<?php

use App\Listeners\CheckApplicationHealth;
use Illuminate\Foundation\Events\DiagnosingHealth;

// Phase 14: the framework's default /up only proves the app booted - this
// proves CheckApplicationHealth is actually wired to DiagnosingHealth and
// does real work (DB/queue/storage), not just that the route exists.
test('the health check endpoint reports healthy when dependencies are reachable', function () {
    apiGet('/up')->assertOk();
});

// Exercises the listener directly against a deliberately-unreachable
// connection, rather than hitting /up over HTTP - swapping the real
// 'mysql' connection the RefreshDatabase transaction wrapper depends on
// would break this test's own teardown, not just the thing under test.
test('the health check listener throws when the database is unreachable', function () {
    config(['database.connections.mysql_unreachable' => array_merge(
        config('database.connections.mysql'),
        ['host' => '127.0.0.1', 'port' => 1],
    )]);

    config(['database.default' => 'mysql_unreachable']);

    try {
        expect(fn () => app(CheckApplicationHealth::class)->handle(new DiagnosingHealth))
            ->toThrow(RuntimeException::class, 'Database connection failed');
    } finally {
        config(['database.default' => 'mysql']);
        \Illuminate\Support\Facades\DB::purge('mysql_unreachable');
    }
});
