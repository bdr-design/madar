import Foundation

@main
struct PerformanceReportVaultRegression {
    static func main() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("ventora-performance-vault-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let vault = PerformanceReportVault(directory: root)
        let first = "{\"format\":\"ventora-performance-report-v1\",\"id\":\"PT-FIRST\",\"frameSummary\":{},\"incidents\":[],\"recentFrames\":[]}"
        let second = first.replacingOccurrences(of: "PT-FIRST", with: "PT-SECOND")
        func check(_ condition: Bool, _ message: String) throws {
            if !condition { throw NSError(domain: "PerformanceReportTest", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
        }
        try check(try vault.load() == nil, "No report before explicit save")
        try vault.save(json: first, reportID: "PT-FIRST")
        try check(try vault.load() == first, "Report retained")
        let recreated = PerformanceReportVault(directory: root)
        try check(try recreated.load() == first, "Report survives new owner")
        do { try vault.save(json: second, reportID: "PT-MISMATCH"); throw NSError(domain: "TestUnexpectedSuccess", code: 1) }
        catch { try check((error as NSError).domain != "TestUnexpectedSuccess", "Wrong report ID rejected") }
        try check(try vault.load() == first, "Failed replacement leaves original")
        do { try vault.save(json: String(repeating: "x", count: PerformanceReportVault.maximumBytes + 1), reportID: "PT-LARGE"); throw NSError(domain: "TestUnexpectedSuccess", code: 1) }
        catch { try check((error as NSError).domain != "TestUnexpectedSuccess", "Oversized report rejected") }
        try check(try vault.load() == first, "Oversized replacement does not delete")
        try vault.save(json: second, reportID: "PT-SECOND")
        try check(try recreated.load() == second, "Atomic replacement visible to new read")
        let filenames = try FileManager.default.contentsOfDirectory(atPath: root.path)
        try check(filenames == ["latest.ghdiagnostic"], "Only one durable report; no game-save files")
        print("PASS native performance report vault: retain/reopen/reject malformed and oversized/atomic replacement")
    }
}
