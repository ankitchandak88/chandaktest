# ChandakText — Build Progress

Resume point for future sessions. **Read this file first** before continuing.
Update it after every phase / every meaningful breakpoint.

## Decisions locked in (do not re-ask)
- DB: **MySQL** (Laragon `mysql-8.0.30-winx64`, root / no password). Databases:
  `chandaktext` (dev), `chandaktext_test` (automated tests). NOT PostgreSQL.
- Redis: Laragon's bundled `redis-x64-5.0.14.1`. PHP has no `ext-redis`, so
  Laravel is configured with `REDIS_CLIENT=predis` (pure-PHP client,
  `predis/predis` composer package) — do not switch back to `phpredis`
  without installing the PHP extension first.
- Backend: Laravel 12 at `backend/`, API-only under `/api/v1`, **Sanctum
  bearer tokens** for both web and mobile (no cookie/session auth at all —
  user explicitly asked for "API based").
- Admin: Filament 3 at `backend/`, mounted at `/admin` in the same Laravel app.
- Web: React 19 + TS + Vite + Tailwind v4 at `web/` — **core user journey
  working end-to-end in a real browser**, see Phase 7.5 below.
- Mobile: Flutter at `chandaktext_mob/` (Flutter 3.35.4 at `C:\dev\flutter`) —
  **not started yet**.
- pdfjs-dist is pinned to **`^4.8.69`**, not the newest 6.x. 6.x depends on
  very recent platform APIs (`URL.parse()` static method, `Promise.try()`)
  that not every Chromium build has yet - it broke entirely in the browser
  automation tool used to test this. 4.8.69 works everywhere tested. Don't
  casually bump this major version without re-testing the PDF viewer.
- Payment: `PAYMENT_PROVIDER=fake` by default (app/Services/Billing/FakePaymentProvider).
  Real `RazorpayPaymentProvider` is wired and ready but untested (no live keys).
- IDs: every domain table uses a UUID primary key (`HasUuids` trait). `users.id`
  stays a normal bigint (Laravel default) — only `users.*` foreign keys
  (`created_by`, `uploaded_by`, etc.) are bigint; everything else is UUID.

## How to run it locally (next session start-of-day)
```
cd /c/laragon/www/chandaktext/backend
"/c/laragon/bin/redis/redis-x64-5.0.14.1/redis-server.exe" "/c/laragon/bin/redis/redis-x64-5.0.14.1/redis.windows.conf" &   # if not already running
php artisan serve --port=8123 &
php artisan queue:work &
```
Super admin login for `/admin`: `admin@chandaktext.test` / `password`
(seeded by `database/seeders/SuperAdminSeeder.php`, override via
`SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_PASSWORD` in `.env`).

## Phase status

- [x] **Phase 0 — Foundation**: repo + git init, `.gitignore`, Laravel 12
      scaffold, MySQL configured, Sanctum/Filament/spatie-permission/
      smalot-pdfparser/fpdi-fpdf/razorpay-sdk/predis installed.
- [x] **Phase 1 — Accounts & tenancy**: register/login/logout/forgot-password/
      reset-password/verify-email/me/update-profile/delete-account all live
      and curl-tested. Organizations+Memberships+roles (owner/member).
      `ResolveOrganization` middleware (`X-Organization-Id` header) +
      Policies (Organization/Project/Document/Annotation/Excerpt/Note/
      WorkspaceItem/Link/Export) enforce tenant isolation — **verified**:
      cross-tenant project access → 403, cross-tenant search → 403,
      unauthenticated → 401.
