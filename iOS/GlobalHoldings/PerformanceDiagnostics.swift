import Foundation
import UIKit

/// Sensors exist only during an explicitly started session. No polling or per-frame native bridge calls.
final class PerformanceDiagnostics {
    private let queue = DispatchQueue(label: "com.ventora.performance-report", qos: .utility)
    private var observers: [NSObjectProtocol] = []
    private var sessionID: String?
    private var previousBatteryMonitoring = false
    private var lastSample: [String: Any]?
    private var sampleSink: (([String: Any]) -> Void)?
    private var vault: PerformanceReportVault {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return PerformanceReportVault(directory: base.appendingPathComponent("PerformanceReports", isDirectory: true))
    }

    private func sample(kind: String, identifier: String) -> [String: Any] {
        let device = UIDevice.current
        let thermal: String
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: thermal = "nominal"
        case .fair: thermal = "fair"
        case .serious: thermal = "serious"
        case .critical: thermal = "critical"
        @unknown default: thermal = "unknown"
        }
        let state: String
        switch device.batteryState {
        case .unplugged: state = "unplugged"
        case .charging: state = "charging"
        case .full: state = "full"
        case .unknown: state = "unknown"
        @unknown default: state = "unknown"
        }
        let level = device.batteryLevel
        let result: [String: Any] = ["type": "sample", "sessionId": identifier, "kind": kind,
            "nativeUptimeMs": ProcessInfo.processInfo.systemUptime * 1000,
            "thermalState": thermal, "batteryState": state,
            "batteryLevel": level.isFinite && level >= 0 && level <= 1 ? NSNumber(value: level) : NSNull(),
            "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled]
        lastSample = result
        return result
    }

    func suspend() {
        guard let identifier = sessionID else { return }
        let snapshot = sample(kind: "background", identifier: identifier)
        sampleSink?(snapshot)
        removeSensors()
    }

    private func removeSensors() {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers.removeAll(keepingCapacity: false)
        if sessionID != nil { UIDevice.current.isBatteryMonitoringEnabled = previousBatteryMonitoring }
        sessionID = nil
        sampleSink = nil
    }

    private func start(identifier: String, emit: @escaping ([String: Any]) -> Void) throws -> [String: Any] {
        guard identifier.count <= 100, !identifier.isEmpty,
              identifier.range(of: "^[A-Za-z0-9-]+$", options: .regularExpression) != nil,
              sessionID == nil || sessionID == identifier else {
            throw NSError(domain: "VentoraPerformance", code: 4, userInfo: [NSLocalizedDescriptionKey: "Invalid or busy performance session"])
        }
        if sessionID == identifier { return sample(kind: "start", identifier: identifier) }
        previousBatteryMonitoring = UIDevice.current.isBatteryMonitoringEnabled
        sessionID = identifier
        sampleSink = emit
        UIDevice.current.isBatteryMonitoringEnabled = true
        let names: [Notification.Name] = [ProcessInfo.thermalStateDidChangeNotification,
            UIDevice.batteryLevelDidChangeNotification, UIDevice.batteryStateDidChangeNotification,
            .NSProcessInfoPowerStateDidChange]
        for name in names {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                guard let self, self.sessionID == identifier else { return }
                self.sampleSink?(self.sample(kind: "change", identifier: identifier))
            })
        }
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in self?.suspend() })
        return sample(kind: "start", identifier: identifier)
    }

    /// Called only after GameViewController verifies its own trusted main document and navigation token.
    func handle(_ payload: [String: Any], emit: @escaping ([String: Any]) -> Void, export: @escaping (URL) -> Void) -> Bool {
        guard let action = payload["action"] as? String, action.hasPrefix("performance") else { return false }
        let requestID = String((payload["requestId"] as? String ?? "").prefix(100))
        let reply: (Bool, [String: Any]) -> Void = { ok, detail in
            var message = detail
            message["type"] = "reply"; message["requestId"] = requestID; message["action"] = action; message["ok"] = ok
            emit(message)
        }
        switch action {
        case "performanceStart":
            do { reply(true, ["sample": try start(identifier: payload["sessionId"] as? String ?? "", emit: emit)]) }
            catch { reply(false, ["error": error.localizedDescription]) }
        case "performanceStop":
            let requested = payload["sessionId"] as? String ?? ""
            if sessionID == requested {
                let snapshot = sample(kind: "stop", identifier: requested)
                removeSensors(); reply(true, ["sample": snapshot])
            } else if let lastSample, lastSample["sessionId"] as? String == requested {
                reply(true, ["sample": lastSample])
            } else { reply(false, ["error": "Performance session is not active"]) }
        case "performanceSave", "performanceExport":
            guard let json = payload["json"] as? String, json.utf8.count <= PerformanceReportVault.maximumBytes,
                  let identifier = payload["reportId"] as? String, identifier.count <= 100 else {
                reply(false, ["error": "Invalid performance report payload"]); return true
            }
            let reportVault = vault
            queue.async {
                do {
                    if action == "performanceSave" { try reportVault.save(json: json, reportID: identifier) }
                    else {
                        let data = try PerformanceReportVault.validatedData(json, reportID: identifier)
                        let url = FileManager.default.temporaryDirectory.appendingPathComponent("Ventora_Performance.ghdiagnostic")
                        try data.write(to: url, options: .atomic)
                        DispatchQueue.main.async { export(url) }
                    }
                    DispatchQueue.main.async { reply(true, ["reportId": identifier, "prepared": true, "externalSaveConfirmed": false]) }
                } catch { DispatchQueue.main.async { reply(false, ["error": error.localizedDescription]) } }
            }
        case "performanceLoad":
            let reportVault = vault
            queue.async {
                do {
                    let json = try reportVault.load()
                    DispatchQueue.main.async { reply(true, ["json": json ?? ""]) }
                } catch { DispatchQueue.main.async { reply(false, ["error": error.localizedDescription]) } }
            }
        default: reply(false, ["error": "Unknown performance action"])
        }
        return true
    }

    deinit {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        if sessionID != nil {
            let previous = previousBatteryMonitoring
            if Thread.isMainThread { UIDevice.current.isBatteryMonitoringEnabled = previous }
            else { DispatchQueue.main.async { UIDevice.current.isBatteryMonitoringEnabled = previous } }
        }
    }
}
