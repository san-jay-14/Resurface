# Dibs — Headless Share Handler
### Claude Code Build Spec

---

## What This Spec Covers

Implement a **headless Android share target** for Dibs. When a user shares a reel/link to Dibs from any app, the main Dibs UI must **never open**. The content is saved silently in the background. The only feedback is a small heads-up notification confirming the save. The user stays in Instagram (or YouTube, or wherever they were).

---

## Behaviour Contract

```
User taps Share in Instagram
  → Share sheet opens (Android native)
    → User taps "Dibs"
      → Share sheet closes
        → User is back in Instagram ← they never left
          → 1–2 seconds later: heads-up notification appears
              "Saved to Places 📍" (or "Saving..." if still processing)
```

**The main Dibs app Activity must NOT launch.** There is no transition animation, no splash screen, no app UI — nothing. If the user opens Dibs later, the save will be there.

---

## Architecture Overview

Three components need to be built:

```
1. ShareReceiverActivity   — native Android Activity (headless)
      ↓ immediately calls finish()
2. SaveWorker              — WorkManager background job
      ↓ extracts URL, queues enrichment
3. NotificationHelper      — posts heads-up confirmation
```

The main Expo app is untouched at runtime. ShareReceiverActivity is a separate lightweight Activity that never renders any UI.

---

## Component 1: ShareReceiverActivity

### File: `android/app/src/main/java/com/dibs/ShareReceiverActivity.kt`

This is a native Kotlin Activity. It must:

1. Receive the `ACTION_SEND` intent from the share sheet
2. Extract the shared URL from `Intent.EXTRA_TEXT`
3. Enqueue a `SaveWorker` job (WorkManager)
4. Post an immediate "Saving..." notification
5. Call `finish()` — this is the critical line that returns the user to their source app

**Key manifest flags** (detailed in Component 4):
- `android:theme="@android:style/Theme.NoDisplay"` — no UI surface created
- `android:noHistory="true"` — never appears in recents
- `android:excludeFromRecents="true"`
- `android:taskAffinity=""` — runs in its own task, doesn't hijack the Dibs app task

```kotlin
class ShareReceiverActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val sharedText = intent?.getStringExtra(Intent.EXTRA_TEXT)

        if (sharedText != null) {
            val url = extractUrl(sharedText)
            if (url != null) {
                enqueueSaveWorker(url)
                NotificationHelper.postSavingNotification(this)
            }
        }

        finish() // MUST be called — returns user to source app immediately
    }

    private fun extractUrl(text: String): String? {
        // Regex to pull first URL out of shared text
        // Instagram shares as: "Check this out https://www.instagram.com/reel/..."
        // YouTube shares as: "https://youtu.be/..."
        // WhatsApp-forwarded links may have surrounding text
        val urlRegex = Regex("""https?://[^\s]+""")
        return urlRegex.find(text)?.value
    }

    private fun enqueueSaveWorker(url: String) {
        val inputData = workDataOf(
            SaveWorker.KEY_URL to url,
            SaveWorker.KEY_SOURCE to detectSource(url),
            SaveWorker.KEY_TIMESTAMP to System.currentTimeMillis()
        )

        val saveRequest = OneTimeWorkRequestBuilder<SaveWorker>()
            .setInputData(inputData)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .build()

        WorkManager.getInstance(applicationContext).enqueue(saveRequest)
    }

    private fun detectSource(url: String): String {
        return when {
            url.contains("instagram.com") -> "instagram"
            url.contains("youtube.com") || url.contains("youtu.be") -> "youtube"
            url.contains("whatsapp.com") -> "whatsapp"
            else -> "web"
        }
    }
}
```

---

## Component 2: SaveWorker

### File: `android/app/src/main/java/com/dibs/SaveWorker.kt`

WorkManager job that runs fully in the background. Responsible for:

1. Storing the URL immediately to Supabase (raw, uncategorized) — this is the "guaranteed save"
2. Fetching URL metadata (title, OG image, description) if network is available
3. Running categorization logic (local heuristic first, Claude API if needed)
4. Updating the Supabase record with enriched data
5. Updating the notification from "Saving..." to "Saved to [Category] [emoji]"

