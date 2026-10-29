import Foundation
import CryptoKit
import Security
import MachO

/// VENTORA release edition (Info.plist GHEdition = release): the game shows the player no developer tools, installs no
/// update files (the App Store updates the app) and cannot be inspected from Safari.
let ventoraReleaseEdition = (Bundle.main.object(forInfoDictionaryKey: "GHEdition") as? String) == "release"

/// The release WebApp ships sealed: every script, stylesheet and data file is AES-256-GCM ciphertext bound to its own
/// path ("VENC1" + nonce + ciphertext + tag). The gh:// handler opens a file in memory as WebKit asks for it; nothing
/// readable is written to disk. In the release edition a script, stylesheet or data file that is not sealed, or does not
/// open under this build's key (edited, swapped or foreign), is refused.
enum VentoraPack {
    static let magic = Data("VENC1".utf8)
    private static let key: SymmetricKey? = {
        let bytes = VentoraReleaseKey.bytes()
        return bytes.count == 32 ? SymmetricKey(data: bytes) : nil
    }()

    static var sealsFiles: Bool { key != nil }

    /// Scripts, stylesheets and data must be sealed in a sealed build; index.html and runtime-required.json stay readable.
    static func mustBeSealed(_ path: String) -> Bool {
        let ext = (path as NSString).pathExtension.lowercased()
        return ["js", "css", "json"].contains(ext) && path != "runtime-required.json"
    }

    /// The bytes WebKit receives for `path`, or nil when the file must be refused.
    static func open(_ data: Data, path: String) -> Data? {
        if data.starts(with: magic) {
            guard let key, data.count > magic.count + 12 + 16 else { return nil }
            do {
                let box = try AES.GCM.SealedBox(combined: Data(data.dropFirst(magic.count)))
                return try AES.GCM.open(box, using: key, authenticating: Data(path.utf8))
            } catch {
                return nil
            }
        }
        if key != nil && mustBeSealed(path) { return nil }
        return data
    }
}

/// VENTORA release saves are sealed and encrypted under this device's own secret (VentoraDeviceSecret), never under the
/// build's pack key: that key is made new for every build, so a seal derived from it refused every save after an App Store
/// update. The seal is an HMAC of the save payload (and the keyed digest of each vault chunk); every vault JSON file (A/B
/// saves, manual slots, checkpoints) is also stored as AES-256-GCM ciphertext, so no number can be read or searched in
/// the files. A save edited, swapped or copied from another device does not open, and the game takes its recovery path.
/// All of it runs on the vault's own queue, never on the game's thread. The development edition (no pack key) has no
/// secret: nothing is sealed or encrypted, as before. In the release edition a secret that cannot be read now (Keychain
/// not available) makes the vault refuse to read or write, never fall back to unsealed files.
enum VentoraSaveSeal {
    static var required: Bool { VentoraPack.sealsFiles }
    static var active: Bool { required }
    /// Where the 32-byte device secret comes from; a release check on CI sets its own.
    static var secretProvider: () -> Data? = VentoraDeviceSecret.load
    private static let lock = NSLock()
    private static var cached: (seal: SymmetricKey, file: SymmetricKey)?
    private static let fileMagic = Data("GHVF1".utf8)
    private static let fileContext = Data("ventora-vault-file-v1".utf8)

    private static func keys() -> (seal: SymmetricKey, file: SymmetricKey)? {
        guard required else { return nil }
        lock.lock()
        defer { lock.unlock() }
        if let cached { return cached }
        guard let secret = secretProvider(), secret.count == 32 else { return nil }
        let material = SymmetricKey(data: secret)
        let made = (seal: HKDF<SHA256>.deriveKey(inputKeyMaterial: material, info: Data("ventora-save-seal-v2".utf8), outputByteCount: 32),
                    file: HKDF<SHA256>.deriveKey(inputKeyMaterial: material, info: Data("ventora-save-file-v1".utf8), outputByteCount: 32))
        cached = made
        return made
    }

    private struct Unavailable: LocalizedError { var errorDescription: String? { "The save key of this device is not available." } }

    static func seal(_ payload: Data) -> String? {
        guard let key = keys()?.seal else { return nil }
        return HMAC<SHA256>.authenticationCode(for: payload, using: key).map { String(format: "%02x", $0) }.joined()
    }

    /// The seal a new file carries: nil in the development edition; in the release edition a refusal without the key.
    static func sealForWrite(_ payload: Data) throws -> String? {
        guard required else { return nil }
        guard let value = seal(payload) else { throw Unavailable() }
        return value
    }

    static func matches(_ seal: String?, _ payload: Data) -> Bool {
        guard required else { return true }
        guard let seal, let expected = Self.seal(payload) else { return false }
        let a = Array(seal.utf8), b = Array(expected.utf8)
        guard a.count == b.count else { return false }
        var difference: UInt8 = 0
        for index in 0..<a.count { difference |= a[index] ^ b[index] }
        return difference == 0
    }

