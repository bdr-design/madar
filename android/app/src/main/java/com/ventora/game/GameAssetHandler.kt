package com.ventora.game

import android.content.Context
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.IOException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Serves assets/WebApp/ to the WebView at https://appassets.androidplatform.net/assets/WebApp/, as the iPhone app's
 * gh:// handler does (VentoraPack.swift):
 *  - a sealed file ("VENC1" + nonce(12) + ciphertext + tag(16), AES-256-GCM, its own path as the associated data) is
 *    opened in memory under this build's key (VentoraReleaseKey); nothing readable is written to disk;
 *  - in the release edition a script, stylesheet or data file that is not sealed, or does not open under this key, is
 *    refused (index.html and runtime-required.json stay readable);
 *  - index.html gains the Android bridge script (android-shim.js, served from here) before the game's first script, so
 *    the bridge and the edition exist before the game reads them (the page's policy allows only its own scripts).
 */
class GameAssetHandler(private val context: Context, private val release: Boolean) : WebViewAssetLoader.PathHandler {
    private val key: SecretKeySpec? = VentoraReleaseKey.bytes().takeIf { it.size == 32 }?.let { SecretKeySpec(it, "AES") }

    override fun handle(path: String): WebResourceResponse? {
        if (!path.startsWith(PREFIX)) return null
        val rel = path.removePrefix(PREFIX)
        if (rel.isEmpty() || rel.contains("..")) return refused()
        if (rel == SHIM) return response(rel, shimScript().toByteArray(Charsets.UTF_8))
        val raw = try {
            context.assets.open("WebApp/$rel").use { it.readBytes() }
        } catch (_: IOException) {
            return null
        }
        val bytes = open(raw, rel) ?: return refused()
        return response(rel, if (rel == "index.html") withShim(bytes) else bytes)
    }

    private fun open(data: ByteArray, rel: String): ByteArray? {
        if (data.size >= MAGIC.size && data.copyOfRange(0, MAGIC.size).contentEquals(MAGIC)) {
            val secret = key ?: return null
            if (data.size <= MAGIC.size + NONCE + TAG) return null
            return try {
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, secret, GCMParameterSpec(TAG * 8, data, MAGIC.size, NONCE))
                cipher.updateAAD(rel.toByteArray(Charsets.UTF_8))
                cipher.doFinal(data, MAGIC.size + NONCE, data.size - MAGIC.size - NONCE)
            } catch (_: Exception) {
                null
            }
        }
        if (key != null && mustBeSealed(rel)) return null
        if (release && mustBeSealed(rel)) return null
        return data
    }

    private fun mustBeSealed(rel: String): Boolean {
        val ext = rel.substringAfterLast('.', "").lowercase()
        return ext in setOf("js", "css", "json") && rel != "runtime-required.json"
    }

    private fun withShim(html: ByteArray): ByteArray {
        val text = String(html, Charsets.UTF_8)
        val at = text.indexOf("<script")
        if (at < 0) return html
        // The bridge first, then the save vault's boot script (the newest save, before the game's first own script).
        return (text.substring(0, at) + "<script src=\"$SHIM\"></script>\n  <script src=\"/vault/boot.js\"></script>\n  " + text.substring(at)).toByteArray(Charsets.UTF_8)
    }

    /** window.webkit.messageHandlers as the game expects them on the iPhone: the store bridge, and the save vault's two
     *  bridges (VaultBridge), whose save text or chunk base64 goes as its own argument (never escaped into JSON and parsed
     *  again); the store edition's flag and the device signals. */
    private fun shimScript(): String = buildString {
        append("(()=>{'use strict';if(!window.VentoraAndroid)return;")
        append("const post=(name,message)=>window.VentoraAndroid.post(name,JSON.stringify(message==null?{}:message));")
        append("const vault=(name,message)=>{const m=message==null?{}:message,body=typeof m.saveJSON==='string'?m.saveJSON:(typeof m.base64==='string'?m.base64:''),meta={};for(const key of Object.keys(m))if(key!=='saveJSON'&&key!=='base64')meta[key]=m[key];window.VentoraAndroid.vault(name,JSON.stringify(meta),body);};")
        append("window.webkit={messageHandlers:{storeBridge:{postMessage:message=>post('storeBridge',message)},saveBridge:{postMessage:message=>vault('saveBridge',message)},updateBridge:{postMessage:message=>vault('updateBridge',message)}}};")
        if (release) { append("window.GH_EDITION='release';"); append(DeviceIntegrity.script) }
        append("})();")
    }

    private fun response(rel: String, bytes: ByteArray): WebResourceResponse {
        val response = WebResourceResponse(mimeType(rel), if (isText(rel)) "utf-8" else null, ByteArrayInputStream(bytes))
        response.responseHeaders = mapOf("Cache-Control" to "no-store")
        return response
    }

    private fun refused(): WebResourceResponse = WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(ByteArray(0)))

    private fun isText(rel: String): Boolean = mimeType(rel).let { it.startsWith("text/") || it.endsWith("javascript") || it.endsWith("json") || it.endsWith("svg+xml") }

    private fun mimeType(rel: String): String = when (rel.substringAfterLast('.', "").lowercase()) {
        "html" -> "text/html"
        "css" -> "text/css"
        "js" -> "application/javascript"
        "json" -> "application/json"
        "geojson" -> "application/geo+json"
        "webp" -> "image/webp"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "svg" -> "image/svg+xml"
        "ttf" -> "font/ttf"
        "woff2" -> "font/woff2"
        "txt" -> "text/plain"
        else -> "application/octet-stream"
    }

    companion object {
        const val HOST = "appassets.androidplatform.net"
        const val PREFIX = "WebApp/"
        const val SHIM = "android-shim.js"
        private val MAGIC = "VENC1".toByteArray(Charsets.UTF_8)
        private const val NONCE = 12
        private const val TAG = 16
    }
}
