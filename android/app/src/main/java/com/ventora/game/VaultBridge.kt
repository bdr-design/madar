package com.ventora.game

import android.os.Handler
import android.os.Looper
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import com.ventora.vault.MiniJson
import com.ventora.vault.SaveVault
import com.ventora.vault.VaultSeal
import com.ventora.vault.utf8
import java.io.ByteArrayInputStream
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * The game's save bridge on Android (approved «انقل خزنة الحفظ للأندرويد بدقة»): window.webkit.messageHandlers.saveBridge
 * and updateBridge as on the iPhone (GameViewController.swift), answered with the same events (gh-native-save-ack,
 * gh-native-reset-ack, gh-native-chunk-ack, gh-native-slot-ack), so persistence-core.js runs unchanged.
 *
 * Findings of the save audit, applied here: the page's call only hands its text over and returns (the shim sends the
 * save text as its own argument, never inside a JSON string to be escaped and parsed again); the vault opens on a
 * background thread (the Keystore and the files are never touched on the main thread); every check, hash, decode and
 * write runs on the vault thread; the main thread only posts the small answer back to the page.
 */
class VaultBridge(filesDir: File, release: Boolean, private val post: (String) -> Unit) {
    /** Keeps this page's requests in order while the vault opens (the vault thread keeps them in order afterwards). */
    private val queue = Executors.newSingleThreadExecutor { Thread(it, "ventora-vault-bridge").apply { isDaemon = true } }
    private val vaultFuture: Future<SaveVault> = Holder.open(filesDir, release)
    private val main = Handler(Looper.getMainLooper())
    /** The page a request came from; an answer to a page that has since been replaced is dropped (iOS isCurrentDocument). */
    private val document = AtomicInteger(0)
    @Volatile var trusted = false
    @Volatile private var nextBootForced = false

    /** One vault for the process: a recreated activity (rotation, a process kept alive) never opens a second one on the
     *  same files while the first is still writing. */
    private object Holder {
        private var future: Future<SaveVault>? = null
        @Synchronized fun open(filesDir: File, release: Boolean): Future<SaveVault> = future ?: Executors.newSingleThreadExecutor { Thread(it, "ventora-vault-open").apply { isDaemon = true } }.let { opener ->
            val folder = File(filesDir, "GlobalHoldingsSaveVault")
            opener.submit<SaveVault> {
                val seal = if (!release) VaultSeal.DEVELOPMENT else runCatching { VaultSeal.fromSecret(DeviceSealKey.load(folder).key) }.getOrElse { VaultSeal.unavailable() }
                SaveVault(folder, seal)
            }.also { future = it; opener.shutdown() }
        }
    }

    private fun vault(): SaveVault = vaultFuture.get(60, TimeUnit.SECONDS)

    /** A new page starts (WebViewClient.onPageStarted, main thread): answers to the old one are dropped. */
    fun pageStarted(trustedPage: Boolean) { document.incrementAndGet(); trusted = trustedPage }

    /** The activity ends: its queue stops taking requests (work already handed to the vault still completes). */
    fun close() { trusted = false; queue.shutdown() }

    /** From the page (the WebView's bridge thread): only parse the small envelope and queue the work in order. */
    fun receive(name: String, metaJson: String, body: String) {
        if (!trusted) return
        val token = document.get()
        val meta = (runCatching { MiniJson.parse(metaJson) }.getOrNull() as? Map<*, *>)?.entries?.associate { it.key.toString() to it.value } ?: return
        val action = meta["action"] as? String ?: return
        val enqueuedAt = System.nanoTime()
        runCatching { queue.execute {
            val vault = runCatching { vault() }.getOrNull() ?: return@execute
            vault.submit({ handle(vault, name, action, meta, body, enqueuedAt) }) { result ->
                result.exceptionOrNull()?.let { error -> failure(name, action, meta, error.message ?: "Native vault error.", enqueuedAt, token) }
                result.getOrNull()?.let { answer -> if (token == document.get()) send(answer.first, answer.second) }
            }
        } }
    }

    private fun handle(vault: SaveVault, name: String, action: String, meta: Map<String, Any?>, body: String, enqueuedAt: Long): Pair<String, Map<String, Any?>>? {
        val startedAt = System.nanoTime()
        val runtime = BuildConfig.VERSION_NAME
        fun index() = (meta["index"] as? Double)?.takeIf { it == Math.floor(it) }?.toInt() ?: -1
        when {
            name == "saveBridge" && action == "commitSave" -> {
                val prepared = vault.validateEnvelope(meta, utf8(body), "commitSave")
                val checkedAt = System.nanoTime()
                val generation = vault.commit(prepared, runtime, extraStages = mapOf("queueWaitMs" to (startedAt - enqueuedAt) / 1e6, "bridgeMs" to (checkedAt - startedAt) / 1e6))
                return saveAck(meta, true, generation, null, (System.nanoTime() - enqueuedAt) / 1e6, vault.takeCommitTimings(generation))
            }
            name == "saveBridge" && action == "storeSaveChunk" -> {
                val requestId = meta["requestId"] as? String ?: return null
                val id = meta["id"] as? String ?: ""
                if (requestId.isEmpty() || requestId.length > 200 || !vault.isValidChunkId(id)) return "gh-native-chunk-ack" to linkedMapOf("requestId" to requestId, "id" to id, "success" to false, "message" to "Invalid save chunk upload.")
                val raw = (meta["bytes"] as? Double)?.toInt()
                val digest = vault.storeChunkBase64(id, body, meta["encoding"] as? String ?: "identity", raw)
                return "gh-native-chunk-ack" to linkedMapOf("requestId" to requestId, "id" to id, "success" to true, "sha256" to digest)
            }
            name == "saveBridge" && action == "saveManualSlot" -> {
                val prepared = vault.validateEnvelope(meta, utf8(body), "saveManualSlot")
                val metadata = vault.saveManualSlot(index(), prepared, (meta["label"] as? String).orEmpty().take(120), runtime)
                return slotAck(meta, true, null, metadata.toMap(), null)
            }
            name == "saveBridge" && action == "loadManualSlot" -> {
                val generation = vault.loadManualSlot(index(), runtime)
                nextBootForced = true
                return slotAck(meta, true, generation, null, null)
            }
            name == "saveBridge" && action == "clearManualSlot" -> { vault.clearManualSlot(index()); return slotAck(meta, true, null, null, null) }
            name == "updateBridge" && action == "resetGameSave" -> {
                val prepared = vault.validateEnvelope(meta, utf8(body), "resetGameSave")
                val generation = vault.resetTo(prepared, runtime, meta["clearManualSlots"] == true)
                nextBootForced = true
                return saveAck(meta, true, generation, null, (System.nanoTime() - enqueuedAt) / 1e6, null)
            }
            // runtimeReady, bootProgress and the iPhone's update-package actions have no Android counterpart.
            else -> return null
        }
    }