- [x] **Phase 2 — PDF documents**: upload (size/mime/magic-byte validation +
      `EntitlementService` quota check) → private storage
      (`storage/app/private`, Laravel's default non-public disk) →
      `ProcessDocumentJob` (smalot/pdfparser text extraction) → `document_pages`
      rows + `page_count` + status `ready`/`failed`. **Verified end-to-end**
      with a hand-built minimal PDF via curl: upload → queued → processed →
      page text retrievable.
- [x] **Phase 3 — Annotations & excerpts**: full CRUD, normalized (0–1)
      `source_rects`/`payload` coordinates so zoom doesn't break alignment.
      Curl-tested.
- [x] **Phase 4 — Workspace**: `workspace_items` CRUD + a
      `POST .../workspace-items/batch` endpoint for the canvas autosave loop
      (upsert by id or by item_type+target_id). `links` CRUD with validated
      polymorphic references (rejects links to nonexistent excerpt/note).
      Curl-tested.
- [x] **Phase 5 — Search & export**: MySQL `FULLTEXT` search across
      `document_pages`/`excerpts`/`notes`, scoped to a project the caller can
      access. `GenerateExportJob` compiles notes+excerpts into a PDF via
      FPDF (**not** a page-accurate highlight overlay — see "Known
      simplifications" below). Curl-tested including download.
- [x] **Phase 6 — SaaS & admin (core)**: Plans (seeded Free/Pro from `.env`),
      `EntitlementService` (project/storage/doc-per-project quotas, row-locked
      against races), `usage_events`-ready schema, Subscriptions with
      `pending→active` lifecycle, `PaymentProvider` interface +
      `FakePaymentProvider`/`RazorpayPaymentProvider` drivers, webhook
      signature verification + `payment_events` idempotency (**curl-verified**:
      duplicate webhook event_id → "Already processed", no double-activation).
      Filament resources: Users (suspend/restore + audit), Organizations
      (suspend/restore + audit + usage columns), Plans (KeyValue limits
      editor), Subscriptions, Documents (metadata-only, no content exposed,
      read-only), AuditLogs (read-only), FeatureFlags. `AdminOverviewWidget`
      dashboard stats. Super-admin gate via `User::canAccessPanel()`.

## Phase 7 — Quality (testing): DONE for the backend API

Pest installed and wired to `chandaktext_test` (MySQL). **34/34 tests
passing** across: `AuthTest`, `ProjectTenancyTest`, `DocumentUploadTest`,
`AnnotationExcerptTest`, `WorkspaceLinkTest`, `SearchExportTest`,
`BillingTest`, `AdminSuspensionTest`, `OrganizationMembersTest`,
`Feature/Admin/FilamentPanelTest` —
covers BE-001 through BE-020 from docs/08.

**Two real bugs found and fixed while writing these tests** (both were
present in the actual app code, not just test mistakes):
1. `User` model's `$fillable` was missing `status`/`suspended_reason`/
   `suspended_at`/`is_super_admin` — so `->update(['status' => 'suspended'])`
   silently did nothing (mass-assignment protection), both in
   `AuthController` and in the Filament `UserResource` suspend action. Fixed
   by adding those fields to `$fillable`.
2. None in app code, but a **test-infrastructure gotcha worth remembering**:
   Sanctum's guard (`Illuminate\Auth\RequestGuard`) memoizes the resolved
   user on first authentication within a test, so a second simulated HTTP
   call using a *different* user's bearer token in the same test method
   silently keeps authenticating as the first user. Fixed by routing every
   test HTTP call through `apiGet/apiPost/apiPatch/apiDelete` wrapper
   functions in `tests/Pest.php`, which call `auth()->forgetGuards()` before
   every request. **Always use these wrappers in new tests, never
   `test()->getJson()` etc directly, whenever a test might authenticate as
   more than one user.**

**Known test-infra limitation (not an app bug)**: InnoDB only merges
FULLTEXT index changes into the searchable index at transaction COMMIT.
`RefreshDatabase` wraps every test in an uncommitted transaction, so a
freshly-inserted `document_pages`/`excerpts`/`notes` row is *never* visible
to `MATCH AGAINST` inside a test, regardless of row count. `SearchExportTest`
therefore only asserts on authorization (403 cross-tenant / 200 same-tenant),
not on the search actually finding the text — the real matching behavior was
separately confirmed working via curl against a real running server earlier
in this project.

## Phase 7.5 — Web frontend: core journey DONE, verified in a real browser

`web/` is React 19 + TS + Vite + Tailwind v4, API-only against the Laravel
backend (bearer token in `Authorization` + `X-Organization-Id` header, via
an axios client in `src/lib/api.ts`). Everything below was clicked through
in an actual Chrome tab (not just unit-tested) via the browser automation
tool, including a real uploaded PDF (not just the hand-built test fixture):
**register → create project → upload PDF → open PDF.js viewer → select text
→ save as excerpt → add a note → drag canvas cards → positions persist
across reload → export → download-ready PDF link appears.** This is the
single most important milestone so far - the whole spec's "core user
journey" (docs/01 section 1.7) now works front-to-back.

Files: `src/lib/api.ts` (axios + interceptors), `src/lib/queries.ts` (every
React Query hook for projects/documents/excerpts/notes/workspace-items/
links/exports/usage), `src/lib/pdf.ts` (pdfjs-dist worker setup),
`src/stores/auth.ts` (zustand, persisted), `src/types/api.ts`,
`src/components/ui.tsx` (Button/Input/Card/etc), `src/components/
{AppShell,ProtectedRoute,PdfViewer,WorkspaceCanvas}.tsx`, `src/pages/
{LoginPage,RegisterPage,DashboardPage,ProjectWorkspacePage}.tsx`, routing in
`App.tsx`/`main.tsx`.

**Real bugs found and fixed while testing this in the browser** (not just
frontend mistakes - two were backend bugs):
1. **Backend**: `DocumentController::index()`, `ExcerptController::index()`,
   `NoteController::index()` wrapped an already-paginated Eloquent
   paginator (which serializes as `{data, links, meta}`) in ANOTHER
   `['data' => ...]`, producing `{data: {data: [...], links, meta}}` -
   double-wrapped, inconsistent with `ProjectController::index()` which
   returns the paginator directly. Fixed by removing the extra wrap in all
   three; **every paginated list endpoint now has the same
   `{data: [...], links, meta}` shape.** If you add a new paginated index
   endpoint, match this, not a `['data' => ...]` wrap.
2. **Frontend**: PDF.js 6.x's URL-based loading path calls `URL.parse()`
   (a very new static method) and its worker message handling calls
   `Promise.try()` (same) - both threw `TypeError: ... is not a function`
   in the Chrome build used for testing. Fixed by (a) downgrading
   `pdfjs-dist` to `^4.8.69`, which doesn't need either API, and (b) loading
   the PDF via `getDocument({ data: new Uint8Array(arrayBuffer) })` instead
   of `getDocument({ url: objectBlobUrl })`, which avoids the URL-parsing
   code path entirely regardless of pdf.js version.
3. **Dev-env gotcha, not a code bug**: after changing `pdfjs-dist`'s version
   in `package.json`, the already-running `npm run dev` process kept
   serving the OLD pre-bundled dependency from its in-memory cache /
   `node_modules/.vite` - deleting that folder wasn't even enough on its
   own; the dev server process itself had to be killed and restarted
   before the browser picked up the new version. If a dependency version
   change doesn't seem to take effect, restart `npm run dev`, don't just
   clear the cache.
4. Minor: `useCreateProject`/`useUploadDocument` weren't invalidating the
   `['usage']` query, so the "X / Y projects" counter on the dashboard
   went stale after creating a project. Fixed (both now also invalidate
   `['usage']`).

**Not done yet in the web app**: theme toggle (dark is the only theme right
now), link-creation UX is minimal (double-click to enter "link mode", no
visual affordance for notes - only excerpts currently wired via
`onOpenExcerpt`), no annotation (highlight/comment) UI yet (only excerpt
creation from text selection), no account/billing/settings pages, no
responsive/mobile-width layout pass, no accessibility pass (docs/05 section
5.6 WCAG 2.2 AA target untouched), bundle isn't code-split (pdf.worker is
1.3MB, main bundle is ~690KB - fine for now, listed in build output as a
warning). FE-0xx test suite (Playwright or similar) not started.

## Phase 8 — Mobile app (`chandaktext_mob/`, Flutter): first pass DONE

Flutter 3.35.4 project created with `--org com.chandaktext`. Same API
approach as web (Dio + bearer token + X-Organization-Id header, see
`lib/api/api_client.dart`). Screens: Login, Register, Projects (list +
create + usage), Project detail (tabbed Documents/Excerpts/Notes + export),
PDF reader (`syncfusion_flutter_pdfviewer`, text selection → save excerpt).
`flutter analyze` clean, `flutter test` passes (1 widget smoke test).

Deliberately **list-based, not the drag canvas** the web app has — matches
docs/07 section 7.2's "Advanced canvas gestures... can be staged after the
first release". Mobile excerpt creation stores a full-page placeholder
`source_rects` entry rather than a DOM-selection-derived precise rect
(Syncfusion's free-tier selection API gives selected text + page number,
not per-character bounding rects the way a browser `Range` does) - a
documented simplification, not a crash/bug.

**Real bug found while wiring this up**: `file_picker` v11 removed the
`FilePicker.platform` static accessor used in older versions/tutorials —
it's `FilePicker.pickFiles(...)` directly now (an `abstract final class`
with static methods, no singleton instance). Fixed in
`project_detail_screen.dart`.

