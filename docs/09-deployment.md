# Deployment checklist (Phase 16)

Covers the Laravel 12 API (`backend/`) and the React/Vite web app (`web/`).
Mobile store submission is out of scope here — see Phase 18 for that.
Local dev today runs on Windows/Laragon; this checklist assumes a Linux
production host, the realistic target even though nothing here has been
run against one yet (flag that honestly rather than pretending it has).

## 0. Prerequisites on the server

- PHP 8.2+ (matches `composer.json`'s `"php": "^8.2"`) with extensions:
  `pdo_mysql`, `zip` (FPDI/PHPWord/spatie-backup all need it), `gd` or
  `imagick` (mPDF image handling), `mbstring`, `xml`, `curl`, `fileinfo`.
  `ext-redis` is NOT required — this app uses `predis/predis` (pure PHP
  client) instead, see `docs/PROGRESS.md`.
- MySQL 8.x (not PostgreSQL/SQLite — `FULLTEXT` search and a raw
  `ALTER TABLE ... ADD FULLTEXT` migration are MySQL-specific).
- Redis (queue + cache backend in production — `QUEUE_CONNECTION=redis`
  is the `.env.example` default; `sync` is only for tests).
- `mysqldump`/`mysql` client binaries reachable — either on `PATH`, or set
  `MYSQLDUMP_BINARY_PATH` (see `docs/backup-restore.md`, Phase 15).
- Node 20+ / npm, for building `web/` and `backend/`'s own Vite assets.
- A process supervisor (systemd or supervisord) and cron — both are
  required for this app to actually run correctly in the background; see
  §3 below. Nothing here is optional "nice to have" ops polish.

## 1. Required environment variables

Pulled from `backend/.env.example` — copy it to `.env` and go through
every section below. **Bold** = must be changed from the example/default
before going to production; everything else is a safe default or
genuinely optional.

**Core app**
- `APP_ENV=production` (not `local`)
- **`APP_DEBUG=false`** — `local`'s default is `true`, which would leak
  stack traces (see `bootstrap/app.php`'s exception renderer, which
  branches on `app()->hasDebugModeEnabled()`)
- **`APP_KEY`** — generate fresh per environment: `php artisan key:generate`
  (never copy a key between environments)
- **`APP_URL`** — the real public URL. Used to build absolute links
  (password reset emails) and matters for `TrustProxies`/proxy headers,
  see §5.
- `LOG_LEVEL=debug` is fine to leave for now since nothing here ships to
  a log aggregator yet; tighten to `warning`/`error` if log volume becomes
  a cost concern.

**Database**
- `DB_HOST` / `DB_PORT` / **`DB_DATABASE`** / **`DB_USERNAME`** /
  **`DB_PASSWORD`** — real production credentials, obviously not `root`/
  blank password like local dev.

**Queue / cache**
- `QUEUE_CONNECTION=redis`, `CACHE_STORE` — point `REDIS_HOST`/
  `REDIS_PORT`/**`REDIS_PASSWORD`** at the real Redis instance.
  `REDIS_CLIENT=phpredis` is fine if the server has `ext-redis`; this repo
  defaults local dev to `predis` only because the dev machine doesn't
  have that extension — use whichever is actually installed.

**Mail**
- `MAIL_MAILER=log` is a dev-only stand-in (writes to the log file
  instead of sending). **Set a real mailer** (`smtp`, `ses`, etc.) and its
  credentials before relying on password-reset emails in production.

**Storage**
- `FILESYSTEM_DISK=local` is fine to keep — Phase 15's backup setup
  already assumes `storage/app` is where uploads/exports live. If this
  ever moves to S3, note that Phase 15's backup `files` source
  (`config/backup.php`) and the dedicated `backups` disk would both need
  revisiting, not just this one var.

**Frontend linkage**
- **`FRONTEND_URL`** — the real web app origin (used in password reset
  links and anywhere else the backend needs to link back to the SPA).
- `SANCTUM_STATEFUL_DOMAINS` — harmless to leave as-is; this app is pure
  bearer-token auth for both web and mobile, this var is unused in
  practice (kept only because Sanctum's own config reads it).
- `SANCTUM_TOKEN_EXPIRATION_MINUTES=43200` (30 days) — a product decision,
  not a security default to blindly change; revisit only if asked.

**Payments** (`docs/06`)
- `PAYMENT_PROVIDER=fake` is safe to leave until real payments are wanted.
  **If turning on Razorpay**: set `PAYMENT_PROVIDER=razorpay` and the real
  **`RAZORPAY_KEY_ID`**/**`RAZORPAY_KEY_SECRET`**/**`RAZORPAY_WEBHOOK_SECRET`**.
  `FAKE_PAYMENTS_WEBHOOK_SECRET` only matters while the fake provider is
  active.

**Super admin seed**
- **`SUPER_ADMIN_EMAIL`** / **`SUPER_ADMIN_PASSWORD`** — change both from
  the example (`admin@chandaktext.test` / `password`) before running
  `db:seed` in production. `SuperAdminSeeder` uses `updateOrCreate()`, so
  re-running it later (e.g. to rotate the password) is safe and won't
  duplicate the account.

**Plan limits** (`PLAN_FREE_*`, `PLAN_PRO_*`) — safe defaults; also
editable afterward from the Filament admin panel, so getting them
slightly wrong at deploy time isn't a one-way door.

**Export/retention/share-link config** (`EXPORT_LINK_TTL_MINUTES`,
`DOCUMENT_RETENTION_DAYS`, `SHARE_LINK_DEFAULT_DAYS`, `SHARE_LINK_MAX_DAYS`)
— product decisions already made earlier in this project; safe to keep
unless the user asks to change them.

**AI assistant** (Phase: Section 15 answers)
- `AI_PROVIDER=fake` needs no key and is safe to ship as-is. **If turning
  on a real provider**, set `AI_PROVIDER=openai` or `anthropic` and the
  matching **`OPENAI_API_KEY`**/**`ANTHROPIC_API_KEY`** — a real key
  means real cost, so this is an explicit product decision, not a default
  flip.

**Observability (Phase 14)**
- **`SENTRY_LARAVEL_DSN`** — blank is "safe" (no-op, nothing breaks) but
  means production errors are only ever visible in log files. Set a real
  DSN before relying on this for incident response.

**Backups (Phase 15)**
- `MYSQLDUMP_BINARY_PATH` — only needed if `mysqldump`/`mysql` aren't on
  `PATH` on the production host. Leave blank if they resolve normally
  (likely true on a standard Linux server with a MySQL client installed,
  unlike this Windows/Laragon dev box).

## 2. First deploy

```bash
cd backend
composer install --no-dev --optimize-autoloader
cp .env.example .env   # then edit per §1 above
php artisan key:generate
php artisan migrate --force
php artisan db:seed --force   # PlanSeeder + SuperAdminSeeder - both
                               # idempotent (updateOrCreate), safe to
                               # re-run on every deploy if ever needed
php artisan storage:link
npm install && npm run build   # only builds routes/web.php's '/' welcome
                                # page assets (resources/js/app.js +
                                # resources/css/app.css) - skip this and
                                # that one unused route 500s on a missing
                                # Vite manifest. Filament's admin panel
                                # assets are separate, already published as
                                # static files under public/ by
                                # `artisan filament:upgrade` (a composer
                                # post-update script, see composer.json) -
                                # not part of this build at all.

cd ../web
npm install
npm run build                  # emits web/dist - see §4 for serving it
```

Config/route/view caching for production (run after every deploy, not
just the first):
```bash
php artisan config:cache
php artisan route:cache
php artisan view:cache
php artisan event:cache
```

## 3. Queue worker + scheduler — both required, not optional

This app's background work (export generation, AI calls, document
processing, Phase 15's daily backups, Phase 15/BUG-003's soft-delete
purge) only happens if a queue worker is actually running continuously,
and its scheduled jobs (`routes/console.php`) only fire if something is
actually invoking Laravel's scheduler every minute. Neither happens by
itself — there's no in-process timer. Forgetting either of these means
exports silently sit in `queued` forever and the Phase 15 backup never
runs, with no obvious error anywhere.

