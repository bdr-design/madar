package com.ventora.vault

/**
 * The few root fields the vault reads from a save, without decoding the rest (the iPhone vault's SaveJSONHeader, the
 * same rules): saveVersion, saveRevision, resetEpoch, simSeconds, fleet.rows.$ghBinary / fleet.rows.chunks and
 * stateCodec.chunks. Every other value is checked as JSON and passed over with an explicit stack (no recursion), so a
 * deep or large save costs one pass over its bytes on the vault thread and no object tree.
 */
internal class SaveJsonHeader {
    sealed class Value {
        object Absent : Value()
        object Null : Value()
        object Container : Value()
        data class Bool(val value: Boolean) : Value()
        data class Num(val value: Double) : Value()
        data class Str(val value: String) : Value()
    }

    var saveVersion: Value = Value.Absent
    var saveRevision: Value = Value.Absent
    var resetEpoch: Value = Value.Absent
    var simSeconds: Value = Value.Absent
    /** root.fleet is an object holding an object `rows`; rowsBinary and chunks are read from that object. */
    var fleetRows = false
    var rowsBinary: Value = Value.Absent
    /** rows.chunks when it is an array of strings, null otherwise; chunksSeen: rows has a `chunks` key. */
    var chunks: List<String>? = null
    var chunksSeen = false
    /** root.stateCodec.chunks, the text chunks of sealed collections, read like rows.chunks. */
    var stateChunks: List<String>? = null
    var stateChunksSeen = false

    companion object {
        fun inspect(bytes: ByteArray): SaveJsonHeader = Scanner(bytes).document()
    }

    private class Scanner(val b: ByteArray) {
        var i = 0
        private fun invalid() = VaultException("Save payload is not valid JSON.")
        private val peek: Int get() = if (i < b.size) b[i].toInt() and 0xFF else 0

        fun document(): SaveJsonHeader {
            val header = SaveJsonHeader()
            skipSpace()
            if (peek != 0x7B) throw invalid()
            i++
            val first = BooleanArray(1) { true }
            while (nextMember(first)) {
                val key = string()
                colon()
                when (key) {
                    "saveVersion" -> header.saveVersion = value()
                    "saveRevision" -> header.saveRevision = value()
                    "resetEpoch" -> header.resetEpoch = value()
                    "simSeconds" -> header.simSeconds = value()
                    "fleet" -> {
                        header.fleetRows = false; header.rowsBinary = Value.Absent; header.chunks = null; header.chunksSeen = false
                        if (peek == 0x7B) fleet(header) else skipValue()
                    }
                    "stateCodec" -> {
                        header.stateChunks = null; header.stateChunksSeen = false
                        if (peek == 0x7B) stateCodec(header) else skipValue()
                    }
                    else -> skipValue()
                }
            }
            skipSpace()
            if (i != b.size) throw invalid()
            return header
        }

        private fun fleet(header: SaveJsonHeader) {
            i++
            val first = BooleanArray(1) { true }
            while (nextMember(first)) {
                val key = string()
                colon()
                if (key != "rows") { skipValue(); continue }
                header.fleetRows = false; header.rowsBinary = Value.Absent; header.chunks = null; header.chunksSeen = false
                if (peek != 0x7B) { skipValue(); continue }
                header.fleetRows = true
                i++
                val firstRow = BooleanArray(1) { true }
                while (nextMember(firstRow)) {
                    val rowKey = string()
                    colon()
                    when (rowKey) {
                        "\$ghBinary" -> header.rowsBinary = value()
                        "chunks" -> { header.chunksSeen = true; header.chunks = stringArray() }
                        else -> skipValue()
                    }
                }
            }
        }

        private fun stateCodec(header: SaveJsonHeader) {
            i++
            val first = BooleanArray(1) { true }
            while (nextMember(first)) {
                val key = string()
                colon()
                if (key != "chunks") { skipValue(); continue }
                header.stateChunksSeen = true
                header.stateChunks = stringArray()
            }
        }

