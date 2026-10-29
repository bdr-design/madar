# The WebView calls the bridge by name (addJavascriptInterface): keep its @JavascriptInterface methods.
-keepclassmembers class com.ventora.game.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
