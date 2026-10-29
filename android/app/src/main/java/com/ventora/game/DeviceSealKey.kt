package com.ventora.game

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import com.ventora.vault.VaultException
import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The save seal key of this device (release edition): 32 random bytes made on first use, stored only encrypted
 * (AES-256-GCM) under a non-exportable Android Keystore key. Both survive app updates and are removed with the app,
 * like the saves themselves (no backup, see data_extraction_rules.xml), so a save sealed here opens after every update
 * and on no other device. Read on the vault thread, never on the main thread.
 */
object DeviceSealKey {
    private const val ALIAS = "ventora-save-seal-wrap-v1"
    private const val FILE = "save-seal-key.v1"

    /**
     * The key, made on first use. Making it takes two steps (the Keystore key, then the stored file, verified by reading
     * it back) and only a key whose file verified is ever returned, so nothing is sealed with a half-made key: if a step
     * was cut short (process killed, disk full) or one half is gone (the OS dropped the Keystore entry, the file is
     * corrupt), what remains could never open a save, and both halves are discarded and a new key is made. Saves sealed
     * with a lost key are then refused by the vault, which reports them to the game (its recovery path), and later saves
     * are sealed with the new key, instead of the device being unable to seal anything again.
     * Synchronized: two first uses at once must not each make a key. Every failure is a [VaultException].
     */
    @Synchronized
    fun load(folder: File): Loaded = try {
        folder.mkdirs()
        val file = AtomicFile(File(folder, FILE))
        // Only a definite loss discards a key: the file absent, the Keystore entry absent (containsAlias answered),
        // or a file that fails its authentication tag. A Keystore that cannot be reached right now throws, and the next
        // use tries again: discarding a good key would make every save on the device unreadable.
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val hasEntry = keyStore.containsAlias(ALIAS)
        val stored = if (file.baseFile.exists()) file.readFully() else null
        val opened = if (stored != null && hasEntry) {
            val wrap = keyStore.getKey(ALIAS, null) as? SecretKey ?: throw VaultException("Save seal key unavailable.")
            try { unwrap(wrap, stored) } catch (_: javax.crypto.AEADBadTagException) { null } catch (_: SealCorrupt) { null }
        } else null
        if (opened != null) Loaded(opened, renewed = false) else {
            val hadKey = stored != null || hasEntry
            if (hasEntry) keyStore.deleteEntry(ALIAS)
            file.delete()
            Loaded(create(file), renewed = hadKey)
        }
    } catch (error: VaultException) {
        throw error
    } catch (error: Exception) {
        throw VaultException("Save seal key unavailable: ${error.javaClass.simpleName}")
    }

    /** renewed: an earlier key existed and could not be opened (saves sealed with it will be refused). */
    class Loaded(val key: ByteArray, val renewed: Boolean)

    private fun create(file: AtomicFile): ByteArray {
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build())
        val wrap = generator.generateKey()
        val key = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, wrap) }
        val sealed = cipher.iv + cipher.doFinal(key)
        val out = file.startWrite()
        try { out.write(sealed); file.finishWrite(out) } catch (error: Throwable) { file.failWrite(out); throw error }
        // finishWrite does not report a failed sync on every API level: the read-back is the check.
        val verified = try { unwrap(wrap, file.readFully()) } catch (_: Exception) { null }
        if (verified == null || !verified.contentEquals(key)) throw VaultException("Save seal key verification failed.")
        return key
    }

    private class SealCorrupt : VaultException("Save seal key corrupt.")

    private fun unwrap(wrap: SecretKey, stored: ByteArray): ByteArray {
        if (stored.size != 12 + 32 + 16) throw SealCorrupt()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, wrap, GCMParameterSpec(128, stored, 0, 12)) }
        return cipher.doFinal(stored, 12, stored.size - 12)
    }
}
