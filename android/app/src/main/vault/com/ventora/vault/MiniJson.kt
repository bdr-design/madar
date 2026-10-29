package com.ventora.vault

/**
 * The small JSON the vault's own files need (envelope headers, manual slots, checkpoints), with no platform library so
 * the same code runs on Android and in the JVM tests. Objects become [LinkedHashMap], arrays [List], numbers [Double],
 * and strings decode every JSON escape (a lone surrogate escape becomes U+FFFD, as the iPhone vault's scanner does).
 * Only ASCII digits and hex digits count, a number must be finite, and nesting is bounded; every refusal is [Invalid].
 */
internal object MiniJson {
    class Invalid : VaultException("Invalid JSON.")
    /** Deeper nesting is refused (the vault's own files are a few levels deep); no stack overflow on hostile input. */
    private const val MAX_DEPTH = 256

    fun parse(text: String): Any? {
        val reader = Reader(text)
        reader.space()
        val value = reader.value()
        reader.space()
        if (reader.i != text.length) throw Invalid()
        return value
    }

    /** Encodes maps, lists, strings, numbers, booleans and null. Keys keep their insertion order. */
    fun stringify(value: Any?): String = StringBuilder().also { write(it, value) }.toString()

    private fun write(out: StringBuilder, value: Any?) {
        when (value) {
            null -> out.append("null")
            is String -> quote(out, value)
            is Boolean -> out.append(if (value) "true" else "false")
            is Int, is Long -> out.append(value.toString())
            is Double -> {
                require(value.isFinite()) { "non-finite number" }
                if (value == Math.rint(value) && Math.abs(value) < 9.007199254740992E15) out.append(value.toLong().toString()) else out.append(value.toString())
            }
            is Number -> write(out, value.toDouble())
            is Map<*, *> -> {
                out.append('{')
                var first = true
                for ((key, item) in value) {
                    if (!first) out.append(',')
                    first = false
                    quote(out, key.toString())
                    out.append(':')
                    write(out, item)
                }
                out.append('}')
            }
            is List<*> -> {
                out.append('[')
                value.forEachIndexed { index, item -> if (index > 0) out.append(','); write(out, item) }
                out.append(']')
            }
            else -> throw IllegalArgumentException("unsupported JSON value")
        }
    }

    fun quote(out: StringBuilder, text: String) {
        out.append('"')
        for (c in text) {
            when {
                c == '"' -> out.append("\\\"")
                c == '\\' -> out.append("\\\\")
                c < ' ' -> out.append("\\u").append(HEX[c.code shr 12 and 15]).append(HEX[c.code shr 8 and 15]).append(HEX[c.code shr 4 and 15]).append(HEX[c.code and 15])
                else -> out.append(c)
            }
        }
        out.append('"')
    }

    private const val HEX = "0123456789abcdef"

    private class Reader(val s: String) {
        var i = 0
        var depth = 0
        private fun isDigit(c: Char) = c in '0'..'9'
        fun space() { while (i < s.length && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t')) i++ }
        fun value(): Any? {
            if (i >= s.length) throw Invalid()
            return when (s[i]) {
                '{' -> nested { obj() }
                '[' -> nested { arr() }
                '"' -> str()
                't' -> word("true", true)
                'f' -> word("false", false)
                'n' -> word("null", null)
                else -> num()
            }
        }
        private inline fun <T> nested(read: () -> T): T { if (++depth > MAX_DEPTH) throw Invalid(); try { return read() } finally { depth-- } }
        private fun word(w: String, v: Any?): Any? { if (!s.startsWith(w, i)) throw Invalid(); i += w.length; return v }
        private fun obj(): Map<String, Any?> {
            val out = LinkedHashMap<String, Any?>()
            i++; space()
            if (i < s.length && s[i] == '}') { i++; return out }
            while (true) {
                space(); if (i >= s.length || s[i] != '"') throw Invalid()
                val key = str(); space()
                if (i >= s.length || s[i] != ':') throw Invalid()
                i++; space()
                out[key] = value(); space()
                if (i >= s.length) throw Invalid()
                if (s[i] == ',') { i++; continue }
                if (s[i] == '}') { i++; return out }
                throw Invalid()
            }
        }
        private fun arr(): List<Any?> {
            val out = ArrayList<Any?>()
            i++; space()
            if (i < s.length && s[i] == ']') { i++; return out }
            while (true) {
                space(); out.add(value()); space()
                if (i >= s.length) throw Invalid()
                if (s[i] == ',') { i++; continue }
                if (s[i] == ']') { i++; return out }
                throw Invalid()
            }
        }
        private fun num(): Double {
            val start = i
            if (i < s.length && s[i] == '-') i++
            if (i < s.length && s[i] == '0') i++ else if (i < s.length && s[i] in '1'..'9') { while (i < s.length && isDigit(s[i])) i++ } else throw Invalid()
            if (i < s.length && s[i] == '.') { i++; if (i >= s.length || !isDigit(s[i])) throw Invalid(); while (i < s.length && isDigit(s[i])) i++ }
            if (i < s.length && (s[i] == 'e' || s[i] == 'E')) { i++; if (i < s.length && (s[i] == '+' || s[i] == '-')) i++; if (i >= s.length || !isDigit(s[i])) throw Invalid(); while (i < s.length && isDigit(s[i])) i++ }
            return s.substring(start, i).toDouble().takeIf { it.isFinite() } ?: throw Invalid()
        }
        private fun hex4(): Int {
            if (s.length - i < 4) throw Invalid()
            var v = 0
            repeat(4) { val c = s[i++]; v = v shl 4 or when (c) { in '0'..'9' -> c - '0'; in 'a'..'f' -> c - 'a' + 10; in 'A'..'F' -> c - 'A' + 10; else -> throw Invalid() } }
            return v
        }
        fun str(): String {
            i++
            val start = i
            while (i < s.length && s[i] != '"' && s[i] != '\\') { if (s[i] < ' ') throw Invalid(); i++ }
            if (i < s.length && s[i] == '"') { i++; return s.substring(start, i - 1) }
            val out = StringBuilder().append(s, start, i)
            while (true) {
                if (i >= s.length) throw Invalid()
                val c = s[i]
                if (c == '"') { i++; return out.toString() }
                if (c < ' ') throw Invalid()
                if (c != '\\') { out.append(c); i++; continue }
                if (i + 1 >= s.length) throw Invalid()
                val e = s[i + 1]; i += 2
                when (e) {
                    '"' -> out.append('"'); '\\' -> out.append('\\'); '/' -> out.append('/')
                    'b' -> out.append('\b'); 'f' -> out.append('\u000C'); 'n' -> out.append('\n'); 'r' -> out.append('\r'); 't' -> out.append('\t')
                    'u' -> {
                        val unit = hex4()
                        if (unit in 0xD800..0xDBFF && i + 6 <= s.length && s[i] == '\\' && s[i + 1] == 'u') {
                            val mark = i; i += 2
                            val low = hex4()
                            if (low in 0xDC00..0xDFFF) { out.append(unit.toChar()).append(low.toChar()); continue }
                            i = mark
                        }
                        out.append(if (unit in 0xD800..0xDFFF) '�' else unit.toChar())
                    }
                    else -> throw Invalid()
                }
            }
        }
    }
}