**Queue worker**: run under a process supervisor so it restarts on crash
and on deploy. A ready-to-adapt supervisord config is at
`deploy/supervisor-queue-worker.conf` — copy it to
`/etc/supervisor/conf.d/`, fix the paths/user for the real host, then:
```bash
supervisorctl reread
supervisorctl update
supervisorctl start chandaktext-queue-worker:*
```
After every deploy that changes queued-job-handling code, restart the
workers so they pick up new code (same class of bug Phase 12/13 hit
locally — an old `queue:work` process keeps running stale code
indefinitely otherwise, see `docs/PROGRESS.md`'s Phase 12-13 section):
```bash
php artisan queue:restart
```

**Scheduler**: `routes/console.php`'s `Schedule::command(...)->daily()`
calls do nothing on their own — they register what *should* run, but
something still has to call `php artisan schedule:run` every minute for
any of it to fire. Add one cron entry on the server:
```
* * * * * cd /path/to/backend && php artisan schedule:run >> /dev/null 2>&1
```
This single line drives everything currently scheduled: the daily
document-purge (BUG-003), and Phase 15's `backup:run`/`backup:clean`.

## 4. Web app (`web/`)

`npm run build` emits static files to `web/dist/`. Two reasonable ways to
serve them, either is fine for this app (it's a client-side-routed SPA
hitting a separate API, not server-rendered):

- **Static hosting** (Netlify/Vercel/S3+CloudFront/nginx `root`) pointed
  at `web/dist/`, with a catch-all rewrite to `index.html` (client-side
  routing — `react-router-dom` — needs this or a hard refresh on any
  non-root path 404s).
- **Same web server as the API**, serving `web/dist/` as static files at
  the root path while reverse-proxying `/api/*` to the Laravel app.

**Required build-time env var**: `VITE_API_URL` — the web app defaults to
`http://127.0.0.1:8123/api/v1` (`web/src/lib/api.ts`) when it's unset,
which is only correct for local dev. Set it to the real API's public URL
before running `npm run build` (Vite bakes `VITE_*` vars in at build
time, not runtime — there's no `web/.env.example` yet; one's been added
alongside this checklist as a starting point).

**CORS**: `backend` currently uses Laravel's framework-default CORS
config (no published `config/cors.php`) — `allowed_origins: ['*']`,
`supports_credentials: false`. That's not a security hole for this app
specifically (pure bearer-token auth, no cookies ever sent
cross-origin), but it's broader than necessary once a real web origin
exists. Worth narrowing to the real `FRONTEND_URL` origin at some point;
not a launch blocker.

## 5. Storage, permissions, and reverse proxy

- `storage/` and `bootstrap/cache/` must be writable by the web
  server/PHP-FPM user (standard Laravel requirement).
- Phase 15's backup destination (`storage/backups/`) must **persist
  across deploys** — if the deploy process replaces the whole app
  directory (common with some deployment tools), make sure this path is
  excluded from that wipe or lives on a persistent volume. Losing it
  doesn't lose application data (the backups are a safety net, not the
  primary store), but it does lose backup *history*.
