package com.ventora.game

import android.annotation.SuppressLint
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

/**
 * VENTORA for Android (approved «تجهيز الأندرويد»): the game in a full-screen landscape WebView, served from the APK's
 * assets on a secure local origin (WebViewAssetLoader) so its storage, workers and policy behave as in a browser. The
 * game keeps its saves in the WebView's own storage here; the store goes through Play Billing (StoreBilling).
 * The back button closes an open page or dialog first and only then sends the app to the background.
 */
class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var store: StoreBilling
    private lateinit var vault: VaultBridge
    private val main = android.os.Handler(android.os.Looper.getMainLooper())
    private var pendingPause: Runnable? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val release = BuildConfig.EDITION == "release"
        vault = VaultBridge(filesDir, release) { script -> if (::webView.isInitialized) webView.evaluateJavascript(script, null) }
        val loader = WebViewAssetLoader.Builder()
            .setDomain(GameAssetHandler.HOST)
            .addPathHandler("/assets/", GameAssetHandler(this, release))
            .addPathHandler("/vault/", vault.Paths(release))
            .build()
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mediaPlaybackRequiresUserGesture = false
            settings.setSupportZoom(false)
            settings.builtInZoomControls = false
            settings.displayZoomControls = false
            overScrollMode = WebView.OVER_SCROLL_NEVER
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    if (request.url.host == GameAssetHandler.HOST) loader.shouldInterceptRequest(request.url) else null

                // The game stays in its own document; a link elsewhere does not open inside the app.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    request.url.host != GameAssetHandler.HOST

                // The save bridge answers only the game's own page, and never a page that has replaced the one that asked.
                override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                    vault.pageStarted(Uri.parse(url ?: "").host == GameAssetHandler.HOST)
                }

                // The page's process ended (memory pressure): the saved game is in the vault; start again from it.
                override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                    recreate()
                    return true
                }
            }
        }
        WebView.setWebContentsDebuggingEnabled(!release && BuildConfig.DEBUG)
        store = StoreBilling(this) { method, json -> callGame(method, json) }
        webView.addJavascriptInterface(Bridge(), "VentoraAndroid")
        setContentView(webView)
        hideSystemBars()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript(BACK_SCRIPT) { closed -> if (closed != "true") moveTaskToBack(true) }
            }
        })
        // After the process was ended the WebView may hold nothing to restore: start the game again (it boots from its save).
        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) webView.loadUrl(START_URL)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    // Leaving the app: the game saves first (as the iPhone's persistForBackground) and the page is paused once that save
    // is acknowledged by the vault, or after eight seconds.
    override fun onPause() {
        val pause = Runnable { pendingPause = null; webView.onPause() }
        pendingPause?.let { main.removeCallbacks(it) }
        pendingPause = pause
        main.postDelayed(pause, 8000)
        // evaluateJavascript does not wait for a promise: the page says when the save is acknowledged.
        webView.evaluateJavascript("(async()=>{try{await window.GH_RUNTIME?.persistForBackground?.();}catch(_e){}finally{window.VentoraAndroid&&window.VentoraAndroid.backgroundSaved();}})();", null)
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        pendingPause?.let { main.removeCallbacks(it); pendingPause = null }
        webView.onResume()
    }

    override fun onDestroy() {
        store.close()
        vault.close()
        pendingPause?.let { main.removeCallbacks(it) }
        webView.removeJavascriptInterface("VentoraAndroid")
        webView.destroy()
        super.onDestroy()
    }

    private fun hideSystemBars() {
        val controller = WindowInsetsControllerCompat(window, webView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    private fun callGame(method: String, json: String) {
        runOnUiThread {
            webView.evaluateJavascript("window.GH_STORE_NATIVE&&window.GH_STORE_NATIVE.$method($json);", null)
        }
    }

    /** The page's half of window.webkit.messageHandlers (android-shim.js). Called on the WebView's bridge thread. */
    inner class Bridge {
        /** The game's save on leaving the app is acknowledged: the page may pause now. */
        @JavascriptInterface
        fun backgroundSaved() {
            main.post { pendingPause?.let { main.removeCallbacks(it); it.run() } }
        }

        /** The save bridges (VaultBridge): returns at once; the vault thread does the work. */
        @JavascriptInterface
        fun vault(name: String, meta: String, body: String) {
            if (name == "saveBridge" || name == "updateBridge") vault.receive(name, meta, body)
        }

        @JavascriptInterface
        fun post(name: String, message: String) {
            val payload = try { JSONObject(message) } catch (_: Exception) { return }
            val action = payload.optString("action")
            runOnUiThread {
                if (!isTrustedPage()) return@runOnUiThread
                if (name == "storeBridge") store.handle(action, payload)
            }
        }
    }

    private fun isTrustedPage(): Boolean = Uri.parse(webView.url ?: "").host == GameAssetHandler.HOST

    companion object {
        private const val START_URL = "https://${GameAssetHandler.HOST}/assets/WebApp/index.html"
        private const val BACK_SCRIPT = "(()=>{const dialog=document.querySelector('dialog[open] .ui-confirm-cancel,dialog[open] [data-action=\"cancel\"]');if(dialog){dialog.click();return true;}const close=document.querySelector('#drawer.open #drawerClose');if(close){close.click();return true;}return false;})()"
    }
}
