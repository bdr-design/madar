package com.ventora.vault

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CoreFormatsTest {
    private fun header(text: String) = SaveJsonHeader.inspect(text.toByteArray(Charsets.UTF_8))

    @Test fun headerReadsRootFieldsAndManifests() {
        val h = header("""{"saveVersion":"3.0.0","x":{"deep":[1,{"a":"\"}"}]},"saveRevision":7,"resetEpoch":2,"simSeconds":"86400.5","fleet":{"rows":{"${'$'}ghBinary":"chunks-v1","chunks":["a1","b-2"]}},"stateCodec":{"chunks":["t.1"]}}""")
        assertEquals(SaveJsonHeader.Value.Str("3.0.0"), h.saveVersion)
        assertEquals(SaveJsonHeader.Value.Num(7.0), h.saveRevision)
        assertEquals(SaveJsonHeader.Value.Str("86400.5"), h.simSeconds)
        assertTrue(h.fleetRows)
        assertEquals(listOf("a1", "b-2"), h.chunks)
        assertEquals(listOf("t.1"), h.stateChunks)
    }

    @Test fun headerLastDuplicateWinsAndNonStringListIsInvalid() {
        val h = header("""{"fleet":{"rows":{"chunks":["a"]}},"fleet":{"rows":{"chunks":["a",1]}}}""")
        assertTrue(h.chunksSeen); assertNull(h.chunks)
    }

    @Test fun headerRefusesBrokenJson() {
        for (bad in listOf("", "[]", "{", """{"a":}""", """{"a":01}""", """{"a":1.}""", """{"a":"\x"}""", "{\"a\":\"\u0001\"}", """{"a":1} x""", """{"a":tru}"""))
            assertFailsWith<VaultException>(bad) { header(bad) }
    }

    @Test fun headerDecodesEscapesAndLoneSurrogates() {
        val h = header("""{"saveVersion":"\u0041\ud83d\ude00\ud800x\/"}""")
        assertEquals(SaveJsonHeader.Value.Str("A\uD83D\uDE00\uFFFDx/"), h.saveVersion)
    }

    @Test fun miniJsonIsStrict() {
        assertEquals(mapOf("a" to listOf(1.0, "x", null, true)), MiniJson.parse("""{"a":[1,"x",null,true]}"""))
        for (bad in listOf("{\"a\":1\u0662}", "\"\\u\u0660\u0660\u0664\u0661\"", "\"\\u\uFF21\uFF21\uFF21\uFF21\"", "1e400", "[".repeat(50_000)))
            assertFailsWith<VaultException>(bad.take(20)) { MiniJson.parse(bad) }
        val text = MiniJson.stringify(linkedMapOf("g" to 3.0, "s" to "q\"\\\n", "n" to null, "l" to listOf(1.5, false)))
        assertEquals("""{"g":3,"s":"q\"\\\u000a","n":null,"l":[1.5,false]}""", text)
        assertEquals(mapOf("g" to 3.0, "s" to "q\"\\\n", "n" to null, "l" to listOf(1.5, false)), MiniJson.parse(text))
    }

    @Test fun utf8MatchesTextEncoder() {
        assertEquals(listOf(0x61, 0xEF, 0xBF, 0xBD, 0x62), utf8("a\uD800b").map { it.toInt() and 0xFF })
        assertTrue(utf8("ف😀").contentEquals("ف😀".toByteArray(Charsets.UTF_8)))
    }

    /** The JS packer's format (save-chunk-codec.js): planes by stride, PackBits runs, CRC-32 of the raw bytes. */
    private fun pack(raw: ByteArray, stride: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        out.write("GHCPRLE1".toByteArray())
        fun u32(v: Int) { for (k in 0 until 4) out.write(v ushr (8 * k) and 255) }
        u32(raw.size); out.write(stride and 255); out.write(stride ushr 8); out.write(0); out.write(0); u32(ChunkTransport.crc32(raw))
        for (plane in 0 until minOf(stride, raw.size)) {
            val bytes = (plane until raw.size step stride).map { raw[it] }
            var at = 0
            while (at < bytes.size) {
                var run = 1
                while (at + run < bytes.size && run < 128 && bytes[at + run] == bytes[at]) run++
                if (run >= 2) { out.write(257 - run); out.write(bytes[at].toInt() and 255); at += run; continue }
                var lit = 1
                while (at + lit < bytes.size && lit < 128 && !(at + lit + 1 < bytes.size && bytes[at + lit] == bytes[at + lit + 1])) lit++
                out.write(lit - 1); for (k in 0 until lit) out.write(bytes[at + k].toInt() and 255); at += lit
            }
        }
        return out.toByteArray()
    }

    @Test fun packbitsRoundTripAndRefusals() {
        val raw = ByteArray(40_000) { (if (it % 128 < 8) it / 128 else 0).toByte() }
        for (stride in listOf(1, 13, 128)) {
            val wire = pack(raw, stride)
            assertTrue(ChunkTransport.decode(wire, "gh-packbits-v1", raw.size).contentEquals(raw), "stride $stride")
            val bent = wire.copyOf().also { it[it.size - 1] = (it[it.size - 1] + 1).toByte() }
            assertFailsWith<VaultException> { ChunkTransport.decode(bent, "gh-packbits-v1", raw.size) }
            assertFailsWith<VaultException> { ChunkTransport.decode(wire, "gh-packbits-v1", raw.size + 1) }
        }
        assertEquals(0xCBF43926.toInt(), ChunkTransport.crc32("123456789".toByteArray()))
        assertFailsWith<VaultException> { ChunkTransport.decode(ByteArray(0), "identity", null) }
        assertFailsWith<VaultException> { ChunkTransport.decode(ByteArray(4), "lz4", 4) }
    }

    @Test fun sealIsKeyedAndDevelopmentIsOpen() {
        val payload = "{\"a\":1}".toByteArray()
        assertTrue(VaultSeal.DEVELOPMENT.matches(null, payload))
        assertNull(VaultSeal.DEVELOPMENT.seal(payload))
        assertTrue(VaultSeal.DEVELOPMENT.fileBytes(payload).contentEquals(payload))
        val a = VaultSeal.fromSecret(ByteArray(32) { 1 })
        val b = VaultSeal.fromSecret(ByteArray(32) { 2 })
        val seal = a.seal(payload)!!
        assertTrue(a.matches(seal, payload))
        assertTrue(!b.matches(seal, payload) && !a.matches(null, payload) && !a.matches(seal, "{\"a\":2}".toByteArray()))
        assertEquals(32, a.chunkDigest(payload).size)
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", VaultSeal.sha256Hex("abc".toByteArray()))
    }

    /** RFC 5869 test case 3 (empty salt and info), the derivation the iPhone's CryptoKit HKDF performs. */
    @Test fun hkdfMatchesRfc5869() {
        val ikm = ByteArray(22) { 0x0b }
        val extract = javax.crypto.Mac.getInstance("HmacSHA256").apply { init(javax.crypto.spec.SecretKeySpec(ByteArray(32), "HmacSHA256")) }.doFinal(ikm)
        assertEquals("19ef24a32c717b167f33a91d6f648bdf96596776afdb6377ac434c1c293ccb04", VaultSeal.hex(extract))
        assertEquals("8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d", VaultSeal.hex(VaultSeal.hkdf(ikm, "")).take(64))
    }

    @Test fun filesAreEncryptedAndRefusedWhenTouched() {
        val a = VaultSeal.fromSecret(ByteArray(32) { 7 })
        val plain = "{\"cash\":100,\"saveRevision\":3}".toByteArray()
        val stored = a.fileBytes(plain)
        assertTrue(String(stored, Charsets.ISO_8859_1).let { "cash" !in it && "saveRevision" !in it && it.startsWith("GHVF1") })
        assertTrue(a.plainBytes(stored)!!.contentEquals(plain))
        assertTrue(!a.fileBytes(plain).contentEquals(stored), "a fresh nonce for every write")
        val edited = stored.copyOf().also { it[it.size / 2] = (it[it.size / 2].toInt() xor 1).toByte() }
        assertNull(a.plainBytes(edited))
        assertNull(a.plainBytes(plain), "a plain file is refused in the release edition")
        assertNull(VaultSeal.fromSecret(ByteArray(32) { 8 }).plainBytes(stored), "another device's file is refused")
        val none = VaultSeal.unavailable()
        assertNull(none.plainBytes(stored)); assertTrue(!none.matches(null, plain))
        assertFailsWith<VaultException> { none.fileBytes(plain) }
        assertFailsWith<VaultException> { none.sealForWrite(plain) }
        assertFailsWith<VaultException> { none.chunkDigest(plain) }
    }
}