- Behind a reverse proxy (nginx/ALB/etc.), configure `TrustProxies`
  (`bootstrap/app.php` → `$middleware->trustProxies(...)`, not currently
  called, so Laravel's default is in effect) so `$request->getClientIp()`,
  `url()`, and `APP_URL`-derived links (password resets, `FRONTEND_URL`
  references) reflect the real public host/scheme rather than the
  internal proxy hop. Untrusted proxy headers would otherwise make
  generated URLs wrong (http instead of https, or the proxy's internal
  hostname).

## 6. Health check

`/up` (Phase 14) is wired to actually check dependencies, not just that
PHP booted — see `app/Listeners/CheckApplicationHealth.php`. Point a load
balancer health check or uptime monitor (e.g. UptimeRobot, or the
load balancer's own health check config) at it:
- **200** = DB reachable, queue backend (Redis, when `QUEUE_CONNECTION=redis`)
  reachable, storage disk writable.
- **Non-200** = one of those three failed. Check `storage/logs/laravel.log`
  (or Sentry, once a real DSN is set) for which one — the listener throws
  a specific message per check ("Database connection failed: ...",
  "Queue backend (redis) unreachable: ...", "Storage disk unwritable: ...").

## 7. Rollback

- **Code**: safe to roll back via normal deploy-revert (redeploy the
  previous release/commit) — nothing here does anything unusual that
  would complicate that.
- **Migrations**: most have straightforward `down()` methods (table
  drops / column removals) and are safe to roll back on an otherwise
  empty-of-new-data database. One is NOT safely reversible once used:
  `database/migrations/2026_10_21_130000_add_pdf_highlights_format_to_exports_table.php`
  narrows the `exports.format` MySQL `ENUM` back from
  `('pdf','pdf_highlights','docx')` to `('pdf','docx')` on `down()` — if
  any `exports` row already has `format='pdf_highlights'` by the time you
  roll back, that `ALTER TABLE` will either fail outright or (depending
  on SQL mode) silently coerce those rows to an unintended value. Check
  for existing `pdf_highlights` rows before rolling back past this
  migration; if any exist, don't roll back the schema — roll back the
  application code only, or migrate those specific rows to `'pdf'` first.
- **Backups**: a schema rollback doesn't touch `storage/backups/` — those
  remain valid for whatever DB state they captured, per
  `docs/backup-restore.md`.