```kotlin
class SaveWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context, params) {

    companion object {
        const val KEY_URL = "url"
        const val KEY_SOURCE = "source"
        const val KEY_TIMESTAMP = "timestamp"
    }

    override suspend fun doWork(): Result {
        val url = inputData.getString(KEY_URL) ?: return Result.failure()
        val source = inputData.getString(KEY_SOURCE) ?: "web"
        val timestamp = inputData.getLong(KEY_TIMESTAMP, System.currentTimeMillis())

        return try {
            // Step 1: Immediate raw save — this must succeed first
            val saveId = SupabaseClient.insertRawSave(
                url = url,
                source = source,
                timestamp = timestamp,
                status = "pending"
            )

            // Step 2: Fetch metadata
            val metadata = MetadataFetcher.fetch(url) // title, ogImage, description

            // Step 3: Categorize (heuristic first, fast)
            val category = CategoryHeuristic.classify(url, source, metadata)
                ?: CategoryHeuristic.UNCATEGORIZED

            // Step 4: Update record with enriched data
            SupabaseClient.updateSave(
                id = saveId,
                title = metadata.title,
                thumbnailUrl = metadata.ogImage,
                description = metadata.description,
                category = category,
                status = "saved"
            )

            // Step 5: Update notification with real category
            NotificationHelper.postSavedNotification(
                context = applicationContext,
                category = category
            )

            Result.success()

        } catch (e: Exception) {
            // Save failed — update notification to error state
            NotificationHelper.postSaveFailedNotification(applicationContext)
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }
}
```

---

## Component 3: NotificationHelper

### File: `android/app/src/main/java/com/dibs/NotificationHelper.kt`

Manages the heads-up notification lifecycle. There are three states:

| State | When | Copy | Duration |
|---|---|---|---|
| **Saving** | Immediately after share | `"Saving to Dibs..."` | Until worker completes |
| **Saved** | Worker succeeds | `"Saved to Places 📍"` etc | Auto-dismisses after 4s |
| **Failed** | Worker fails after retries | `"Couldn't save — tap to retry"` | Persistent until tapped |

**Notification channel:** `dibs_save_confirmations`
- Importance: `IMPORTANCE_HIGH` (required for heads-up / peek behaviour)
- Sound: none (silent)
- Vibration: none
- Show on lock screen: no (`VISIBILITY_SECRET`)

**Critical UX note:** The notification must appear as a **heads-up / peek** (slides in from top, auto-dismisses) — NOT a persistent notification drawer item. This requires `IMPORTANCE_HIGH` on the channel AND `setFullScreenIntent` is NOT used (that would be too aggressive). The peek behaviour is automatic when channel importance is HIGH.

```kotlin
object NotificationHelper {

    private const val CHANNEL_ID = "dibs_save_confirmations"
    private const val NOTIFICATION_ID = 9001
    
    // Category to emoji + label mapping
    private val categoryDisplay = mapOf(
        "places"   to Pair("📍", "Places"),
        "recipes"  to Pair("🍳", "Recipes"),
        "fashion"  to Pair("👗", "Fashion"),
        "shopping" to Pair("🛍️", "Shopping"),
        "watch"    to Pair("▶️", "Watch Later"),
        "inspo"    to Pair("✨", "Inspo"),
        "uncategorized" to Pair("🔖", "Dibs")
    )

    fun createChannel(context: Context) {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Save confirmations",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            setSound(null, null)
            enableVibration(false)
            lockscreenVisibility = Notification.VISIBILITY_SECRET
            description = "Quick confirmation when you save something to Dibs"
        }
        context.getSystemService(NotificationManager::class.java)
            .createNotificationChannel(channel)
    }

    fun postSavingNotification(context: Context) {
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_dibs_mono) // monochrome app icon
            .setContentTitle("Saving to Dibs...")
            .setProgress(0, 0, true) // indeterminate progress
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(false)
            .build()

        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
    }

    fun postSavedNotification(context: Context, category: String) {
        val (emoji, label) = categoryDisplay[category] ?: Pair("🔖", "Dibs")

        val openAppIntent = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("open_category", category)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_dibs_mono)
            .setContentTitle("Saved to $label $emoji")
            .setContentText("Tap to open Dibs")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setTimeoutAfter(4000) // auto-dismiss after 4 seconds
            .setContentIntent(openAppIntent)
            .build()

        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
    }

    fun postSaveFailedNotification(context: Context) {
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_dibs_mono)
            .setContentTitle("Couldn't save that")
            .setContentText("Tap to try again")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()

        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
    }
}
```