**Not yet done / untested**:
- `flutter run -d chrome` rendered Login/Register correctly but then hung
  on the register network call (web-only `flutter_secure_storage` quirk,
  not an Android/iOS issue - see below, this is now IN PROGRESS on a real
  emulator instead).
- Annotations (highlight/comment) UI, offline caching, account/billing
  screens, push notifications, accessibility pass, device test matrix
  (docs/07 section 7.5) - none of these started.
- Store submission prep (Phase 9: signed AAB, iOS archive, store listing
  assets, privacy policy, account deletion flow, billing-policy review) -
  not started; sensible to defer until Phase 8 is actually device-tested.

## PAUSED HERE — resume point (2026-10-21, session paused ~1hr at user's request)

Work since the mobile/emulator pause point below shifted to a **security
audit + bug-fix pass** driven by `CLAUDE_IMPLEMENTATION_BRIEF_RESEARCH_SAAS.md`
(root of the repo) — a 1022-line structured brief written against this
codebase: security findings (P0), functional bugs (P1/P2), UX (P3), future
features (P4), plus a Section 15 list of things that need the user's
decision before implementing.

**Fixed and tested this pass** (all have regression tests, full list in the
chat transcript / git log once committed):
- SEC-001 BOLA in Excerpt/Annotation/Note policies, SEC-002 upload loaded
  whole file into memory, SEC-005 `is_super_admin`/status mass-assignable,
  SEC-006 Sanctum tokens never expired.
