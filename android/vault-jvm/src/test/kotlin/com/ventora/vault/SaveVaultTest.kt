package com.ventora.vault

import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The Android vault against the iPhone vault's contract (GlobalSaveVault.swift), in both editions. */
class SaveVaultTest {
    private val dirs = ArrayList<File>()
    private val vaults = ArrayList<SaveVault>()
    private val secret = ByteArray(32) { (it * 7).toByte() }

    private fun folder() = Files.createTempDirectory("vault").toFile().also { dirs.add(it) }
    private fun open(dir: File, seal: VaultSeal = VaultSeal.fromSecret(secret)) = SaveVault(dir, seal).also { vaults.add(it) }

    @AfterTest fun clean() { vaults.forEach { it.shutdown() }; dirs.forEach { it.deleteRecursively() } }

    private fun json(revision: Int, epoch: Int = 0, cash: Long = 100, chunks: List<String> = emptyList(), state: List<String> = emptyList()): ByteArray {
        val fleet = if (chunks.isEmpty()) "" else ""","fleet":{"rows":{"${'$'}ghBinary":"chunks-v1","chunks":[${chunks.joinToString(",") { "\"$it\"" }}]}}"""
        val codec = if (state.isEmpty()) "" else ""","stateCodec":{"chunks":[${state.joinToString(",") { "\"$it\"" }}]}"""
        return """{"saveVersion":"3.0.0","saveRevision":$revision,"resetEpoch":$epoch,"simSeconds":${86400 + revision},"cash":$cash,"name":"شركة \"أ\"\n"$fleet$codec}""".toByteArray()
    }

    private fun SaveVault.commitNow(data: ByteArray, allow: Boolean = false) = await { commit(prepare(data), "3.0.0", allowRegression = allow) }

    @Test fun commitsAlternateAndReadBack() {
        val dir = folder(); val v = open(dir)
        assertEquals(1, v.commitNow(json(1)))
        assertEquals(2, v.commitNow(json(2)))
        assertTrue(File(dir, "save-A.vault").exists() && File(dir, "save-B.vault").exists(), "A/B alternate")
        assertTrue(v.await { v.currentPayload() }!!.contentEquals(json(2)))
        assertEquals(2, v.await { v.currentGeneration() })
        val stages = v.await { v.takeCommitTimings(2) }!!
        assertTrue(stages.containsKey("writeVerifyMs") && stages["payloadBytes"] == json(2).size.toDouble())
        // A new vault on the same folder (an app restart) finds the newest save.
        val again = open(dir)
        assertTrue(again.await { again.currentPayload() }!!.contentEquals(json(2)))
    }

    @Test fun refusesStaleAndUnchunkedSaves() {
        val v = open(folder())
        v.commitNow(json(5))
        assertFailsWith<VaultException> { v.commitNow(json(4)) }.also { assertEquals("Stale native save rejected.", it.message) }
        v.commitNow(json(5)); v.commitNow(json(1, epoch = 1))
        assertFailsWith<VaultException> { v.commitNow(json(9, epoch = 0)) }
        assertFailsWith<VaultException> { v.commitNow(json(9, epoch = 1, chunks = listOf("f1"))) }.also { assertEquals("Missing save chunk: f1", it.message) }
        assertFailsWith<VaultException> { v.commitNow("""{"saveVersion":"9.0.0","simSeconds":1}""".toByteArray()) }
        assertFailsWith<VaultException> { v.commitNow("""{"saveVersion":"3.0.0","simSeconds":-1}""".toByteArray()) }
    }

    @Test fun releaseFilesAreEncryptedAndAnEditIsRefused() {
        val dir = folder(); val v = open(dir)
        v.commitNow(json(1, cash = 777))
        val file = File(dir, "save-A.vault"); val stored = file.readBytes()
        val text = String(stored, Charsets.ISO_8859_1)
        assertTrue(text.startsWith("GHVF1") && "777" !in text && "cash" !in text && "saveRevision" !in text, "nothing readable in the file")
        stored[stored.size / 2] = (stored[stored.size / 2].toInt() xor 1).toByte(); file.writeBytes(stored)
        val reopened = open(dir)
        assertNull(reopened.await { reopened.currentPayload() }, "an edited save is refused")
        assertFailsWith<VaultException> { reopened.commitNow(json(2)) }.also { assertEquals("No valid native save remains; recovery required.", it.message) }
        assertTrue(reopened.await { reopened.bootScript(false, false, "C") }.contains("GH_NATIVE_RECOVERY_BLOCKED=true"), "the boot is blocked")
        val foreign = open(dir, VaultSeal.fromSecret(ByteArray(32) { 1 }))
        assertNull(foreign.await { foreign.currentPayload() }, "another device's save is refused")
    }

    @Test fun developmentFilesStayPlainAndUnsealed() {
        val dir = folder(); val v = open(dir, VaultSeal.DEVELOPMENT)
        v.commitNow(json(1, cash = 777))
        val text = File(dir, "save-A.vault").readText()
        assertTrue(text.startsWith("GHVAULT2\n") && text.contains("\"seal\":null") && text.contains("\"cash\":777"))
    }

