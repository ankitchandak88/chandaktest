# ChandakText — Build Progress

Resume point for future sessions. **Read this file first** before continuing.
Update it after every phase / every meaningful breakpoint.

## BREAKPOINT (2026-10-22) — Annotation/drawing engine: Phases 1-4(partial) built + code-reviewed, ALL pending live verification

User compared real LiquidText screenshots against the app and found a real
gap: the backend has a complete `annotations` API (highlight/underline/
comment/ink types) that **neither frontend ever used** - this was always in
original scope (`Research_SaaS_MVP_Markdown_Docs/07-mobile-apps-store-
release.md` §7.2), just never built. Full plan at
`C:\Users\Prem\.claude\plans\sparkling-wobbling-aurora.md` (approved) -
read it before continuing this work. User's explicit bar: "better than
LiquidText, 100x, no compromise on design or functionality" - treat the
plan's mandatory final cross-verification table as the actual finish line,
not "it compiles."

**Phase 1 — DONE, committed (`d141710`)**: real highlight/underline/comment
annotations, both platforms.
- Web: `PdfViewer.tsx` now has Highlight/Underline buttons in the selection
  popup + a Comment pin tool, rendering a live SVG overlay fed by the
  previously-unused `useAnnotations` hook. New `useDeleteAnnotation`.
- Mobile: discovered `syncfusion_flutter_pdfviewer` has a **complete
  built-in native annotation system** (`HighlightAnnotation`/
  `UnderlineAnnotation`/`StickyNoteAnnotation`, `addAnnotation`/
  `removeAnnotation`/`onAnnotationSelected`) that was simply never used -
  used that instead of hand-rolling rect math. `getSelectedTextLines()`
  gives real per-line bounds (PDF point-space); normalized to the same 0-1
  convention as web via a `syncfusion_flutter_pdf` `PdfDocument` parsed
  from the same bytes. Mobile excerpts also got real rects as a side
  effect (the old full-page placeholder is gone).
- New `Annotation` model + 3 API methods on mobile (none existed before).
- Verified: backend 109 tests passed (3 new); web `npm run build`+`oxlint`
  clean; mobile `flutter analyze`/`flutter test` clean, debug APK builds
  for both x86_64 and arm64; backend contract double-checked directly via
  curl (create/list/delete, all 3 types) since the Chrome browser tool is
  not connecting in this environment (tried repeatedly, consistent
  failure - likely an environment limitation, not a user-side toggle).
  **Live on-device visual check still pending** - user's phone disconnected
  for the night; do this first on resume if it's not done yet (reconnect
  via USB, `adb reverse tcp:8123 tcp:8123`, install the already-built
  `chandaktext_mob/build/app/outputs/flutter-apk/app-debug.apk`).

**Phase 2 — DONE, committed (`b957f61`)**: real pen/highlighter/eraser/lasso
drawing engine, both platforms. One `Annotation` row (`type='ink'`) per
stroke - `payload = {points: [[x,y,pressure],...], size, tool}`, identical
shape on both platforms.
- Web: `perfect-freehand` renders strokes as SVG paths (new
  `web/src/lib/freehand.ts` helper). Eraser hit-tests live against
  ink points/highlight rects while dragging. Lasso does point-in-polygon
  against each annotation's anchor, shows a "N selected · Delete" bar.
