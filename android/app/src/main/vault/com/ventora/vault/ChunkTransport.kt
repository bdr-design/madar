package com.ventora.vault

/**
 * Wire-only PackBits byte planes (the iPhone vault's VentoraChunkTransport, the same format "GHCPRLE1"). Decoded on the
 * vault thread before the digest, the immutable id check, the atomic write and the read-back; stored chunk files and
 * save manifests are the raw bytes.
 */
internal object ChunkTransport {
    private val CRC_TABLE = IntArray(256) { index ->
        var value = index
        repeat(8) { value = if (value and 1 != 0) (0xedb88320.toInt() xor (value ushr 1)) else value ushr 1 }
        value
    }
    private val MAGIC = "GHCPRLE1".toByteArray(Charsets.US_ASCII)
    private const val MAX_RAW = 4 * 1024 * 1024
    private const val MAX_IDENTITY = 64 * 1024 * 1024

    private fun corrupt() = VaultException("Invalid compressed save chunk.")

    fun crc32(bytes: ByteArray): Int {
        var crc = -1
        for (byte in bytes) crc = CRC_TABLE[(crc xor byte.toInt()) and 255] xor (crc ushr 8)
        return crc.inv()
    }

    fun decode(data: ByteArray, encoding: String, rawBytes: Int?): ByteArray {
        if (encoding == "identity") {
            if (data.isEmpty() || data.size > MAX_IDENTITY || (rawBytes != null && rawBytes != data.size)) throw corrupt()
            return data
        }
        if (encoding != "gh-packbits-v1" || data.size < 20 || data.size > MAX_RAW) throw corrupt()
        for (k in 0 until 8) if (data[k] != MAGIC[k]) throw corrupt()
        fun byte(at: Int) = data[at].toInt() and 0xFF
        fun word(at: Int) = byte(at) or (byte(at + 1) shl 8) or (byte(at + 2) shl 16) or (byte(at + 3) shl 24)
        val length = word(8).toLong() and 0xFFFFFFFFL
        val stride = byte(12) or (byte(13) shl 8)
        if (length <= 0 || length > MAX_RAW || rawBytes == null || rawBytes.toLong() != length || data.size >= length ||
            stride !in intArrayOf(1, 13, 128) || byte(14) != 0 || byte(15) != 0) throw corrupt()
        val size = length.toInt()
        val output = ByteArray(size)
        var read = 20
        for (plane in 0 until minOf(stride, size)) {
            val count = (size - 1 - plane) / stride + 1
            var at = 0
            while (at < count) {
                if (read >= data.size) throw corrupt()
                val control = byte(read); read++
                if (control == 128) throw corrupt()
                val run = if (control < 128) control + 1 else 257 - control
                if (run > count - at) throw corrupt()
                if (control < 128) {
                    if (run > data.size - read) throw corrupt()
                    for (index in 0 until run) output[plane + (at + index) * stride] = data[read + index]
                    read += run
                } else {
                    if (read >= data.size) throw corrupt()
                    val value = data[read]; read++
                    for (index in 0 until run) output[plane + (at + index) * stride] = value
                }
                at += run
            }
        }
        if (read != data.size) throw corrupt()
        if (crc32(output) != word(16)) throw corrupt()
        return output
    }
}
