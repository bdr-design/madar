import Foundation
import AppKit
import WebKit
import CryptoKit

guard CommandLine.arguments.count == 2 else { fatalError("Source root required") }
let sourceRoot = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let testDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("ventora-export-test-" + UUID().uuidString)
let index = try String(contentsOf: sourceRoot.appendingPathComponent("WebApp/index.html"), encoding: .utf8)
let regex = try NSRegularExpression(pattern: "<meta\\b[^>]*http-equiv=\"Content-Security-Policy\"[^>]*>", options: .caseInsensitive)
guard let match = regex.firstMatch(in: index, range: NSRange(index.startIndex..., in: index)),
      let range = Range(match.range, in: index) else { fatalError("App CSP required") }
let csp = String(index[range])
let script = """
window.qaDownload=(name,worker=true,length=4194305)=>{
 const click=blob=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 if(worker){const w=new Worker('/__qa_export_worker__.js');w.onmessage=e=>{click(e.data);w.terminate();};w.onerror=e=>window.webkit.messageHandlers.exportProbe.postMessage({error:e.message});w.postMessage(length);}
 else click(new Blob([new Uint8Array(length).fill(65)],{type:'application/json'}));
};
window.webkit.messageHandlers.exportProbe.postMessage({ready:true});
"""
var requestedPaths: [String] = []
final class Scheme: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        requestedPaths.append(url.path)
        let body: String, type: String
        switch url.path {
        case "/__qa_export.js": body = script; type = "text/javascript"
        case "/__qa_export_worker__.js": body = "self.onmessage=e=>self.postMessage(new Blob([new Uint8Array(e.data).fill(65)],{type:'application/json'}));"; type = "text/javascript"
        default: body = "<!doctype html>" + csp + "<script src='/__qa_export.js'></script>"; type = "text/html"
        }
        let data = Data(body.utf8)
        task.didReceive(URLResponse(url: url, mimeType: type, expectedContentLength: data.count, textEncodingName: "utf-8"))
        task.didReceive(data)
        task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
final class Probe: NSObject, WKNavigationDelegate, WKScriptMessageHandler, WKDownloadDelegate {
    var ready = false
    var errors: [String] = []
    var outcomes: [Result<URL, Error>] = []
    var adoptions = 0
    var cancelled = false
    var cancelNext = false
    var delayDestination = true
    lazy var owner = VentoraSaveExportDownloads(directory: testDirectory) { [weak self] result in self?.outcomes.append(result) }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        let value = message.body as? [String: Any] ?? [:]
        if value["ready"] as? Bool == true { ready = true }
        if let error = value["error"] as? String { errors.append(error) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.request.url?.scheme == "blob" {
            decisionHandler(owner.authorize(action, document: webView.url) ? .download : .cancel)
        } else { decisionHandler(.allow) }
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        adoptions += 1
        owner.adopt(download, from: navigationAction)
        download.delegate = self
        if cancelNext { cancelNext = false; owner.cancelAll(); cancelled = true }
    }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let delayed = delayDestination
        delayDestination = false
        owner.download(download, decideDestinationUsing: response, suggestedFilename: suggestedFilename) { url in
            // Test only: the page revokes its Blob URL after one second. A slow disk destination must remain exact.
            if delayed { DispatchQueue.main.asyncAfter(deadline: .now() + 1.25) { completionHandler(url) } }
            else { completionHandler(url) }
        }
    }
    func downloadDidFinish(_ download: WKDownload) { owner.downloadDidFinish(download) }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        owner.download(download, didFailWithError: error, resumeData: resumeData)
    }
}
let scheme = Scheme(), probe = Probe(), config = WKWebViewConfiguration()
config.websiteDataStore = .nonPersistent()
config.setURLSchemeHandler(scheme, forURLScheme: "gh")
config.userContentController.add(probe, name: "exportProbe")
let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 956, height: 440), configuration: config)
view.navigationDelegate = probe
let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
window.contentView = view
func wait(_ condition: () -> Bool, seconds: Double = 20) {
    let deadline = Date().addingTimeInterval(seconds)
    while !condition() && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
}
func request(_ name: String, worker: Bool = true, length: Int = 4_194_305) {
    let data = try! JSONSerialization.data(withJSONObject: [name])
    let array = String(data: data, encoding: .utf8)!
    view.evaluateJavaScript("qaDownload(\(array)[0],\(worker ? "true" : "false"),\(length));") { _, error in
        if let error { probe.errors.append(String(describing: error)) }
    }
}
var cases: [[String: Any]] = []
func check(_ name: String, _ ok: Bool) { cases.append(["name": name, "ok": ok]); print("EXPORT_CASE \(name) \(ok ? "PASS" : "FAIL")") }
let trusted = URL(string: "gh://app/index.html")!, blob = URL(string: "blob:null/example")!
let allowed = VentoraSaveExportDownloads.allowedSource(document: trusted, source: trusted, mainFrame: true, mainTarget: true, request: blob)
let denied = !VentoraSaveExportDownloads.allowedSource(document: trusted, source: trusted, mainFrame: false, mainTarget: true, request: blob)
    && !VentoraSaveExportDownloads.allowedSource(document: URL(string: "gh://other/index.html"), source: trusted, mainFrame: true, mainTarget: true, request: blob)
    && !VentoraSaveExportDownloads.allowedSource(document: trusted, source: URL(string: "gh://user@app/index.html"), mainFrame: true, mainTarget: true, request: blob)
    && !VentoraSaveExportDownloads.allowedSource(document: trusted, source: trusted, mainFrame: true, mainTarget: false, request: blob)
    && !VentoraSaveExportDownloads.allowedSource(document: trusted, source: trusted, mainFrame: true, mainTarget: true, request: URL(string: "https://example.org/file.ghsave"))
