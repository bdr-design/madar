package com.ventora.game

import android.app.Activity
import android.util.Base64
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.ConsumeParams
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors

/**
 * VENTORA store on Google Play (Play Billing 8), with the same protocol as the iPhone's StoreKit 2 owner
 * (VentoraStore.swift): the game asks through the `storeBridge` handler (`ready`, `purchase`, `restore`, `finish`), and this
 * owner answers on window.GH_STORE_NATIVE (`onProducts`, `onTransaction`, `onPurchaseFailed`). A purchase is delivered only
 * when its signature verifies under the app's Play licence key; it is consumed (capital packs) or acknowledged (the rest)
 * only when the game answers `finish` after the save that holds it is stored, so an interrupted purchase is delivered
 * again at the next `ready`. The Play product ids are the game's own suffixes (capital.small, plus.monthly, ...).
 */
class StoreBilling(private val activity: Activity, private val send: (String, String) -> Unit) : PurchasesUpdatedListener {
    private val client: BillingClient = BillingClient.newBuilder(activity)
        .setListener(this)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .build()
    private val products = mutableMapOf<String, ProductDetails>()
    private val pending = mutableMapOf<String, Purchase>()
    /** The Plus subscription held now (product id to purchase token), so a switch replaces it instead of adding one. */
    private val ownedSubs = mutableMapOf<String, String>()
    private val network = Executors.newSingleThreadExecutor()
    private var connecting = false
    private val waiting = mutableListOf<Pair<() -> Unit, (() -> Unit)?>>()

    fun handle(action: String, payload: JSONObject) {
        when (action) {
            // Only a purchase the player asked for reports a failure: no Play Store at launch is not a failed purchase.
            "ready" -> connected(null) { loadProducts(); deliverOwned() }
            "purchase" -> payload.optString("productId").takeIf { it.isNotEmpty() }?.let { id -> connected({ failed("unavailable") }) { purchase(suffixOf(id)) } }
            "restore" -> connected(null) { deliverOwned() }
            "finish" -> payload.optString("transactionId").takeIf { it.isNotEmpty() }?.let { finish(it) }
        }
    }

    fun close() { waiting.clear(); network.shutdownNow(); client.endConnection() }

