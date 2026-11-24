# App store submission prep (Phase 18)

Target: **Google Play + Apple App Store**, both per user decision. App: **ChandakText**
(`chandaktext_mob/`, applicationId `com.chandaktext.chandaktext_mob`, version `1.0.0+1`
— versionName `1.0.0` / versionCode `1` — in `pubspec.yaml`).

Real feature set this listing must reflect (don't oversell): PDF upload/reading,
excerpt/annotation capture, a workspace canvas (drag-to-position, tap-to-link
cards), project-scoped tags (with AI-assisted suggestions), APA/MLA citation
generation per document, password-optional expiring share links (read-only,
notes+excerpts only — never the source PDF), and an AI assistant
(summarize / chat / tag-suggest) that defaults to a deterministic fake
provider until an admin configures a real one (`AI_PROVIDER` env var).

## 1. Icons & screenshots — nothing exists yet (TODO for design)

Checked `chandaktext_mob/android/app/src/main/res/mipmap-*` — only the
**default Flutter launcher icon placeholder** is present, no custom app icon.
No `assets/` or `screenshots/` directory exists in the mobile project at all.
Nothing below can be produced until real design assets exist; this is a
checklist of what's needed, not something currently in-repo.

**Google Play:**
- App icon: 512×512 PNG, 32-bit with alpha, max 1MB.
- Feature graphic: 1024×500 PNG/JPEG, no alpha.
- Phone screenshots: 2–8 images, 16:9 or 9:16, min dimension 320px, max 3840px.
- 7" tablet screenshots: optional but recommended, same count/ratio rules.
- 10" tablet screenshots: optional.

**Apple App Store:**
- App icon: 1024×1024 PNG, no alpha, no rounded corners (Apple applies the mask).
- Screenshots are **required per device size class**, not just "a phone":
  - 6.9" display (iPhone 16 Pro Max class) — required.
  - 6.5" display (iPhone 11 Pro Max / XS Max class) — required if no 6.9" set covers it.
  - iPad 13" display — required only if the app supports iPad (check
    `chandaktext_mob/ios/Runner.xcodeproj` device family setting once Mac
    access exists; not verified here).
- 3–10 screenshots per size class, PNG/JPEG, no alpha.

## 2. Store listing copy (draft)

**App name:** ChandakText

**Subtitle / short description** (Play Store 80-char limit):
> Read, annotate, and organize research PDFs with AI-assisted tagging.
(79 chars)

**Category:** Productivity (primary) — Education or Reference are reasonable
alternates if Play Console's category definitions fit better at submission
time; Productivity is the closest match to the actual feature set.

**Suggested keywords:** PDF reader, research, annotation, citations, APA,
MLA, study notes, document organizer, AI summarize, academic workspace.

**Full description (draft):**

> ChandakText is a research workspace for anyone who needs to actually work
> inside their PDFs, not just read them.
>
> - **Upload and read PDFs** on the go, with the excerpts and annotations you
>   capture staying in sync with your desktop/web workspace.
> - **Canvas workspace**: pull excerpts and notes onto a visual canvas,
>   reposition them, and draw links between related ideas.
> - **Tags**, with AI-assisted suggestions based on what you're reading —
>   accept a suggestion to create and apply it in one tap, or manage them
>   yourself.
> - **Citations**: APA and MLA citations generated automatically from a
>   document's metadata, editable per document.
> - **Share links**: hand a read-only, optionally password-protected view of
>   your notes and excerpts to a collaborator — never the original PDF file.
> - **AI assistant**: summarize a document or ask questions about it,
>   grounded in the document's own text.
>
> Your account, organization, and documents sync the same way across web and
> mobile.

(Full description is well under both stores' character limits — Play allows
4000 chars, Apple 4000 chars — so there's room to expand once real
screenshots/marketing material exist to reference.)

## 3. Privacy policy

Drafted separately at [`docs/privacy-policy-draft.md`](./privacy-policy-draft.md)
— both stores require a live, linkable privacy policy URL before submission.
**This is a first draft for a real lawyer/compliance reviewer, not something
to publish as-is** — see the disclaimer at the top of that file.

## 4. Google Play Data Safety form — what to declare

Based on what the backend (`backend/app/`) actually collects/sends, not a
generic template:

| Data type | Collected? | Shared with third party? | Notes |
|---|---|---|---|
| Name | Yes | No | Account registration (`users.name`) |
| Email address | Yes | No | Account registration/login |
| User-uploaded files | Yes | No* | PDF documents, stored on the backend's own storage disk |
| App activity / in-app actions | Yes | No | Notes, excerpts, tags, workspace items — all account-scoped |
| User-generated content sent to AI | Conditionally | **Yes, if `AI_PROVIDER` is set to `openai` or `anthropic`** | Document text (truncated to 12,000 chars, see `AiAssistantService::MAX_CONTEXT_CHARS`), chat history, and the user's typed question are sent to that provider's API. Declare this as shared with a third party **only when a real provider is configured** — the default `fake` provider sends nothing externally. |
| Device or other identifiers | No | — | No analytics/crash-reporting SDK is wired into the mobile app currently |

\* Not shared with a third party by default; becomes conditionally true for
the AI-assistant row above when AI_PROVIDER is a real provider, since
document text is the upload's extracted content.

**Encryption in transit:** yes, declare it enabled. Checked
`chandaktext_mob/android/app/src/main/res/xml/network_security_config.xml`
directly — the `usesCleartextTraffic="true"` in `AndroidManifest.xml` is
correctly scoped to only `10.0.2.2` (Android emulator's host alias) and
`localhost`, both dev-only; it already carries a comment noting production
must point at an `https://` backend. No change needed here before release.

**Data deletion:** `DELETE /me` (`AuthController::destroy`, see
`backend/routes/api/v1.php`) already exists and lets a user delete their
own account — reference this directly in the Data Safety form's "how to
request data deletion" field rather than standing up a separate process.

## 5. iOS-specific — needs Mac access, not executable here

This machine has no Mac/Xcode. These steps can only be prepared as a
checklist:

1. Apple Developer Program enrollment (if not already done) — $99/year,
   can take 24–48h for approval.
2. App Store Connect: create the app record (bundle ID, SKU, primary
   language) — bundle ID should mirror the Android `applicationId`
   convention, e.g. `com.chandaktext.chandaktextMob` (reverse-DNS, Apple
   disallows underscores in bundle IDs that Android allows).
3. Xcode signing: automatic signing via a Development/Distribution
   certificate tied to the Developer Program account, or manual
   provisioning profiles.
4. `flutter build ipa` → produces the `.xcarchive`/`.ipa` for upload via
   Xcode Organizer or `xcrun altool`/Transporter.
5. TestFlight: upload a build, add internal testers, wait for the (usually
   fast) TestFlight processing/compliance check before external testing.
6. App Privacy "nutrition label" questionnaire in App Store Connect — same
   underlying disclosures as the Play Data Safety table above (user
   content, contact info, and conditionally third-party AI data sharing).
7. App Review submission — Apple's review can reject for things Play
   doesn't check as strictly (e.g. placeholder/default app icon, which this
   app currently has — do not submit to Apple with the default Flutter
   icon still in place).

## 6. Android-specific release prep

**Signing — currently unset, must be fixed before release:**
`chandaktext_mob/android/app/build.gradle.kts` has release builds
explicitly signing with the **debug** keystore
(`signingConfig = signingConfigs.getByName("debug")`, with a `// TODO: Add
your own signing config for the release build` comment already in the
file). No `key.properties` or release keystore exists anywhere in
`chandaktext_mob/android/`. Before building a release artifact:

1. Generate a release keystore: `keytool -genkey -v -keystore
   release.keystore -alias chandaktext -keyalg RSA -keysize 2048 -validity
   10000` (store it outside the repo — it must never be committed, and
   losing it means you can never update the app under the same Play Store
   listing again).
2. Add `chandaktext_mob/android/key.properties` (gitignored) with the
   keystore path/passwords.
3. Update `build.gradle.kts`'s `signingConfigs`/`buildTypes.release` to
   read from `key.properties` and sign release builds with it instead of
   the debug key.

**Format:** Google Play requires an Android App Bundle (`.aab`), not a raw
APK, for new app submissions. Build with `flutter build appbundle
--release` (not `flutter build apk --release`, which is fine for direct
sideload/testing but won't satisfy Play's submission requirement).

**Versioning:** bump `version:` in `pubspec.yaml` (`versionName+versionCode`)
on every release; Play Console rejects an upload whose versionCode isn't
strictly higher than the previous one.

## Found while researching this (flag for the coordinating session)

- No custom app icon or screenshots exist at all yet — both store
  submissions are blocked on design assets, independent of anything code-side.
- Release builds currently sign with the **debug keystore** — a real gap
  that needs fixing before any Play/App Store submission, not just a
  checklist nicety.
- `android:usesCleartextTraffic="true"` is already correctly scoped to
  dev-only hosts via `network_security_config.xml` — verified, not a gap.
- Only `android.permission.INTERNET` is declared — a clean, minimal
  permission footprint, nothing to justify beyond basic network access.