    static func chunkDigest(_ data: Data) throws -> Data {
        guard required else { return Data(SHA256.hash(data: data)) }
        guard let key = keys()?.seal else { throw Unavailable() }
        return Data(HMAC<SHA256>.authenticationCode(for: data, using: key))
    }

    /// A vault JSON file as stored: "GHVF1" + AES-GCM (nonce, ciphertext, tag) in the release edition, the plain bytes
    /// in the development edition.
    static func fileBytes(_ plain: Data) throws -> Data {
        guard required else { return plain }
        guard let key = keys()?.file else { throw Unavailable() }
        guard let combined = try AES.GCM.seal(plain, using: key, authenticating: fileContext).combined else { throw Unavailable() }
        return fileMagic + combined
    }

    /// The plain bytes of a stored vault JSON file, or nil when it must be refused (in the release edition: not
    /// encrypted, edited, or from another device).
    static func plainBytes(_ stored: Data) -> Data? {
        guard required else { return stored }
        guard stored.starts(with: fileMagic), stored.count > fileMagic.count + 12 + 16, let key = keys()?.file else { return nil }
        guard let box = try? AES.GCM.SealedBox(combined: Data(stored.dropFirst(fileMagic.count))) else { return nil }
        return try? AES.GCM.open(box, using: key, authenticating: fileContext)
    }
}

/// The release edition's save secret on this device: 32 random bytes made on first use and kept in the Keychain
/// (available after the first unlock, not synchronised: it moves with an encrypted backup of the phone, to no other
/// device, and is not in an unencrypted backup). Read on the vault queue. Only a definite absence makes a new secret: a
/// Keychain that cannot answer now (the device not unlocked since it started) leaves the vault refusing until it can,
/// instead of replacing a secret that still opens every save.
enum VentoraDeviceSecret {
    private static let service = "com.ventora.save-secret", account = "v1"

    private static func read() -> (status: OSStatus, data: Data?) {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account,
                                    kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        return (status, item as? Data)
    }

    static func load() -> Data? {
        let found = read()
        if found.status == errSecSuccess { return found.data?.count == 32 ? found.data : nil }
        guard found.status == errSecItemNotFound else { return nil }
        var bytes = Data(count: 32)
        let made = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
        guard made == errSecSuccess else { return nil }
        let add: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account,
                                  kSecValueData as String: bytes, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock, kSecAttrSynchronizable as String: false]
        let added = SecItemAdd(add as CFDictionary, nil)
        if added == errSecSuccess { return bytes }
        if added == errSecDuplicateItem, let again = read().data, again.count == 32 { return again }
        return nil
    }
}

/// What the release edition can tell about the device it runs on (approved security layer 3): signs of a jailbreak, of an
/// injected instrumentation library and of an attached debugger, read once (on the vault queue, when the game's first
/// page is prepared) and given to the game as window.GH_DEVICE_INTEGRITY for its diagnostics. Nothing runs during play,
/// and nothing is refused on these signs alone: a save edited on disk is refused by its encryption and seal instead.
enum VentoraDeviceIntegrity {
    static let script: String = {
        guard ventoraReleaseEdition else { return "" }
        var signals: [String] = []
        let paths = ["/Applications/Cydia.app", "/Applications/Sileo.app", "/var/jb", "/private/var/jb", "/usr/sbin/sshd", "/bin/bash", "/etc/apt", "/private/var/lib/apt", "/usr/lib/libsubstrate.dylib", "/Library/MobileSubstrate/MobileSubstrate.dylib"]
        for path in paths where FileManager.default.fileExists(atPath: path) { signals.append("path:" + path) }
        // A sandboxed app cannot write outside its container.
        let probe = "/private/ventora-integrity-\(UUID().uuidString)"
        if (try? "x".write(toFile: probe, atomically: false, encoding: .utf8)) != nil { signals.append("sandbox-write"); try? FileManager.default.removeItem(atPath: probe) }
        let markers = ["frida", "cynject", "libhooker", "substrate", "substitute", "ellekit", "tweakinject"]
        for index in 0..<_dyld_image_count() {
            guard let name = _dyld_get_image_name(index) else { continue }
            let image = String(cString: name).lowercased()
            if let marker = markers.first(where: { image.contains($0) }) { signals.append("image:" + marker) }
        }
        var info = kinfo_proc(), size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        if sysctl(&mib, UInt32(mib.count), &info, &size, nil, 0) == 0, info.kp_proc.p_flag & P_TRACED != 0 { signals.append("debugger") }
        let unique = Array(Set(signals)).sorted().prefix(12)
        let list = unique.map { "'" + $0.replacingOccurrences(of: "'", with: "") + "'" }.joined(separator: ",")
        return "window.GH_DEVICE_INTEGRITY=Object.freeze({compromised:\(unique.isEmpty ? "false" : "true"),signals:Object.freeze([\(list)])});"
    }()
}
