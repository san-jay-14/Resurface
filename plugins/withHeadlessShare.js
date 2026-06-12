const { withAndroidManifest, withAppBuildGradle, withDangerousMod } = require("@expo/config-plugins");
const path = require("path");
const fs = require("fs");

// ─── Manifest ────────────────────────────────────────────────────────────────
const withManifest = (config) =>
  withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application[0];

    // Remove ACTION_SEND from MainActivity (added by expo-share-intent)
    const main = (app.activity || []).find(
      (a) => a.$["android:name"] === ".MainActivity"
    );
    if (main?.["intent-filter"]) {
      main["intent-filter"] = main["intent-filter"].filter(
        (f) =>
          !(f.action || []).some(
            (a) => a.$["android:name"] === "android.intent.action.SEND"
          )
      );
    }

    // Add ShareReceiverActivity (Theme.NoDisplay, owns ACTION_SEND)
    const hasReceiver = (app.activity || []).some(
      (a) => a.$["android:name"] === ".ShareReceiverActivity"
    );
    if (!hasReceiver) {
      app.activity.push({
        $: {
          "android:name": ".ShareReceiverActivity",
          "android:theme": "@android:style/Theme.NoDisplay",
          "android:noHistory": "true",
          "android:excludeFromRecents": "true",
          "android:taskAffinity": "",
          "android:exported": "true",
        },
        "intent-filter": [
          {
            action: [{ $: { "android:name": "android.intent.action.SEND" } }],
            category: [{ $: { "android:name": "android.intent.category.DEFAULT" } }],
            data: [{ $: { "android:mimeType": "text/plain" } }],
          },
        ],
      });
    }

    return config;
  });

// ─── build.gradle ─────────────────────────────────────────────────────────────
const withGradle = (config) =>
  withAppBuildGradle(config, (config) => {
    let gradle = config.modResults.contents;

    // BuildConfig fields
    if (!gradle.includes("SUPABASE_URL")) {
      gradle = gradle.replace(
        /buildConfigField "String", "REACT_NATIVE_RELEASE_LEVEL".*\n(\s*)}/,
        (m, indent) =>
          m.replace(
            `${indent}}`,
            `${indent}    buildConfigField "String", "SUPABASE_URL", "\\"https://wsnrkbldvrzyqnqexcvo.supabase.co\\""\n` +
            `${indent}    buildConfigField "String", "SUPABASE_ANON_KEY", "\\"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzbnJrYmxkdnJ6eXFucWV4Y3ZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2NzM3NTIsImV4cCI6MjA5NjI0OTc1Mn0.F1UwTmJCWPk0ligMFZLz1dLX1X-s5VQXSQnhs6ZVO9k\\""\n` +
            `${indent}}\n    buildFeatures {\n${indent}    buildConfig = true\n${indent}}`
          )
      );
    }

    // Dependencies
    for (const dep of [
      'implementation("androidx.work:work-runtime-ktx:2.9.0")',
      'implementation("com.squareup.okhttp3:okhttp:4.12.0")',
    ]) {
      if (!gradle.includes(dep)) {
        gradle = gradle.replace(
          'implementation("com.facebook.react:react-android")',
          `implementation("com.facebook.react:react-android")\n    ${dep}`
        );
      }
    }

    config.modResults.contents = gradle;
    return config;
  });

// ─── Kotlin source files ──────────────────────────────────────────────────────
const SHARE_RECEIVER_ACTIVITY = `package com.resurface.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

class ShareReceiverActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        extractUrl(intent)?.let { url ->
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = OneTimeWorkRequestBuilder<SaveWorker>()
                .setInputData(workDataOf(SaveWorker.KEY_URL to url))
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(applicationContext).enqueue(request)
        }
        finish()
    }

    private fun extractUrl(intent: Intent?): String? {
        if (intent?.action != Intent.ACTION_SEND) return null
        if (!intent.type.orEmpty().startsWith("text/")) return null
        val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return null
        return text.split("\\\\s+".toRegex())
            .firstOrNull { it.startsWith("http://") || it.startsWith("https://") }
            ?: text.trim().takeIf { it.startsWith("http") }
    }
}
`;