---

## Component 4: AndroidManifest Changes

### File: `android/app/src/main/AndroidManifest.xml`

Add the `ShareReceiverActivity` entry inside `<application>`. Do NOT modify the existing `MainActivity` entry.

```xml
<!-- Headless share receiver — never shows UI, never opens the app -->
<activity
    android:name=".ShareReceiverActivity"
    android:theme="@android:style/Theme.NoDisplay"
    android:noHistory="true"
    android:excludeFromRecents="true"
    android:taskAffinity=""
    android:exported="true">

    <intent-filter>
        <action android:name="android.intent.action.SEND" />
        <category android:name="android.intent.category.DEFAULT" />
        <data android:mimeType="text/plain" />
    </intent-filter>

</activity>
```

**Flag explanations:**
- `Theme.NoDisplay` — Activity creates no window. If `finish()` isn't called in `onCreate`, Android will ANR-crash it after ~2 seconds. This is intentional — it enforces the headless contract.
- `noHistory="true"` — Activity is removed from back stack as soon as it finishes. Back button in source app is unaffected.
- `excludeFromRecents="true"` — Never appears in the Android recents/task switcher.
- `taskAffinity=""` — Runs in its own anonymous task, completely separate from the main Dibs task. This prevents any risk of bringing the Dibs app to foreground.

---

## Component 5: Expo Config Plugin

Because Expo managed workflow abstracts the native Android project, the manifest changes need to be applied via a **config plugin** so they survive `expo prebuild`.

### File: `plugins/withHeadlessShareActivity.js`

```javascript
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withHeadlessShareActivity(config) {
  return withAndroidManifest(config, async (config) => {
    const manifest = config.modResults;
    const application = manifest.manifest.application[0];

    // Check if already added (idempotent)
    const existing = (application.activity || []).find(
      (a) => a.$['android:name'] === '.ShareReceiverActivity'
    );
    if (existing) return config;

    application.activity = application.activity || [];
    application.activity.push({
      $: {
        'android:name': '.ShareReceiverActivity',
        'android:theme': '@android:style/Theme.NoDisplay',
        'android:noHistory': 'true',
        'android:excludeFromRecents': 'true',
        'android:taskAffinity': '',
        'android:exported': 'true',
      },
      'intent-filter': [
        {
          action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
          category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
          data: [{ $: { 'android:mimeType': 'text/plain' } }],
        },
      ],
    });

    return config;
  });
};
```

### Register in `app.json`:

```json
{
  "expo": {
    "plugins": [
      "./plugins/withHeadlessShareActivity"
    ]
  }
}
```

---

## Component 6: CategoryHeuristic (Local, No API Call)

### File: `android/app/src/main/java/com/dibs/CategoryHeuristic.kt`

Fast local classification using URL patterns and metadata keywords. This runs synchronously inside SaveWorker. Claude API is NOT called during the share flow — it's too slow and too expensive for this path. Claude API is only used for the async enrichment queue (out of scope for this spec).

```kotlin
object CategoryHeuristic {

    const val UNCATEGORIZED = "uncategorized"

    // URL-level signals (fast, no network needed)
    private val urlPatterns = mapOf(
        "places"   to listOf("maps.google", "maps.apple", "zomato.com", "swiggy.com",
                              "tripadvisor", "booking.com", "airbnb.com", "makemytrip"),
        "shopping" to listOf("amazon.in", "amazon.com", "flipkart.com", "meesho.com",
                              "myntra.com", "ajio.com", "nykaa.com", "zepto"),
        "recipes"  to listOf("hebbarskitchen", "cookingshooking", "nishamadhulika"),
        "watch"    to listOf("youtube.com/watch", "youtu.be")
    )

    // Metadata keyword signals (runs after MetadataFetcher)
    private val keywordPatterns = mapOf(
        "places"   to listOf("restaurant", "café", "cafe", "hotel", "resort", "travel",
                              "visit", "trip", "rooftop", "hidden gem", "place to visit"),
        "recipes"  to listOf("recipe", "ingredients", "cook", "bake", "makes", "serves",
                              "minutes", "tbsp", "tsp", "grams"),
        "fashion"  to listOf("outfit", "ootd", "styling", "wear", "trend", "look",
                              "fashion", "aesthetic", "fit", "drip"),
        "shopping" to listOf("buy", "shop", "price", "₹", "rs.", "discount", "sale",
                              "available", "link in bio", "order"),
        "watch"    to listOf("tutorial", "how to", "explained", "learn", "course",
                              "tips", "guide", "review"),
        "inspo"    to listOf("mood", "vibe", "inspo", "aesthetic", "wallpaper",
                              "vision board", "motivation")
    )

    fun classify(url: String, source: String, metadata: Metadata?): String? {
        // 1. Try URL patterns first (instant)
        for ((category, patterns) in urlPatterns) {
            if (patterns.any { url.contains(it, ignoreCase = true) }) {
                return category
            }
        }

        // 2. Try metadata keywords
        if (metadata != null) {
            val searchText = listOf(
                metadata.title,
                metadata.description
            ).joinToString(" ").lowercase()

            val scores = mutableMapOf<String, Int>()
            for ((category, keywords) in keywordPatterns) {
                val hits = keywords.count { searchText.contains(it) }
                if (hits > 0) scores[category] = hits
            }

            if (scores.isNotEmpty()) {
                return scores.maxByOrNull { it.value }?.key
            }
        }

        // 3. Source-level fallback
        return when (source) {
            "youtube" -> "watch"
            else -> null // null = caller should use UNCATEGORIZED or queue for AI
        }
    }
}
```

