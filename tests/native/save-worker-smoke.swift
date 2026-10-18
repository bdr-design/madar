import Foundation
import AppKit
import WebKit
import CryptoKit

// Loads the exact source modules through the native gh://app origin and the application's actual worker CSP.
// This is a macOS WKWebView gate; it is not a physical iPhone performance test.
guard CommandLine.arguments.count == 3 else { fatalError("WebApp directory and probe JavaScript required") }
let webRoot = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true).standardizedFileURL
let probeURL = URL(fileURLWithPath: CommandLine.arguments[2])
let probeData = try Data(contentsOf: probeURL)
let index = try String(contentsOf: webRoot.appendingPathComponent("index.html"), encoding: .utf8)
let cspRegex = try NSRegularExpression(pattern: "<meta\\b[^>]*http-equiv=\"Content-Security-Policy\"[^>]*>", options: .caseInsensitive)
guard let match = cspRegex.firstMatch(in: index, range: NSRange(index.startIndex..., in: index)), let cspRange = Range(match.range, in: index) else { fatalError("Application CSP missing") }
let csp = String(index[cspRange])
let scripts = ["fleet-store-core.js", "save-chunk-codec.js", "state-codec-core.js", "save-checksum-thread.js", "__qa_native_worker_probe__.js"]
let html = "<!doctype html><meta charset=\"utf-8\">" + csp + scripts.map { "<script src=\"/\($0)\"></script>" }.joined()
var requestedPaths: [String] = []

final class Scheme: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.scheme == "gh", url.host == "app" else { task.didFailWithError(NSError(domain: "SaveWorkerProbe", code: 1)); return }
        requestedPaths.append(url.path)
        do {
            let data: Data
            let mime: String
            if url.path == "/index.html" { data = Data(html.utf8); mime = "text/html; charset=utf-8" }
            else if url.path == "/__qa_native_worker_probe__.js" { data = probeData; mime = "text/javascript; charset=utf-8" }
            else {
                let file = webRoot.appendingPathComponent(String(url.path.dropFirst())).standardizedFileURL
                guard file.path.hasPrefix(webRoot.path + "/"), file.pathExtension == "js" else { throw NSError(domain: "SaveWorkerProbe", code: 2) }
                data = try Data(contentsOf: file); mime = "text/javascript; charset=utf-8"
            }
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": mime, "Content-Length": String(data.count)])!
            task.didReceive(response); task.didReceive(data); task.didFinish()
        } catch { task.didFailWithError(error) }
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
final class Probe: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    weak var webView: WKWebView?
    var report: [String: Any]?
    var progress: [String: Any]?
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.webView === webView, message.frameInfo.isMainFrame, message.frameInfo.request.url?.scheme == "gh", message.frameInfo.request.url?.host == "app", let value = message.body as? [String: Any] else { return }
        if value["progress"] as? Bool == true { progress = value; return }
        report = value
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { report = ["failed": 1, "error": String(describing: error)] }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { report = ["failed": 1, "error": String(describing: error)] }
}
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let scheme = Scheme(), probe = Probe(), config = WKWebViewConfiguration()
config.websiteDataStore = .nonPersistent()
config.setURLSchemeHandler(scheme, forURLScheme: "gh")
config.userContentController.add(probe, name: "saveWorkerProbe")
let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 600, height: 400), configuration: config)
probe.webView = view; view.navigationDelegate = probe
let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 400), styleMask: [.borderless], backing: .buffered, defer: false)
window.contentView = view
view.load(URLRequest(url: URL(string: "gh://app/index.html")!))
let deadline = Date().addingTimeInterval(90)
while probe.report == nil && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
var report = probe.report ?? ["failed": 1, "error": "Native save-worker probe timed out", "progress": probe.progress ?? [:]]
let valid = report["version"] as? String == "save-pipeline-native-v1" && report["passed"] as? Int == 9 && report["total"] as? Int == 9 && report["failed"] as? Int == 0 && requestedPaths.contains("/save-checksum-worker.js")
report["realWKWebView"] = true; report["origin"] = "gh://app"; report["platform"] = "macOS"; report["physicalIPhone"] = false
report["workerRequestObserved"] = requestedPaths.contains("/save-checksum-worker.js"); report["requestedPaths"] = requestedPaths
report["nativeGatePassed"] = valid
var hashes: [String: String] = [:]
for file in ["index.html", "fleet-store-core.js", "state-codec-core.js", "save-chunk-codec.js", "save-checksum-thread.js", "save-checksum-worker.js"] {
    hashes[file] = SHA256.hash(data: try Data(contentsOf: webRoot.appendingPathComponent(file))).map { String(format: "%02x", $0) }.joined()
}
report["sourceSha256"] = hashes
report["probeSha256"] = SHA256.hash(data: probeData).map { String(format: "%02x", $0) }.joined()
try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: "native-save-worker.json"))
print("NATIVE_SAVE_WORKER \(valid ? "PASS" : "FAIL")")
exit(valid ? 0 : 1)