    @Test fun anUnavailableKeyRefusesEverything() {
        val dir = folder(); open(dir).commitNow(json(1))
        val v = open(dir, VaultSeal.unavailable())
        assertNull(v.await { v.currentPayload() })
        assertFailsWith<VaultException> { v.commitNow(json(2), allow = true) }
        assertTrue(v.await { v.bootScript(false, false, "C") }.contains("GH_NATIVE_RECOVERY_BLOCKED=true"))
    }

    @Test fun envelopesAreCheckedOnTheVaultThread() {
        val v = open(folder()); val data = json(3, epoch = 1)
        val good = mapOf<String, Any?>("requestId" to "commitSave-1", "action" to "commitSave", "saveSchemaVersion" to "3.0.0", "saveHash" to VaultSeal.sha256Hex(data), "saveRevision" to 3.0, "resetEpoch" to 1.0)
        assertEquals(3L, v.validateEnvelope(good, data, "commitSave").info.saveRevision)
        for ((key, value) in listOf("action" to "saveManualSlot", "saveHash" to "0".repeat(64), "saveRevision" to 4.0, "resetEpoch" to 0.0, "saveSchemaVersion" to "1.0.0", "requestId" to "", "saveRevision" to 3.5))
            assertFailsWith<VaultException>("$key=$value") { v.validateEnvelope(good + (key to value), data, "commitSave") }
    }

    @Test fun chunksAreStoredOnceCheckedAndRequired() {
        val dir = folder(); val v = open(dir)
        val raw = ByteArray(200_000) { (it % 251).toByte() }
        assertEquals(VaultSeal.sha256Hex(raw), v.await { v.storeChunk("f1", raw) })
        assertTrue(v.await { v.readChunk("f1") }.contentEquals(raw))
        v.await { v.storeChunk("f1", raw) }
        assertFailsWith<VaultException> { v.await { v.storeChunk("f1", raw.copyOf(10)) } }.also { assertEquals("Save chunk id reused with other bytes.", it.message) }
        assertFailsWith<VaultException> { v.await { v.storeChunk("../x", raw) } }
        val b64 = java.util.Base64.getEncoder().encodeToString("text chunk".toByteArray())
        v.await { v.storeChunkBase64("t1", b64, "identity", 10) }
        assertEquals(2, v.commitNow(json(1, chunks = listOf("f1"), state = listOf("t1"))).let { v.commitNow(json(2, chunks = listOf("f1"), state = listOf("t1"))) })
        val file = File(dir, "chunks/f1.chunk"); val bytes = file.readBytes(); bytes[bytes.size - 3] = (bytes[bytes.size - 3].toInt() xor 0x55).toByte(); file.writeBytes(bytes)
        assertFailsWith<VaultException> { v.await { v.readChunk("f1") } }
        assertFailsWith<VaultException> { open(dir, VaultSeal.fromSecret(ByteArray(32) { 3 })).let { o -> o.await { o.readChunk("t1") } } }
    }

    @Test fun collectionKeepsWhatAnyFileListsAndRemovesTheRest() {
        val dir = folder(); val v = open(dir)
        for (id in listOf("keep-ab", "keep-slot", "gone-1", "gone-2")) v.await { v.storeChunk(id, id.toByteArray()) }
        v.await { v.saveManualSlot(0, v.prepare(json(1, state = listOf("keep-slot"))), "slot", "3.0.0") }
        v.commitNow(json(2, state = listOf("keep-ab")))
        v.collectNow()
        assertEquals(4, File(dir, "chunks").list()!!.size, "nothing is collected within ten minutes of its upload")
        v.expireUploadsForTesting(); v.collectNow()
        assertEquals(setOf("keep-ab.chunk", "keep-slot.chunk"), File(dir, "chunks").list()!!.toSet(), "an encrypted manual slot still protects its chunk")
        assertTrue(v.await { v.readChunk("keep-slot") }.contentEquals("keep-slot".toByteArray()))
    }

    @Test fun collectionStopsWhenAFileCannotBeRead() {
        val dir = folder(); val v = open(dir)
        v.await { v.storeChunk("maybe", "x".toByteArray()) }
        v.commitNow(json(1))
        File(dir, "manual-slot-2.vault").writeBytes("not encrypted maybe".toByteArray())
        v.expireUploadsForTesting(); v.collectNow()
        assertTrue(File(dir, "chunks/maybe.chunk").exists(), "an unreadable file stops the pass: nothing is deleted")
    }