---

## Supabase Schema Addition

The `saves` table needs a `status` column to track async enrichment state.

```sql
-- Add to existing saves table
ALTER TABLE saves ADD COLUMN IF NOT EXISTS status TEXT 
  DEFAULT 'pending' 
  CHECK (status IN ('pending', 'saved', 'failed'));

ALTER TABLE saves ADD COLUMN IF NOT EXISTS source TEXT;

-- Index for fetching pending saves (enrichment queue)
CREATE INDEX IF NOT EXISTS idx_saves_status ON saves(status) WHERE status = 'pending';
```

---

## Permissions

Add to `AndroidManifest.xml` if not already present:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
```

`POST_NOTIFICATIONS` is required on Android 13+ (API 33+). The app must request this permission at runtime before the first save. Request it during onboarding, framed as: *"Allow Dibs to confirm when something's saved"* — not as a generic notifications ask.

---

## DO NOT BUILD (Scope Guardrails)

- Do NOT build a share UI/bottom sheet — the entire point is zero UI
- Do NOT use `react-native-share-menu` or any RN share library — native Kotlin only for this Activity
- Do NOT call the Claude API inside SaveWorker — heuristic classification only in this flow
- Do NOT modify MainActivity or any existing Expo screens
- Do NOT implement iOS share extension in this milestone — Android only
- Do NOT build the async Claude enrichment queue — that is a separate milestone
- Do NOT implement the `open_category` deep link handler in MainActivity yet — just pass the intent extra, handle it later

---

## Testing Checklist

Before marking this milestone complete, verify:

- [ ] Share Dibs from Instagram — source app stays open, no Dibs UI appears
- [ ] Heads-up notification appears within 2 seconds of sharing
- [ ] Notification auto-dismisses after 4 seconds
- [ ] Tapping notification opens Dibs main screen
- [ ] Save appears in Supabase `saves` table with correct `source` and `status`
- [ ] Category is correctly assigned for: an Instagram reel URL, a YouTube link, a Zomato link
- [ ] Sharing while offline: save is queued and completes when network returns (WorkManager retry)
- [ ] Sharing rapidly 3x in a row: all 3 saves land in Supabase (no race condition)
- [ ] Dibs does NOT appear in Android recents after sharing
- [ ] `expo prebuild` regenerates the manifest correctly with the config plugin

---

## File Summary

| File | Action |
|---|---|
| `android/app/src/main/java/com/dibs/ShareReceiverActivity.kt` | Create |
| `android/app/src/main/java/com/dibs/SaveWorker.kt` | Create |
| `android/app/src/main/java/com/dibs/NotificationHelper.kt` | Create |
| `android/app/src/main/java/com/dibs/CategoryHeuristic.kt` | Create |
| `android/app/src/main/AndroidManifest.xml` | Modify — add ShareReceiverActivity entry |
| `plugins/withHeadlessShareActivity.js` | Create |
| `app.json` | Modify — register config plugin |
| Supabase migration | Run ALTER TABLE statements |

---

*Spec version: 1.0 — Dibs headless share handler, Android-first*