- Mobile: `perfect_freehand` (Dart port, same algorithm as web) renders via
  a new `CustomPainter` overlay - Syncfusion's native annotation system
  (used for Phase 1's highlight/underline/comment) has no ink/freehand
  type. Syncfusion's viewer has no public API for a page's on-screen rect
  during continuous scroll, so drawing mode forces
  `PdfPageLayoutMode.single` (fits the whole page in the viewport, no
  scroll overflow) and maps touches via a fit-within-viewport calculation
  against the page's real point-size.
- Verified: backend 110 tests passed (1 new); web build/lint clean; mobile
  `flutter analyze`/`flutter test` clean, arm64 debug APK builds.
  **⚠️ NOT YET LIVE-VERIFIED**: the mobile touch→page-coordinate mapping
  for drawing (`_pageRectInViewport`/`_localToNormalized` in
  `pdf_reader_screen.dart`) has never been tested on a real device - phone
  was disconnected the entire time this phase was built. **This is the
  single highest-priority thing to check the moment the phone reconnects**
  - draw a pen stroke, confirm it visually lands under your finger, not
  offset. If it's off, the fix is isolated to those two functions.

**Phase 3 (partial) — DONE, committed (`573c48d`)**: Outline (PDF's own
bookmark/TOC tree - web via pdf.js `getOutline()`/`getDestination()`/
`getPageIndex()`, mobile via the lower-level `PdfDocument.bookmarks` +
`pages.indexOf(destination.page)`) and HiLiteView (filtered list of
highlight annotations using their already-captured `text`, no new
backend). Both read-only, zero backend changes, zero coordinate-math risk
- deliberately chosen to keep building on **verifiable-later** ground
while the phone's offline, rather than stacking more unverified frontend
surface area on top of Phases 1-2's pending verification. NOT done from
Phase 3: the actual Drawing/Document/Workspace mode-tab restructuring
(Outline/HiLiteView were added as toggleable additions to the existing
toolbar, not a reorganization into three tabs) - revisit once Phases 1-2
are confirmed working, since the mode-tab UI shell is cheap to build but
pointless to polish before confirming the underlying tools work.

**Verification status going into Phase 4**: everything above (Phases
1-3) is implemented, passes every automated check available in this
environment (backend Pest tests, web build+lint, mobile analyze+test,
backend contract checked directly via curl), but **nothing has been
visually confirmed on a real device or in a real browser** - the Chrome
browser tool won't connect in this environment (tried repeatedly all
session) and the user's phone has been disconnected the entire time
Phases 1-3 were built. This is real, accumulated verification debt.

**Decision**: rather than keep building more frontend surface area on
unverified ground, pivoting to the one remaining Phase 4 item that's
**backend-only and fully self-verifiable without a browser or phone**:
baking annotations into the PDF export (extending
`PdfHighlightOverlayGenerator`, same pattern as the existing excerpt-rect
stamping) - this can be proven with Pest tests + generating a real export
and inspecting the PDF directly, exactly like BE-009/Phase 12 was earlier
this session.

**Phase 4 (partial) — DONE, committed (`92b9a6a`)**: annotations
(highlight/underline/ink/comment) now get stamped onto the
`pdf_highlights` export too (new `Project::annotations()` relation,
`PdfHighlightOverlayGenerator::drawAnnotation()`). Fully verified, not
just build-clean: new Pest test + a real generated export visually
inspected (via the Read tool's native PDF rendering) with all 4
annotation types on the real smoke-test document - yellow highlight
outline, blue underline, red ink line path, pink comment marker, all
correctly positioned. This is the template for "actually verify it," not
"it compiles" - same bar needed for everything still pending below.

**Real bug found and fixed via code review (`a8c5f24`), while phone was
still offline**: rather than keep stacking unverified frontend work,
re-read `syncfusion_flutter_pdfviewer`'s own source carefully and found
the mobile drawing coordinate math (`_pageRectInViewport` in
`pdf_reader_screen.dart`) had a wrong assumption - `PdfPageLayoutMode
.single` fits the page to the viewport's **width only** at zoom=1.0 (confirmed:
`zoomLevel` is hard-floored at 1.0, `greyAreaSize` is computed purely
from height), not "whole page visible, centered both axes" as originally
assumed. Fixed the formula and added a `jumpToPage` reset on entering any
drawing tool to establish the top-aligned state the math now assumes.
This is a genuine improvement, but **does not replace live verification**
- it increases confidence, it isn't proof.