const SAVE_WORKER = `package com.resurface.app

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class SaveWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    companion object {
        const val KEY_URL = "url"
        private const val TAG = "DibsSaveWorker"
        private const val STORAGE_KEY = "sb-wsnrkbldvrzyqnqexcvo-auth-token"
        private val JSON = "application/json".toMediaType()
    }

    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    private val supabaseUrl = BuildConfig.SUPABASE_URL
    private val anonKey = BuildConfig.SUPABASE_ANON_KEY

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val url = inputData.getString(KEY_URL) ?: return@withContext Result.failure()
        val notif = NotificationHelper(applicationContext)
        try {
            val (token, userId) = readAuth() ?: return@withContext Result.failure()
            val saveId = insertSave(url, token, userId)
            invokeEnrichment(url, saveId, token)
            notif.showSuccess(saveId)
            Result.success()
        } catch (e: IOException) {
            Log.w(TAG, "Network error — retrying: \${e.message}")
            Result.retry()
        } catch (e: Exception) {
            Log.e(TAG, "Save failed: \${e.message}", e)
            notif.showError()
            Result.failure()
        }
    }

    private data class AuthState(val token: String, val userId: String)

    private fun readAuth(): AuthState? = try {
        val db = applicationContext.getDatabasePath("RKStorage")
        if (!db.exists()) null
        else {
            val sqlite = SQLiteDatabase.openDatabase(db.path, null, SQLiteDatabase.OPEN_READONLY)
            val cur = sqlite.rawQuery("SELECT value FROM catalystLocalStorage WHERE key = ?", arrayOf(STORAGE_KEY))
            val result = if (cur.moveToFirst()) {
                val json = JSONObject(cur.getString(0))
                val t = json.optString("access_token").takeIf { it.isNotEmpty() }
                val u = json.optJSONObject("user")?.optString("id")
                if (t != null && u != null) AuthState(t, u) else null
            } else null
            cur.close(); sqlite.close(); result
        }
    } catch (e: Exception) { null }

    private fun detectPlatform(url: String) = when {
        url.contains("instagram.com") -> "instagram"
        url.contains("youtube.com") || url.contains("youtu.be") -> "youtube"
        else -> "web"
    }

    private fun insertSave(url: String, token: String, userId: String): String {
        val body = JSONObject().apply {
            put("user_id", userId); put("source_url", url)
            put("source_platform", detectPlatform(url))
            put("category", "unsorted"); put("status", "pending")
        }
        val resp = http.newCall(Request.Builder()
            .url("\$supabaseUrl/rest/v1/saves")
            .addHeader("apikey", anonKey).addHeader("Authorization", "Bearer \$token")
            .addHeader("Content-Type", "application/json").addHeader("Prefer", "return=representation")
            .post(body.toString().toRequestBody(JSON)).build()).execute()
        val raw = resp.body?.string() ?: throw IOException("Empty response")
        if (!resp.isSuccessful) throw IOException("Insert \${resp.code}: \$raw")
        return JSONArray(raw).getJSONObject(0).getString("id")
    }

    private fun invokeEnrichment(url: String, saveId: String, token: String) {
        val fn = if (url.contains("instagram.com")) "scrape-instagram" else "enrich-save"
        val body = JSONObject().apply {
            put("save_id", saveId)
            if (url.contains("instagram.com")) put("url", url)
        }
        try {
            http.newCall(Request.Builder()
                .url("\$supabaseUrl/functions/v1/\$fn")
                .addHeader("apikey", anonKey).addHeader("Authorization", "Bearer \$token")
                .addHeader("Content-Type", "application/json")
                .post(body.toString().toRequestBody(JSON)).build()).execute()
        } catch (e: Exception) { Log.w(TAG, "\$fn failed (non-fatal): \${e.message}") }
    }
}
`;

const NOTIFICATION_HELPER = `package com.resurface.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

class NotificationHelper(private val ctx: Context) {
    companion object {
        private const val CHANNEL_ID = "default"
        private const val NOTIF_ID = 1001
    }
    init {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL_ID, "Dibs", NotificationManager.IMPORTANCE_DEFAULT)
            ctx.getSystemService(NotificationManager::class.java)?.createNotificationChannel(ch)
        }
    }
    fun showSuccess(saveId: String) {
        val tap = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("saveId", saveId)
        }
        val pi = PendingIntent.getActivity(ctx, 0, tap, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        NotificationManagerCompat.from(ctx).notify(NOTIF_ID,
            NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("Saved to Dibs")
                .setContentText("I'll categorise it in the background.")
                .setAutoCancel(true).setContentIntent(pi).build())
    }
    fun showError() {
        NotificationManagerCompat.from(ctx).notify(NOTIF_ID,
            NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("Dibs")
                .setContentText("Couldn't save that link — open Dibs to retry.")
                .setAutoCancel(true).build())
    }
}
`;

const withKotlinFiles = (config) =>
  withDangerousMod(config, [
    "android",
    (config) => {
      const dir = path.join(
        config.modRequest.platformProjectRoot,
        "app/src/main/java/com/resurface/app"
      );
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "ShareReceiverActivity.kt"), SHARE_RECEIVER_ACTIVITY);
      fs.writeFileSync(path.join(dir, "SaveWorker.kt"), SAVE_WORKER);
      fs.writeFileSync(path.join(dir, "NotificationHelper.kt"), NOTIFICATION_HELPER);
      return config;
    },
  ]);

module.exports = function withHeadlessShare(config) {
  config = withManifest(config);
  config = withGradle(config);
  config = withKotlinFiles(config);
  return config;
};
