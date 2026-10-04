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

    // BuildConfig field: the API the share worker posts to. Read from the same env var as the app,
    // so a build can never point the worker and the app at different servers.
    const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
    if (!apiUrl) {
      throw new Error("EXPO_PUBLIC_API_URL must be set to prebuild the Android share worker.");
    }
    const field = `buildConfigField "String", "API_URL", "\\"${apiUrl}\\""`;
    // Logged-out Instagram metadata fetch on the device. OFF until the Phase 0 spike
    // (docs/ig-device-fetch-spike.md) says Go; then build with IG_DEVICE_FETCH=true.
    const deviceField = `buildConfigField "boolean", "IG_DEVICE_FETCH", "${process.env.IG_DEVICE_FETCH === "true"}"`;
    // Idempotent: drop any previous (or legacy) fields, then add the current ones.
    gradle = gradle.replace(
      /^[ \t]*buildConfigField "(String|boolean)", "(SUPABASE_URL|SUPABASE_ANON_KEY|API_URL|IG_DEVICE_FETCH)".*\n/gm,
      "",
    );
    gradle = gradle.replace(
      /buildConfigField "String", "REACT_NATIVE_RELEASE_LEVEL".*\n([ \t]*)}/,
      (m, indent) =>
        m.replace(
          `${indent}}`,
          `${indent}    ${field}\n${indent}    ${deviceField}\n${indent}}` +
            (gradle.includes("buildConfig = true")
              ? ""
              : `\n    buildFeatures {\n${indent}    buildConfig = true\n${indent}}`),
        ),
    );

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
        private const val STORAGE_KEY = "dibs.share"
        private val JSON = "application/json".toMediaType()
    }

    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    private val apiUrl = BuildConfig.API_URL

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val url = inputData.getString(KEY_URL) ?: return@withContext Result.failure()
        val notif = NotificationHelper(applicationContext)
        try {
            val token = readShareToken() ?: return@withContext Result.failure()
            // Best effort: one plain logged-out GET (6s cap), first attempt only. Null on any failure.
            val device = if (runAttemptCount == 0) DeviceMetaFetcher(applicationContext, http).fetchFor(url) else null
            val saveId = enqueue(url, token, device)
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

    // The app mints a scoped, revocable share token after sign-in and stores it in AsyncStorage
    // (RKStorage). It can only call POST /v1/saves/enqueue. Null means "not signed in".
    private fun readShareToken(): String? = try {
        val db = applicationContext.getDatabasePath("RKStorage")
        if (!db.exists()) null
        else {
            val sqlite = SQLiteDatabase.openDatabase(db.path, null, SQLiteDatabase.OPEN_READONLY)
            val cur = sqlite.rawQuery("SELECT value FROM catalystLocalStorage WHERE key = ?", arrayOf(STORAGE_KEY))
            val result = if (cur.moveToFirst()) cur.getString(0).takeIf { it.startsWith("dst_") } else null
            cur.close(); sqlite.close(); result
        }
    } catch (e: Exception) { null }

    // One server-side entry point: canonicalizes the URL, dedupes, creates the save and
    // queues enrichment. Idempotent, so WorkManager retries cannot create duplicates.
    private fun enqueue(url: String, token: String, device: JSONObject?): String {
        val body = JSONObject().put("url", url)
        if (device != null) body.put("device_meta", device)
        val resp = http.newCall(Request.Builder()
            .url("\$apiUrl/v1/saves/enqueue")
            .addHeader("Authorization", "ShareToken \$token")
            .addHeader("Content-Type", "application/json")
            .post(body.toString().toRequestBody(JSON)).build()).execute()
        val raw = resp.body?.string() ?: throw IOException("Empty response")
        // 5xx, rate limits and cold starts are retried by WorkManager; 401 (token revoked) and other
        // 4xx (unsupported link) are final.
        if (resp.code >= 500 || resp.code == 429) throw IOException("enqueue \${resp.code}: \$raw")
        if (!resp.isSuccessful) throw IllegalStateException("enqueue \${resp.code}: \$raw")
        return JSONObject(raw).getString("save_id")
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
      // Plain .kt sources (no template escaping), copied verbatim.
      for (const f of ["DeviceMetaFetcher.kt", "OgParser.kt"]) {
        fs.copyFileSync(path.join(__dirname, "kotlin", f), path.join(dir, f));
      }
      return config;
    },
  ]);

module.exports = function withHeadlessShare(config) {
  config = withManifest(config);
  config = withGradle(config);
  config = withKotlinFiles(config);
  return config;
};
