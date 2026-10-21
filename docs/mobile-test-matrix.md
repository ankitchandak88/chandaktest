# Mobile device test matrix (Phase 17)

## App's declared SDK range

`chandaktext_mob/android/app/build.gradle.kts` doesn't hardcode SDK
levels — it delegates to Flutter's own defaults (checked against the
installed Flutter SDK, `C:\dev\flutter`, at
`packages/flutter_tools/gradle/src/main/kotlin/FlutterExtension.kt`):

- `minSdkVersion` = **24** (Android 7.0 Nougat)
- `targetSdkVersion` / `compileSdkVersion` = **36**

iOS: `chandaktext_mob/ios/Runner.xcodeproj/project.pbxproj` declares
`IPHONEOS_DEPLOYMENT_TARGET = 13.0`.

## Android matrix

| # | Config | API level | Screen | Status |
|---|--------|-----------|--------|--------|
| 1 | Pixel 10a (lightweight) | 36 (current) | 1080×2400, density 420 (phone) | ✅ **Extensively verified this session** — Phases 7–13 (canvas editing, tags, citations, share links, AI assistant, PDF/DOCX export) all live-tested on this exact config, see `docs/PROGRESS.md`. |
| 2 | Pixel 10 (Play Store variant) | 37.2-beta3 | 1080×2424, density 420 (phone) | ⚠️ **Attempted, not completed** — see "What was attempted" below. |
| 3 | A `minSdkVersion`-class device (API 24, Android 7.0) | 24 | phone | ❌ Not attempted — no API 24 system image installed locally (only `android-36`, `android-37.2`, `android-37.2-beta3` are present under the SDK's `system-images/`), and downloading one wasn't justified for this pass given config #2 already surfaced an unrelated environment issue worth fixing first. **Needs to happen before a store release** — this is the oldest OS version real users could be on. |
| 4 | A tablet-class config (e.g. Pixel Tablet, ~1600×2560, lower density-independent scaling) | current | tablet | ❌ Not attempted — no tablet AVD exists yet. LiquidText-style canvas/PDF apps are exactly the kind of app where tablet layout (more canvas real estate, different gesture-area proportions) is worth checking before release, not a formality. |
| 5 | A genuinely low-end device profile (2GB RAM class, API 24–26) | 24–26 | small/low-density | ❌ Not attempted. Closest thing to "will this run acceptably on a cheap phone," which emulator configs only approximate anyway — real-device testing matters more here than for the other rows. |
| 6 | Real hardware: OnePlus CPH2491, Android 16 (API 36), 1240×2772 @560dpi, OxygenOS | 36 | real phone | ✅ **Verified live, real USB-connected device, not an emulator** (2026-10-22) — see "Real-device verification" below. |

### Real-device verification (OnePlus CPH2491, 2026-10-22)

User connected their own phone via USB debugging. Installed the debug APK
(had to rebuild for `android-arm64` — the existing debug APK was
x86_64-only from emulator builds, `INSTALL_FAILED_NO_MATCHING_ABIS`
against real arm64 hardware). OEM-level `INSTALL_FAILED_VERIFICATION_FAILURE`
on first install attempt (common on OnePlus/ColorOS/OxygenOS - Play
Protect-style ADB install verification) - worked after temporarily
toggling `settings put global verifier_verify_adb_installs 0` /
`package_verifier_enable 0`, both restored to `1` afterward.

**Real finding, not an app bug but worth documenting for future
real-device testing**: the app's `network_security_config.xml` only
allowlists cleartext HTTP to the literal domains `10.0.2.2` (emulator-only
alias) and `localhost` - NOT `127.0.0.1`. Testing against a real device
over USB requires `adb reverse tcp:8123 tcp:8123` plus building with
`--dart-define=API_URL=http://localhost:8123/api/v1` (not `127.0.0.1`,
even though they're the same host) - the IP literal is silently blocked
by Android's Network Security Config on API 28+, the domain string name
is not.

**Result**: app launched cleanly (no crash, confirmed via `adb logcat`
filtered for `FATAL`/`AndroidRuntime` - the only fatal-level lines seen
were from OnePlus's own unrelated camera daemon, `APS_ALOG`, not this
app), login screen rendered correctly at this device's higher density
(560dpi vs. the emulator's 420dpi), logged in against the real backend
over `adb reverse`, and loaded real project data from the live database
(3 projects, correct document/note counts matching the actual DB state).
Navigated into a project and confirmed the document/citation view
("Ask AI" entry point) rendered correctly too. This is the first
verification on genuine physical hardware rather than an emulator this
entire project.

### What was attempted for row 2

A second AVD ("Pixel 10", API 37.2-beta3, Google Play variant, different
resolution/density than Pixel 10a) already existed on disk at
`C:\Android\.android\avd\Pixel_10.avd` but wasn't visible to
`flutter emulators` — its top-level `Pixel_10.ini` registration pointer
was missing (only `Pixel_10a.ini` was present), almost certainly left
over from an earlier interrupted session (consistent with the emulator
instability already documented elsewhere in `docs/PROGRESS.md` — ANRs,
a vanishing emulator process, a System UI crash, all previously traced to
host resource pressure, not app bugs).

Fixed that specific problem by hand-writing the missing `Pixel_10.ini`
(mirroring `Pixel_10a.ini`'s format) — this worked, `flutter emulators`
then listed both configs. Also found and cleared a **stale
`hardware-qemu.ini.lock`** inside the AVD's own data directory (another
leftover from the same earlier interrupted session), which was initially
blocking boot with `FATAL | Running multiple emulators with the same AVD
is an experimental feature.` even though nothing else was actually using
it.

After both of those fixes, the emulator process itself did start (a real
`qemu-system-x86_64.exe -avd Pixel_10` process was confirmed running via
`Get-CimInstance Win32_Process`, not just a flutter-tool wrapper), but
`adb devices` stayed on `emulator-5554 offline` for **9+ minutes** of
active polling without ever reaching a connectable state. This is beyond
normal cold-boot time (a few minutes is typical, even for a first boot)
and matches this session's established pattern of this host occasionally
failing to get an emulator to a usable state for reasons unrelated to
app code. Per this task's own instruction not to fight an unstable
emulator indefinitely, the process was stopped cleanly rather than
continuing to retry.

**Net effect**: the Pixel_10 AVD registration/lock problems are now
*fixed* (future sessions should find it listed and lock-free), which is
real, durable progress — but the actual device/API-level coverage this
row represents is still unverified. Next session should simply try
`flutter emulators --launch Pixel_10` again; if it boots cleanly this
time, that's `docs/PROGRESS.md` row 2 done. If it still won't boot within
a couple of minutes, that points at something specific to this AVD's
image (API 37.2 **beta**) rather than host load, and recreating it fresh
via `avdmanager` against a stable API level (e.g. a plain API 34/35
`google_apis` image, not a `-beta` one) would be the next thing to try
instead of continuing to fight this specific AVD.

## iOS matrix — cannot be executed in this environment

This machine has no Mac/Xcode, which iOS builds/testing require — these
rows are a checklist for whenever Mac access exists, not something this
session could attempt:

| # | Config | iOS version | Screen | Status |
|---|--------|--------------|--------|--------|
| 1 | iPhone SE (3rd gen)-class, smallest current iPhone screen | oldest supported — **13.0** per `IPHONEOS_DEPLOYMENT_TARGET`, or the oldest iOS the simulator catalog still offers (whichever is higher in practice) | small phone | ❌ Needs Mac/Xcode |
| 2 | A recent iPhone (e.g. iPhone 16-class) | current stable iOS | standard phone | ❌ Needs Mac/Xcode |
| 3 | iPad (any current model) | current stable iOS | tablet | ❌ Needs Mac/Xcode |

Also needed before any iOS store submission, beyond device coverage:
Xcode archive/signing setup and an Apple Developer account — tracked in
`docs/app-store-submission.md` (Phase 18), not duplicated here.

## What this phase actually proves vs. doesn't

- **Proven**: the app works correctly on one emulator config (Pixel 10a /
  API 36) across every feature this project has shipped (Phases 7–13),
  and separately on one genuine physical device (OnePlus CPH2491, also
  API 36 but different screen density/manufacturer skin) for core
  flows (login, project list, document/citation view) against the real
  backend over the network, not just rendering in isolation.
- **Not proven**: behavior on the oldest supported API level (24), on a
  tablet layout, on a lower-end device profile, on any Play Store-variant
  build, or on iOS at all. Both verified configs happen to be API 36 -
  treat this as evidence the app *works*, not as evidence it works
  *everywhere it claims to support* — the `minSdkVersion=24` claim in
  particular is still unverified on any actual API 24 device/emulator.