        /** An array of strings; null (after checking it) for any other value. */
        private fun stringArray(): List<String>? {
            if (peek != 0x5B) { skipValue(); return null }
            i++
            val items = ArrayList<String>()
            var allStrings = true
            val first = BooleanArray(1) { true }
            while (nextElement(first)) {
                if (peek == 0x22) items.add(string()) else { skipValue(); allStrings = false }
            }
            return if (allStrings) items else null
        }

        /** A value read for the header: scalars decoded, an object or array checked and passed over. */
        private fun value(): Value = when (peek) {
            0x22 -> Value.Str(string())
            0x7B, 0x5B -> { skipValue(); Value.Container }
            0x74 -> { literal(TRUE); Value.Bool(true) }
            0x66 -> { literal(FALSE); Value.Bool(false) }
            0x6E -> { literal(NULL); Value.Null }
            else -> {
                val start = i
                number()
                Value.Num(String(b, start, i - start, Charsets.US_ASCII).toDoubleOrNull() ?: Double.NaN)
            }
        }

        /** Checks one value of any depth and passes over it without decoding it (an explicit stack, no recursion). */
        fun skipValue() {
            val open = ArrayList<Boolean>() // true: object, false: array
            val first = BooleanArray(1)
            while (true) {
                when (peek) {
                    0x7B -> { i++; open.add(true); first[0] = true }
                    0x5B -> { i++; open.add(false); first[0] = true }
                    0x22 -> skipString()
                    0x74 -> literal(TRUE)
                    0x66 -> literal(FALSE)
                    0x6E -> literal(NULL)
                    else -> number()
                }
                // Move to the next value in the innermost open container, closing the finished ones.
                while (open.isNotEmpty()) {
                    val isObject = open[open.size - 1]
                    if (isObject) {
                        if (nextMember(first)) { skipString(); colon(); break }
                    } else if (nextElement(first)) {
                        break
                    }
                    open.removeAt(open.size - 1)
                    first[0] = false
                }
                if (open.isEmpty()) return
            }
        }

        /** Inside an object: false at its closing brace (passed over), true when a member's key follows. */
        private fun nextMember(first: BooleanArray): Boolean {
            skipSpace()
            if (i >= b.size) throw invalid()
            if (b[i].toInt() == 0x7D) { i++; return false }
            if (first[0]) { first[0] = false; return true }
            if (b[i].toInt() != 0x2C) throw invalid()
            i++
            skipSpace()
            return true
        }

        /** Inside an array: false at its closing bracket (passed over), true when an element follows. */
        private fun nextElement(first: BooleanArray): Boolean {
            skipSpace()
            if (i >= b.size) throw invalid()
            if (b[i].toInt() == 0x5D) { i++; return false }
            if (first[0]) { first[0] = false; return true }
            if (b[i].toInt() != 0x2C) throw invalid()
            i++
            skipSpace()
            return true
        }

        private fun colon() {
            skipSpace()
            if (peek != 0x3A) throw invalid()
            i++
            skipSpace()
        }

        private fun skipSpace() {
            while (i < b.size) {
                val c = b[i].toInt()
                if (c != 0x20 && c != 0x0A && c != 0x0D && c != 0x09) return
                i++
            }
        }

        private fun literal(word: ByteArray) {
            if (b.size - i < word.size) throw invalid()
            for (byte in word) { if (b[i] != byte) throw invalid(); i++ }
        }

        /** -?(0|[1-9][0-9]*)(.[0-9]+)?([eE][+-]?[0-9]+)? */
        private fun number() {
            if (peek == 0x2D) i++
            if (peek == 0x30) i++ else if (peek in 0x31..0x39) skipDigits() else throw invalid()
            if (peek == 0x2E) {
                i++
                if (peek !in 0x30..0x39) throw invalid()
                skipDigits()
            }
            if (peek == 0x65 || peek == 0x45) {
                i++
                if (peek == 0x2B || peek == 0x2D) i++
                if (peek !in 0x30..0x39) throw invalid()
                skipDigits()
            }
        }

