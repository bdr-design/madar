package com.ventora.vault

import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.nio.file.attribute.BasicFileAttributes
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.zip.Deflater
import java.util.zip.Inflater

/**
 * The Android save vault (approved «انقل خزنة الحفظ للأندرويد بدقة»): the iPhone vault's protocol and every one of its
 * checks (GlobalSaveVault.swift), so the game's persistence (persistence-core.js) behaves the same on both phones:
 *  - two alternating save files (A/B): a commit writes the slot not holding the newest save, atomically, reads it back and
 *    compares it with what it wrote; a save older than the newest (reset epoch, then revision) is refused;
 *  - a commit lists its chunks (fleet records, sealed collections) and is refused while any is missing; chunks are stored
 *    once per id, checked on every read, and collected in the background ten minutes after nothing lists them;
 *  - three manual slots, a reset with a crash-safe checkpoint (recovered when the vault starts), and the boot script that
 *    hands the newest save to the game before its first script;
 *  - release edition: every file is sealed and encrypted under this device's key ([VaultSeal]).
 *
 * Everything runs on one vault thread ([submit]); the game's thread only hands requests over and receives answers
 * (findings of the save audit: no parsing, hashing, encoding or file work on the UI or JavaScript thread). Unlike the
 * iPhone vault, no caller ever waits for the vault thread from the main thread, and a payload is stored as its own UTF-8
 * bytes after a one-line header instead of an escaped JSON string (no escaping on write, no unescaping on read).
 */
class SaveVault(private val folder: File, private val seal: VaultSeal, private val now: () -> Long = System::currentTimeMillis) {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor { Thread(it, "ventora-save-vault").apply { isDaemon = true } }
    private val collector: ExecutorService = Executors.newSingleThreadExecutor { Thread(it, "ventora-save-vault-gc").apply { isDaemon = true; priority = Thread.MIN_PRIORITY } }
    private val chunkFolder = File(folder, "chunks")
    private var slotHeaders = HashMap<String, SlotHeader>()
    private val recentUploads = HashMap<String, Long>()
    private val commitTimings = LinkedHashMap<Int, Map<String, Double>>()
    private var collecting = false
    private var lastCollection: Map<String, Double>? = null
    @Volatile var startupError: String? = null
        private set

    init {
        executor.execute {
            // A crash before a reset committed returns to the pinned old save. A failed recovery keeps the journal, so the
            // boot script and every write fail closed until it succeeds.
            try { recoverPendingReset() } catch (error: Exception) { startupError = error.message ?: "reset recovery failed" }
        }
    }

    /** Runs [work] on the vault thread and gives its result to [done] there (the caller moves it to its own thread). */
    fun <T> submit(work: () -> T, done: (Result<T>) -> Unit) { executor.execute { done(runCatching(work)) } }

    /** Waits for the vault thread (tests and the WebView's loader thread only; never the main thread). */
    fun <T> await(timeoutMs: Long = 30_000, work: () -> T): T = try {
        executor.submit<T> { work() }.get(timeoutMs, TimeUnit.MILLISECONDS)
    } catch (error: java.util.concurrent.ExecutionException) { throw error.cause ?: error }

    fun shutdown() { executor.shutdown(); collector.shutdownNow() }

    // ---- the payload ------------------------------------------------------------------------------------------------

    class PayloadInfo(val simSeconds: Double, val saveRevision: Long, val resetEpoch: Double, val chunkIds: List<String>?)
    class Prepared(val data: ByteArray, val sha256: String, val info: PayloadInfo)

    private fun parsed(data: ByteArray): PayloadInfo {
        if (data.size > MAX_PAYLOAD) throw VaultException("Save payload is not valid JSON.")
        return payloadInfo(SaveJsonHeader.inspect(data))
    }

    fun prepare(data: ByteArray): Prepared = Prepared(data, VaultSeal.sha256Hex(data), parsed(data))

    private fun payloadInfo(root: SaveJsonHeader): PayloadInfo {
        val version = (root.saveVersion as? SaveJsonHeader.Value.Str)?.value
        if (version == null || version !in SUPPORTED) throw VaultException("Unsupported save schema.")
        fun number(value: SaveJsonHeader.Value, fallback: Double?, strings: Boolean = false): Double? = when (value) {
            SaveJsonHeader.Value.Absent -> fallback
            is SaveJsonHeader.Value.Num -> value.value
            is SaveJsonHeader.Value.Str -> if (strings) value.value.toDoubleOrNull() else null
            else -> null
        }
        val sim = number(root.simSeconds, null, true)
        if (sim == null || !sim.isFinite() || sim < 0) throw VaultException("Invalid simulation clock in save.")
        val revision = number(root.saveRevision, 0.0)
        if (!whole(revision)) throw VaultException("Invalid save revision.")
        val reset = number(root.resetEpoch, 0.0)
        if (!whole(reset)) throw VaultException("Invalid reset epoch.")
        return PayloadInfo(sim, revision!!.toLong(), reset!!, chunkManifest(root))
    }

    private fun whole(value: Double?) = value != null && value.isFinite() && value >= 0 && value <= MAX_SAFE && Math.floor(value) == value

