import Foundation

/// VENTORA release key. The development edition carries none and reads its WebApp as plain files; the release workflow
/// (tools/release/build-release-webapp.cjs) replaces this file at build time with that build's key, split and masked.
enum VentoraReleaseKey {
    static func bytes() -> [UInt8] { [] }
}
