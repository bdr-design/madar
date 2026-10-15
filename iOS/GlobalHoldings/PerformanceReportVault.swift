import Foundation

/// Independent from GlobalSaveVault: one bounded diagnostic report, replaced atomically.
/// The caller owns its serial utility queue; no world state or game save generation is touched.
final class PerformanceReportVault {
    static let maximumBytes = 2_097_152
    private let directory: URL
    private var latestURL: URL { directory.appendingPathComponent("latest.ghdiagnostic") }

    init(directory: URL) { self.directory = directory }

    static func validatedData(_ json: String, reportID: String? = nil) throws -> Data {
        guard json.utf8.count <= maximumBytes,
              let data = json.data(using: .utf8),
              let report = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              report["format"] as? String == "ventora-performance-report-v1",
              let identifier = report["id"] as? String,
              !identifier.isEmpty, identifier.count <= 100,
              identifier.range(of: "^[A-Za-z0-9-]+$", options: .regularExpression) != nil,
              reportID == nil || reportID == identifier,
              report["frameSummary"] is [String: Any],
              let incidents = report["incidents"] as? [Any], incidents.count <= 512,
              let frames = report["recentFrames"] as? [Any], frames.count <= 256 else {
            throw NSError(domain: "VentoraPerformance", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid or oversized performance report"])
        }
        return data
    }

    func save(json: String, reportID: String) throws {
        let data = try Self.validatedData(json, reportID: reportID)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        #if os(iOS)
        try data.write(to: latestURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: latestURL, options: .atomic)
        #endif
    }

    func load() throws -> String? {
        guard FileManager.default.fileExists(atPath: latestURL.path) else { return nil }
        let attributes = try FileManager.default.attributesOfItem(atPath: latestURL.path)
        guard let size = attributes[.size] as? NSNumber, size.intValue <= Self.maximumBytes else {
            throw NSError(domain: "VentoraPerformance", code: 2, userInfo: [NSLocalizedDescriptionKey: "Oversized stored performance report"])
        }
        let data = try Data(contentsOf: latestURL)
        guard let json = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "VentoraPerformance", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unreadable performance report"])
        }
        _ = try Self.validatedData(json)
        return json
    }
}