**Independent `/code-review high` pass (commits `ba9aee7..e2950e8`,
covering Phase 14's Sentry/ops work through Phase 4's export-baking) -
10 findings, all CONFIRMED by a verifier reading actual post-diff file
content, all fixed and committed**:
1. **Most severe**: mobile ink strokes were only ever painted by the
   CustomPaint overlay, mounted exclusively while a drawing tool was
   active - switching to "Select" to just read made every pen/
   highlighter stroke disappear from view (still saved, just not
   shown). Fixed (`c36498f`) by forcing single-page layout mode at all
   times and always mounting the ink overlay, gating only the pointer-
   capture gesture detector behind an active tool.
2. Mobile drawing coordinates ignored `zoomLevel` entirely - fixed
   (`c36498f`), folded into the fit-scale, zoom reset to 1.0 alongside
   the existing scroll reset when entering a drawing tool.
3. Pen tool defaulted to a near-white color on both platforms,
   effectively invisible on first use - fixed (`71d6242`, `c36498f`).
4. `BackupRestoreDrill` crashed on a dropped/renamed table and never
   checked `ZipArchive::open()`'s return value - fixed (`a70c147`),
   re-verified for real against the live database afterward.
5. Export-time malformed ink points crashed the whole export; colorless
   annotations always stamped in highlight-amber regardless of type -
   both fixed (`bca296b`) with new regression tests + a manual visual
   check.
6. Mobile's optimistic annotation delete had no rollback on failure -
   fixed (`c36498f`) by re-syncing from the server instead.
7. Eraser hit-testing (both platforms) only checked distance to stored
   sample points, not the segments between them, missing fast/sparse
   strokes - fixed (`71d6242`, `c36498f`) with a proper point-to-segment
   distance check.
8. Both platforms recomputed every existing ink stroke's path on every
   drag frame instead of just the active one - fixed (`71d6242` via a
   memoized per-stroke sub-component, `c36498f` via a State-owned path
   cache).

Full backend suite: 113 passed. Web build/lint clean. Mobile analyze/
test clean, arm64 debug APK builds. **None of this replaces live device
verification** - it closes real gaps found by careful review, but the
phone still hasn't reconnected this entire session.

**Next on resume, in this order**: 1) **Live-verify Phases 1-4 on the
real device the moment it reconnects** - this is still the single
highest-priority item, don't let it keep sliding. Both the mobile
drawing coordinate mapping and today's 10 code-review fixes have been
corrected via review/static analysis but are still unconfirmed on real
hardware - check them first. 2) Finish Phase 4's remaining frontend-
dependent items (undo/redo, AI summarize via `AiAssistantService`) only
after verification, not before. 3) The Drawing/Document/Workspace
mode-tab restructuring. 4) The plan's mandatory final cross-verification
table - do not consider this done until every row is actually re-tested
live, per the user's explicit "zero bugs, no compromise" bar.

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

## MILESTONE (2026-10-21, later same day) — all 7 "wow factor" phases shipped

After the security-audit batch below, the user asked for the full
feature wishlist from `CLAUDE_IMPLEMENTATION_BRIEF_RESEARCH_SAAS.md`
Section 15 (previously blocked pending their answers - answers came
in, then "continue work, sab go hai"). All 7 phases are now done,
tested, and committed (backend Pest suite: 94 passed; web
build/lint clean; mobile flutter analyze/test clean):

1. **Mobile review + smoke test** - found and fixed: stale
   processing-status/project-counts (no refetch), missing pagination
   ("Load more") on all 4 list endpoints, 401 not forcing re-login.
2. **Tags** (`b882d4c`... `d62183d`) - project-scoped, multi-tag,
   `taggables` pivot (same typed-pair pattern as links/workspace_items).
   Web: chips + picker on every canvas card. Mobile: display only.
3. **Citations** (`589529b`) - `CitationFormatter` service (APA/MLA),
   cached per-document, new PATCH /documents/{id} endpoint. Web:
   CitationEditor on each document card.
4. **Share links** (`08d20fc`) - password-optional, bounded-expiry
   (SHARE_LINK_DEFAULT_DAYS/MAX_DAYS), public read-only
   notes+excerpts view, never the source PDF. Web: ShareManager +
   public /share/:token route.
