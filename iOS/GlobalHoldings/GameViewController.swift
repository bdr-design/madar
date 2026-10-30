import UIKit
import CoreFoundation
import WebKit
import CryptoKit
import UniformTypeIdentifiers
import MachO

private let ventoraSky = UIColor(red: 0.122, green: 0.471, blue: 0.784, alpha: 1)

/// VENTORA release edition on a modified (jailbroken) iPhone: the tools that edit a running game's memory and files
/// need one. The release edition does not open the game there. The checks only look for files and libraries that a
/// stock iPhone never has, so an ordinary device is never refused.
enum VentoraDeviceIntegrity {
    private static let paths = [
        "/Applications/Cydia.app", "/Applications/Sileo.app", "/Applications/Zebra.app", "/Applications/Filza.app",
        "/var/jb", "/private/var/jb", "/Library/MobileSubstrate/MobileSubstrate.dylib", "/usr/lib/TweakInject",
        "/etc/apt", "/private/var/lib/apt", "/usr/sbin/sshd", "/usr/bin/ssh", "/var/binpack"
    ]
    private static let libraries = ["substrate", "substitute", "libhooker", "tweakinject", "ellekit", "frida", "cycript", "sslkillswitch"]

    static func isModified() -> Bool {
        #if targetEnvironment(simulator)
        return false
        #else
        let fm = FileManager.default
        if paths.contains(where: { fm.fileExists(atPath: $0) }) { return true }
        for index in 0..<_dyld_image_count() {
            guard let raw = _dyld_get_image_name(index) else { continue }
            let name = String(cString: raw).lowercased()
            if libraries.contains(where: { name.contains($0) }) { return true }
        }
        return false
        #endif
    }
}

