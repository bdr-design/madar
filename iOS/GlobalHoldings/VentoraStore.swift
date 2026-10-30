import Foundation
import StoreKit
import WebKit

/// VENTORA store (StoreKit 2). The game's store page asks through the `storeBridge` message handler; this owner loads
/// the products (`<bundle id>.<suffix>`), buys, restores, opens the subscription page (`manage`), and hands every *verified* transaction to the game
/// (`GH_STORE_NATIVE.onTransaction`). A transaction is finished only when the game answers `finish` after the save that
/// holds it is stored, so a purchase interrupted by a crash or a closed app is delivered again at the next `ready`
/// (`Transaction.unfinished`). An unverified transaction is never delivered; a revoked one is finished without delivery.
@MainActor
final class VentoraStore {
    static let productSuffixes = [
        "plus.monthly", "plus.yearly", "investor.licence", "time.accelerator", "starter.pack",
        "capital.small", "capital.medium", "capital.large", "capital.huge"
    ]

    private weak var webView: WKWebView?
    private let prefix: String
    private var products: [String: Product] = [:]
    private var pending: [UInt64: Transaction] = [:]
    private var updatesTask: Task<Void, Never>?

    init(webView: WKWebView) {
        self.webView = webView
        self.prefix = (Bundle.main.bundleIdentifier ?? "app") + "."
        // Renewals, purchases approved later (Ask to Buy) and purchases made on another device arrive here.
        updatesTask = Task { [weak self] in
            for await update in Transaction.updates {
                await self?.deliver(update)
            }
        }
    }

    func handle(action: String, payload: [String: Any]) {
        switch action {
        case "ready":
            Task { [weak self] in
                await self?.loadProducts()
                await self?.deliverUnfinished()
            }
        case "purchase":
            guard let suffix = payload["productId"] as? String else { return }
            Task { [weak self] in await self?.purchase(suffix: suffix) }
        case "restore":
            Task { [weak self] in
                try? await AppStore.sync()
                await self?.deliverCurrentEntitlements()
                await self?.deliverUnfinished()
            }
        case "manage":
            // «إدارة الاشتراك»: the App Store's own subscription page, over the game.
            Task { [weak self] in
                guard let scene = self?.webView?.window?.windowScene else { return }
                try? await AppStore.showManageSubscriptions(in: scene)
            }
        case "finish":
            guard let raw = payload["transactionId"] as? String, let id = UInt64(raw),
                  let transaction = pending.removeValue(forKey: id) else { return }
            Task { await transaction.finish() }
        default:
            break
        }
    }

    private func loadProducts() async {
        do {
            let list = try await Product.products(for: Self.productSuffixes.map { prefix + $0 })
            for product in list { products[product.id] = product }
            let rows: [[String: Any]] = list.map { ["productId": $0.id, "displayPrice": $0.displayPrice, "title": $0.displayName] }
            send("onProducts", rows)
        } catch {
            send("onProducts", [[String: Any]]())
        }
    }

    private func purchase(suffix: String) async {
        let id = suffix.hasPrefix(prefix) ? suffix : prefix + suffix
        if products[id] == nil { await loadProducts() }
        guard let product = products[id] else {
            send("onPurchaseFailed", ["reason": "unavailable"])
            return
        }
        do {
            // A UIKit app confirms the sheet in its window scene (iOS 17); without one StoreKit may find no UI anchor.
            let result: Product.PurchaseResult
            if let scene = webView?.window?.windowScene { result = try await product.purchase(confirmIn: scene) } else { result = try await product.purchase() }
            switch result {
            case .success(let verification):
                await deliver(verification)
            case .pending:
                send("onPurchaseFailed", ["reason": "pending"])
            case .userCancelled:
                send("onPurchaseFailed", ["reason": "cancelled"])
            @unknown default:
                send("onPurchaseFailed", ["reason": "failed"])
            }
        } catch {
            send("onPurchaseFailed", ["reason": "failed"])
        }
    }

    private func deliver(_ verification: VerificationResult<Transaction>) async {
        guard case .verified(let transaction) = verification else { return }
        pending[transaction.id] = transaction
        // A refunded transaction (owner «نعم تسحب») goes to the game, which takes back what it granted; it is finished
        // only on the game's answer, like a delivery, so a refund is never lost between the two.
        if transaction.revocationDate != nil {
            send("onRevocation", ["transactionId": String(transaction.id), "productId": transaction.productID])
            return
        }
        var row: [String: Any] = ["transactionId": String(transaction.id), "productId": transaction.productID, "store": "app-store"]
        if let expiry = transaction.expirationDate { row["expiresAt"] = expiry.timeIntervalSince1970 * 1000 }
        send("onTransaction", row)
    }

    private func deliverUnfinished() async {
        for await verification in Transaction.unfinished { await deliver(verification) }
    }

    private func deliverCurrentEntitlements() async {
        for await verification in Transaction.currentEntitlements { await deliver(verification) }
    }

    private func send(_ method: String, _ value: Any) {
        guard let webView, JSONSerialization.isValidJSONObject([value]),
              let data = try? JSONSerialization.data(withJSONObject: [value]),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.GH_STORE_NATIVE&&window.GH_STORE_NATIVE.\(method)(\(json)[0]);", completionHandler: nil)
    }
}
