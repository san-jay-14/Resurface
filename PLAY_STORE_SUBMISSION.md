# Play Store submission guide — Dibs

Everything needed to ship `com.resurface.app` to Google Play. Items marked
**[repo]** are already handled in the codebase; **[you]** must be done by hand in
the Play Console / Google Cloud.

---

## 1. What's already done in the repo [repo]

- `app.json`: name **Dibs**, package `com.resurface.app`, version `1.0.0`,
  portrait, adaptive icon, notification color, deep links.
- Removed the invalid `NOTIFICATIONS` permission; blocked `SYSTEM_ALERT_WINDOW`
  (draw-over-apps) which Play Store scrutinises and the app doesn't use.
- `eas.json`: `production` profile builds an **AAB** (required by Play) on the
  `production` channel with `autoIncrement` version codes; `submit.production`
  wired for the `internal` track as a **draft**.
- `PRIVACY.md`: privacy policy content (must be hosted — see step 4).
- Service-account keys are git-ignored.

## 2. One-time build config you must confirm [you]

- **Mapbox download token.** The app uses `@rnmapbox/maps`. The secret download
  token must be available to the build (EAS secret `MAPBOX_DOWNLOAD_TOKEN` /
  `RNMapboxMapsDownloadToken`). Without it the Android build fails.
  > Note: `package.json` pins `@rnmapbox/maps@10.3.1` while `app.json` requests
  > native `RNMapboxMapsVersion 11.20.1`. Confirm this pair builds before you
  > rely on the production build.
- **google-services.json** is committed and matches `com.resurface.app`. Confirm
  it's the *production* Firebase project.
- **Google / Apple OAuth**: the release build is signed with the EAS upload key.
  Add that key's SHA-1/SHA-256 to your Google OAuth client, and add Supabase
  Auth redirect URLs, or Google sign-in will fail in the store build.

## 3. Build & submit commands [you]

```bash
# 1. Log in
eas login

# 2. Store the Mapbox token (and any other secrets) once
eas secret:create --scope project --name MAPBOX_DOWNLOAD_TOKEN --value <token>

# 3. Produce a signed AAB (EAS manages the upload keystore)
eas build --platform android --profile production

# 4a. Submit via EAS (needs the service-account json, see step 5)
eas submit --platform android --profile production --latest

# 4b. …or download the .aab and upload it manually in the Play Console
```

## 4. Host the privacy policy [you]

Play **requires a public URL**. Publish `PRIVACY.md` somewhere stable, e.g.
GitHub Pages, `https://getdibs.app/privacy`, or a Notion page. Paste that URL
into Play Console → App content → Privacy policy. Replace the placeholder
contact email in `PRIVACY.md` first.

## 5. Google Play service account (for `eas submit`) [you]

1. Play Console → Setup → API access → link a Google Cloud project.
2. Create a service account, grant it **Release manager** (or Admin) access.
3. Download its JSON key, save it as `play-store-service-account.json` in the
   repo root (already git-ignored). Referenced by `eas.json`.

## 6. Data Safety form [you]

Play Console → App content → Data safety. Answer based on what Dibs actually
collects (see `PRIVACY.md`). Declare:

| Data type | Collected | Shared | Purpose | Optional? |
|---|---|---|---|---|
| Name, Email | Yes | No | Account | via Google/Apple sign-in |
| Photos | Yes | No | App functionality | Optional |
| Precise & approximate location | Yes | No | App functionality (place resurfacing/maps) | Optional |
| Other user content (saved links, notes) | Yes | No | App functionality | Required |
| App activity / other | Yes | No | App functionality | — |
| Device or other IDs (push token) | Yes | No | Messaging | — |

- Data is **encrypted in transit**: Yes.
- Users can **request deletion**: Yes (email flow in `PRIVACY.md`).
- No data used for advertising; nothing sold.

## 7. Permissions declaration [you]

- **Location** (`ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`): foreground
  only. In the Location permission declaration, state it is used to show and
  resurface saved *places* near the user; confirm **no background location**.
- Push (`POST_NOTIFICATIONS`), photos, and network need no special declaration.

## 8. Store listing [you]

Play Console → Main store listing. Suggested copy:

- **App name:** Dibs
- **Short description (≤80 chars):**
  `Save links, reels & places — Dibs brings them back right when they matter.`
- **Full description (≤4000 chars):**
  > You save things everywhere — reels, links, cafés, recipes — and never see
  > them again. Dibs is the second brain behind your share button. Share anything
  > into Dibs and it understands *why* you saved it, then resurfaces it at the
  > right moment: when you're near that café, the week before a birthday, or the
  > evening before a long weekend.
  >
  > • Save from any app with the share button
  > • Automatic categorising — places, recipes, shopping, inspo and more
  > • Location-aware reminders for places you saved
  > • Occasion-based resurfacing (birthdays, long weekends)
  > • A tidy library of everything you've saved, finally useful

### Required graphic assets (you must create these)
| Asset | Spec |
|---|---|
| App icon | 512×512 PNG (from `assets/icon.png`) |
| Feature graphic | 1024×500 PNG/JPG — **required** |
| Phone screenshots | 2–8, min 320px, 9:16-ish, PNG/JPG |
| (Optional) tablet / 7"/10" screenshots | if you advertise tablet support |

> `app.json` sets iOS `supportsTablet: true`. Either provide tablet screenshots
> or ignore (Android tablet support is separate; no action needed for phone-only
> launch).

## 9. Content rating, category, contacts [you]

- Complete the **content rating questionnaire** (Dibs is a productivity/utility
  app, no objectionable content → likely "Everyone").
- **Category:** Productivity (or Lifestyle).
- **Contact details:** support email + the hosted privacy policy URL.
- **Target audience:** 13+ (not designed for children).

## 10. Pre-launch checklist [you]

- [ ] Mapbox token set as EAS secret; production AAB builds green.
- [ ] Google/Apple sign-in works in a `production`-profile build on a real device.
- [ ] Share-into-Dibs works from the installed build.
- [ ] Push notification received on the production build.
- [ ] Privacy policy URL live and linked.
- [ ] Data Safety + permissions declaration submitted.
- [ ] Feature graphic + ≥2 screenshots uploaded.
- [ ] Internal testing track release created, then promote to production.
