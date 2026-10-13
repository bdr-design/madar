import Foundation
import CryptoKit

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

/// VENTORA release saves carry a seal: an HMAC of the save payload under a key derived from this build's release key.
/// A save edited on disk (money, assets, any number) no longer matches its seal, so the vault treats it as damaged and
/// the game opens its recovery path instead of the edited world. Vault chunks carry the keyed digest in their header in
/// place of the plain SHA-256. The development edition has no key: no seal is written and none is required.
enum VentoraSaveSeal {
    private static let key: SymmetricKey? = {
        let bytes = VentoraReleaseKey.bytes()
        guard bytes.count == 32 else { return nil }
        return HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: bytes), info: Data("ventora-save-seal-v1".utf8), outputByteCount: 32)
    }()

    static var active: Bool { key != nil }

    static func seal(_ payload: Data) -> String? {
        guard let key else { return nil }
        return HMAC<SHA256>.authenticationCode(for: payload, using: key).map { String(format: "%02x", $0) }.joined()
    }

    static func matches(_ seal: String?, _ payload: Data) -> Bool {
        guard active else { return true }
        guard let seal, let expected = Self.seal(payload) else { return false }
        return seal == expected
    }

    static func chunkDigest(_ data: Data) -> Data {
        if let key { return Data(HMAC<SHA256>.authenticationCode(for: data, using: key)) }
        return Data(SHA256.hash(data: data))
    }
}