/// A native owner for the WebApp lifecycle. It remains available when the web
/// interface cannot load, so update, recovery and diagnostics never depend on
/// the game page being healthy.
final class GameViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, UIDocumentPickerDelegate {
    private var webView: WKWebView!
    /// VENTORA store (StoreKit 2, VentoraStore.swift): the `storeBridge` handler's owner.
    private var store: VentoraStore?
    private let schemeHandler = GlobalGameSchemeHandler()
    private var launchOverlay: UIView?
    private weak var launchSubtitleLabel: UILabel?
    private weak var launchPrimaryButton: UIButton?
    private weak var launchUpdateButton: UIButton?
    private var launchTimeoutWorkItem: DispatchWorkItem?
    private var launchAttempt: UInt = 0
    private var pendingIncomingUpdateURL: URL?
    private var pendingSaveJSON: String?
    private var pendingNativeUpdate: GlobalGameStorage.AppliedUpdate?
    private var updateStateCommittedIdentity: String?
    private var updateStateSaveGeneration: Int?
    private var updateBootConfirmedIdentity: String?
    private var operationsApplyingIdentity: String?
    private var preUpdateSaveGeneration: Int = 0
    private var recoveredWebProcess = false
    private var backgroundSaveTask: UIBackgroundTaskIdentifier = .invalid
    private var backgroundSaveInFlight = false
    private var backgroundSaveToken: UInt = 0
    private var nativeNavigationToken: UInt = 0
    private var navigationPreparing = false
    private var nativeBootstrapIntent: UInt = 0
    private var bootstrapForceOnNavigation = false
    private var bootstrapPauseOnNavigation = false
    private lazy var saveExportDownloads: VentoraSaveExportDownloads = VentoraSaveExportDownloads { [weak self] result in
        guard let self else { return }
        switch result {
        case .success(let url):
            let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            share.completionWithItemsHandler = { [weak self] _, _, _, _ in self?.saveExportDownloads.releaseFile(url) }
            if let popover = share.popoverPresentationController { popover.sourceView = self.view; popover.sourceRect = CGRect(x: self.view.bounds.midX, y: self.view.bounds.midY, width: 1, height: 1) }
            (self.presentedViewController ?? self).present(share, animated: true)
        case .failure(let error):
            self.showMessage(title: "تعذر التصدير", message: error.localizedDescription)
        }
    }

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.add(self, name: "updateBridge")
        configuration.userContentController.add(self, name: "saveBridge")
        configuration.userContentController.add(self, name: "diagnosticBridge")
        configuration.userContentController.add(self, name: "storeBridge")
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: "gh")
        if ventoraReleaseEdition {
            configuration.userContentController.addUserScript(WKUserScript(source: "window.GH_EDITION='release';", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.alwaysBounceHorizontal = false
        webView.allowsBackForwardNavigationGestures = false
        webView.isOpaque = false
        webView.backgroundColor = ventoraSky
        if ventoraReleaseEdition { webView.isInspectable = false }
        store = VentoraStore(webView: webView)
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        initializeRuntime()
        observeDeviceState()
    }

    // The device's power and heat state for the diagnostic export, sent to the page when it loads and when iOS reports a
    // change, never polled: WebKit slows requestAnimationFrame in Low Power Mode and under thermal pressure, which the page
    // cannot read itself.
    private var deviceStateObservers: [NSObjectProtocol] = []

    private func observeDeviceState() {
        guard deviceStateObservers.isEmpty else { return }
        for name in [ProcessInfo.thermalStateDidChangeNotification, Notification.Name.NSProcessInfoPowerStateDidChange] {
            deviceStateObservers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.reportDeviceState()
            })
        }
    }

    private func reportDeviceState() {
        guard webView != nil else { return }
        let thermalState: String
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: thermalState = "nominal"
        case .fair: thermalState = "fair"
        case .serious: thermalState = "serious"
        case .critical: thermalState = "critical"
        @unknown default: thermalState = "unknown"
        }
        let detail: [String: Any] = [
            "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
            "thermalState": thermalState,
            "maximumFramesPerSecond": view.window?.windowScene?.screen.maximumFramesPerSecond ?? 0
        ]
        reportBridgeEvent("gh-native-device-state", detail: detail)
    }

    private func initializeRuntime() {
        if ventoraReleaseEdition && VentoraDeviceIntegrity.isModified() {
            showLaunchOverlay()
            launchPrimaryButton?.isEnabled = false
            launchPrimaryButton?.alpha = 0.55
            showLaunchStatus("لا تعمل أصول ونفوذ على جهاز معدّل (Jailbreak) حفاظًا على عدالة اللعبة وحماية حفظك.")
            return
        }
        do {
            try GlobalGameStorage.shared.ensureInitialized()
            showLaunchOverlay()
        } catch {
            // Keep update and recovery controls available even if a bad build
            // omitted the bundled WebApp. A complete package can bootstrap it.
            showLaunchOverlay(recoveryMessage: error.localizedDescription)
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if let url = pendingIncomingUpdateURL {
            pendingIncomingUpdateURL = nil
            confirmAndApplyUpdate(url)
        }
    }

    /// Gives the existing browser -> Native persistence pipeline enough time to
    /// flush its newest revision when iOS backgrounds the app. The JavaScript
    /// side waits for the authenticated Native Save Vault acknowledgement before
    /// this finite task is ended; expiration always releases the task as well.
    func persistStateForBackground(_ application: UIApplication) {
        if !Thread.isMainThread {
            DispatchQueue.main.async { [weak self] in self?.persistStateForBackground(application) }
            return
        }
        guard !backgroundSaveInFlight, isViewLoaded, webView?.url != nil else { return }
        backgroundSaveInFlight = true
        backgroundSaveToken &+= 1
        let token = backgroundSaveToken
        backgroundSaveTask = application.beginBackgroundTask(withName: "GlobalHoldings.Save") { [weak self] in
            DispatchQueue.main.async { self?.finishBackgroundSaveTask(application, token: token) }
        }
        webView.callAsyncJavaScript(
            "return await window.GH_RUNTIME?.persistForBackground?.();",
            arguments: [:],
            in: nil,
            in: .page
        ) { [weak self] _ in
            DispatchQueue.main.async { self?.finishBackgroundSaveTask(application, token: token) }
        }
    }

    private func finishBackgroundSaveTask(_ application: UIApplication, token: UInt) {
        guard backgroundSaveInFlight, token == backgroundSaveToken else { return }
        backgroundSaveInFlight = false
        let task = backgroundSaveTask
        backgroundSaveTask = .invalid
        if task != .invalid { application.endBackgroundTask(task) }
    }

    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        coordinator.animate(alongsideTransition: nil) { [weak self] _ in
            self?.webView?.evaluateJavaScript("window.dispatchEvent(new Event('resize'));")
        }
    }

    /// VENTORA entry screen: the launch art fills the screen, one «دخول اللعبة» button sits over the calm sea on the
    /// left, and a status line under it reports loading and failures. The development edition keeps two small update
    /// and restore buttons in the corner; the release edition has neither.
    private func showLaunchOverlay(recoveryMessage: String? = nil) {
        launchTimeoutWorkItem?.cancel()
        launchOverlay?.removeFromSuperview()
        let overlay = UIView()
        overlay.backgroundColor = ventoraSky
        overlay.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(overlay)

        let art = UIImageView(image: UIImage(named: "LaunchArt"))
        art.contentMode = .scaleAspectFill
        art.clipsToBounds = true
        art.isAccessibilityElement = true
        art.accessibilityLabel = "أصول ونفوذ"
        art.translatesAutoresizingMaskIntoConstraints = false
        overlay.addSubview(art)

        let recovering = recoveryMessage != nil
        let play = makeButton(title: recovering ? "إعادة محاولة التشغيل" : "دخول اللعبة", primary: true)
        if recovering {
            play.addTarget(self, action: #selector(retryRuntimeInitialization), for: .touchUpInside)
        } else {
            play.addTarget(self, action: #selector(enterGame), for: .touchUpInside)
        }
        play.translatesAutoresizingMaskIntoConstraints = false
        overlay.addSubview(play)

        // The status line: loading, recovery and failure messages on a dark glass pill.
        let status = UIView()
        status.backgroundColor = UIColor.black.withAlphaComponent(0.38)
        status.layer.cornerRadius = 12
        status.translatesAutoresizingMaskIntoConstraints = false
        status.isHidden = recoveryMessage == nil
        let subtitle = UILabel()
        subtitle.text = recoveryMessage.map { "استرداد أصول ونفوذ · \($0)" }
        subtitle.textColor = .white
        subtitle.font = .systemFont(ofSize: 13, weight: .semibold)
        subtitle.textAlignment = .center
        subtitle.numberOfLines = 3
        subtitle.translatesAutoresizingMaskIntoConstraints = false
        status.addSubview(subtitle)
        overlay.addSubview(status)

        let version = UILabel()
        let storage = GlobalGameStorage.shared
        let installedNote = !ventoraReleaseEdition && storage.installedBuild > 0 && storage.installedBuild != storage.bundledBuild
            ? " ⚠︎ مثبّت فعليًا BUILD\(storage.installedBuild)"
            : ""
        version.text = ventoraReleaseEdition ? "الإصدار \(storage.currentVersion)" : "\(storage.currentVersion) · BUILD\(storage.bundledBuild)\(installedNote)"
        version.textColor = .white
        version.font = .monospacedDigitSystemFont(ofSize: 11, weight: .semibold)
        version.layer.shadowColor = UIColor.black.cgColor
        version.layer.shadowOpacity = 0.6
        version.layer.shadowRadius = 2
        version.layer.shadowOffset = .zero
        version.translatesAutoresizingMaskIntoConstraints = false
        overlay.addSubview(version)

        let safe = overlay.safeAreaLayoutGuide
        var constraints: [NSLayoutConstraint] = [
            overlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            overlay.topAnchor.constraint(equalTo: view.topAnchor),
            overlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            art.leadingAnchor.constraint(equalTo: overlay.leadingAnchor),
            art.trailingAnchor.constraint(equalTo: overlay.trailingAnchor),
            art.topAnchor.constraint(equalTo: overlay.topAnchor),
            art.bottomAnchor.constraint(equalTo: overlay.bottomAnchor),
            play.leftAnchor.constraint(equalTo: safe.leftAnchor, constant: 28),
            play.centerYAnchor.constraint(equalTo: safe.centerYAnchor, constant: -10),
            play.widthAnchor.constraint(equalToConstant: 220),
            play.heightAnchor.constraint(equalToConstant: 56),
            status.topAnchor.constraint(equalTo: play.bottomAnchor, constant: 12),
            status.centerXAnchor.constraint(equalTo: play.centerXAnchor),
            status.widthAnchor.constraint(lessThanOrEqualToConstant: 300),
            status.widthAnchor.constraint(greaterThanOrEqualTo: play.widthAnchor),
            subtitle.leadingAnchor.constraint(equalTo: status.leadingAnchor, constant: 12),
            subtitle.trailingAnchor.constraint(equalTo: status.trailingAnchor, constant: -12),
            subtitle.topAnchor.constraint(equalTo: status.topAnchor, constant: 8),
            subtitle.bottomAnchor.constraint(equalTo: status.bottomAnchor, constant: -8),
            version.leftAnchor.constraint(equalTo: safe.leftAnchor, constant: 30),
            version.bottomAnchor.constraint(equalTo: safe.bottomAnchor, constant: -12)
        ]

        var update: UIButton?
        if !ventoraReleaseEdition {
            var corner: [UIView] = []
            let updateButton = makeCornerButton(title: "تحديث")
            updateButton.addTarget(self, action: #selector(openUpdatePicker), for: .touchUpInside)
            corner.append(updateButton)
            if GlobalGameStorage.shared.hasPreviousVersion {
                let restore = makeCornerButton(title: "استرجاع")
                restore.addTarget(self, action: #selector(confirmRestorePreviousVersion), for: .touchUpInside)
                corner.append(restore)
            }
            let row = UIStackView(arrangedSubviews: corner)
            row.axis = .horizontal
            row.spacing = 8
            row.semanticContentAttribute = .forceLeftToRight
            row.translatesAutoresizingMaskIntoConstraints = false
            overlay.addSubview(row)
            constraints += [
                row.leftAnchor.constraint(equalTo: safe.leftAnchor, constant: 26),
                row.topAnchor.constraint(equalTo: safe.topAnchor, constant: 14),
                updateButton.heightAnchor.constraint(equalToConstant: 34)
            ]
            update = updateButton
        }
        NSLayoutConstraint.activate(constraints)
        launchOverlay = overlay
        launchSubtitleLabel = subtitle
        launchPrimaryButton = play
        launchUpdateButton = update
    }

    private func showLaunchStatus(_ text: String) {
        launchSubtitleLabel?.text = text
        launchSubtitleLabel?.superview?.isHidden = false
    }

    private func beginLaunchLoading() {
        launchAttempt &+= 1
        let attempt = launchAttempt
        launchTimeoutWorkItem?.cancel()
        showLaunchStatus("جارٍ استعادة عالمك والتحقق من الحفظ وتجهيز الخريطة…")
        launchPrimaryButton?.setTitle("جارٍ التشغيل…", for: .normal)
        launchPrimaryButton?.isEnabled = false
        launchPrimaryButton?.alpha = 0.72
        launchUpdateButton?.isEnabled = false
        launchUpdateButton?.alpha = 0.55
        let timeout = DispatchWorkItem { [weak self] in
            guard let self, self.launchAttempt == attempt, self.launchOverlay != nil else { return }
            self.showLaunchFailure(ventoraReleaseEdition
                ? "لم يكتمل تجهيز اللعبة خلال المهلة. لم يُعرض عالم افتراضي بدل حفظك؛ أعد المحاولة."
                : "لم يكتمل تجهيز اللعبة خلال المهلة. لم يُعرض عالم افتراضي بدل حفظك؛ أعد المحاولة أو ثبّت تحديثًا سليمًا.")
        }
        launchTimeoutWorkItem = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 45, execute: timeout)
    }

    private func showLaunchFailure(_ message: String) {
        launchTimeoutWorkItem?.cancel()
        launchTimeoutWorkItem = nil
        showLaunchStatus(message)
        launchPrimaryButton?.setTitle("إعادة محاولة التشغيل", for: .normal)
        launchPrimaryButton?.isEnabled = true
        launchPrimaryButton?.alpha = 1
        launchUpdateButton?.isEnabled = true
        launchUpdateButton?.alpha = 1
    }

    private func completeLaunchOverlay() {
        launchTimeoutWorkItem?.cancel()
        launchTimeoutWorkItem = nil
        guard let overlay = launchOverlay else { return }
        launchOverlay = nil
        launchSubtitleLabel = nil
        launchPrimaryButton = nil
        launchUpdateButton = nil
        UIView.animate(withDuration: 0.22, animations: { overlay.alpha = 0 }) { _ in overlay.removeFromSuperview() }
    }

    private func makeButton(title: String, primary: Bool) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(title, for: .normal)
        button.setTitleColor(.white, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: primary ? 19 : 15, weight: .bold)
        button.backgroundColor = primary
            ? UIColor(red: 0.05, green: 0.50, blue: 0.70, alpha: 1)
            : UIColor.black.withAlphaComponent(0.30)
        button.layer.cornerRadius = primary ? 28 : 17
        button.layer.borderWidth = 1.5
        button.layer.borderColor = UIColor.white.withAlphaComponent(primary ? 0.75 : 0.45).cgColor
        button.layer.shadowColor = UIColor(red: 0.02, green: 0.19, blue: 0.29, alpha: 1).cgColor
        button.layer.shadowOpacity = primary ? 0.45 : 0
        button.layer.shadowRadius = 10
        button.layer.shadowOffset = CGSize(width: 0, height: 6)
        return button
    }

    private func makeCornerButton(title: String) -> UIButton {
        let button = makeButton(title: title, primary: false)
        button.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
        button.contentEdgeInsets = UIEdgeInsets(top: 0, left: 14, bottom: 0, right: 14)
        return button
    }

    @objc private func enterGame() {
        loadGame()
    }

    @objc private func retryRuntimeInitialization() {
        launchOverlay?.removeFromSuperview()
        launchOverlay = nil
        initializeRuntime()
    }

    @objc private func openUpdatePicker() {
        guard !ventoraReleaseEdition else { return }
        let types = ["saneiupdate", "ghupdate"].compactMap { UTType(filenameExtension: $0) }
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: types.isEmpty ? [.data] : types, asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        present(picker, animated: true)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else { return }
        importUpdate(from: url)
    }

    func importUpdate(from url: URL) {
        guard !ventoraReleaseEdition else { return }
        do {
            let local = try GlobalGameStorage.shared.copyIncomingUpdate(from: url)
            guard isViewLoaded, view.window != nil else {
                pendingIncomingUpdateURL = local
                return
            }
            confirmAndApplyUpdate(local)
        } catch {
            showMessage(title: "فشل استلام التحديث", message: error.localizedDescription)
        }
    }

    private func confirmAndApplyUpdate(_ url: URL) {
        let alert = UIAlertController(
            title: "تحديث أصول ونفوذ",
            message: "تم العثور على حزمة تحديث. الإصدار الحالي: \(GlobalGameStorage.shared.currentVersion)",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "إلغاء", style: .cancel) { _ in try? FileManager.default.removeItem(at: url) })
        alert.addAction(UIAlertAction(title: "تحديث الآن", style: .default) { [weak self] _ in self?.applyNativeUpdate(url) })
        present(alert, animated: true)
    }

    private func applyNativeUpdate(_ url: URL) {
        webView.stopLoading()
        captureVerifiedPreUpdateCheckpoint { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let error):
                self.showMessage(title: "فشل نقطة الاستعادة", message: error.localizedDescription)
            case .success(let generation):
                self.preUpdateSaveGeneration = generation
                self.reportUpdateLifecycle(phase: "PRE_SAVE_COMMITTED", message: "Verified pre-update save generation \(generation)")
                DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                    do {
                        let result = try GlobalGameStorage.shared.applyUpdatePackage(at: url, preUpdateSaveGeneration: generation)
                        DispatchQueue.main.async {
                            guard let self else { return }
                            self.preparePendingUpdate(result)
                            self.reportUpdateLifecycle(phase: "RUNTIME_SWAPPED", version: result.version)
                            self.showMessage(
                                title: "تم التحقق من ملفات التحديث",
                                message: "تم تجهيز الإصدار \(result.version) مبدئيًا. سيُعتمد فقط بعد نجاح العمليات والحفظ الدائم وفحص سلامة التشغيل."
                            ) { [weak self] in
                                self?.launchOverlay?.removeFromSuperview()
                                self?.launchOverlay = nil
                                self?.loadGame(cacheBuster: result.version)
                            }
                        }
                    } catch {
                        DispatchQueue.main.async { [weak self] in
                            self?.reportUpdateLifecycle(phase: "FAILED", message: error.localizedDescription)
                            self?.showMessage(title: "فشل التحديث", message: error.localizedDescription)
                        }
                    }
                }
            }
        }
    }

    private func captureVerifiedPreUpdateCheckpoint(completion: @escaping (Result<Int, Error>) -> Void) {
        let commit: (String?) -> Void = { save in
            guard let save, !save.isEmpty else {
                let generation = GlobalSaveVault.shared.currentGeneration()
                guard generation > 0 else {
                    completion(.failure(NSError(domain: "GlobalHoldings.Update", code: 1001, userInfo: [NSLocalizedDescriptionKey: "لا توجد نقطة حفظ Native موثقة قبل التحديث. افتح اللعبة واحفظ الحالة أولاً ثم أعد المحاولة."])))
                    return
                }
                completion(.success(generation))
                return
            }
            GlobalSaveVault.shared.commitAsync(save, runtimeVersion: GlobalGameStorage.shared.currentVersion) { [weak self] result in
                if case .success(let generation) = result {
                    GlobalGameStorage.shared.noteCurrentSaveGeneration(generation)
                }
                completion(result)
            }
        }
        // If the runtime is loaded, capture the freshest in-memory state directly.
        // Native Save Vault remains the authoritative fallback when WebKit is unavailable.
        guard isViewLoaded, webView.url != nil else { commit(GlobalSaveVault.shared.currentSave()); return }
        webView.evaluateJavaScript("JSON.stringify(window.__GH_STATE__||null)") { value, error in
            if let error {
                if let native = GlobalSaveVault.shared.currentSave() { commit(native) }
                else { completion(.failure(error)) }
                return
            }
            let live = (value as? String).flatMap { $0 == "null" || $0.isEmpty ? nil : $0 }
            commit(live ?? GlobalSaveVault.shared.currentSave())
        }
    }

    private func preparePendingUpdate(_ update: GlobalGameStorage.AppliedUpdate) {
        pendingNativeUpdate = update
        updateStateCommittedIdentity = nil
        updateStateSaveGeneration = nil
        updateBootConfirmedIdentity = nil
        operationsApplyingIdentity = nil
    }

    private func updateIdentity(version: String, build: Int) -> String { "\(version)#\(build)" }

    private func payloadInteger(_ value: Any?) -> Int? {
        if let number = value as? NSNumber {
            guard CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
            let v = number.doubleValue
            guard v.isFinite, v >= 0, v <= 9_007_199_254_740_991, v.rounded(.down) == v else { return nil }
            return Int(v)
        }
        if let text = value as? String, let v = Int(text), v >= 0, v <= 9_007_199_254_740_991 { return v }
        return nil
    }

    private func isTrustedGameDocument(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme?.lowercased() == "gh" && url.host?.lowercased() == "app"
            && url.user == nil && url.password == nil && url.port == nil
    }

    @objc private func confirmRestorePreviousVersion() {
        guard GlobalGameStorage.shared.hasPreviousVersion else { return }
        let version = GlobalGameStorage.shared.previousVersion ?? "النسخة السابقة"
        let alert = UIAlertController(
            title: "استرجاع النسخة السابقة",
            message: "سيتم استرجاع إصدار \(version) مع الاحتفاظ بالنسخة الحالية للتبديل لاحقًا.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "إلغاء", style: .cancel))
        alert.addAction(UIAlertAction(title: "استرجاع", style: .destructive) { [weak self] _ in self?.restorePreviousVersion() })
        present(alert, animated: true)
    }

    private func restorePreviousVersion() {
        webView.stopLoading()
        // Manual rollback must checkpoint the freshest in-memory game state first so
        // toggling back later restores an exact Runtime + Save pair.
        captureVerifiedPreUpdateCheckpoint { [weak self] checkpoint in
            guard let self else { return }
            switch checkpoint {
            case .failure(let error):
                self.showMessage(title: "فشل الاسترجاع", message: "تعذر تثبيت نقطة حفظ قبل الاسترجاع: \(error.localizedDescription)")
            case .success:
                DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                    do {
                        let version = try GlobalGameStorage.shared.restorePreviousVersion()
                        DispatchQueue.main.async {
                            self?.showMessage(title: "تم تجهيز الاسترجاع", message: "تم تجهيز الإصدار \(version). لن يُعتمد نهائيًا إلا بعد اجتياز Boot + Integrity.") { [weak self] in
                                self?.loadGame(cacheBuster: UUID().uuidString)
                            }
                        }
                    } catch {
                        DispatchQueue.main.async { [weak self] in self?.showMessage(title: "فشل الاسترجاع", message: error.localizedDescription) }
                    }
                }
            }
        }
    }

    private func loadGame(cacheBuster: String = UUID().uuidString) {
        if launchOverlay == nil { showLaunchOverlay() }
        beginLaunchLoading()
        guard let url = URL(string: "gh://app/index.html?v=\(cacheBuster.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? cacheBuster)") else {
            showLaunchFailure("تعذر تكوين عنوان التشغيل المحلي.")
            return
        }
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30))
    }

    private func isCurrentDocument(_ token: UInt) -> Bool {
        token == nativeNavigationToken && !navigationPreparing
    }

    private func prepareNextNativeBootstrap(force: Bool, pause: Bool = false) {
        // Recovery flags survive ordinary save completions until consumed by the
        // next successful top-level navigation. They do not hold a stale payload.
        bootstrapForceOnNavigation = bootstrapForceOnNavigation || force
        bootstrapPauseOnNavigation = bootstrapPauseOnNavigation || pause
        nativeBootstrapIntent &+= 1
    }

    private func installBootstrapBeforeNavigation(_ target: WKWebView, token: UInt, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let intent = nativeBootstrapIntent
        let force = bootstrapForceOnNavigation
        let pause = bootstrapPauseOnNavigation
        GlobalSaveVault.shared.bootstrapJavaScriptAsync(force: force, pause: pause) { [weak self, weak target] script in
            guard let self, let target, target === self.webView, token == self.nativeNavigationToken else {
                decisionHandler(.cancel)
                return
            }
            // A reset/recovery intent arriving while the snapshot was queued
            // must not be consumed by an earlier unpaused bootstrap.
            guard intent == self.nativeBootstrapIntent else {
                self.installBootstrapBeforeNavigation(target, token: token, decisionHandler: decisionHandler)
                return
            }
            target.configuration.userContentController.removeAllUserScripts()
            if !script.isEmpty {
                target.configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            }
            self.bootstrapForceOnNavigation = false
            self.bootstrapPauseOnNavigation = false
            decisionHandler(.allow)
        }
    }

    private func manualSlotMetadataDictionary(_ metadata: GlobalSaveVault.ManualSlotMetadata) -> [String: Any] {
        var out: [String: Any] = [
            "index": metadata.index,
            "simSeconds": metadata.simSeconds,
            "saveRevision": metadata.saveRevision,
            "resetEpoch": metadata.resetEpoch,
            "savedAt": metadata.savedAt,
            "label": metadata.label
        ]
        if let runtimeVersion = metadata.runtimeVersion { out["runtimeVersion"] = runtimeVersion }
        return out
    }

    private func reportManualSlotAck(payload: [String: Any], success: Bool, generation: Int? = nil, metadata: GlobalSaveVault.ManualSlotMetadata? = nil, message: String? = nil) {
        var detail: [String: Any] = [
            "success": success,
            "message": message ?? "",
            "action": payload["action"] as? String ?? "",
            "requestId": payload["requestId"] as? String ?? "",
            "index": payloadInteger(payload["index"]) ?? -1
        ]
        if let generation { detail["generation"] = generation }
        if let metadata { detail["metadata"] = manualSlotMetadataDictionary(metadata) }
        reportBridgeEvent("gh-native-slot-ack", detail: detail)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        // Privileged bridges are owned by this WebView's main local document only.
        guard !navigationPreparing, message.webView === webView, message.frameInfo.isMainFrame,
              isTrustedGameDocument(message.frameInfo.request.url) else { return }
        guard let payload = message.body as? [String: Any], let action = payload["action"] as? String else { return }
        let requestDocument = nativeNavigationToken
        if message.name == "saveBridge" {
            switch action {
            case "commitSave":
                guard let json = payload["saveJSON"] as? String else {
                    reportSaveAck(payload: payload, success: false, generation: nil, message: "Invalid save envelope.")
                    return
                }
                let nativeCommitStartedAt = ProcessInfo.processInfo.systemUptime
                GlobalSaveVault.shared.commitAsync(json, runtimeVersion: GlobalGameStorage.shared.currentVersion, envelope: payload) { [weak self] result in
                    let nativeVaultCommitMs = max(0, (ProcessInfo.processInfo.systemUptime - nativeCommitStartedAt) * 1000)
                    switch result {
                    case .success(let generation):
                        GlobalGameStorage.shared.noteCurrentSaveGeneration(generation)
                        let stages = GlobalSaveVault.shared.takeCommitTimings(generation: generation)
                        guard self?.isCurrentDocument(requestDocument) == true else { return }
                        self?.reportSaveAck(payload: payload, success: true, generation: generation, message: nil, nativeVaultCommitMs: nativeVaultCommitMs, nativeVaultStages: stages)
                    case .failure(let error):
                        guard self?.isCurrentDocument(requestDocument) == true else { return }
                        print("GlobalSaveVault commit failed: \(error.localizedDescription)")
                        self?.reportSaveAck(payload: payload, success: false, generation: nil, message: error.localizedDescription, nativeVaultCommitMs: nativeVaultCommitMs)
                    }
                }
            case "storeSaveChunk":
                // Build 358 (million-asset save): one 4 MiB fleet record chunk, uploaded before the commit that lists it.
                guard let requestId = payload["requestId"] as? String, !requestId.isEmpty, requestId.count <= 200,
                      let id = payload["id"] as? String, GlobalSaveVault.shared.isValidChunkId(id),
                      let text = payload["base64"] as? String else {
                    reportBridgeEvent("gh-native-chunk-ack", detail: ["requestId": payload["requestId"] as? String ?? "", "id": payload["id"] as? String ?? "", "success": false, "message": "Invalid save chunk upload."])
                    return
                }
                let encoding = payload["encoding"] as? String ?? "identity"
                let rawBytes = payloadInteger(payload["bytes"])
                GlobalSaveVault.shared.storeChunkBase64Async(id: id, text: text, encoding: encoding, rawBytes: rawBytes) { [weak self] result in
                    guard self?.isCurrentDocument(requestDocument) == true else { return }
                    switch result {
                    case .success(let digest):
                        self?.reportBridgeEvent("gh-native-chunk-ack", detail: ["requestId": requestId, "id": id, "success": true, "sha256": digest])
                    case .failure(let error):
                        self?.reportBridgeEvent("gh-native-chunk-ack", detail: ["requestId": requestId, "id": id, "success": false, "message": error.localizedDescription])
                    }
                }
            case "saveManualSlot":
                guard let index = payloadInteger(payload["index"]), (0...5).contains(index),
                      let json = payload["saveJSON"] as? String else {
                    reportManualSlotAck(payload: payload, success: false, message: "Invalid manual slot save envelope.")
                    return
                }
                let label = String((payload["label"] as? String ?? "").prefix(120))
                GlobalSaveVault.shared.saveManualSlotAsync(index, json: json, label: label, runtimeVersion: GlobalGameStorage.shared.currentVersion, envelope: payload) { [weak self] result in
                    switch result {
                    case .success(let metadata):
                        guard self?.isCurrentDocument(requestDocument) == true else { return }
                        self?.reportManualSlotAck(payload: payload, success: true, metadata: metadata)
                    case .failure(let error):
                        guard self?.isCurrentDocument(requestDocument) == true else { return }
                        self?.reportManualSlotAck(payload: payload, success: false, message: error.localizedDescription)
                    }
                }
            case "loadManualSlot":
                guard let requestId = payload["requestId"] as? String, !requestId.isEmpty, requestId.count <= 200,
                      let index = payloadInteger(payload["index"]), (0...5).contains(index) else {
                    reportManualSlotAck(payload: payload, success: false, message: "Invalid manual slot load request.")
                    return
                }
                GlobalSaveVault.shared.loadManualSlotAsync(index, runtimeVersion: GlobalGameStorage.shared.currentVersion) { [weak self] result in
                    switch result {
                    case .success(let generation):
                        GlobalGameStorage.shared.noteCurrentSaveGeneration(generation)
                        guard self?.isCurrentDocument(requestDocument) == true else { return }
                        self?.prepareNextNativeBootstrap(force: true)
                        self?.reportManualSlotAck(payload: payload, success: true, generation: generation)
                    case .failure(let error):
                        guard self?.isCurrentDocument(requestDocument) == true else { return }
                        self?.reportManualSlotAck(payload: payload, success: false, message: error.localizedDescription)
                    }
                }
            case "clearManualSlot":
                guard let requestId = payload["requestId"] as? String, !requestId.isEmpty, requestId.count <= 200,
                      let index = payloadInteger(payload["index"]), (0...5).contains(index) else {
                    reportManualSlotAck(payload: payload, success: false, message: "Invalid manual slot clear request.")
                    return
                }
                GlobalSaveVault.shared.clearManualSlotAsync(index) { [weak self] result in
                    switch result {
                    case .success:
                        guard self?.isCurrentDocument(requestDocument) == true else { return }
                        self?.reportManualSlotAck(payload: payload, success: true)
                    case .failure(let error):
                        guard self?.isCurrentDocument(requestDocument) == true else { return }
                        self?.reportManualSlotAck(payload: payload, success: false, message: error.localizedDescription)
                    }
                }
            default:
                break
            }
            return
        }
        if message.name == "storeBridge" {
            store?.handle(action: action, payload: payload)
            return
        }
        if message.name == "diagnosticBridge" {
            guard action == "exportDiagnostic", let json = payload["json"] as? String else { return }
            exportDiagnosticBundle(json: json, requestedName: payload["filename"] as? String)
            return
        }
        guard message.name == "updateBridge" else { return }
        switch action {
        case "installWebPack":
            guard !ventoraReleaseEdition else {
                reportToWeb(success: false, message: "تحديثات أصول ونفوذ تصل من متجر التطبيقات.")
                return
            }
            guard let manifest = payload["manifest"] as? [String: Any],
                  let files = payload["files"] as? [[String: Any]],
                  let operationsJSON = payload["operationsJSON"] as? String,
                  let save = payload["saveJSON"] as? String else {
                reportToWeb(success: false, message: "بيانات التحديث أو نقطة الحفظ الوقائية غير مكتملة.")
                return
            }
            pendingSaveJSON = save
            // A verified Save Vault generation is a hard precondition for replacing WebApp files.
            GlobalSaveVault.shared.commitAsync(save, runtimeVersion: GlobalGameStorage.shared.currentVersion) { [weak self] result in
                switch result {
                case .success(let generation):
                    self?.preUpdateSaveGeneration = generation
                    self?.reportUpdateLifecycle(phase: "PRE_SAVE_COMMITTED", message: "Verified pre-update save generation \(generation)")
                    GlobalGameStorage.shared.noteCurrentSaveGeneration(generation)
                    self?.applyWebBridgeUpdate(manifest: manifest, files: files, operationsJSON: operationsJSON, preUpdateSaveGeneration: generation)
                case .failure(let error):
                    self?.pendingSaveJSON = nil
                    self?.reportToWeb(success: false, message: "فشل إنشاء نقطة الاستعادة قبل التحديث: \(error.localizedDescription)")
                }
            }
        case "commitUpdateState":
            guard let version = payload["version"] as? String,
                  let build = payloadInteger(payload["build"]), build >= 0,
                  let save = payload["saveJSON"] as? String,
                  pendingNativeUpdate?.version == version,
                  pendingNativeUpdate?.build == build else {
                reportToWeb(success: false, message: "رفض Native اعتماد حالة تحديث غير مطابقة للإصدار/Build المعلق.")
                return
            }
            GlobalSaveVault.shared.commitAsync(save, runtimeVersion: version) { [weak self] result in
                guard let self else { return }
                switch result {
                case .success(let generation):
                    do {
                        try GlobalGameStorage.shared.markUpdateStateCommitted(version: version, build: build, saveGeneration: generation)
                        self.updateStateCommittedIdentity = self.updateIdentity(version: version, build: build)
                        self.updateStateSaveGeneration = generation
                        self.operationsApplyingIdentity = nil
                        self.reportUpdateLifecycle(phase: "STATE_COMMITTED", version: version, message: "Save generation \(generation)")
                        self.tryFinalizeNativeUpdate(version: version, build: build)
                    } catch {
                        self.reportToWeb(success: false, message: error.localizedDescription)
                        self.rollbackFailedUpdate(reason: "update-journal-state-commit-failed")
                    }
                case .failure(let error):
                    self.reportToWeb(success: false, message: "فشل الحفظ الدائم بعد عمليات التحديث: \(error.localizedDescription)")
                    self.rollbackFailedUpdate(reason: "durable-save-failed")
                }
            }
        case "updateOperationsFailed":
            guard let pending = pendingNativeUpdate,
                  payload["version"] as? String == pending.version,
                  payloadInteger(payload["build"]) == pending.build else { return }
            rollbackFailedUpdate(reason: payload["message"] as? String ?? "operations-failed")
        case "rollbackWebPack":
            rollbackFailedUpdate(reason: payload["reason"] as? String ?? "web-requested-rollback")
        case "openNativeUpdatePicker":
            openUpdatePicker()
        case "confirmUpdateBoot":
            guard let version = payload["version"] as? String else { return }
            confirmNativeUpdateBoot(version: version, build: payloadInteger(payload["build"]))
        case "runtimeReady":
            guard let version = payload["version"] as? String,
                  version == GlobalGameStorage.shared.currentVersion,
                  payloadInteger(payload["build"]) != nil else {
                showLaunchFailure("رفض Native إشارة جهوزية لا تطابق إصدار اللعبة المثبّت.")
                return
            }
            completeLaunchOverlay()
        case "bootProgress":
            guard launchOverlay != nil,
                  let loaded = payloadInteger(payload["loaded"]),
                  let total = payloadInteger(payload["total"]),
                  total > 0, loaded <= total else { return }
            let percent = min(100, Int((Double(loaded) / Double(total) * 100).rounded(.down)))
            launchSubtitleLabel?.text = "جارٍ استعادة عالمك والتحقق من الحفظ… \(percent)%"
        case "resetGameSave":
            guard let cleanSave = payload["saveJSON"] as? String else {
                reportSaveAck(payload: payload, success: false, generation: nil, message: "Invalid reset envelope.")
                return
            }
            let version = GlobalGameStorage.shared.currentVersion
            let clearManualSlots = payload["clearManualSlots"] as? Bool ?? false
            let nativeCommitStartedAt = ProcessInfo.processInfo.systemUptime
            GlobalSaveVault.shared.resetToAsync(cleanSave, runtimeVersion: version, clearManualSlots: clearManualSlots, envelope: payload) { [weak self] result in
                let nativeVaultCommitMs = max(0, (ProcessInfo.processInfo.systemUptime - nativeCommitStartedAt) * 1000)
                switch result {
                case .success(let generation):
                    GlobalGameStorage.shared.noteCurrentSaveGeneration(generation)
                    guard let self, self.isCurrentDocument(requestDocument) else { return }
                    self.prepareNextNativeBootstrap(force: true)
                    self.reportSaveAck(payload: payload, success: true, generation: generation, message: nil, nativeVaultCommitMs: nativeVaultCommitMs)
                case .failure(let error):
                    guard let self, self.isCurrentDocument(requestDocument) else { return }
                    self.reportSaveAck(payload: payload, success: false, generation: nil, message: error.localizedDescription, nativeVaultCommitMs: nativeVaultCommitMs)
                }
            }
        default:
            break
        }
    }

    private func confirmNativeUpdateBoot(version: String, build: Int?) {
        if let pending = pendingNativeUpdate, pending.version == version {
            // Legacy v2 packages signed semantic version but not Build. Their
            // native identity is therefore Build 0; v3 requires an exact match.
            guard pending.build == 0 || build == pending.build else {
                rollbackFailedUpdate(reason: "boot-confirm-build-mismatch")
                return
            }
            let identity = updateIdentity(version: version, build: pending.build)
            updateBootConfirmedIdentity = identity
            reportUpdateLifecycle(phase: "BOOT_CONFIRMED", version: version)
            tryFinalizeNativeUpdate(version: version, build: pending.build)
            return
        }
        // Bundled IPA baseline promotion has no .saneiupdate operations object,
        // but it still uses the same durable journal and must wait for WebApp
        // bootstrap confirmation before the runtime swap becomes final.
        DispatchQueue.global(qos: .utility).async { [weak self] in
            do {
                let confirmed = try GlobalGameStorage.shared.confirmCurrentUpdateBoot(version: version, build: build)
                if confirmed { DispatchQueue.main.async { self?.reportUpdateLifecycle(phase: "BOOT_CONFIRMED", version: version) } }
            } catch {
                DispatchQueue.main.async { self?.rollbackFailedUpdate(reason: "bundled-baseline-boot-confirm-failed") }
            }
        }
    }

    private func tryFinalizeNativeUpdate(version: String, build: Int) {
        let identity = updateIdentity(version: version, build: build)
        guard updateStateCommittedIdentity == identity,
              updateBootConfirmedIdentity == identity,
              updateStateSaveGeneration != nil else { return }
        finalizeNativeUpdate(version: version, build: build)
    }

    private func finalizeNativeUpdate(version: String, build: Int) {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            do {
                let confirmed = try GlobalGameStorage.shared.confirmCurrentUpdateBoot(version: version, build: build)
                DispatchQueue.main.async {
                    guard confirmed, let self else { return }
                    self.pendingNativeUpdate = nil
                    self.pendingSaveJSON = nil
                    self.updateStateCommittedIdentity = nil
                    self.updateStateSaveGeneration = nil
                    self.updateBootConfirmedIdentity = nil
                    self.operationsApplyingIdentity = nil
                    self.reportUpdateLifecycle(phase: "FINALIZED", version: version)
                    self.reportToWeb(success: true, message: "تم تثبيت الإصدار \(version) Build \(build) واعتماد العمليات والحفظ الدائم بنجاح.")
                }
            } catch {
                DispatchQueue.main.async { [weak self] in
                    self?.reportUpdateLifecycle(phase: "BOOT_CONFIRM_FAILED", version: version, message: error.localizedDescription)
                    self?.rollbackFailedUpdate(reason: "boot-confirm-failed: \(error.localizedDescription)")
                }
            }
        }
    }

    private func exportDiagnosticBundle(json: String, requestedName: String?) {
        let rawName = (requestedName?.isEmpty == false ? requestedName! : "GlobalHoldings_Diagnostics.ghdiag")
        let safeName = rawName.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: "\\", with: "-")
        let allowedExtensions: Set<String> = ["ghdiag", "ghincident", "ghdiagnostic", "ghtrace", "ghhealth", "ghsupport"]
        let requestedExtension = URL(fileURLWithPath: safeName).pathExtension.lowercased()
        let finalName = allowedExtensions.contains(requestedExtension) ? safeName : safeName + ".ghdiag"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(finalName, isDirectory: false)
        do {
            guard let data = json.data(using: .utf8), data.count <= 8_000_000 else {
                showMessage(title: "تعذر التصدير", message: "ملف التشخيص أكبر من الحد الوقائي 8 MB.")
                return
            }
            try data.write(to: url, options: .atomic)
            let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            if let popover = share.popoverPresentationController { popover.sourceView = view; popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1) }
            present(share, animated: true)
        } catch {
            showMessage(title: "فشل تصدير التشخيص", message: error.localizedDescription)
        }
    }

    private func applyWebBridgeUpdate(manifest: [String: Any], files: [[String: Any]], operationsJSON: String, preUpdateSaveGeneration: Int) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do {
                let update = try GlobalGameStorage.shared.applyWebBridgeUpdate(manifest: manifest, files: files, operationsJSON: operationsJSON, preUpdateSaveGeneration: preUpdateSaveGeneration)
                DispatchQueue.main.async {
                    self?.reportUpdateLifecycle(phase: "RUNTIME_SWAPPED", version: update.version)
                    // Apply update operations only from the newly staged runtime,
                    // not from the page that requested its own replacement.
                    self?.preparePendingUpdate(update)
                    self?.loadGame(cacheBuster: "\(update.version)-build\(update.build)-\(UUID().uuidString)")
                }
            } catch {
                DispatchQueue.main.async { [weak self] in
                    self?.reportUpdateLifecycle(phase: "FAILED", message: error.localizedDescription)
                    self?.reportToWeb(success: false, message: error.localizedDescription)
                }
            }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if restorePendingSaveIfNeeded() { return }
        applyPendingNativeOperationsIfNeeded()
        reportDeviceState()
        if recoveredWebProcess {
            recoveredWebProcess = false
            webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('gh-native-recovery',{detail:{source:'native-save-vault',paused:true}}));")
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard webView === self.webView else { return }
        navigationPreparing = false
        showLaunchFailure("تعذر تحميل محرك اللعبة المحلي: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard webView === self.webView else { return }
        navigationPreparing = false
        showLaunchFailure("توقف تحميل محرك اللعبة قبل اكتماله: \(error.localizedDescription)")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        saveExportDownloads.cancelAll()
        recoveredWebProcess = true
        prepareNextNativeBootstrap(force: true, pause: true)
        loadGame(cacheBuster: "recovery-\(GlobalSaveVault.shared.currentGeneration())-\(UUID().uuidString)")
    }

    @discardableResult
    private func restorePendingSaveIfNeeded() -> Bool {
        guard let save = pendingSaveJSON else { return false }
        guard GlobalSaveVault.shared.currentSave() == save else {
            pendingSaveJSON = nil
            rollbackFailedUpdate(reason: "restore-pending-save-native-mismatch")
            return true
        }
        // Rebuild the document-start bootstrap from the newly committed native
        // generation. Never round-trip the full world through localStorage.
        pendingSaveJSON = nil
        prepareNextNativeBootstrap(force: true)
        loadGame(cacheBuster: "native-restore-\(GlobalSaveVault.shared.currentGeneration())-\(UUID().uuidString)")
        return true
    }

    private func applyPendingNativeOperationsIfNeeded() {
        guard let update = pendingNativeUpdate else { return }
        let identity = updateIdentity(version: update.version, build: update.build)
        guard operationsApplyingIdentity != identity, updateStateCommittedIdentity != identity else { return }
        operationsApplyingIdentity = identity
        reportUpdateLifecycle(phase: "OPERATIONS_STARTED", version: update.version)
        guard JSONSerialization.isValidJSONObject(update.webPayload),
              let data = try? JSONSerialization.data(withJSONObject: update.webPayload),
              let json = String(data: data, encoding: .utf8),
              let encoded = json.data(using: .utf8)?.base64EncodedString() else {
            rollbackFailedUpdate(reason: "invalid-native-payload")
            return
        }
        let version = update.version.replacingOccurrences(of: "'", with: "\\'")
        let build = update.build
        let script = """
        (()=>{
          const b=Uint8Array.from(atob('\(encoded)'),c=>c.charCodeAt(0));
          const p=JSON.parse(new TextDecoder().decode(b));
          Promise.resolve().then(()=>{
            const runtime=window.GH_RUNTIME;
            if(!runtime||typeof runtime.applyNativeUpdate!=='function'||typeof runtime.businessIntegrity!=='function') throw new Error('Required update runtime owners are unavailable');
            return runtime.applyNativeUpdate(p);
          }).then(applied=>{
            // false can mean a duplicate or unavailable owner: neither proves this signed update was applied.
            if(applied!==true) throw new Error('Update owner did not confirm application; duplicate or ambiguous result rejected');
            const integrity=window.GH_RUNTIME.businessIntegrity();
            if(!integrity||!['healthy','warning'].includes(integrity.status)||!integrity.counts||integrity.counts.critical!==0) throw new Error('Integrity confirmation is missing or critical after update operations');
            const save=JSON.stringify(window.__GH_STATE__||null);
            if(!save||save==='null') throw new Error('Durable update state is unavailable');
            window.webkit?.messageHandlers?.updateBridge?.postMessage({action:'commitUpdateState',version:'\(version)',build:\(build),saveJSON:save});
          }).catch(error=>{
            window.webkit?.messageHandlers?.updateBridge?.postMessage({action:'updateOperationsFailed',version:'\(version)',build:\(build),message:String(error?.message||error)});
          });
        })();
        """
        webView.evaluateJavaScript(script) { [weak self] _, error in
            if let error {
                self?.operationsApplyingIdentity = nil
                self?.rollbackFailedUpdate(reason: "native-operation-launch-failed: \(error.localizedDescription)")
            }
        }
    }

    private func rollbackFailedUpdate(reason: String) {
        reportUpdateLifecycle(phase: "ROLLBACK_STARTED", version: pendingNativeUpdate?.version, message: reason)
        do {
            let restoredVersion = try GlobalGameStorage.shared.rollbackPendingUpdate(reason: reason)
            pendingNativeUpdate = nil
            updateStateCommittedIdentity = nil
            updateStateSaveGeneration = nil
            updateBootConfirmedIdentity = nil
            operationsApplyingIdentity = nil
            pendingSaveJSON = nil
            reportUpdateLifecycle(phase: "ROLLED_BACK", version: restoredVersion, message: reason)
            reportToWeb(success: false, message: "تم إلغاء التحديث واستعادة النسخة السابقة بسبب فشل وقائي: \(reason)")
            loadGame(cacheBuster: "rollback-\(UUID().uuidString)")
        } catch {
            reportUpdateLifecycle(phase: "FAILED", version: pendingNativeUpdate?.version, message: error.localizedDescription)
            reportToWeb(success: false, message: "فشل التحديث وتعذر الاسترجاع التلقائي: \(error.localizedDescription)")
        }
    }

    private func reportUpdateLifecycle(phase: String, version: String? = nil, message: String? = nil) {
        var detail: [String: Any] = ["phase": phase]
        if let version, !version.isEmpty { detail["version"] = version }
        if let message, !message.isEmpty { detail["message"] = message }
        guard JSONSerialization.isValidJSONObject(detail),
              let data = try? JSONSerialization.data(withJSONObject: detail, options: [.sortedKeys]) else { return }
        let encoded = data.base64EncodedString()
        let script = "(()=>{const b=Uint8Array.from(atob('\(encoded)'),c=>c.charCodeAt(0));const d=JSON.parse(new TextDecoder().decode(b));window.dispatchEvent(new CustomEvent('gh-update-lifecycle',{detail:d}));})();"
        webView.evaluateJavaScript(script)
    }

    private func reportBridgeEvent(_ name: String, detail: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: detail, options: [.sortedKeys]) else { return }
        let encoded = data.base64EncodedString()
        // Both event name and envelope are JSON encoded; no user text is interpolated as code.
        guard let nameData = try? JSONSerialization.data(withJSONObject: [name]),
              let names = String(data: nameData, encoding: .utf8) else { return }
        let script = "(()=>{const d=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('\(encoded)'),c=>c.charCodeAt(0))));window.dispatchEvent(new CustomEvent(\(names)[0],{detail:d}));})();"
        webView.evaluateJavaScript(script)
    }

    private func reportSaveAck(payload: [String: Any], success: Bool, generation: Int?, message: String?, nativeVaultCommitMs: Double? = nil, nativeVaultStages: [String: Double]? = nil) {
        var detail: [String: Any] = ["success": success, "message": message ?? ""]
        for key in ["requestId", "action", "saveRevision", "resetEpoch", "saveSchemaVersion", "saveHash"] {
            if let value = payload[key] { detail[key] = value }
        }
        if let generation { detail["generation"] = generation }
        if let nativeVaultCommitMs, nativeVaultCommitMs.isFinite { detail["nativeVaultCommitMs"] = nativeVaultCommitMs }
        // Foreground commit stages plus the last completed deferred chunk-cleanup pass and payload sizes.
        if let nativeVaultStages { detail["nativeVaultStages"] = nativeVaultStages.filter { $0.value.isFinite } }
        let event = payload["action"] as? String == "resetGameSave" ? "gh-native-reset-ack" : "gh-native-save-ack"
        reportBridgeEvent(event, detail: detail)
    }

    private func reportToWeb(success: Bool, message: String) {
        reportBridgeEvent("gh-native-update", detail: ["success": success, "message": message])
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.request.url?.scheme?.lowercased() == "blob" {
            decisionHandler(webView === self.webView && saveExportDownloads.authorize(navigationAction, document: webView.url) ? .download : .cancel)
            return
        }
        if let url = navigationAction.request.url, navigationAction.navigationType == .linkActivated, ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        guard navigationAction.targetFrame?.isMainFrame != false else {
            decisionHandler(.allow)
            return
        }
        guard isTrustedGameDocument(navigationAction.request.url) else {
            decisionHandler(.cancel)
            return
        }
        nativeNavigationToken &+= 1
        navigationPreparing = true
        installBootstrapBeforeNavigation(webView, token: nativeNavigationToken, decisionHandler: decisionHandler)
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        guard webView === self.webView else { return }
        navigationPreparing = false
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        guard webView === self.webView else { download.cancel { _ in }; return }
        saveExportDownloads.adopt(download, from: navigationAction)
    }

    private func showMessage(title: String, message: String, completion: (() -> Void)? = nil) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "حسنًا", style: .default) { _ in completion?() })
        present(alert, animated: true)
    }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }
}