    private fun failure(name: String, action: String, meta: Map<String, Any?>, message: String, enqueuedAt: Long, token: Int) {
        if (token != document.get()) return
        val answer = when {
            action == "storeSaveChunk" -> "gh-native-chunk-ack" to linkedMapOf("requestId" to (meta["requestId"] as? String).orEmpty(), "id" to (meta["id"] as? String).orEmpty(), "success" to false, "message" to message)
            action in setOf("saveManualSlot", "loadManualSlot", "clearManualSlot") -> slotAck(meta, false, null, null, message)
            action == "commitSave" || action == "resetGameSave" -> saveAck(meta, false, null, message, (System.nanoTime() - enqueuedAt) / 1e6, null)
            else -> return
        }
        send(answer.first, answer.second)
    }

    private fun saveAck(meta: Map<String, Any?>, success: Boolean, generation: Int?, message: String?, commitMs: Double, stages: Map<String, Double>?): Pair<String, Map<String, Any?>> {
        val detail = linkedMapOf<String, Any?>("success" to success, "message" to (message ?: ""))
        for (key in listOf("requestId", "action", "saveRevision", "resetEpoch", "saveSchemaVersion", "saveHash")) if (meta.containsKey(key)) detail[key] = meta[key]
        if (generation != null) detail["generation"] = generation
        if (commitMs.isFinite()) detail["nativeVaultCommitMs"] = commitMs
        if (stages != null) detail["nativeVaultStages"] = stages.filterValues { it.isFinite() }
        return (if (meta["action"] == "resetGameSave") "gh-native-reset-ack" else "gh-native-save-ack") to detail
    }

    private fun slotAck(meta: Map<String, Any?>, success: Boolean, generation: Int?, metadata: Map<String, Any?>?, message: String?): Pair<String, Map<String, Any?>> {
        val detail = linkedMapOf<String, Any?>("success" to success, "message" to (message ?: ""), "action" to (meta["action"] as? String).orEmpty(),
            "requestId" to (meta["requestId"] as? String).orEmpty(), "index" to ((meta["index"] as? Double)?.toInt() ?: -1))
        if (generation != null) detail["generation"] = generation
        if (metadata != null) detail["metadata"] = metadata
        return "gh-native-slot-ack" to detail
    }

    /** The answer as a page event: both name and detail are JSON (no text is interpolated as code). */
    private fun send(event: String, detail: Map<String, Any?>) {
        val script = "window.dispatchEvent(new CustomEvent(${MiniJson.stringify(event)},{detail:${MiniJson.stringify(detail)}}));"
        main.post { post(script) }
    }

    /** Served under https://appassets.androidplatform.net/vault/ on the WebView's loader thread (never the main thread). */
    inner class Paths(private val release: Boolean) : WebViewAssetLoader.PathHandler {
        override fun handle(path: String): WebResourceResponse? {
            val vault = runCatching { vault() }.getOrNull() ?: return notFound()
            return when {
                path == "boot.js" -> {
                    val forced = nextBootForced.also { nextBootForced = false }
                    val script = runCatching { vault.await { vault.bootScript(forced, false, COMPATIBILITY) } }.getOrElse { "$COMPATIBILITY;window.GH_NATIVE_RECOVERY_BLOCKED=true;" }
                    response("application/javascript", script.toByteArray(Charsets.UTF_8))
                }
                path.startsWith("save-chunk/") -> {
                    val id = android.net.Uri.decode(path.removePrefix("save-chunk/"))
                    if (!vault.isValidChunkId(id)) return notFound()
                    runCatching { vault.await { vault.readChunk(id) } }.getOrNull()?.let { response("application/octet-stream", it) } ?: notFound()
                }
                else -> notFound()
            }
        }

        private fun response(type: String, bytes: ByteArray) = WebResourceResponse(type, if (type.endsWith("javascript")) "utf-8" else null, 200, "OK",
            mapOf("Cache-Control" to "no-store, no-cache, must-revalidate, max-age=0", "Content-Length" to bytes.size.toString()), ByteArrayInputStream(bytes))

        private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(ByteArray(0)))
    }

    companion object {
        /** What the game reads from the native shell (the iPhone vault's compatibility line; the vault protocol level). */
        const val COMPATIBILITY = "window.GH_NATIVE_BUILD=362;window.GH_NATIVE_SOURCE_SNAPSHOT='';window.GH_NATIVE_CHUNK_ENCODINGS=['gh-packbits-v1'];window.GH_NATIVE_ROW_PATCHES=1;window.GH_NATIVE_VALUE_CHUNKS=1;"
    }
}
