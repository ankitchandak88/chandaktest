<?php

namespace App\Listeners;

use Illuminate\Foundation\Events\DiagnosingHealth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Phase 14: the framework's default `/up` only proves the app booted - it
 * dispatches this event but has nothing listening, so a broken DB
 * connection, a dead queue backend, or an unwritable storage disk would
 * still report "healthy". Throwing here is what makes `/up` actually fail
 * (see vendor/laravel/framework/.../ApplicationBuilder.php - it catches
 * whatever this throws and turns it into a 500).
 */
class CheckApplicationHealth
{
    public function handle(DiagnosingHealth $event): void
    {
        $this->checkDatabase();
        $this->checkQueueBackend();
        $this->checkStorageDisk();
    }

    private function checkDatabase(): void
    {
        try {
            DB::connection()->getPdo();
        } catch (\Throwable $e) {
            throw new RuntimeException('Database connection failed: '.$e->getMessage(), previous: $e);
        }
    }

    private function checkQueueBackend(): void
    {
        $driver = config('queue.default');

        if ($driver === 'redis') {
            try {
                Redis::connection(config('queue.connections.redis.connection', 'default'))->ping();
            } catch (\Throwable $e) {
                throw new RuntimeException('Queue backend (redis) unreachable: '.$e->getMessage(), previous: $e);
            }
        }

        // 'sync' (tests) and 'database' (covered by checkDatabase above)
        // need no separate check; other drivers aren't used by this app.
    }

    private function checkStorageDisk(): void
    {
        $disk = Storage::disk(config('filesystems.default'));
        $probePath = 'health-check/'.Str::uuid().'.txt';

        try {
            $disk->put($probePath, 'ok');

            if (! $disk->exists($probePath)) {
                throw new RuntimeException('Storage disk write did not persist.');
            }
        } catch (\Throwable $e) {
            throw new RuntimeException('Storage disk unwritable: '.$e->getMessage(), previous: $e);
        } finally {
            $disk->delete($probePath);
        }
    }
}
