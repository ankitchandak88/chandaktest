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
- Web: React + TS + Vite + Tailwind at `web/` — **not started yet**.
- Mobile: Flutter at `chandaktext_mob/` (Flutter 3.35.4 at `C:\dev\flutter`) —
  **not started yet**.
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

Pest installed and wired to `chandaktext_test` (MySQL). **30/30 tests
passing** across: `AuthTest`, `ProjectTenancyTest`, `DocumentUploadTest`,
`AnnotationExcerptTest`, `WorkspaceLinkTest`, `SearchExportTest`,
`BillingTest`, `AdminSuspensionTest`, `Feature/Admin/FilamentPanelTest` —
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

## Not started yet
- Non-API Phase 7 items: OpenAPI spec generation (docs/04 section 4.7),
  observability/monitoring, backup/restore drill, deployment checklist
  (docs/09), FE-0xx tests (need the web app to exist first), mobile tests,
  smoke-test checklist automation. These can wait until web/mobile exist.
- **Web frontend** (`web/` — React 19 + TS + Vite + Tailwind v4): scaffolded
  and in progress. Done so far: Vite+React+TS+Tailwind v4 project created,
  deps installed (react-router-dom, @tanstack/react-query, axios, zustand,
  react-hook-form+zod, pdfjs-dist, clsx/tailwind-merge/lucide-react).
  `src/lib/api.ts` (axios client with auto bearer token + X-Organization-Id
  header injection + 401-logout interceptor), `src/stores/auth.ts` (zustand,
  persisted to localStorage), `src/types/api.ts` (all API response shapes),
  `src/lib/pdf.ts` (pdfjs-dist worker setup), `src/components/ui.tsx`
  (Button/Input/Card/Label/FieldError/EmptyState/Spinner primitives),
  `src/pages/LoginPage.tsx` + `RegisterPage.tsx` done. **Next**: router setup
  in `App.tsx`/`main.tsx`, Dashboard (project list+create+usage), then the
  project workspace page (document upload, PDF.js viewer with text
  selection → excerpt, notes, canvas, export trigger).
- **Mobile app** (`chandaktext_mob/` — Flutter): not started. Folder name
  confirmed by user: `chandaktext_mob`, sibling of `backend/` and `web/`.

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
