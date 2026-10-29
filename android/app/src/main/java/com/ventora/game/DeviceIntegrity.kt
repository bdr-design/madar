package com.ventora.game

import android.os.Build
import android.os.Debug
import java.io.File

/**
 * What the release edition can tell about the device (approved security layer 3, as on the iPhone): signs of root, of an
 * injected instrumentation library and of an attached debugger, read once when the game's first page is served (on the
 * WebView's loader thread, never during play) and given to the game as window.GH_DEVICE_INTEGRITY for its diagnostics.
 * Nothing is refused on these signs alone: a save edited on disk is refused by its encryption and seal instead.
 */
object DeviceIntegrity {
    val script: String by lazy {
        val signals = sortedSetOf<String>()
        val paths = listOf("/system/bin/su", "/system/xbin/su", "/sbin/su", "/su/bin/su", "/system/app/Superuser.apk", "/data/adb/magisk", "/data/adb/ksu", "/data/local/tmp/frida-server")
        for (path in paths) if (runCatching { File(path).exists() }.getOrDefault(false)) signals.add("path:$path")
        if (Build.TAGS?.contains("test-keys") == true) signals.add("test-keys")
        if (Debug.isDebuggerConnected() || tracerPid() > 0) signals.add("debugger")
        runCatching {
            File("/proc/self/maps").bufferedReader().useLines { lines ->
                for (line in lines) {
                    val lower = line.lowercase()
                    for (marker in listOf("frida", "xposed", "lsposed", "substrate")) if (marker in lower) signals.add("image:$marker")
                }
            }
        }
        val list = signals.take(12).joinToString(",") { "'" + it.replace("'", "") + "'" }
        "window.GH_DEVICE_INTEGRITY=Object.freeze({compromised:${signals.isNotEmpty()},signals:Object.freeze([$list])});"
    }

    private fun tracerPid(): Int = runCatching {
        File("/proc/self/status").readLines().firstOrNull { it.startsWith("TracerPid:") }?.substringAfter(':')?.trim()?.toInt() ?: 0
    }.getOrDefault(0)
}
