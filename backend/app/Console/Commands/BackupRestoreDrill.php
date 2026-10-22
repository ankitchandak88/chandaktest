<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use PDO;
use Symfony\Component\Process\Process;
use ZipArchive;

/**
 * Phase 15: "a backup zip exists" proves nothing about whether it can
 * actually be restored - this command is the real drill: take the most
 * recent backup, restore its DB dump into a throwaway scratch database
 * (never the real one), and compare every table's row count against the
 * live database. See docs/backup-restore.md for the runbook this
 * automates.
 */
class BackupRestoreDrill extends Command
{
    protected $signature = 'backup:restore-drill {--keep : Leave the scratch database and extracted files in place for manual inspection instead of cleaning up}';

    protected $description = 'Restore the most recent backup into a scratch database and verify row counts match the live database';

    private string $scratchDatabase = 'chandaktext_restore_drill';

    public function handle(): int
    {
        $zipPath = $this->locateLatestBackup();

        if (! $zipPath) {
            $this->error('No backup zip found on the "backups" disk. Run `php artisan backup:run` first.');

            return self::FAILURE;
        }

        $this->info("Using backup: {$zipPath}");

        $workDir = storage_path('restore-drill-tmp/'.Str::random(12));
        mkdir($workDir, recursive: true);

        try {
            $dumpPath = $this->extractDatabaseDump($zipPath, $workDir);

            if (! $dumpPath) {
                $this->error('No database dump (db-dumps/*.sql) found inside that backup.');

                return self::FAILURE;
            }

            $this->createScratchDatabase();
            $this->importDump($dumpPath);

            $mismatches = $this->compareRowCounts();

            if ($mismatches->isEmpty()) {
                $this->info('Restore drill passed: every table in the restored database matches the live row count.');

                return self::SUCCESS;
            }

            $this->error('Restore drill found mismatches:');
            foreach ($mismatches as $table => [$live, $restored]) {
                $this->line("  {$table}: live={$live} restored={$restored}");
            }

            return self::FAILURE;
        } finally {
            if (! $this->option('keep')) {
                $this->dropScratchDatabase();
                $this->deleteDirectory($workDir);
            } else {
                $this->warn("Kept scratch database '{$this->scratchDatabase}' and {$workDir} for inspection.");
            }
        }
    }

    private function locateLatestBackup(): ?string
    {
        $disk = Storage::disk('backups');

        $latest = collect($disk->allFiles())
            ->filter(fn ($path) => str_ends_with($path, '.zip'))
            ->sortDesc()
            ->first();

        return $latest ? $disk->path($latest) : null;
    }

    private function extractDatabaseDump(string $zipPath, string $workDir): ?string
    {
        $zip = new ZipArchive;
        $result = $zip->open($zipPath);

        if ($result !== true) {
            // Without this check, a corrupt/truncated zip silently proceeds
            // as if it opened, finds no db-dumps entry (there's nothing to
            // find), and reports the generic "no dump found" below - which
            // masks the actual problem (a corrupt backup file) this drill
            // specifically exists to catch.
            throw new \RuntimeException("Could not open backup zip '{$zipPath}' (ZipArchive error code {$result}) - the backup file may be corrupt or truncated.");
        }

        $dumpEntry = null;
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = $zip->getNameIndex($i);
            if (str_contains($name, 'db-dumps') && str_ends_with($name, '.sql')) {
                $dumpEntry = $name;
                break;
            }
        }

        if (! $dumpEntry) {
            $zip->close();

            return null;
        }

        $zip->extractTo($workDir, [$dumpEntry]);
        $zip->close();

        return $workDir.DIRECTORY_SEPARATOR.$dumpEntry;
    }

    private function mysqlBinary(string $name): string
    {
        $binPath = config('database.connections.mysql.dump.dump_binary_path');

        return $binPath ? rtrim($binPath, '/').'/'.$name : $name;
    }

    private function createScratchDatabase(): void
    {
        $this->dropScratchDatabase();

        DB::statement("CREATE DATABASE `{$this->scratchDatabase}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    }

    private function dropScratchDatabase(): void
    {
        DB::statement("DROP DATABASE IF EXISTS `{$this->scratchDatabase}`");
    }

    private function importDump(string $dumpPath): void
    {
        $config = config('database.connections.mysql');

        $process = new Process([
            $this->mysqlBinary('mysql'),
            '--host='.$config['host'],
            '--port='.$config['port'],
            '--user='.$config['username'],
            '--password='.$config['password'],
            $this->scratchDatabase,
        ]);

        $process->setInput(fopen($dumpPath, 'r'));
        $process->setTimeout(300);
        $process->run();

        if (! $process->isSuccessful()) {
            throw new \RuntimeException('Restoring the dump failed: '.$process->getErrorOutput());
        }
    }

    private function compareRowCounts()
    {
        $liveDatabase = config('database.connections.mysql.database');
        $pdo = DB::connection()->getPdo();

        // Union of tables on *both* sides, not just the live database's
        // list - querying a live-only table name against the restored DB
        // (or vice versa) would throw (the table genuinely doesn't exist
        // there), crashing the whole drill instead of reporting it as the
        // mismatch it is. This also catches the reverse drift the
        // live-only list missed entirely: a table still present in an
        // older restore that's since been dropped/renamed on live.
        $liveTables = $pdo->query("SHOW TABLES FROM `{$liveDatabase}`")->fetchAll(PDO::FETCH_COLUMN);
        $restoredTables = $pdo->query("SHOW TABLES FROM `{$this->scratchDatabase}`")->fetchAll(PDO::FETCH_COLUMN);
        $allTables = array_unique([...$liveTables, ...$restoredTables]);

        $liveCounts = [];
        $restoredCounts = [];

        foreach ($allTables as $table) {
            $liveCounts[$table] = in_array($table, $liveTables, true)
                ? (int) $pdo->query("SELECT COUNT(*) FROM `{$liveDatabase}`.`{$table}`")->fetchColumn()
                : 0;
            $restoredCounts[$table] = in_array($table, $restoredTables, true)
                ? (int) $pdo->query("SELECT COUNT(*) FROM `{$this->scratchDatabase}`.`{$table}`")->fetchColumn()
                : 0;
        }

        return self::mismatchesBetween($liveCounts, $restoredCounts);
    }

    /**
     * Pure comparison, deliberately separated from the DB/subprocess calls
     * above so it's unit-testable without a real mysqldump/mysql.exe/scratch
     * database - see tests/Unit/Console/Commands/BackupRestoreDrillTest.php.
     *
     * @param  array<string,int>  $liveCounts
     * @param  array<string,int>  $restoredCounts
     * @return \Illuminate\Support\Collection<string,array{0:int,1:int}>
     */
    public static function mismatchesBetween(array $liveCounts, array $restoredCounts): \Illuminate\Support\Collection
    {
        $mismatches = collect();

        foreach ($liveCounts as $table => $liveCount) {
            $restoredCount = $restoredCounts[$table] ?? 0;

            if ($liveCount !== $restoredCount) {
                $mismatches->put($table, [$liveCount, $restoredCount]);
            }
        }

        return $mismatches;
    }

    private function deleteDirectory(string $path): void
    {
        if (! is_dir($path)) {
            return;
        }

        $items = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($path, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST
        );

        foreach ($items as $item) {
            $item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname());
        }

        rmdir($path);
    }
}
