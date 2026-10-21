# Backup & restore runbook (Phase 15)

## What gets backed up

- **Database**: a full `mysqldump` of the `mysql` connection's database
  (see `config/backup.php` → `backup.source.databases`).
- **Files**: everything under `storage/app` (user-uploaded PDFs +
  generated exports) — application code is excluded since it's already in
  git and backing it up again would just be redundant disk churn.

Both are zipped together and written to a **dedicated `backups` disk**
(`storage/backups/`, see `config/filesystems.php`), deliberately *outside*
`storage/app`. Sharing a disk between "files being backed up" and "where
the backup zip is written" would make each run try to include previous
backup zips in the next one — a classic self-referencing backup bug. Same
reasoning for `temporary_directory` in `config/backup.php`, which also
lives outside `storage/app` for the same reason.

## Where backups live, and for how long

- Local disk only for now (no production hosting/cloud bucket decided
  yet) — `storage/backups/{APP_NAME}/{timestamp}.zip`.
- `backup:clean` (scheduled daily at 02:30, see `routes/console.php`)
  prunes old backups per `config/backup.php`'s cleanup strategy
  (`DefaultStrategy` — defaults keep all backups for a few days, then
  thin them out). Tune `cleanup.default_strategy.*` in that file if the
  defaults don't match your retention needs.
- `backup:monitor` checks backup health (max age, max total size) per the
  `monitor_backups` section of the same config — not yet wired to an
  alerting channel (see Phase 14 for Sentry; a monitor failure could be
  routed there once that's configured with a real DSN).

## Running a backup manually

```bash
cd backend
php artisan backup:run              # database + storage/app files
php artisan backup:run --only-db    # database only, faster
php artisan backup:list             # see what's on disk
```

### `mysqldump`/`mysql` binary path (Windows/Laragon specific)

This Laragon install doesn't put `mysqldump`/`mysql` on `PATH`. Both the
backup and the restore drill below read the binary directory from
`config('database.connections.mysql.dump.dump_binary_path')`, driven by
the `MYSQLDUMP_BINARY_PATH` env var:

```
MYSQLDUMP_BINARY_PATH="C:/laragon/bin/mysql/mysql-8.0.30-winx64/bin"
```

If you're on a different machine where these *are* on `PATH`, leave this
env var blank — `array_filter()` in `config/database.php` drops the key
entirely when it's empty, and the dumper falls back to a bare `mysqldump`
command resolved via `PATH`.

## Proving a backup is actually restorable

A zip file existing proves nothing by itself. `php artisan
backup:restore-drill`:

1. Finds the most recent backup on the `backups` disk.
2. Extracts just the `db-dumps/*.sql` entry (not the files, which aren't
   relevant to this check).
3. Creates a throwaway `chandaktext_restore_drill` database (never the
   real one) and imports the dump into it via `mysql.exe`.
4. Compares **every table's row count** between the live database and the
   restored scratch database.
5. Reports pass/fail, then drops the scratch database and deletes its
   temp extraction directory (unless you pass `--keep`, e.g. to manually
   inspect the restored data with a MySQL client).

```bash
php artisan backup:run --only-db
php artisan backup:restore-drill
```

**Actually run on this machine (2026-10-21)**, confirming the whole chain
works end to end, not just in theory:

```
$ php artisan backup:run
Starting backup...
Dumping database chandaktext...
Determining files to backup...
Zipping 238 files and directories...
Created zip containing 238 files and directories. Size is 805.22 KB
Copying zip to disk named backups...
Successfully copied zip to disk named backups.
Backup completed!

$ php artisan backup:restore-drill
Using backup: C:\laragon\www\chandaktext\backend\storage\backups\ChandakText\2026-10-21-17-50-22.zip
Restore drill passed: every table in the restored database matches the live row count.
```

The row-count comparison logic itself (not the real `mysqldump`/`mysql.exe`
subprocess calls, which need real binaries and aren't compatible with the
test suite's `RefreshDatabase` transaction wrapper — the same category of
limitation documented in `tests/Feature/Api/SearchExportTest.php` for
MySQL FULLTEXT) has unit test coverage in
`tests/Unit/Console/Commands/BackupRestoreDrillTest.php`.

## Restoring for real (disaster recovery)

If you ever need to actually recover, not just drill:

1. Stop the app (or at least the queue worker) so nothing writes to the
   database mid-restore.
2. Pick the backup to restore from `php artisan backup:list`.
3. Extract its `db-dumps/*.sql` entry and import it directly into the
   **real** database:
   ```bash
   "C:/laragon/bin/mysql/mysql-8.0.30-winx64/bin/mysql.exe" -u root chandaktext < dump.sql
   ```
   This **overwrites existing data** — there is no scratch database
   involved here, unlike the drill above. Take a fresh backup of the
   current (possibly-broken) state first if there's any chance you'll
   need to compare against it afterward.
4. Extract the rest of the zip (the `storage/app` tree) over the real
   `storage/app` directory to restore uploaded documents and exports.
5. Restart the app and queue worker, then spot-check a few
   projects/documents in the UI before considering the recovery done.

## Known limitations / revisit if asked

- Local disk only. If this app moves to real hosting, add an S3 (or
  similar) disk to `backup.destination.disks` — `config/filesystems.php`
  already has an `s3` disk stubbed out (`AWS_*` env vars), so this is
  mostly a one-line config change plus credentials, not new code.
- No automated alerting on backup failure/staleness yet (`backup:monitor`
  runs but nothing reads its result) — natural follow-up once Phase 14's
  Sentry DSN is actually configured.
- The restore drill checks row counts, not full content/checksum
  equality. Row-count parity across every table is strong evidence a
  dump/restore round-trip didn't silently drop or truncate anything, but
  it wouldn't catch byte-level corruption within an unchanged row count.