- BUG-001 export download 401'd via `<a target=_blank>` (no auth header),
  BUG-002 PdfViewer annotation popup misaligned on scroll, BUG-003 deleting
  a document orphaned its excerpts/annotations (now soft-delete cascade +
  `app:purge-soft-deleted-documents` daily command, `DOCUMENT_RETENTION_DAYS`
  env, default 30), BUG-004 deleting excerpt/note left dangling workspace
  items/links, BUG-005 re-adding an org member didn't update their role,
  BUG-006 projects/documents/excerpts/notes lists silently capped at page 1
  (now `useInfiniteQuery` + "Load more" in `DashboardPage.tsx` and
  `ProjectWorkspacePage.tsx`).
- BE-007 search min-length now matches MySQL's actual
  `innodb_ft_min_token_size` (verified via `SHOW VARIABLES`, not assumed),
  BE-008 `.env.example` rewritten to match real env keys.

**Two judgment calls made without asking** (brief flagged both as
"Claude must clarify" — user has now been told, no objection yet):
1. Document retention: 30 days before permanent purge.
2. Membership roles: owner can freely set any member's role via the
   add-member endpoint; only guard is "can't demote/remove the last
   remaining owner" (409), mirroring the existing last-owner-removal rule.

**New finding, NOT fixed, needs a decision (BE-009)**: PDF export
(`backend/app/Jobs/GenerateExportJob.php`) uses FPDF's core Latin-1 fonts
and transliterates UTF-8 via `iconv(...//TRANSLIT)`. Degrades gracefully
for accented Latin text but **mangles any non-Latin script** (Devanagari/
Hindi, Chinese, Arabic, Cyrillic) into garbage/dropped characters. Real fix
needs a Unicode-capable PDF path (TTF-embedding FPDF variant or a different
library) + bundling a font — which languages to support is a product
decision, not made yet.

**Verification done before pausing**: `php vendor/bin/pest` from
`backend/` → 46 passed, 131 assertions, 0 failed. `npm run build` from
`web/` → clean TypeScript+Vite build. `npm run lint` (oxlint) and
`./vendor/bin/pint --test` both show only pre-existing issues in files this
batch never touched (not regressions).

**Still fully blocked, waiting on user answers (brief Section 15)** — do
NOT implement any of these without asking first: AI assistant features
(provider/privacy/budget), share-link scope (source PDF exposure,
password, expiry), citation format scope, PDF export overlay-vs-editable-
annotations, tags scope (org/project/user level), collaboration milestone
scope, mobile canvas-editing scope for first release.