    /** fleet.rows.chunks of a 'chunks-v1' manifest, then stateCodec.chunks; [] without either; null when one is invalid. */
    private fun chunkManifest(root: SaveJsonHeader): List<String>? {
        val ids = ArrayList<String>()
        if (root.fleetRows && root.rowsBinary == SaveJsonHeader.Value.Str("chunks-v1")) {
            val fleet = root.chunks ?: return null
            if (!fleet.all(::isValidChunkId)) return null
            ids.addAll(fleet)
        }
        if (root.stateChunksSeen) {
            val text = root.stateChunks ?: return null
            if (!text.all(::isValidChunkId)) return null
            ids.addAll(text)
        }
        return ids
    }

    /**
     * The bridge's envelope, checked on the vault thread (the iPhone's validateBridgeEnvelope): the request, the action,
     * a supported schema, the revision and reset epoch matching the payload's own, and its SHA-256 matching saveHash.
     */
    fun validateEnvelope(meta: Map<String, Any?>, json: ByteArray, action: String): Prepared {
        fun integer(value: Any?): Double? = (value as? Number)?.toDouble()?.takeIf { whole(it) }
        val requestId = meta["requestId"] as? String
        val schema = meta["saveSchemaVersion"] as? String
        val hash = meta["saveHash"] as? String
        if (requestId.isNullOrEmpty() || requestId.length > 200 || meta["action"] != action || schema == null || schema !in SUPPORTED ||
            hash == null || hash.length != 64 || !hash.all { it in '0'..'9' || it in 'a'..'f' } || json.size > MAX_PAYLOAD) throw VaultException(INVALID_ENVELOPE)
        val root = SaveJsonHeader.inspect(json)
        fun rootInteger(value: SaveJsonHeader.Value, absent: Double?): Double? = when (value) {
            SaveJsonHeader.Value.Absent -> absent
            is SaveJsonHeader.Value.Num -> value.value.takeIf { whole(it) }
            else -> null
        }
        if ((root.saveVersion as? SaveJsonHeader.Value.Str)?.value != schema) throw VaultException(INVALID_ENVELOPE)
        val revision = integer(meta["saveRevision"]); val rootRevision = rootInteger(root.saveRevision, null)
        val epoch = integer(meta["resetEpoch"]); val rootEpoch = rootInteger(root.resetEpoch, 0.0)
        if (revision == null || rootRevision == null || revision != rootRevision || epoch == null || rootEpoch == null || epoch != rootEpoch) throw VaultException(INVALID_ENVELOPE)
        val digest = VaultSeal.sha256Hex(json)
        if (digest != hash) throw VaultException(INVALID_ENVELOPE)
        return Prepared(json, digest, payloadInfo(root))
    }

    // ---- files ------------------------------------------------------------------------------------------------------

    private class FileIdentity(val size: Long, val modified: Long, val key: String?) {
        override fun equals(other: Any?) = other is FileIdentity && other.size == size && other.modified == modified && other.key == key
        override fun hashCode() = (size * 31 + modified).hashCode()
    }

    private fun identity(file: File): FileIdentity? = try {
        val attributes = Files.readAttributes(file.toPath(), BasicFileAttributes::class.java)
        FileIdentity(attributes.size(), attributes.lastModifiedTime().to(TimeUnit.NANOSECONDS), attributes.fileKey()?.toString())
    } catch (_: Exception) { null }

