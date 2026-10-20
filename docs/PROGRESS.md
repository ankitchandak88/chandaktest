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

## Right now / IN PROGRESS

**Phase 7 — Quality**: setting up Pest (installed, `tests/Pest.php` +
`tests/TestCase.php` configured to migrate+seed `chandaktext_test` per test
via `RefreshDatabase`). `tests/Feature/Api/AuthTest.php` and
`ProjectTenancyTest.php` written (8/9 passing).

**Open bug to fix next**: `AuthTest > a suspended user cannot log in` fails —
expects 422, got 200. The suspended check in
`AuthController::login()` (`app/Http/Controllers/Api/V1/AuthController.php`)
looks correct by inspection; root cause not yet found. Was mid-investigation
(checking whether `$user->update(['status' => 'suspended'])` in the test
actually persists before the HTTP sub-request reads it — a tinker check
against `chandaktext_test` showed 0 users, which needs explaining: either the
tinker connection didn't point at the test DB correctly, or there's a dirty
read issue). **Next step**: add a temporary `dd($user->fresh()->status)`
right before the `isSuspended()` check, or dump the actual JSON body in the
test (`dump($response->json())`) instead of only asserting status, to see
the real failure reason before touching any logic.

## Not started yet
- Remaining Pest coverage for BE-006 through BE-020 (upload validation,
  annotation ownership, link-to-nonexistent-object, search isolation,
  duplicate/invalid webhook signature — webhook ones are already manually
  curl-verified but need a real automated test), FE-0xx, mobile tests,
  smoke-test checklist automation.
- OpenAPI spec generation (docs/04 section 4.7).
- Observability/monitoring, backup/restore drill, deployment checklist
  (docs/09) — all deferred to near the end, per the roadmap.
- **Web frontend** (`web/` — React+TS+Vite+Tailwind+shadcn+PDF.js+canvas
  library): not started.
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