        private fun skipDigits() { while (i < b.size && b[i] >= 0x30 && b[i] <= 0x39) i++ }

        /** Checks a string and passes over it: no raw control character, only JSON's escapes. */
        private fun skipString() {
            if (peek != 0x22) throw invalid()
            i++
            while (i < b.size) {
                val c = b[i].toInt() and 0xFF
                if (c == 0x22) { i++; return }
                if (c == 0x5C) { escape(); continue }
                if (c < 0x20) throw invalid()
                i++
            }
            throw invalid()
        }

        /** At a backslash: checks the escape, passes over it and returns the UTF-16 code unit it stands for. */
        private fun escape(): Int {
            if (b.size - i < 2) throw invalid()
            val c = b[i + 1].toInt() and 0xFF
            i += 2
            return when (c) {
                0x22, 0x5C, 0x2F -> c
                0x62 -> 0x08
                0x66 -> 0x0C
                0x6E -> 0x0A
                0x72 -> 0x0D
                0x74 -> 0x09
                0x75 -> {
                    if (b.size - i < 4) throw invalid()
                    var unit = 0
                    repeat(4) {
                        val h = b[i].toInt() and 0xFF
                        val digit = when (h) {
                            in 0x30..0x39 -> h - 0x30
                            in 0x41..0x46 -> h - 0x37
                            in 0x61..0x66 -> h - 0x57
                            else -> throw invalid()
                        }
                        unit = unit shl 4 or digit
                        i++
                    }
                    unit
                }
                else -> throw invalid()
            }
        }

        /** A string decoded; a lone surrogate escape becomes U+FFFD. */
        private fun string(): String {
            val start = i + 1
            skipString()
            val end = i - 1
            var escaped = false
            for (k in start until end) if (b[k].toInt() == 0x5C) { escaped = true; break }
            if (!escaped) return String(b, start, end - start, Charsets.UTF_8)
            val out = java.io.ByteArrayOutputStream(end - start)
            i = start
            while (i < end) {
                if (b[i].toInt() != 0x5C) { out.write(b[i].toInt()); i++; continue }
                val unit = escape()
                var scalar = if (unit in 0xD800..0xDFFF) 0xFFFD else unit
                if (unit in 0xD800..0xDBFF && end - i >= 6 && b[i].toInt() == 0x5C && b[i + 1].toInt() == 0x75) {
                    val mark = i
                    val low = escape()
                    if (low in 0xDC00..0xDFFF) scalar = 0x10000 + ((unit - 0xD800) shl 10) + (low - 0xDC00) else i = mark
                }
                val encoded = String(Character.toChars(scalar)).toByteArray(Charsets.UTF_8)
                out.write(encoded, 0, encoded.size)
            }
            i = end + 1
            return String(out.toByteArray(), Charsets.UTF_8)
        }

        companion object {
            val TRUE = "true".toByteArray(Charsets.US_ASCII)
            val FALSE = "false".toByteArray(Charsets.US_ASCII)
            val NULL = "null".toByteArray(Charsets.US_ASCII)
        }
    }
}

/** Every refusal of the vault carries the message the game shows or records (the iPhone vault's VaultError). */
open class VaultException(message: String) : Exception(message)

/**
 * UTF-8 as the game's TextEncoder writes it: an unpaired surrogate becomes U+FFFD (EF BF BD), never '?' as
 * String.toByteArray does, so the bytes the vault hashes and seals are the bytes the game hashed.
 */
internal fun utf8(text: String): ByteArray {
    val encoder = Charsets.UTF_8.newEncoder()
        .onMalformedInput(java.nio.charset.CodingErrorAction.REPLACE)
        .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPLACE)
        .replaceWith(byteArrayOf(0xEF.toByte(), 0xBF.toByte(), 0xBD.toByte()))
    val buffer = encoder.encode(java.nio.CharBuffer.wrap(text))
    return ByteArray(buffer.remaining()).also { buffer.get(it) }
}
