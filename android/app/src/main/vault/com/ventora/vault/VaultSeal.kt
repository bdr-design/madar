package com.ventora.vault

import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * The release edition's protection of the saves on this device (the iPhone vault's VentoraSaveSeal, the same scheme):
 *  - the seal: HMAC-SHA256 of a save payload, and the keyed digest stored in each chunk file;
 *  - the files: every vault file other than a chunk is stored as "GHVF1" + AES-256-GCM (nonce, ciphertext, tag), so no
 *    number can be read or searched in it.
 * Both keys are derived (HKDF-SHA256, empty salt, as CryptoKit's HKDF) from this device's own 32-byte secret
 * ([DeviceSealKey], kept wrapped by the Android Keystore), never from the release pack key: that key is made new for every
 * build, so a seal derived from it would refuse every save after an app update (the defect found in the iPhone vault).
 * All of it runs on the vault thread. The development edition has no secret: nothing is sealed or encrypted. A release
 * edition whose secret cannot be read ([unavailable]) refuses to read or write, never falls back to plain files.
 */
class VaultSeal private constructor(val required: Boolean, private val sealKey: ByteArray?, private val fileKey: ByteArray?) {
    val active: Boolean get() = required

    private fun mac(): Mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(sealKey, "HmacSHA256")) }

    /** The payload's seal (64 lowercase hex); null in the development edition or without the key. */
    fun seal(payload: ByteArray): String? = if (sealKey == null) null else hex(mac().doFinal(payload))

    /** The seal a new file carries: null in the development edition; in the release edition a refusal without the key. */
    fun sealForWrite(payload: ByteArray): String? {
        if (!required) return null
        return seal(payload) ?: throw VaultException(UNAVAILABLE)
    }

    /** In the development edition every payload matches; in the release edition only one carrying its own seal. */
    fun matches(seal: String?, payload: ByteArray): Boolean {
        if (!required) return true
        val expected = seal(payload) ?: return false
        return seal != null && MessageDigest.isEqual(seal.toByteArray(Charsets.US_ASCII), expected.toByteArray(Charsets.US_ASCII))
    }

    /** The 32 bytes stored in a chunk file's header: HMAC with the key, SHA-256 in the development edition. */
    fun chunkDigest(data: ByteArray): ByteArray {
        if (!required) return sha256(data)
        if (sealKey == null) throw VaultException(UNAVAILABLE)
        return mac().doFinal(data)
    }

    /** A vault file as stored: encrypted in the release edition, the plain bytes in the development edition. */
    fun fileBytes(plain: ByteArray): ByteArray {
        if (!required) return plain
        val key = fileKey ?: throw VaultException(UNAVAILABLE)
        val nonce = ByteArray(12).also { RANDOM.nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD(FILE_CONTEXT)
        return FILE_MAGIC + nonce + cipher.doFinal(plain)
    }

    /** The plain bytes of a stored vault file, or null when it must be refused (release: not encrypted, edited, foreign). */
    fun plainBytes(stored: ByteArray): ByteArray? {
        if (!required) return stored
        val key = fileKey ?: return null
        if (stored.size <= FILE_MAGIC.size + 12 + 16) return null
        for (k in FILE_MAGIC.indices) if (stored[k] != FILE_MAGIC[k]) return null
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, stored, FILE_MAGIC.size, 12))
            cipher.updateAAD(FILE_CONTEXT)
            cipher.doFinal(stored, FILE_MAGIC.size + 12, stored.size - FILE_MAGIC.size - 12)
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        private const val UNAVAILABLE = "The save key of this device is not available."
        private val FILE_MAGIC = "GHVF1".toByteArray(Charsets.US_ASCII)
        private val FILE_CONTEXT = "ventora-vault-file-v1".toByteArray(Charsets.US_ASCII)
        private val RANDOM = SecureRandom()

        val DEVELOPMENT = VaultSeal(false, null, null)
        /** A release edition whose device secret cannot be read now: every read and write is refused. */
        fun unavailable() = VaultSeal(true, null, null)
        fun fromSecret(secret: ByteArray): VaultSeal {
            require(secret.size == 32) { "seal secret must be 32 bytes" }
            return VaultSeal(true, hkdf(secret, "ventora-save-seal-v2"), hkdf(secret, "ventora-save-file-v1"))
        }

        /** RFC 5869 HKDF-SHA256 with an empty salt (a hash-length string of zeros), one 32-byte block. */
        internal fun hkdf(secret: ByteArray, info: String): ByteArray {
            val extract = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(ByteArray(32), "HmacSHA256")) }.doFinal(secret)
            val expand = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(extract, "HmacSHA256")) }
            expand.update(info.toByteArray(Charsets.UTF_8)); expand.update(1)
            return expand.doFinal()
        }

        fun sha256(data: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(data)
        fun sha256Hex(data: ByteArray): String = hex(sha256(data))

        private val HEX = "0123456789abcdef".toCharArray()
        fun hex(bytes: ByteArray): String {
            val out = CharArray(bytes.size * 2)
            for (k in bytes.indices) { val v = bytes[k].toInt() and 0xFF; out[k * 2] = HEX[v ushr 4]; out[k * 2 + 1] = HEX[v and 15] }
            return String(out)
        }
    }
}