5. **PDF export overlay** (`91a850d`) - new 'pdf_highlights' export
   format stamps excerpt regions as outlined rects onto the actual
   source PDF pages via FPDI (no alpha/fill - plain FPDF has no
   transparency support without injecting raw PDF graphics state).
6. **AI assistant** (`570fe42`) - `AiProvider` interface, same
   config-driven-driver pattern as `PaymentProvider`
   (AI_PROVIDER=fake/openai/anthropic). Summarize (cached), chat
   (stateless), tag suggestions (suggest-only, never auto-applies).
   Real providers wired against each API's actual contract and
   verified with Http::fake(), never against a live key.
7. **Mobile canvas editing** (`d080ba5`) - 4th "Canvas" tab:
   drag-to-reposition, tap-to-link, same workspace-items/batch
   endpoint as web. Found mid-build that saving an excerpt/note on
   mobile never created a workspace_item (so it could never appear on
   any canvas, web's included) - fixed. Also found and fixed a real
   Flutter gesture-arena conflict (ancestor scroll views were eating
   card drag gestures) by switching to LongPressDraggable.

**Not done / explicitly deferred, not forgotten:**
- Mobile UI for tags-management, citations, share-links, AI assistant
  - the APIs are all ready, only the web app has UI for them so far.
- DOCX export still unimplemented (per the PRD, deferred until a
  library/format is chosen).
- Real OpenAI/Anthropic keys have never been tested live - only
  Http::fake()-verified request/response handling.
- PDF export highlights are outline-only (no translucent fill) - see
  PdfHighlightOverlayGenerator's doc comment for why.

**Judgment calls made without being asked first** (flagged to the user
in-session): 30-day document retention before permanent purge;
owner-can-set-any-role-but-can't-demote-the-last-owner; share links
default to 7-day expiry, 90-day cap; AI assistant defaults to a
deterministic 'fake' provider until an admin sets a real one.

## PAUSED HERE — resume point (2026-10-21, later same day — supersedes the
## "PAUSED HERE" section below; that one's history, not current state)

Since the MILESTONE entry above, the "not done / explicitly deferred" list
from that milestone got fully worked through as **Phases 8–13** (mobile UI
for the 7 wow-factor features + the two deferred items), all done, tested,
and committed:

- **Phase 8 — Mobile tags UI**: tag chips/picker on canvas cards, AI
  "Suggest" button (accepts a suggestion → creates-if-needed + assigns in
  one action). **Live-verified on-device** this session (not just
  `flutter analyze`): suggested "Testing" tag, accepted it, confirmed it
  persisted to the real DB and re-rendered on the card.
- **Phase 9 — Mobile citations UI**: `CitationEditor` widget on the
  document card. **Live-verified**: edited the URL field, saved, APA/MLA
  text updated live with the new citation.
- **Phase 10 — Mobile share-links UI**: `ShareManager` bottom sheet
  (create/list/revoke). **Live-verified**: created a link (list refreshed
  with the real expiry date), revoked it (list emptied back to "No active
  share links").
- **Phase 11 — Mobile AI assistant UI**: `AiDocumentPanel` (summarize +
  chat) wired into the document card. **Live-verified**: sent a real chat
  message through the live API, got back the expected `FakeAiProvider`
  canned response.
- **Phase 12 — BE-009 fix (non-Latin PDF export)**: replaced the old FPDF
  `iconv(...//TRANSLIT)` path with `HtmlToPdfRenderer` (mPDF,
  `autoScriptToLang`/`autoLangToFont`) for both the compiled 'pdf' export
  and the `pdf_highlights` notes-summary appendix. **Verified three ways**:
  automated text-extraction tests (conjunct-free Hindi, CJK, Cyrillic exact
  round-trip; Arabic script-presence check — PDF ToUnicode CMaps don't
  reliably round-trip conjuncts/contextual shaping even when rendering is
  correct, so tests are scoped to what extraction can honestly prove), an
  end-to-end API test, and a **manual visual PDF inspection** (via Claude's
  native PDF reading) confirming conjunct Hindi, Arabic, and Chinese all
  render as correct, readable script.
- **Phase 13 — DOCX export**: `DocxExportGenerator` (PHPWord, built
  directly against its section/text API rather than reusing the Blade/mPDF
  HTML pipeline — PHPWord's HTML importer doesn't understand mPDF-specific
  tags like `<pagebreak />`). Same content scope as the 'pdf' format; no
  `pdf_highlights`-equivalent (doesn't carry over to a text document). Also
  fixed two latent bugs this surfaced: both the backend download endpoint
  and the web download handler hardcoded a `.pdf` filename regardless of
  actual format. **Verified**: unit tests against the real docx XML (zip
  archive — PHPWord could silently produce something empty/corrupt), an
  end-to-end API test, and a **live manual run through the web UI**
  (selected DOCX in the export dropdown, downloaded, inspected
  `word/document.xml` directly).

**One real environment bug found and fixed along the way (not app code)**:
an orphaned `php artisan queue:work` process from a much earlier session
was still alive in the background with stale in-memory code, silently
racing the current worker and serving old job results (surfaced as DOCX
exports failing with the old "not implemented" message even after the fix
was deployed). Killed it; only the current worker should be running —
if exports ever seem to run "old" code again, check
`Get-CimInstance Win32_Process -Filter "Name='php.exe'"` for duplicate
`queue:work` processes before assuming it's a code bug.

Full backend suite after Phase 13: **101 passed (268 assertions)**. Web
`tsc --noEmit`: clean.

### Phases 14–18 (ops/release-prep) — ALL DONE, committed, cross-verified

User asked for these to be phased too, after confirming testing/smoke-test
status. **Decisions locked in** (so don't re-ask):
- Phase 14 error tracking: **Sentry**. Phase 18 target stores: **both
  Google Play and Apple App Store** (iOS prep is documentation-only — no
  Mac/Xcode on this machine).
- Phase 15 backup destination: **local disk only** for now (no production
  hosting/cloud bucket decided yet).

**Phase 14 — done, committed**: `sentry/sentry-laravel` wired via
`Integration::handles()` in `bootstrap/app.php`, config-driven through
`SENTRY_LARAVEL_DSN` (same works-with-no-key pattern as `AI_PROVIDER`).
New `AssignRequestId` middleware gives every request one id, consistent
across the error JSON body, `X-Request-Id` header, log `Context`, and
Sentry's tagged scope (+ organization_id/user id once
`ResolveOrganization` has run). New `CheckApplicationHealth` listener
makes `/up` actually check DB/queue/storage reachability instead of just
proving the app booted — the framework's default `/up` dispatches
`DiagnosingHealth` but has nothing listening by default. Verified: tests
for both the healthy path and a deliberately-unreachable DB (exercised
the listener directly, not through HTTP, to avoid breaking the test's own
`RefreshDatabase` transaction teardown), plus a live curl against the
running dev server.

**Phase 15 — done, committed**: `spatie/laravel-backup`, DB dump +
`storage/app` (not application code — already in git). New `backups`
filesystem disk and a relocated `temporary_directory`, both deliberately
outside `storage/app` — a real self-referencing-backup bug was found and
fixed here (destination/temp dir living inside the thing being backed up
means each run tries to include the previous run's own zip). New `php
artisan backup:restore-drill` command actually restores the latest
backup's DB dump into a throwaway scratch database and compares every
table's row count against live data — run for real on this machine,
passed, output captured in `docs/backup-restore.md`. `mysqldump`/`mysql`
aren't on this Laragon install's PATH — binary directory comes from the
new `MYSQLDUMP_BINARY_PATH` env var. Scheduled daily (`backup:run` 02:00,
`backup:clean` 02:30, `routes/console.php`). Full suite: 106 passed.

**Phases 16–18 — dispatched to 3 parallel fork agents** (user asked to
speed this up), each scoped to its own files only, none committing. All
three reported back, were reviewed (spot-checked their factual claims
against the real codebase before trusting them — e.g. the migration
rollback warning, the `VITE_API_URL` fallback, the min/target SDK values
— all confirmed accurate), then committed:

- **Phase 16** (`docs/09-deployment.md` + `deploy/supervisor-queue-worker.conf`
  + `web/.env.example`, which didn't exist before): env var checklist,
  first-deploy steps, queue worker + scheduler setup (both required —
  nothing runs itself), web build/serve, storage/reverse-proxy notes,
  `/up` as the LB health check, a rollback section flagging one migration
  (`..._add_pdf_highlights_format_to_exports_table.php`) that isn't safely
  reversible once `pdf_highlights` export rows exist.
- **Phase 17** (`docs/mobile-test-matrix.md`): real API-level/screen-size
  matrix grounded in the app's actual declared SDK range (`minSdk=24`,
  `targetSdk=36`, iOS deployment target 13.0 — checked against source).
  Attempted a second emulator config (API 37.2-beta3); found and fixed two
  real local environment issues (missing AVD registration `.ini`, a stale
  `hardware-qemu.ini.lock`) but the emulator itself never left `adb`'s
  `offline` state after 9+ minutes — stopped per the "don't fight
  instability indefinitely" judgment call, confirmed cleanly shut down.
  iOS flagged as needing Mac/Xcode access.
- **Phase 18** (`docs/app-store-submission.md` + `docs/privacy-policy-draft.md`):
  icon/screenshot requirements for both stores, a grounded store listing
  draft, a privacy policy draft (flagging the AI-provider third-party data
  sharing specifically, conditional on a real provider being configured),
  a Play Data Safety table. **Two real gaps found and flagged** (not
  fixed — documentation phase): release builds currently sign with the
  **debug keystore** (no release keystore/`key.properties` exists), and no
  custom app icon or screenshots exist anywhere in the repo — both block
  either store submission regardless of code readiness.

**Cross-verification + smoke test pass** (explicitly requested before the
user went to sleep), done after all five phases landed:
- Backend: full suite **106 passed**.
- Web: found and fixed a **real build-breaking bug** that plain
  `tsc --noEmit` had missed (likely stale incremental build info) but
  `npm run build` (`tsc -b`) caught correctly — `useStartExport`'s
  parameter type hadn't been widened to include `'docx'` when Phase 13
  added that format. Fixed, `npm run build` now clean; `oxlint` shows only
  pre-existing warnings in files untouched this session.
- Mobile: `flutter analyze` clean, `flutter test` passes.
- **Real physical device verification** (new, beyond the emulator): user
  connected their own phone (OnePlus CPH2491, Android 16/API 36,
  1240×2772 @560dpi) over USB. Rebuilt the debug APK for `android-arm64`
  (existing one was x86_64-only), worked around an OEM ADB-install
  verification block, and confirmed login + project list + document view
  render correctly and fetch real data from the live backend with no
  crashes. Found and documented a real gotcha for this: the app's
  `network_security_config.xml` only allowlists cleartext HTTP to
  `10.0.2.2` and the literal string `localhost` — NOT the `127.0.0.1` IP
  literal, which Android silently blocks on API 28+ even though it's the
  same host. Restored the device's security settings afterward.

**Everything from Phases 1–18 is now implemented, tested, and committed.**
No open threads left from this session. Next session should read this
file top-to-bottom before doing anything, per the file's own instruction
at the top, but there is no specific "resume task" queued — check with
the user for what's next (Phase 13's DOCX library choice is resolved;
the Phase 18-flagged release-blockers — debug-keystore signing, missing
app icon/screenshots — are real work items whenever a store submission is
actually imminent, not urgent now).

---

## PAUSED HERE — resume point (2026-10-21, session paused ~1hr at user's request) — HISTORY, superseded by the section above

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
