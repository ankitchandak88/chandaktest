# ChandakText — Mobile (Flutter)

Android/iOS client for the ChandakText PDF research workspace, talking to
the Laravel API at `../backend` over `/api/v1` (Sanctum bearer tokens,
same as the web app — see `docs/PROGRESS.md` at the repo root for the full
project status).

## Scope (docs/07 "Mobile Apps and Store Release")

Implemented: register/login/logout, project list + create, usage display,
PDF upload, PDF.js-equivalent viewing via `syncfusion_flutter_pdfviewer`
with text selection → save-as-excerpt, excerpts list, notes list + create,
export (queue + poll status).

Not yet implemented (see docs/PROGRESS.md for the up to date list):
precise on-page excerpt coordinates (mobile stores a full-page placeholder
rect rather than the DOM-selection-derived rect the web app captures),
annotations (highlight/comment) UI, the drag-and-drop workspace canvas
(mobile shows excerpts/notes as lists — "staged after first release" per
docs/07 for advanced gestures), offline caching, account/billing screens,
push notifications.

## Running it locally

The backend must be running first (`cd ../backend && php artisan serve
--port=8123`, plus `php artisan queue:work` and Redis — see the repo root
`docs/PROGRESS.md` "How to run it locally").

```
flutter pub get
flutter run                       # picks whatever device/emulator is connected
flutter run -d chrome              # quickest way to smoke-test the UI, no emulator needed
```

By default the app points at `http://10.0.2.2:8123/api/v1`, which is the
**Android emulator's** alias for the host machine's `localhost`. Override
with `--dart-define=API_URL=...` for other targets:

- iOS Simulator: `--dart-define=API_URL=http://localhost:8123/api/v1`
- Chrome (web): `--dart-define=API_URL=http://localhost:8123/api/v1`
- A real device on the same network: `--dart-define=API_URL=http://<your-machine-LAN-IP>:8123/api/v1`

Plain `http://` only works against `10.0.2.2` / `localhost` — see
`android/app/src/main/res/xml/network_security_config.xml` and the
`NSAppTransportSecurity` exception in `ios/Runner/Info.plist`. Production
builds must point at an `https://` backend (docs/09 deployment checklist).

## Testing

```
flutter analyze
flutter test
```
