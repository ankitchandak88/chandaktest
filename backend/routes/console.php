<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// BUG-003: permanently remove documents (files + dependent records) once
// they've been soft-deleted past the retention window.
Schedule::command('app:purge-soft-deleted-documents')->daily();

// Phase 15: daily DB + storage/app backup (see config/backup.php), cleaned
// up on the same schedule per config/backup.php's cleanup strategy so old
// backups don't accumulate forever on local disk.
Schedule::command('backup:run')->daily()->at('02:00');
Schedule::command('backup:clean')->daily()->at('02:30');