**Next step on resume**: ask the user for Section 15 answers (or proceed
with more decision-free items from the brief if they're still thinking),
then resolve the Android emulator state below (was mid-build when
interrupted by this brief work — check `flutter devices` first, it may
have gone stale), then circle back to the earlier "wow factor" feature
discussion (AI assistant, share links, tags, highlight-overlay export,
citations) once Section 15 is answered.

**Uncommitted at time of writing** — check `git status`; this was about to
be committed as a checkpoint right before the pause.

---

## Earlier pause point (mobile emulator, superseded by the above — check if still relevant on resume)

**In progress, not yet confirmed working**: `flutter run -d emulator-5554`
against the `Pixel_10a` Android emulator (API 36, already created and
launched successfully - `flutter doctor --android-licenses` needed no
action, SDK licenses were already fine on this machine). The first Gradle
`assembleDebug` build was **still running** (several minutes in, `java.exe`
processes active = genuinely working, not stuck - first builds with
syncfusion/file_picker/secure_storage native deps are slow) when the
session was paused. **Next step on resume**: check on this build
(`flutter devices` to confirm `emulator-5554` is still up, re-run `flutter
run -d emulator-5554` from `chandaktext_mob/` if the process died) and
actually click through register→login→create project→upload→PDF
view→excerpt on the real emulator before trusting the mobile app works.
This is the single most important unverified thing right now.

Also done just before pausing (uncommitted at time of writing, check `git
status` on resume):
- `docs/openapi.yaml` - hand-written OpenAPI 3.0 spec, 35 paths, validated
  as parseable YAML. Not auto-generated; keep in sync by hand.
- Generalized the web app's link-mode UI: `WorkspaceCanvas`'s
  `onOpenExcerpt` (excerpt-only) became `onOpenCard` (excerpt OR note), so
  notes can now be either end of a link, not just excerpts. Rebuilt clean.
- `backend/README.md` replaced (was the Laravel-skeleton default) with
  actual project-specific setup/test instructions.
- `tests/Feature/Api/OrganizationMembersTest.php` - 4 new passing tests
  (owner adds member, adding an unregistered email is rejected, a non-owner
  can't add members, removing the last owner is rejected with 409).
- Full Pest suite was mid-run (one more time, to confirm nothing broke)
  when paused - **re-run `php vendor/bin/pest` from `backend/` on resume
  and confirm it's still all green before doing anything else.**

## Not started yet
- Non-API Phase 7 items: observability/monitoring, backup/restore drill,
  deployment checklist (docs/09), mobile device test matrix, smoke-test
  checklist automation.
- Phase 9 — Store submission prep (see Phase 8 note above for why it's
  blocked on real-device testing first).

## Known simplifications (intentional, documented, revisit if asked)
- Export is a compiled "notes + excerpts" PDF, not a highlight overlay
  stamped onto the original PDF pages (would need FPDI page-by-page
  stamping using the stored normalized rects — straightforward follow-up,
  just scoped out of the first pass).
- DOCX export returns a clear "not implemented" failure instead of
  attempting anything (per docs/01: "Offer DOCX export only after a
  suitable library and formatting scope are selected").
- Document/export downloads are plain authenticated API endpoints
  (`auth:sanctum` + policy re-check), not signed temporary URLs — chosen
  because both the web app and the Flutter app always attach a bearer token
  anyway, and it avoids a second auth mechanism. Documented as a deliberate
  reading of "short-lived signed URLs" vs. "authorized API" being
  equally valid per the architecture doc.
- Validation is inline in controllers (`$request->validate([...])`), not
  separate `FormRequest` classes, to move faster across ~13 controllers.
  Authorization is still always via Policies (`$this->authorize(...)`).
- Thumbnail generation (docs mention it) is not implemented — `page_count`
  and status are tracked but no image thumbnails are generated yet.

## Key files to re-read when resuming
- `backend/routes/api/v1.php` — the full route map.
- `backend/app/Services/EntitlementService.php` — all quota logic.
- `backend/app/Services/Billing/*` — payment provider abstraction.
- `backend/app/Http/Middleware/ResolveOrganization.php` — tenant context.
- `backend/app/Policies/Concerns/AuthorizesProjectAccess.php` — shared
  authorization logic every project-scoped policy uses.
- `backend/tests/Pest.php` — `registerUser()` / `minimalPdfBytes()` test helpers.
