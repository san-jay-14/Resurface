package com.resurface.app

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Best-effort, LOGGED-OUT fetch of a public Instagram post page, run by the share worker before it
 * calls the API. The API treats the result as untrusted hints (see server/src/adapters/instagramDevice.ts).
 *
 * Hard rules (Instagram resolver spec, sections 0, 4 and 8):
 *  - one plain GET per save, with the client's default identity and a standard Accept-Language only;
 *  - nothing is stored or sent between requests, no credentials, no login, no CAPTCHA handling;
 *  - a login wall, 429, oversized body or empty parse is a quiet failure: no retry, no workaround;
 *  - three consecutive login-wall / 429 responses switch the feature off on this device for 24 hours.
 * Disabled unless the app was built with IG_DEVICE_FETCH=true (decided by the Phase 0 spike).
 */
class DeviceMetaFetcher(context: Context, client: OkHttpClient) {
    companion object {
        private const val TIMEOUT_SECONDS = 6L
        private const val MAX_BODY_BYTES = 2_000_000L
        private const val MAX_REDIRECTS = 2
        private const val PREFS = "dibs.devicefetch"
        private const val KEY_WALL_FAILURES = "wall_failures"
        private const val KEY_DISABLED_UNTIL = "disabled_until"
        private const val WALL_LIMIT = 3
        private const val DISABLE_MS = 24L * 60 * 60 * 1000
        private val SHORTCODE =
            Regex("instagram\\.com/(?:[A-Za-z0-9._]+/)?(?:p|reel|reels|tv)/([A-Za-z0-9_-]{5,})")
        private val HOSTS = setOf("instagram.com", "www.instagram.com")
    }

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val http = client.newBuilder()
        .connectTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .readTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .callTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .followRedirects(false) // followed by hand below: at most 2 hops, instagram.com only
        .build()

    /** Payload for POST /v1/saves/enqueue `device_meta`, or null (disabled, not a post, or failed). */
    fun fetchFor(sharedUrl: String): JSONObject? {
        if (!BuildConfig.IG_DEVICE_FETCH || !enabled()) return null
        val shortcode = SHORTCODE.find(sharedUrl)?.groupValues?.get(1) ?: return null
        return fetch("https://www.instagram.com/p/$shortcode/", shortcode)
    }

    internal fun enabled(now: Long = System.currentTimeMillis()): Boolean =
        now >= prefs.getLong(KEY_DISABLED_UNTIL, 0L)

    private fun fetch(url: String, shortcode: String): JSONObject? {
        return try {
            var target = url
            // The first request plus at most MAX_REDIRECTS redirects.
            for (attempt in 0..MAX_REDIRECTS) {
                val req = Request.Builder().url(target)
                    .header("Accept-Language", "en-US,en;q=0.9")
                    .build()
                http.newCall(req).execute().use { res ->
                    if (res.code == 429) { noteWall(); return null }
                    if (res.isRedirect) {
                        val next = res.header("Location")?.let { res.request.url.resolve(it) }
                        if (next == null || next.encodedPath.contains("/accounts/login")) {
                            noteWall(); return null
                        }
                        if (next.scheme != "https" || next.host !in HOSTS) return null
                        target = next.toString()
                        return@use // loop: follow the redirect
                    }
                    if (res.code != 200) return null
                    if (res.request.url.encodedPath.contains("/accounts/login")) {
                        noteWall(); return null
                    }
                    val source = res.body?.source() ?: return null
                    source.request(MAX_BODY_BYTES + 1)
                    if (source.buffer.size > MAX_BODY_BYTES) return null
                    val meta = OgParser.parse(source.readUtf8(), shortcode)
                    if (meta != null) prefs.edit().putInt(KEY_WALL_FAILURES, 0).apply()
                    return meta
                }
            }
            null // too many redirects
        } catch (e: Exception) {
            null // timeouts, DNS, TLS: a quiet failure, not a signal about Instagram
        }
    }

    private fun noteWall() {
        val failures = prefs.getInt(KEY_WALL_FAILURES, 0) + 1
        if (failures >= WALL_LIMIT) {
            prefs.edit()
                .putInt(KEY_WALL_FAILURES, 0)
                .putLong(KEY_DISABLED_UNTIL, System.currentTimeMillis() + DISABLE_MS)
                .apply()
        } else {
            prefs.edit().putInt(KEY_WALL_FAILURES, failures).apply()
        }
    }
}
