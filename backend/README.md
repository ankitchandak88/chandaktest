# ChandakText — Backend (Laravel)

API-only Laravel 12 app (`/api/v1`) + Filament admin panel (`/admin`) for
the ChandakText PDF research workspace. See the repo root's
`docs/PROGRESS.md` for the full project status, decisions, and known
simplifications - read that first.

## Stack

MySQL (not PostgreSQL - see docs/PROGRESS.md for why), Redis via `predis`
(no `ext-redis` on this machine), Sanctum bearer tokens (no cookie/session
auth - both the web app and the Flutter app authenticate the same way).

## Local setup

```
composer install
cp .env.example .env   # then set DB_*, REDIS_*, PAYMENT_PROVIDER=fake
php artisan key:generate
php artisan migrate
php artisan db:seed      # Free/Pro plans + a super-admin user
php artisan serve --port=8123
php artisan queue:work   # separate terminal - PDF processing & exports run here
```

Super admin login for `/admin`: `admin@chandaktext.test` / `password`
(overridable via `SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_PASSWORD`).

## Testing

```
php vendor/bin/pest
```

Runs against the `chandaktext_test` MySQL database (`phpunit.xml`) -
**not** sqlite: several features (MySQL FULLTEXT search, a raw `ALTER
TABLE ... ADD FULLTEXT` in a migration) are MySQL-specific.

## API reference

`docs/openapi.yaml` - every `/api/v1/*` endpoint with request/response
shapes. Not auto-generated from the routes/controllers; keep it in sync by
hand when endpoints change (docs/04-api-specification.md section 4.7).
