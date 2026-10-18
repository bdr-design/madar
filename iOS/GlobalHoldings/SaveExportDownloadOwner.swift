import Foundation
import WebKit

/// One explicit, read-only export. WebKit streams the Blob to disk; this owner never reads its contents.
/// There is no timer, observer, additional WebView or gameplay worker.
final class VentoraSaveExportDownloads: NSObject, WKDownloadDelegate {
    static let byteLimit: Int64 = 1_073_741_824
    private static let extensions: Set<String> = ["ghsave", "ghdiag", "ghdiagnostic", "ghincident", "ghtrace", "ghhealth", "ghsupport"]
    private let completion: (Result<URL, Error>) -> Void
    private let directory: URL
    private var authorizedURL: String?
    private var active: WKDownload?
    private var destination: URL?
    private var leased = Set<URL>()

    init(directory: URL = FileManager.default.temporaryDirectory.appendingPathComponent("Ventora-Exports", isDirectory: true),
         completion: @escaping (Result<URL, Error>) -> Void) {
        self.directory = directory
        self.completion = completion
    }

    var isBusy: Bool { active != nil || !leased.isEmpty }

    static func trustedDocument(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme?.lowercased() == "gh" && url.host?.lowercased() == "app"
            && url.user == nil && url.password == nil && url.port == nil
    }

    static func allowedSource(document: URL?, source: URL?, mainFrame: Bool, mainTarget: Bool, request: URL?) -> Bool {
        trustedDocument(document) && trustedDocument(source) && mainFrame && mainTarget
            && request?.scheme?.lowercased() == "blob"
    }

    static func allowedFilename(_ name: String) -> Bool {
        !name.isEmpty && name.utf8.count <= 180 && !name.hasPrefix(".")
            && !name.contains("/") && !name.contains("\\")
            && !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
            && extensions.contains(URL(fileURLWithPath: name).pathExtension.lowercased())
    }

    static func allowedSize(_ bytes: Int64) -> Bool { bytes > 0 && bytes <= byteLimit }

    func authorize(_ action: WKNavigationAction, document: URL?) -> Bool {
        guard !isBusy, Self.allowedSource(document: document, source: action.sourceFrame.request.url,
            mainFrame: action.sourceFrame.isMainFrame, mainTarget: action.targetFrame?.isMainFrame != false,
            request: action.request.url), let url = action.request.url else { return false }
        authorizedURL = url.absoluteString
        return true
    }

    func adopt(_ download: WKDownload, from action: WKNavigationAction) {
        if active === download { return }
        guard !isBusy, let authorizedURL, action.request.url?.absoluteString == authorizedURL else {
            download.cancel { _ in }
            return
        }
        self.authorizedURL = nil
        active = download
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        guard active === download else { completionHandler(nil); return }
        guard Self.allowedFilename(suggestedFilename), response.expectedContentLength <= Self.byteLimit else {
            completionHandler(nil)
            fail(download, error: exportError("تعذر تصدير الملف: الاسم أو الحجم غير مدعوم."))
            return
        }
        do {
            let folder = directory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let url = folder.appendingPathComponent(suggestedFilename, isDirectory: false)
            destination = url
            completionHandler(url)
        } catch {
            completionHandler(nil)
            fail(download, error: error)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard active === download else { return }
        guard let url = destination else { fail(download, error: exportError("لم يُنشأ ملف التصدير.")); return }
        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            guard let size = attributes[.size] as? NSNumber, Self.allowedSize(size.int64Value) else {
                throw exportError("حجم ملف التصدير غير صالح.")
            }
            active = nil
            destination = nil
            leased.insert(url)
            completion(.success(url))
        } catch { fail(download, error: error) }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        fail(download, error: error)
    }

    /// The share sheet owns a URL lease, not an in-memory JSON copy.
    @discardableResult func releaseFile(_ url: URL) -> Bool {
        guard leased.remove(url) != nil else { return false }
        Self.removeFolder(containing: url)
        return true
    }

    func cancelAll() {
        let download = active
        active = nil
        authorizedURL = nil
        if let destination { Self.removeFolder(containing: destination) }
        destination = nil
        let files = leased
        leased.removeAll()
        for url in files { Self.removeFolder(containing: url) }
        download?.delegate = nil
        download?.cancel { _ in }
    }

    private func fail(_ download: WKDownload, error: Error) {
        guard active === download else { return }
        active = nil
        download.delegate = nil
        if let destination { Self.removeFolder(containing: destination) }
        destination = nil
        completion(.failure(error))
    }

    private func exportError(_ message: String) -> Error {
        NSError(domain: "Ventora.SaveExport", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    nonisolated private static func removeFolder(containing url: URL) {
        let folder = url.deletingLastPathComponent()
        DispatchQueue.global(qos: .utility).async { try? FileManager.default.removeItem(at: folder) }
    }

    deinit {
        let download = active
        let files = Array(leased) + (destination.map { [$0] } ?? [])
        DispatchQueue.main.async { download?.delegate = nil; download?.cancel { _ in } }
        for url in files { Self.removeFolder(containing: url) }
    }
}