    /** Atomic replace: a temporary file in the same folder, synced, then moved over the destination. */
    private fun writeAtomic(file: File, bytes: ByteArray) {
        folder.mkdirs()
        val temp = File(file.parentFile, ".${file.name}.${System.nanoTime()}.tmp")
        try {
            FileOutputStream(temp).use { out -> out.write(bytes); out.fd.sync() }
            Files.move(temp.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } finally { temp.delete() }
    }

    /** Writes a vault file (encrypted in the release edition) and proves the disk holds exactly those bytes. */
    private fun writeVerified(file: File, plain: ByteArray, failure: String): FileIdentity {
        val stored = seal.fileBytes(plain)
        writeAtomic(file, stored)
        val written = runCatching { file.readBytes() }.getOrNull()
        if (written == null || !written.contentEquals(stored)) throw VaultException(failure)
        return identity(file) ?: throw VaultException(failure)
    }

    private fun readPlain(file: File): ByteArray? = runCatching { file.readBytes() }.getOrNull()?.let(seal::plainBytes)

    /** A header line (the vault's own JSON) and the payload's bytes: "<MAGIC>\n<header>\n<payload>". */
    private fun frame(magic: String, header: Map<String, Any?>, payload: ByteArray?): ByteArray {
        val head = (magic + "\n" + MiniJson.stringify(header) + "\n").toByteArray(Charsets.UTF_8)
        return if (payload == null) head else head + payload
    }

    private class Framed(val header: Map<*, *>, val payload: ByteArray)

    private fun unframe(magic: String, bytes: ByteArray): Framed? {
        val prefix = (magic + "\n").toByteArray(Charsets.UTF_8)
        if (bytes.size < prefix.size) return null
        for (k in prefix.indices) if (bytes[k] != prefix[k]) return null
        var end = prefix.size
        while (end < bytes.size && bytes[end] != NEWLINE) end++
        if (end >= bytes.size) return null
        val header = runCatching { MiniJson.parse(String(bytes, prefix.size, end - prefix.size, Charsets.UTF_8)) }.getOrNull() as? Map<*, *> ?: return null
        return Framed(header, bytes.copyOfRange(end + 1, bytes.size))
    }

    private fun slotFile(slot: String) = File(folder, "save-$slot.vault")
    private fun manualFile(index: Int) = File(folder, "manual-slot-${index + 1}.vault")
    private fun manualBackupFile(index: Int) = File(folder, "pending-manual-slot-${index + 1}.vault")
    private val resetFile get() = File(folder, "pending-reset.vault")

    // ---- A/B commits ------------------------------------------------------------------------------------------------

    class Envelope(val generation: Int, val slot: String, val runtimeVersion: String?, val simSeconds: Double, val saveRevision: Long,
                   val resetEpoch: Double, val sha256: String, val seal: String?, val payload: ByteArray, val chunkIds: List<String>)

    private class SlotHeader(val generation: Int, val slot: String, val saveRevision: Long, val resetEpoch: Double, val chunkIds: List<String>, val file: FileIdentity)

    private fun readEnvelope(slot: String): Envelope? {
        val framed = readPlain(slotFile(slot))?.let { unframe(SLOT_MAGIC, it) } ?: return null
        val h = framed.header
        val generation = (h["generation"] as? Double)?.takeIf { whole(it) && it > 0 }?.toInt() ?: return null
        if (h["schemaVersion"] != VAULT_SCHEMA || h["slot"] != slot) return null
        val info = runCatching { parsed(framed.payload) }.getOrNull() ?: return null
        val sha = h["sha256"] as? String ?: return null
        if (VaultSeal.sha256Hex(framed.payload) != sha || !seal.matches(h["seal"] as? String, framed.payload)) return null
        if ((h["simSeconds"] as? Double) != info.simSeconds || (h["saveRevision"] as? Double)?.toLong() != info.saveRevision || (h["resetEpoch"] as? Double) != info.resetEpoch) return null
        return Envelope(generation, slot, h["runtimeVersion"] as? String, info.simSeconds, info.saveRevision, info.resetEpoch, sha, h["seal"] as? String, framed.payload, info.chunkIds ?: return null)
    }

    private fun envelopes(): List<Envelope> = SLOTS.mapNotNull { slot ->
        val file = slotFile(slot)
        val id = identity(file)
        val envelope = if (id != null) readEnvelope(slot) else null
        if (envelope != null && id != null) slotHeaders[slot] = SlotHeader(envelope.generation, slot, envelope.saveRevision, envelope.resetEpoch, envelope.chunkIds, id) else slotHeaders.remove(slot)
        envelope
    }

    private fun bestEnvelope(): Envelope? = envelopes().maxByOrNull { it.generation }

    /** The newest verified header; a slot file this vault verified and that is still the same file is not read again. */
    private fun currentHeader(): SlotHeader? {
        var best: SlotHeader? = null
        for (slot in SLOTS) {
            val id = identity(slotFile(slot))
            if (id == null) { slotHeaders.remove(slot); continue }
            val cached = slotHeaders[slot]
            val header = if (cached != null && cached.file == id) cached else {
                slotHeaders.remove(slot)
                val envelope = readEnvelope(slot) ?: continue
                SlotHeader(envelope.generation, slot, envelope.saveRevision, envelope.resetEpoch, envelope.chunkIds, id).also { slotHeaders[slot] = it }
            }
            if (best == null || header.generation > best.generation) best = header
        }
        return best
    }

    fun commit(prepared: Prepared, runtimeVersion: String?, allowRegression: Boolean = false, extraStages: Map<String, Double> = emptyMap()): Int {
        val stages = LinkedHashMap(extraStages)
        var mark = System.nanoTime()
        fun lap(name: String) { val t = System.nanoTime(); stages[name] = (stages[name] ?: 0.0) + (t - mark) / 1e6; mark = t }
        if (!allowRegression && resetFile.exists()) throw VaultException("Reset recovery is pending.")
        if (!allowRegression && startupError != null) throw VaultException("Reset recovery is pending.")
        val chunkIds = requireChunks(prepared.info.chunkIds)
        folder.mkdirs()
        val current = currentHeader()
        lap("currentSlotMs")
        if (!allowRegression && current == null && SLOTS.any { slotFile(it).exists() }) throw VaultException("No valid native save remains; recovery required.")
        if (!allowRegression && current != null) {
            val info = prepared.info
            if (info.resetEpoch < current.resetEpoch || (info.resetEpoch == current.resetEpoch && info.saveRevision < current.saveRevision)) throw VaultException("Stale native save rejected.")
        }
        val generation = (current?.generation ?: 0) + 1
        if (generation <= 0) throw VaultException("Native save generation exhausted.")
        val slot = if (current?.slot == "A") "B" else "A"
        val header = linkedMapOf<String, Any?>("generation" to generation, "slot" to slot, "schemaVersion" to VAULT_SCHEMA, "runtimeVersion" to runtimeVersion,
            "simSeconds" to prepared.info.simSeconds, "saveRevision" to prepared.info.saveRevision, "resetEpoch" to prepared.info.resetEpoch,
            "savedAt" to now() / 1000.0, "sha256" to prepared.sha256, "seal" to seal.sealForWrite(prepared.data))
        val bytes = frame(SLOT_MAGIC, header, prepared.data)
        lap("encodeMs")
        slotHeaders.remove(slot)
        val file = writeVerified(slotFile(slot), bytes, "Native save verification failed after write.")
        slotHeaders[slot] = SlotHeader(generation, slot, prepared.info.saveRevision, prepared.info.resetEpoch, chunkIds, file)
        lap("writeVerifyMs")
        scheduleCollection()
        stages["chunkGcMs"] = 0.0; stages["chunkGcDeferred"] = 1.0
        lastCollection?.forEach { (key, value) -> stages[key] = value }
        stages["payloadBytes"] = prepared.data.size.toDouble(); stages["envelopeBytes"] = bytes.size.toDouble()
        commitTimings[generation] = stages
        while (commitTimings.size > 8) commitTimings.remove(commitTimings.keys.first())
        return generation
    }

    fun takeCommitTimings(generation: Int): Map<String, Double>? = commitTimings.remove(generation)
    fun currentGeneration(): Int = bestEnvelope()?.generation ?: 0
    fun currentPayload(): ByteArray? = bestEnvelope()?.payload

    // ---- manual slots -----------------------------------------------------------------------------------------------

    class SlotMetadata(val index: Int, val runtimeVersion: String?, val simSeconds: Double, val saveRevision: Long, val resetEpoch: Double, val savedAt: Double, val label: String) {
        fun toMap(): Map<String, Any?> = linkedMapOf("index" to index, "simSeconds" to simSeconds, "saveRevision" to saveRevision, "resetEpoch" to resetEpoch,
            "savedAt" to savedAt, "label" to label).also { if (runtimeVersion != null) it["runtimeVersion"] = runtimeVersion }
    }

    private class ManualSlot(val metadata: SlotMetadata, val sha256: String, val seal: String?, val payload: ByteArray)

    private fun validIndex(index: Int): Int { if (index !in 0..2) throw VaultException("Invalid manual save slot."); return index }

    fun saveManualSlot(index: Int, prepared: Prepared, label: String, runtimeVersion: String?): SlotMetadata {
        validIndex(index)
        requireChunks(prepared.info.chunkIds)
        val metadata = SlotMetadata(index, runtimeVersion, prepared.info.simSeconds, prepared.info.saveRevision, prepared.info.resetEpoch, now() / 1000.0, label.take(120))
        val header = linkedMapOf<String, Any?>("format" to SLOT_FORMAT, "schemaVersion" to VAULT_SCHEMA, "metadata" to metadata.toMap(), "sha256" to prepared.sha256, "seal" to seal.sealForWrite(prepared.data))
        writeVerified(manualFile(index), frame(MANUAL_MAGIC, header, prepared.data), "Manual save slot verification failed.")
        return metadata
    }

    private fun readManualSlot(index: Int): ManualSlot? {
        if (index !in 0..2) return null
        val framed = readPlain(manualFile(index))?.let { unframe(MANUAL_MAGIC, it) } ?: return null
        val h = framed.header
        val m = h["metadata"] as? Map<*, *> ?: return null
        if (h["format"] != SLOT_FORMAT || h["schemaVersion"] != VAULT_SCHEMA || (m["index"] as? Double)?.toInt() != index) return null
        val sim = m["simSeconds"] as? Double ?: return null; val revision = m["saveRevision"] as? Double ?: return null; val epoch = m["resetEpoch"] as? Double ?: return null
        if (!sim.isFinite() || sim < 0 || !whole(revision) || !whole(epoch)) return null
        val sha = h["sha256"] as? String ?: return null
        if (VaultSeal.sha256Hex(framed.payload) != sha || !seal.matches(h["seal"] as? String, framed.payload)) return null
        val info = runCatching { parsed(framed.payload) }.getOrNull() ?: return null
        if (info.simSeconds != sim || info.saveRevision != revision.toLong() || info.resetEpoch != epoch) return null
        val metadata = SlotMetadata(index, m["runtimeVersion"] as? String, sim, revision.toLong(), epoch, (m["savedAt"] as? Double) ?: 0.0, (m["label"] as? String).orEmpty())
        return ManualSlot(metadata, sha, h["seal"] as? String, framed.payload)
    }

    fun manualSlotMetadata(): List<SlotMetadata> = (0..2).mapNotNull { readManualSlot(it)?.metadata }

    fun clearManualSlot(index: Int) { validIndex(index); manualFile(index).delete() }

    /** Loads a manual slot as the newest save (twice: both A/B slots), with the same crash-safe checkpoint as a reset. */
    fun loadManualSlot(index: Int, runtimeVersion: String?): Int {
        validIndex(index)
        val slot = readManualSlot(index) ?: throw VaultException("Manual save slot is unavailable.")
        recoverPendingReset()
        writeCheckpoint(bestEnvelope(), clearManualSlots = false, hashes = null)
        return try {
            val prepared = prepare(slot.payload)
            commit(prepared, runtimeVersion ?: slot.metadata.runtimeVersion, allowRegression = true)
            val generation = commit(prepared, runtimeVersion ?: slot.metadata.runtimeVersion, allowRegression = true)
            resetFile.delete()
            generation
        } catch (failure: Exception) {
            try { recoverPendingReset() } catch (error: Exception) { throw VaultException("CRITICAL: manual slot load compensation failed: ${error.message}") }
            throw failure
        }
    }

    // ---- reset ------------------------------------------------------------------------------------------------------

    private fun rawHash(file: File): String? = if (file.exists()) VaultSeal.sha256Hex(file.readBytes()) else null

    private fun writeCheckpoint(current: Envelope?, clearManualSlots: Boolean, hashes: List<String?>?) {
        val header = linkedMapOf<String, Any?>("runtimeVersion" to current?.runtimeVersion, "sha256" to current?.sha256, "seal" to current?.seal,
            "hasPayload" to (current != null), "clearManualSlots" to clearManualSlots, "manualSlotHashes" to hashes)
        writeVerified(resetFile, frame(RESET_MAGIC, header, current?.payload), "Reset checkpoint verification failed.")
    }

    /** A reset without a window for the old game: the clean save written to both A/B slots, a checkpoint first. */
    fun resetTo(prepared: Prepared, runtimeVersion: String?, clearManualSlots: Boolean): Int {
        recoverPendingReset()
        folder.mkdirs()
        val hashes = if (clearManualSlots) (0..2).map { rawHash(manualFile(it)) } else null
        writeCheckpoint(bestEnvelope(), clearManualSlots, hashes)
        return try {
            if (hashes != null) stageManualSlots(hashes)
            commit(prepared, runtimeVersion, allowRegression = true)
            val generation = commit(prepared, runtimeVersion, allowRegression = true)
            resetFile.delete()
            if (clearManualSlots) (0..2).forEach { manualBackupFile(it).delete() }
            generation
        } catch (failure: Exception) {
            try { recoverPendingReset() } catch (error: Exception) { throw VaultException("CRITICAL: reset compensation failed: ${error.message}") }
            throw failure
        }
    }

    /** Two-phase: every manual slot copied and its copy verified before any is removed. */
    private fun stageManualSlots(hashes: List<String?>) {
        for (index in 0..2) {
            val source = manualFile(index); val backup = manualBackupFile(index)
            backup.delete()
            val expected = hashes[index]
            if (expected == null) { if (source.exists()) throw VaultException("Manual slot set changed while reset was staged."); continue }
            if (rawHash(source) != expected) throw VaultException("Manual slot source changed before reset staging.")
            Files.copy(source.toPath(), backup.toPath(), StandardCopyOption.REPLACE_EXISTING)
            if (rawHash(backup) != expected) throw VaultException("Manual slot reset backup verification failed.")
        }
        for (index in 0..2) manualFile(index).delete()
    }

    private fun restoreManualSlots(hashes: List<String?>) {
        for (index in 0..2) {
            val source = manualFile(index); val backup = manualBackupFile(index); val expected = hashes[index]
            if (expected == null) { source.delete(); backup.delete(); continue }
            if (backup.exists() && rawHash(backup) == expected) {
                Files.move(backup.toPath(), source.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); continue
            }
            if (source.exists() && rawHash(source) == expected) { backup.delete(); continue }
            throw VaultException("Manual slot reset recovery could not verify the original slot.")
        }
    }

    private fun recoverPendingReset() {
        if (!resetFile.exists()) { (0..2).forEach { manualBackupFile(it).delete() }; return }
        val framed = readPlain(resetFile)?.let { unframe(RESET_MAGIC, it) } ?: throw VaultException("Reset checkpoint is unreadable.")
        val h = framed.header
        if (h["hasPayload"] == true) {
            val prepared = prepare(framed.payload)
            if (h["sha256"] != prepared.sha256 || !seal.matches(h["seal"] as? String, prepared.data)) throw VaultException("Reset checkpoint hash mismatch.")
            commit(prepared, h["runtimeVersion"] as? String, allowRegression = true)
            commit(prepared, h["runtimeVersion"] as? String, allowRegression = true)
        } else {
            SLOTS.forEach { slotFile(it).delete(); slotHeaders.remove(it) }
        }
        if (h["clearManualSlots"] == true) {
            val hashes = (h["manualSlotHashes"] as? List<*>)?.map { it as? String }
            if (hashes == null || hashes.size != 3) throw VaultException("Manual slot reset checkpoint is incomplete.")
            restoreManualSlots(hashes)
        }
        resetFile.delete()
        (0..2).forEach { manualBackupFile(it).delete() }
        startupError = null
    }

    // ---- chunks -----------------------------------------------------------------------------------------------------
    //   chunks/<id>.chunk: "GHCHUNKD" | keyed digest of the raw bytes (32) | raw length (u64 LE) | Deflate (fast)

    fun isValidChunkId(id: String): Boolean = id.isNotEmpty() && id.length <= 160 && id != "." && id != ".." &&
        id.all { it in '0'..'9' || it in 'A'..'Z' || it in 'a'..'z' || it == '.' || it == '_' || it == '-' }

    private fun chunkFile(id: String) = File(chunkFolder, "$id.chunk")

    /** The fallback bridge's base64 (as the game sends it without a raw upload route) is decoded here, on the vault thread. */
    fun storeChunkBase64(id: String, text: String, encoding: String, rawBytes: Int?): String {
        if (text.length > 96 * 1024 * 1024) throw VaultException("Invalid save chunk upload.")
        val wire = try { java.util.Base64.getDecoder().decode(text) } catch (_: IllegalArgumentException) { throw VaultException("Invalid save chunk upload.") }
        return storeChunk(id, ChunkTransport.decode(wire, encoding, rawBytes))
    }

    fun storeChunk(id: String, data: ByteArray): String {
        if (!isValidChunkId(id)) throw VaultException("Invalid save chunk id.")
        if (data.isEmpty() || data.size > 64 * 1024 * 1024) throw VaultException("Invalid save chunk size.")
        val digest = VaultSeal.sha256Hex(data)
        val file = chunkFile(id)
        if (file.exists()) {
            val existing = runCatching { readChunk(id) }.getOrNull()
            if (existing == null || !existing.contentEquals(data)) throw VaultException("Save chunk id reused with other bytes.")
            recentUploads[id] = now(); return digest
        }
        chunkFolder.mkdirs()
        val deflater = Deflater(Deflater.BEST_SPEED)
        val compressed = try {
            deflater.setInput(data); deflater.finish()
            val out = java.io.ByteArrayOutputStream(data.size / 2 + 64); val buffer = ByteArray(64 * 1024)
            while (!deflater.finished()) out.write(buffer, 0, deflater.deflate(buffer))
            out.toByteArray()
        } finally { deflater.end() }
        val head = java.io.ByteArrayOutputStream(48 + compressed.size)
        head.write(CHUNK_MAGIC); head.write(seal.chunkDigest(data))
        var length = data.size.toLong(); repeat(8) { head.write((length and 0xFF).toInt()); length = length ushr 8 }
        head.write(compressed)
        writeAtomic(file, head.toByteArray())
        val verified = runCatching { readChunk(id) }.getOrNull()
        if (verified == null || !verified.contentEquals(data)) { file.delete(); throw VaultException("Save chunk verification failed after write.") }
        recentUploads[id] = now()
        return digest
    }

    fun readChunk(id: String): ByteArray {
        if (!isValidChunkId(id)) throw VaultException("Invalid save chunk id.")
        val file = runCatching { chunkFile(id).readBytes() }.getOrNull() ?: throw VaultException("Save chunk is corrupt.")
        if (file.size < 48) throw VaultException("Save chunk is corrupt.")
        for (k in CHUNK_MAGIC.indices) if (file[k] != CHUNK_MAGIC[k]) throw VaultException("Save chunk is corrupt.")
        var length = 0L; for (k in 7 downTo 0) length = (length shl 8) or (file[40 + k].toLong() and 0xFF)
        if (length <= 0 || length > 64L * 1024 * 1024) throw VaultException("Save chunk is corrupt.")
        val raw = ByteArray(length.toInt())
        val inflater = Inflater()
        try {
            inflater.setInput(file, 48, file.size - 48)
            var at = 0
            while (at < raw.size) { val n = inflater.inflate(raw, at, raw.size - at); if (n == 0 && (inflater.finished() || inflater.needsInput())) break; at += n }
            // Exactly the stated length: the stream must end here (one more byte would be a longer chunk).
            if (at == raw.size && !inflater.finished() && inflater.inflate(ByteArray(1)) != 0) throw VaultException("Save chunk is corrupt.")
            if (at != raw.size || !inflater.finished()) throw VaultException("Save chunk is corrupt.")
        } catch (error: java.util.zip.DataFormatException) { throw VaultException("Save chunk is corrupt.") } finally { inflater.end() }
        if (!java.security.MessageDigest.isEqual(seal.chunkDigest(raw), file.copyOfRange(8, 40))) throw VaultException("Save chunk is corrupt.")
        return raw
    }

    private fun requireChunks(manifest: List<String>?): List<String> {
        val ids = manifest ?: throw VaultException("Invalid save chunk manifest.")
        for (id in ids) if (!chunkFile(id).exists()) throw VaultException("Missing save chunk: $id")
        return ids
    }

    // ---- chunk collection (never on the commit path) ----------------------------------------------------------------
    // Candidates: chunk files not uploaded in the last ten minutes and not listed by a verified A/B header still on disk.
    // Every other vault file is read (decrypted) on the collector thread and any candidate id appearing in it is kept; an
    // unreadable file stops the pass (a referenced chunk is never deleted). Deleting returns to the vault thread, at most
    // eight files per batch, and only while every protecting file is still the same file.

    private fun scheduleCollection() {
        if (collecting) return
        collecting = true
        val cutoff = now() - GRACE_MS
        recentUploads.entries.removeAll { it.value <= cutoff }
        val recent = HashSet(recentUploads.keys)
        val headers = slotHeaders.values.map { Triple(slotFile(it.slot), it.file, it.chunkIds.toSet()) }
        val started = System.nanoTime()
        collector.execute {
            val plan = runCatching { plan(recent, headers) }.getOrNull()
            executor.execute {
                if (plan == null) { collecting = false; return@execute }
                sweep(plan, started, 0)
            }
        }
    }

    private class Plan(val candidates: Set<String>, val protectedIds: Set<String>, val files: Map<String, FileIdentity>, val scanned: Long, val ok: Boolean)

    private fun protectingFiles(): List<File> = folder.listFiles { file -> file.isFile && file.name.endsWith(".vault") }?.toList() ?: emptyList()

    private fun plan(recent: Set<String>, headers: List<Triple<File, FileIdentity, Set<String>>>): Plan? {
        val names = chunkFolder.list() ?: return null
        val candidates = names.filter { it.endsWith(".chunk") }.map { it.removeSuffix(".chunk") }.toMutableSet()
        candidates.removeAll(recent)
        if (candidates.isEmpty()) return null
        val files = HashMap<String, FileIdentity>()
        for (file in protectingFiles()) files[file.path] = identity(file) ?: return null
        val headerFiles = HashSet<String>()
        for ((file, id, ids) in headers) if (files[file.path] == id) { candidates.removeAll(ids); headerFiles.add(file.path) }
        if (candidates.isEmpty()) return null
        val kept = HashSet<String>(); var scanned = 0L
        for (file in protectingFiles()) {
            if (file.path in headerFiles) continue
            val bytes = readPlain(file) ?: return Plan(candidates, kept, files, scanned, ok = false)
            scanned += bytes.size
            var start = -1
            for (k in 0..bytes.size) {
                val c = if (k < bytes.size) bytes[k].toInt().toChar() else ' '
                val idChar = c in '0'..'9' || c in 'A'..'Z' || c in 'a'..'z' || c == '.' || c == '_' || c == '-'
                if (idChar) { if (start < 0) start = k } else if (start >= 0) {
                    if (k - start <= 160) { val token = String(bytes, start, k - start, Charsets.US_ASCII); if (token in candidates) kept.add(token) }
                    start = -1
                }
            }
        }
        return Plan(candidates, kept, files, scanned, ok = true)
    }

    private fun sweep(plan: Plan, started: Long, deleted: Int) {
        val present = HashMap<String, FileIdentity>()
        for (file in protectingFiles()) present[file.path] = identity(file) ?: run { abort(plan, started, deleted); return }
        if (!plan.ok || present != plan.files) { abort(plan, started, deleted); return }
        val cutoff = now() - GRACE_MS
        recentUploads.entries.removeAll { it.value <= cutoff }
        val safe = (plan.candidates - plan.protectedIds).filter { it !in recentUploads }.sorted()
        val batch = safe.take(DELETE_BATCH)
        var removed = 0
        for (id in batch) if (chunkFile(id).delete()) removed++
        val rest = safe.drop(DELETE_BATCH).toSet()
        if (rest.isNotEmpty()) {
            val next = Plan(rest, plan.protectedIds, plan.files, plan.scanned, plan.ok)
            collector.execute { Thread.sleep(25); executor.execute { sweep(next, started, deleted + removed) } }
            return
        }
        record(plan, started, deleted + removed, aborted = false)
        collecting = false
    }

    private fun abort(plan: Plan, started: Long, deleted: Int) {
        record(plan, started, deleted, aborted = true)
        collecting = false
    }

    private fun record(plan: Plan, started: Long, deleted: Int, aborted: Boolean) {
        lastCollection = mapOf("backgroundChunkGcMs" to (System.nanoTime() - started) / 1e6, "backgroundChunkGcScannedBytes" to plan.scanned.toDouble(),
            "backgroundChunkGcCandidates" to plan.candidates.size.toDouble(), "backgroundChunkGcProtected" to plan.protectedIds.size.toDouble(),
            "backgroundChunkGcDeleted" to deleted.toDouble(), "backgroundChunkGcAborted" to if (aborted) 1.0 else 0.0)
    }

    /** A test or maintenance barrier: runs one collection and waits for it (never used by gameplay saves). */
    fun collectNow(timeoutMs: Long = 30_000) {
        await { scheduleCollection() }
        val deadline = System.currentTimeMillis() + timeoutMs
        while (await { collecting }) { if (System.currentTimeMillis() > deadline) throw VaultException("collection timed out"); Thread.sleep(5) }
    }

    /** Test access: forget the upload times (as ten minutes passing would). */
    internal fun expireUploadsForTesting() { await { recentUploads.clear() } }

    // ---- the boot script --------------------------------------------------------------------------------------------

    /**
     * The script the game runs before its first own script (served by the shell as /vault/boot.js), as the iPhone's
     * bootstrapJavaScript: the newest save as window.__GH_NATIVE_SAVE_JSON__ (a JavaScript string literal: no base64 and no
     * per-character decoding on the game's thread), its chunks fetched before app.js runs, the save's meta and the manual
     * slots. A pending reset, a refused save file or an unreadable key blocks the boot (the game's recovery path).
     */
    fun bootScript(force: Boolean, pause: Boolean, compatibility: String): String {
        val blocked = "$compatibility;window.GH_NATIVE_RECOVERY_BLOCKED=true;"
        if (resetFile.exists() || startupError != null) return blocked
        if (seal.required && runCatching { seal.sealForWrite(ByteArray(0)) }.isFailure) return blocked
        val envelope = bestEnvelope() ?: return if (SLOTS.any { slotFile(it).exists() }) blocked else compatibility
        val slots = MiniJson.stringify(manualSlotMetadata().map { it.toMap() })
        val ids = MiniJson.stringify(envelope.chunkIds)
        val meta = MiniJson.stringify(linkedMapOf("source" to "native-save-vault", "generation" to envelope.generation, "saveRevision" to envelope.saveRevision,
            "resetEpoch" to envelope.resetEpoch, "simSeconds" to envelope.simSeconds, "forced" to force, "paused" to pause))
        val out = java.io.ByteArrayOutputStream(envelope.payload.size + 4096)
        fun put(text: String) = out.write(text.toByteArray(Charsets.UTF_8))
        put(compatibility)
        put(";(()=>{try{let raw=")
        jsStringLiteral(envelope.payload, out)
        put(";if($pause){const parsed=JSON.parse(raw);parsed.speed=0;raw=JSON.stringify(parsed);}")
        put("window.__GH_NATIVE_SAVE_JSON__=raw;const ids=$ids;")
        put("if(ids.length){const chunks=new Map(),gate={ready:false,failed:null,deferred:null,defer(script){this.deferred=(script&&script.src)||'app.js';}};")
        put("window.__GH_NATIVE_SAVE_CHUNKS__=chunks;window.__GH_BOOT_GATE__=gate;")
        put("let cursor=0,loaded=0,lastReported=-1;const report=()=>{const bucket=Math.floor(loaded/8);if(bucket===lastReported&&loaded!==ids.length)return;lastReported=bucket;try{window.webkit?.messageHandlers?.updateBridge?.postMessage({action:'bootProgress',loaded,total:ids.length});}catch(_e){}};report();")
        put("const worker=async()=>{for(;;){const index=cursor++;if(index>=ids.length)return;const id=ids[index],response=await fetch('/vault/save-chunk/'+encodeURIComponent(id),{cache:'no-store'});if(!response.ok)throw new Error('save-chunk-'+response.status);chunks.set(id,await response.arrayBuffer());loaded++;report();}};")
        put("Promise.all(Array.from({length:Math.min(8,ids.length)},worker)).catch(error=>{gate.failed=String(error&&error.message||error);console.error('GH native save chunks failed',error);})")
        put(".finally(()=>{gate.ready=true;if(gate.deferred){const s=document.createElement('script');s.src=gate.deferred;(document.body||document.documentElement).appendChild(s);}});}")
        put("window.__GH_NATIVE_SAVE_META__=Object.freeze($meta);window.__GH_NATIVE_SLOT_META__=$slots;")
        put("try{sessionStorage.setItem('gh-native-save-restored','1');}catch(_e){}")
        put("}catch(e){window.GH_NATIVE_RECOVERY_BLOCKED=true;console.error('GH native save bootstrap failed',e);}})();")
        return out.toString(Charsets.UTF_8.name())
    }

    companion object {
        const val VAULT_SCHEMA = "2.0.0"
        val SUPPORTED = setOf("2.0.0", "3.0.0")
        private val SLOTS = listOf("A", "B")
        private const val SLOT_MAGIC = "GHVAULT2"
        private const val MANUAL_MAGIC = "GHSLOT2"
        private const val RESET_MAGIC = "GHRESET2"
        private const val SLOT_FORMAT = "global-holdings-native-slot-v1"
        private const val INVALID_ENVELOPE = "Invalid save envelope."
        private const val MAX_PAYLOAD = 30 * 1024 * 1024
        private const val MAX_SAFE = 9.007199254740991E15
        private const val GRACE_MS = 600_000L
        private const val DELETE_BATCH = 8
        private const val NEWLINE: Byte = 0x0A
        private val CHUNK_MAGIC = "GHCHUNKD".toByteArray(Charsets.US_ASCII)

        /** UTF-8 JSON text as a JavaScript string literal: quote, backslash, control characters, U+2028 and U+2029 escaped. */
        fun jsStringLiteral(bytes: ByteArray, out: java.io.ByteArrayOutputStream) {
            val hex = "0123456789abcdef"
            out.write('"'.code)
            var run = 0
            var k = 0
            while (k < bytes.size) {
                val b = bytes[k].toInt() and 0xFF
                val lineSeparator = b == 0xE2 && k + 2 < bytes.size && (bytes[k + 1].toInt() and 0xFF) == 0x80 && ((bytes[k + 2].toInt() and 0xFF) == 0xA8 || (bytes[k + 2].toInt() and 0xFF) == 0xA9)
                if (b != 0x22 && b != 0x5C && b >= 0x20 && !lineSeparator) { k++; continue }
                out.write(bytes, run, k - run)
                when {
                    lineSeparator -> { out.write(if ((bytes[k + 2].toInt() and 0xFF) == 0xA8) "\\u2028".toByteArray() else "\\u2029".toByteArray()); k += 3 }
                    b < 0x20 -> { out.write("\\u00".toByteArray()); out.write(hex[b shr 4].code); out.write(hex[b and 15].code); k++ }
                    else -> { out.write('\\'.code); out.write(b); k++ }
                }
                run = k
            }
            out.write(bytes, run, bytes.size - run)
            out.write('"'.code)
        }
    }
}