private final class GlobalGameSchemeHandler: NSObject, WKURLSchemeHandler {
    // Tasks still waiting for an asynchronous reply (save chunks). A stopped task must never receive data.
    private var pendingTasks = Set<ObjectIdentifier>()

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            finish404(urlSchemeTask, url: URL(string: "gh://app/")!)
            return
        }
        var path = url.path.removingPercentEncoding ?? url.path
        if path.hasPrefix("/") { path.removeFirst() }
        if path.isEmpty { path = "index.html" }
        if url.host?.lowercased() == "app", path.hasPrefix("save-chunk/") {
            serveSaveChunk(urlSchemeTask, url: url, id: String(path.dropFirst("save-chunk/".count)))
            return
        }
        guard let file = GlobalGameStorage.shared.fileURL(for: path), let stored = try? Data(contentsOf: file),
              let data = VentoraPack.open(stored, path: path) else {
            finish404(urlSchemeTask, url: url)
            return
        }
        let type = mimeType(for: path)
        let contentType = isText(path) ? "\(type); charset=utf-8" : type
        let headers = ["Content-Type": contentType, "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", "Pragma": "no-cache", "Expires": "0"]
        guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) else {
            finish404(urlSchemeTask, url: url)
            return
        }
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        pendingTasks.remove(ObjectIdentifier(urlSchemeTask as AnyObject))
    }

    /// Build 358 (million-asset save): the fleet record chunks of the native save, read (decompressed and SHA-256
    /// checked) on the vault queue. The boot gate fetches them before app.js assembles the saved fleet.
    private func serveSaveChunk(_ task: WKURLSchemeTask, url: URL, id: String) {
        let method = (task.request.httpMethod ?? "GET").uppercased()
        guard GlobalSaveVault.shared.isValidChunkId(id) else {
            finish404(task, url: url)
            return
        }
        if method == "POST" {
            storeSaveChunk(task, url: url, id: id)
            return
        }
        guard method == "GET" else {
            finish404(task, url: url)
            return
        }
        let key = ObjectIdentifier(task as AnyObject)
        pendingTasks.insert(key)
        GlobalSaveVault.shared.chunkDataAsync(id: id) { [weak self] result in
            guard let self, self.pendingTasks.remove(key) != nil else { return }
            switch result {
            case .success(let data):
                let headers = ["Content-Type": "application/octet-stream", "Content-Length": String(data.count), "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"]
                guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) else {
                    self.finish404(task, url: url)
                    return
                }
                task.didReceive(response)
                task.didReceive(data)
                task.didFinish()
            case .failure:
                self.finish404(task, url: url)
            }
        }
    }

    /// Upload of one chunk as the raw request body (CI WebKit delivers a 4 MiB body intact as httpBody), stored and
    /// verified on the vault queue. The reply is JSON: {ok, id, sha256} or {ok:false, message}.
    private func storeSaveChunk(_ task: WKURLSchemeTask, url: URL, id: String) {
        var body = task.request.httpBody
        if body == nil, let stream = task.request.httpBodyStream {
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 65_536)
            stream.open()
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
            stream.close()
            body = data
        }
        let key = ObjectIdentifier(task as AnyObject)
        pendingTasks.insert(key)
        let reply: (Int, [String: Any]) -> Void = { [weak self] status, detail in
            guard let self, self.pendingTasks.remove(key) != nil else { return }
            let data = (try? JSONSerialization.data(withJSONObject: detail)) ?? Data("{}".utf8)
            let headers = ["Content-Type": "application/json; charset=utf-8", "Content-Length": String(data.count), "Cache-Control": "no-store"]
            guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
                self.finish404(task, url: url)
                return
            }
            task.didReceive(response)
            task.didReceive(data)
            task.didFinish()
        }
        guard let data = body, !data.isEmpty else {
            reply(400, ["ok": false, "id": id, "message": "Empty save chunk upload."])
            return
        }
        let encoding = task.request.value(forHTTPHeaderField: "X-GH-Chunk-Encoding") ?? "identity"
        let rawBytes = task.request.value(forHTTPHeaderField: "X-GH-Chunk-Raw-Bytes").flatMap(Int.init)
        GlobalSaveVault.shared.storeChunkAsync(id: id, data: data, encoding: encoding, rawBytes: rawBytes) { result in
            switch result {
            case .success(let digest): reply(200, ["ok": true, "id": id, "sha256": digest])
            case .failure(let error): reply(409, ["ok": false, "id": id, "message": error.localizedDescription])
            }
        }
    }

    private func finish404(_ task: WKURLSchemeTask, url: URL) {
        let body = Data("Game files not found.".utf8)
        if let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/plain; charset=utf-8"]) {
            task.didReceive(response)
        }
        task.didReceive(body)
        task.didFinish()
    }

    private func isText(_ path: String) -> Bool {
        ["html", "css", "js", "json", "txt", "svg", "geojson"].contains((path as NSString).pathExtension.lowercased())
    }

    private func mimeType(for path: String) -> String {
        switch (path as NSString).pathExtension.lowercased() {
        case "html": return "text/html"
        case "css": return "text/css"
        case "js": return "application/javascript"
        case "json": return "application/json"
        case "geojson": return "application/geo+json"
        case "webp": return "image/webp"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg": return "image/svg+xml"
        case "txt": return "text/plain"
        default:
            let type = UTType(filenameExtension: (path as NSString).pathExtension)
            return type?.preferredMIMEType ?? "application/octet-stream"
        }
    }
}

// Without a UI delegate WKWebView answers window.confirm with "cancel" and drops window.alert, so every confirmed
// action in the game (conference cheques, facility closure, sales) returned without doing anything on iPhone.
extension GameViewController {
    private func presentJavaScriptDialog(_ alert: UIAlertController) -> Bool {
        guard view.window != nil, presentedViewController == nil else { return false }
        present(alert, animated: true)
        return true
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "حسنًا", style: .default) { _ in completionHandler() })
        if !presentJavaScriptDialog(alert) { completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "إلغاء", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "تأكيد", style: .default) { _ in completionHandler(true) })
        if !presentJavaScriptDialog(alert) { completionHandler(false) }
    }
}