check("trusted-main-source-only", allowed && denied)
check("filename-and-size-guards", VentoraSaveExportDownloads.allowedFilename("Ventora_Save_v3.0.0_D3.ghsave")
    && VentoraSaveExportDownloads.allowedFilename("Ventora_health.ghhealth")
    && !VentoraSaveExportDownloads.allowedFilename("../outside.ghsave")
    && !VentoraSaveExportDownloads.allowedFilename("payload.html")
    && !VentoraSaveExportDownloads.allowedFilename(".hidden.ghsave")
    && !VentoraSaveExportDownloads.allowedFilename(String(repeating: "a", count: 181) + ".ghsave")
    && VentoraSaveExportDownloads.allowedSize(4_194_305)
    && !VentoraSaveExportDownloads.allowedSize(0)
    && !VentoraSaveExportDownloads.allowedSize(1_073_741_825))
view.load(URLRequest(url: trusted))
wait({ probe.ready })
request("Ventora_Save_v3.0.0_D3.ghsave")
wait({ probe.outcomes.count >= 1 })
var firstURL: URL?
var workerExact = false
if let outcome = probe.outcomes.first, case .success(let url) = outcome, let data = try? Data(contentsOf: url) {
    firstURL = url
    workerExact = data.count == 4_194_305 && SHA256.hash(data: data) == SHA256.hash(data: Data(repeating: 65, count: 4_194_305))
}
check("worker-blob-streams-to-exact-native-file", workerExact && probe.owner.isBusy && requestedPaths.contains("/__qa_export_worker__.js"))
let unrelated = testDirectory.appendingPathComponent("unrelated.ghsave")
try? FileManager.default.createDirectory(at: testDirectory, withIntermediateDirectories: true)
try? Data([1, 2, 3]).write(to: unrelated)
let unknownDenied = !probe.owner.releaseFile(unrelated) && FileManager.default.fileExists(atPath: unrelated.path)
if let firstURL { probe.owner.releaseFile(firstURL); wait({ !FileManager.default.fileExists(atPath: firstURL.path) }) }
check("url-lease-cleanup-only-owned-files", unknownDenied && !probe.owner.isBusy && firstURL.map { !FileManager.default.fileExists(atPath: $0.path) } == true)
let beforeDiagnostic = probe.outcomes.count
request("Ventora_health.ghhealth", worker: false, length: 4097)
wait({ probe.outcomes.count > beforeDiagnostic })
var diagnosticExact = false
if probe.outcomes.count > beforeDiagnostic, case .success(let url) = probe.outcomes.last!, let data = try? Data(contentsOf: url) {
    diagnosticExact = data == Data(repeating: 65, count: 4097)
    probe.owner.releaseFile(url)
}
check("diagnostic-blob-uses-same-native-download", diagnosticExact)
let beforeRefusal = probe.outcomes.count
request("unsupported.html", worker: false, length: 100)
wait({ probe.outcomes.count > beforeRefusal })
var refused = false
if probe.outcomes.count > beforeRefusal, case .failure = probe.outcomes.last! { refused = true }
check("unsupported-extension-refuses-and-releases", refused && !probe.owner.isBusy)
probe.cancelNext = true
request("Ventora_cancel.ghsave")
wait({ probe.cancelled })
let afterCancel = probe.outcomes.count
request("Ventora_retry.ghsave", worker: true, length: 8193)
wait({ probe.outcomes.count > afterCancel })
var retryExact = false
if probe.outcomes.count > afterCancel, case .success(let url) = probe.outcomes.last!, let data = try? Data(contentsOf: url) {
    retryExact = data == Data(repeating: 65, count: 8193)
    probe.owner.releaseFile(url)
}
check("cancel-is-bounded-and-retry-is-exact", probe.cancelled && retryExact && !probe.owner.isBusy)
var live = false
view.evaluateJavaScript("typeof qaDownload==='function'") { value, error in live = error == nil && value as? Bool == true }
wait({ live })
check("document-survives-and-no-script-errors", live && view.url?.scheme == "gh" && probe.errors.isEmpty)
probe.owner.cancelAll()
let failed = cases.filter { ($0["ok"] as? Bool) != true }.count
let files = ["iOS/GlobalHoldings/SaveExportDownloadOwner.swift", "iOS/GlobalHoldings/GameViewController.swift", "tests/native/save-export-download-smoke.swift"]
let hashes = Dictionary(uniqueKeysWithValues: try files.map { name in
    (name, SHA256.hash(data: try Data(contentsOf: sourceRoot.appendingPathComponent(name))).map { String(format: "%02x", $0) }.joined())
})
let report: [String: Any] = ["passed": cases.count - failed, "total": cases.count, "failed": failed, "cases": cases,
    "sourceSha256": hashes, "realWKWebView": true, "origin": "gh://app", "workerBlobExact": workerExact,
    "adoptions": probe.adoptions, "errors": probe.errors, "physicalIPhone": false, "platform": "macOS"]
try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: "native-save-export.json"))
try? FileManager.default.removeItem(at: testDirectory)
print("NATIVE_SAVE_EXPORT \(cases.count - failed)/\(cases.count)")
exit(failed == 0 && cases.count == 8 ? 0 : 1)
