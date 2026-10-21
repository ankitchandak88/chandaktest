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