    private fun connected(onFail: (() -> Unit)?, action: () -> Unit) {
        if (client.isReady) { action(); return }
        waiting.add(action to onFail)
        if (connecting) return
        connecting = true
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                activity.runOnUiThread {
                    connecting = false
                    val ready = result.responseCode == BillingClient.BillingResponseCode.OK
                    val queued = waiting.toList()
                    waiting.clear()
                    if (ready) queued.forEach { it.first() } else queued.forEach { it.second?.invoke() }
                }
            }
            override fun onBillingServiceDisconnected() {
                activity.runOnUiThread { connecting = false }
            }
        })
    }

    private fun loadProducts(then: (() -> Unit)? = null) {
        val rows = JSONArray()
        var remaining = 2
        fun done() { remaining--; if (remaining == 0) { send("onProducts", rows.toString()); then?.invoke() } }
        for ((type, ids) in listOf(BillingClient.ProductType.INAPP to INAPP, BillingClient.ProductType.SUBS to SUBS)) {
            val params = QueryProductDetailsParams.newBuilder().setProductList(ids.map {
                QueryProductDetailsParams.Product.newBuilder().setProductId(it).setProductType(type).build()
            }).build()
            client.queryProductDetailsAsync(params) { result, details ->
                activity.runOnUiThread {
                    if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                        for (product in details.productDetailsList) {
                            products[product.productId] = product
                            rows.put(JSONObject().put("productId", product.productId).put("title", product.name).put("displayPrice", priceOf(product)))
                        }
                    }
                    done()
                }
            }
        }
    }

    private fun priceOf(product: ProductDetails): String =
        product.oneTimePurchaseOfferDetails?.formattedPrice
            ?: product.subscriptionOfferDetails?.firstOrNull()?.pricingPhases?.pricingPhaseList?.lastOrNull()?.formattedPrice
            ?: ""

    /** As on the iPhone: a product not loaded yet (the list is still on its way) is loaded first, once. */
    private fun purchase(id: String, reloaded: Boolean = false) {
        val product = products[id] ?: run { if (reloaded) failed("unavailable") else loadProducts { purchase(id, true) }; return }
        val params = BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(product)
        product.subscriptionOfferDetails?.firstOrNull()?.offerToken?.let { params.setOfferToken(it) }
        val flow = BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(params.build()))
        // Monthly and yearly Plus are one entitlement: switching replaces the held subscription (credit for the unused
        // time) instead of billing both.
        if (id in SUBS) ownedSubs.entries.firstOrNull { it.key != id }?.let { (_, token) ->
            flow.setSubscriptionUpdateParams(BillingFlowParams.SubscriptionUpdateParams.newBuilder()
                .setOldPurchaseToken(token)
                .setSubscriptionReplacementMode(BillingFlowParams.SubscriptionUpdateParams.ReplacementMode.WITH_TIME_PRORATION)
                .build())
        }
        if (id in SUBS && id in ownedSubs) { deliverOwned(); return }
        val result = client.launchBillingFlow(activity, flow.build())
        if (result.responseCode != BillingClient.BillingResponseCode.OK) failed("failed")
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        activity.runOnUiThread {
            when (result.responseCode) {
                BillingClient.BillingResponseCode.OK -> purchases.orEmpty().forEach { deliver(it, fresh = true) }
                BillingClient.BillingResponseCode.USER_CANCELED -> failed("cancelled")
                BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> deliverOwned()
                else -> failed("failed")
            }
        }
    }

    private fun deliverOwned() {
        for (type in listOf(BillingClient.ProductType.INAPP, BillingClient.ProductType.SUBS)) {
            client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(type).build()) { result, purchases ->
                activity.runOnUiThread {
                    if (result.responseCode != BillingClient.BillingResponseCode.OK) return@runOnUiThread
                    // A lifetime purchase refunded on Play is simply no longer listed: the game compares (owner «نعم تسحب»).
                    if (type == BillingClient.ProductType.INAPP) {
                        val owned = JSONArray()
                        for (purchase in purchases) if (purchase.purchaseState == Purchase.PurchaseState.PURCHASED && verified(purchase)) purchase.products.forEach { owned.put(it) }
                        send("onOwned", JSONObject().put("store", "play").put("products", owned).toString())
                    }
                    if (type == BillingClient.ProductType.SUBS) {
                        ownedSubs.clear()
                        for (purchase in purchases) if (purchase.purchaseState == Purchase.PurchaseState.PURCHASED) purchase.products.firstOrNull()?.let { ownedSubs[it] = purchase.purchaseToken }
                    }
                    purchases.forEach { deliver(it) }
                }
            }
        }
    }

    /** fresh: the answer to a purchase just made; a pending one is reported then, not again at every launch. */
    private fun deliver(purchase: Purchase, fresh: Boolean = false) {
        if (purchase.purchaseState == Purchase.PurchaseState.PENDING) { if (fresh) failed("pending"); return }
        if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) return
        if (!verified(purchase)) return
        val productId = purchase.products.firstOrNull() ?: return
        val orderId = purchase.orderId?.takeIf { it.isNotEmpty() } ?: "token-" + purchase.purchaseToken.hashCode().toUInt().toString(16)
        if (productId !in SUBS) {
            pending[orderId] = purchase
            send("onTransaction", JSONObject().put("transactionId", orderId).put("productId", productId).put("store", "play").toString())
            return
        }
        ownedSubs[productId] = purchase.purchaseToken
        // Owner (approved «أ», no server): Play tells the device only that a subscription is active now, never its renewal
        // date (purchaseTime and orderId stay those of the first order). So each day Play still lists it as active the
        // game receives a confirmation: Plus until that moment plus three days. The moment never comes from the phone's
        // clock: a new purchase's own signed time, otherwise the time of an HTTPS answer from Google (no network, no
        // confirmation; the last one still covers three days). The game keeps the latest real time it has seen, so a date
        // set back cannot stretch it.
        if (fresh) { confirm(purchase, productId, orderId, purchase.purchaseTime); return }
        network.execute {
            val trusted = trustedTime() ?: return@execute
            activity.runOnUiThread { confirm(purchase, productId, orderId, trusted) }
        }
    }

    private fun confirm(purchase: Purchase, productId: String, orderId: String, at: Long) {
        val transactionId = "$orderId.c${DAY_FORMAT.get()!!.format(at)}"
        pending[transactionId] = purchase
        send("onTransaction", JSONObject().put("transactionId", transactionId).put("productId", productId).put("store", "play")
            .put("expiresAt", at + GRACE_DAYS * DAY_MS).put("confirmedAt", at).toString())
    }

    /** The time of an HTTPS answer from Google (its Date header; TLS proves who answered), or null without network. */
    private fun trustedTime(): Long? = try {
        val connection = URL(TIME_URL).openConnection() as HttpURLConnection
        connection.requestMethod = "HEAD"; connection.connectTimeout = 4000; connection.readTimeout = 4000; connection.useCaches = false
        try { connection.responseCode; connection.date.takeIf { it > 0 } } finally { connection.disconnect() }
    } catch (_: Exception) { null }

    private fun finish(transactionId: String) {
        val purchase = pending.remove(transactionId) ?: return
        val productId = purchase.products.firstOrNull() ?: return
        if (productId in CONSUMABLE) {
            client.consumeAsync(ConsumeParams.newBuilder().setPurchaseToken(purchase.purchaseToken).build()) { _, _ -> }
        } else if (!purchase.isAcknowledged) {
            client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(purchase.purchaseToken).build()) { _ -> }
        }
    }

    /** The purchase's signature under the Play licence key (BuildConfig.PLAY_LICENSE_KEY); a debug build without a key
     *  accepts Play's own test purchases. */
    private fun verified(purchase: Purchase): Boolean {
        val key = BuildConfig.PLAY_LICENSE_KEY
        if (key.isEmpty()) return BuildConfig.DEBUG
        return try {
            val publicKey = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(Base64.decode(key, Base64.DEFAULT)))
            val verifier = Signature.getInstance("SHA1withRSA")
            verifier.initVerify(publicKey)
            verifier.update(purchase.originalJson.toByteArray(Charsets.UTF_8))
            verifier.verify(Base64.decode(purchase.signature, Base64.DEFAULT))
        } catch (_: Exception) {
            false
        }
    }

    private fun failed(reason: String) = send("onPurchaseFailed", JSONObject().put("reason", reason).toString())

    private fun suffixOf(id: String): String = ALL.firstOrNull { id == it || id.endsWith(".$it") } ?: id

    companion object {
        // The starter pack is consumed too: the game keeps "once" in the save, and a pack Play kept owned would be
        // delivered again into every new game at its first `ready`.
        private val CONSUMABLE = setOf("capital.small", "capital.medium", "capital.large", "capital.huge", "starter.pack")
        private val SUBS = listOf("plus.monthly", "plus.yearly")
        private val INAPP = listOf("investor.licence", "time.accelerator") + CONSUMABLE
        private val ALL = INAPP + SUBS
        private const val GRACE_DAYS = 3L
        private const val TIME_URL = "https://www.google.com/generate_204"
        private val DAY_FORMAT = object : ThreadLocal<SimpleDateFormat>() {
            override fun initialValue() = SimpleDateFormat("yyyyMMdd", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        }
        private const val DAY_MS = 86_400_000L
    }
}