    @Test fun manualSlotsSaveLoadAndClear() {
        val dir = folder(); val v = open(dir)
        v.commitNow(json(10))
        val meta = v.await { v.saveManualSlot(1, v.prepare(json(3)), "قبل التوسع", "3.0.0") }
        assertEquals(1, meta.index); assertEquals(3L, meta.saveRevision)
        assertEquals(listOf(1), v.await { v.manualSlotMetadata() }.map { it.index })
        val generation = v.await { v.loadManualSlot(1, "3.0.0") }
        assertTrue(generation >= 3); assertTrue(v.await { v.currentPayload() }!!.contentEquals(json(3)), "the slot is the newest save (below the old revision)")
        assertTrue(!File(dir, "pending-reset.vault").exists())
        v.await { v.clearManualSlot(1) }
        assertTrue(v.await { v.manualSlotMetadata() }.isEmpty())
        assertFailsWith<VaultException> { v.await { v.loadManualSlot(1, null) } }
        assertFailsWith<VaultException> { v.await { v.saveManualSlot(3, v.prepare(json(1)), "", null) } }
    }

    @Test fun resetWritesBothSlotsAndClearsManualSlots() {
        val dir = folder(); val v = open(dir)
        v.commitNow(json(20, epoch = 0)); v.await { v.saveManualSlot(0, v.prepare(json(5)), "a", null) }
        val generation = v.await { v.resetTo(v.prepare(json(0, epoch = 1)), "3.0.0", clearManualSlots = true) }
        assertTrue(generation >= 3)
        assertTrue(v.await { v.currentPayload() }!!.contentEquals(json(0, epoch = 1)))
        assertTrue(v.await { v.manualSlotMetadata() }.isEmpty() && !File(dir, "pending-reset.vault").exists() && !File(dir, "pending-manual-slot-1.vault").exists())
        assertFailsWith<VaultException> { v.commitNow(json(99, epoch = 0)) }
    }

    @Test fun aCrashDuringAResetReturnsToTheOldSave() {
        // The moment of the crash, rebuilt in the development edition (plain files): the reset's checkpoint holds the old
        // save, the manual slot is only in its staged backup, and one clean slot was written before the process ended.
        val dir = folder(); val d = open(dir, VaultSeal.DEVELOPMENT)
        val old = json(20)
        d.commitNow(old); d.await { d.saveManualSlot(0, d.prepare(json(5)), "a", null) }
        val slot = File(dir, "manual-slot-1.vault"); val slotHash = VaultSeal.sha256Hex(slot.readBytes())
        slot.copyTo(File(dir, "pending-manual-slot-1.vault")); slot.delete()
        File(dir, "pending-reset.vault").writeText("GHRESET2\n{\"runtimeVersion\":null,\"sha256\":\"${VaultSeal.sha256Hex(old)}\",\"seal\":null,\"hasPayload\":true,\"clearManualSlots\":true,\"manualSlotHashes\":[\"$slotHash\",null,null]}\n" + String(old))
        d.commitNow(json(0, epoch = 1), allow = true)
        assertFailsWith<VaultException> { d.commitNow(json(1, epoch = 1)) }.also { assertEquals("Reset recovery is pending.", it.message) }
        d.shutdown()
        // The next start recovers before anything else.
        val recovered = open(dir, VaultSeal.DEVELOPMENT)
        assertTrue(recovered.await { recovered.currentPayload() }!!.contentEquals(old), "the old save is authoritative again")
        assertEquals(listOf(0), recovered.await { recovered.manualSlotMetadata() }.map { it.index }, "the manual slot is restored")
        assertTrue(!File(dir, "pending-reset.vault").exists() && !File(dir, "pending-manual-slot-1.vault").exists())
        assertEquals(null, recovered.startupError)
    }

    @Test fun bootScriptHandsTheSaveToTheGame() {
        val dir = folder(); val v = open(dir)
        assertEquals("C", v.await { v.bootScript(false, false, "C") }, "no save: the compatibility flags only")
        v.await { v.storeChunk("f1", ByteArray(10) { 1 }) }
        v.commitNow(json(4, chunks = listOf("f1")))
        v.await { v.saveManualSlot(2, v.prepare(json(2)), "خانة", null) }
        val script = v.await { v.bootScript(true, false, "window.GH_NATIVE_BUILD=362") }
        assertTrue(script.startsWith("window.GH_NATIVE_BUILD=362;"))
        assertTrue(script.contains("const ids=[\"f1\"]") && script.contains("fetch('/vault/save-chunk/'+encodeURIComponent(id)"))
        assertTrue(script.contains("\"generation\":1") && script.contains("\"forced\":true") && script.contains("\"label\":\"خانة\""))
        // The payload is a JavaScript string literal of the exact text.
        val start = script.indexOf("let raw=") + 8; val end = script.indexOf(";if(false)")
        val literal = script.substring(start, end)
        assertEquals(String(json(4, chunks = listOf("f1"))), MiniJson.parse(literal))
    }

    @Test fun jsLiteralEscapesLineSeparators() {
        val out = java.io.ByteArrayOutputStream()
        SaveVault.jsStringLiteral("a b \"\\\u0001".toByteArray(), out)
        assertEquals("\"a\\u2028b\\u2029\\\"\\\\\\u0001\"", out.toString("UTF-8"))
    }
}
