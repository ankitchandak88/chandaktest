<?php

use App\Console\Commands\BackupRestoreDrill;

test('identical row counts produce no mismatches', function () {
    $counts = ['users' => 5, 'projects' => 2, 'notes' => 0];

    $mismatches = BackupRestoreDrill::mismatchesBetween($counts, $counts);

    expect($mismatches)->toBeEmpty();
});

test('a differing table is reported with both counts', function () {
    $live = ['users' => 5, 'projects' => 2];
    $restored = ['users' => 5, 'projects' => 1];

    $mismatches = BackupRestoreDrill::mismatchesBetween($live, $restored);

    expect($mismatches->toArray())->toBe(['projects' => [2, 1]]);
});

test('a table missing entirely from the restore counts as a mismatch, not silently skipped', function () {
    $live = ['users' => 5, 'new_table' => 3];
    $restored = ['users' => 5];

    $mismatches = BackupRestoreDrill::mismatchesBetween($live, $restored);

    expect($mismatches->toArray())->toBe(['new_table' => [3, 0]]);
});
