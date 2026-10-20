<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    // Every test gets the Free/Pro plans seeded (EntitlementService falls
    // back to the "free" plan code for any organization without an active
    // subscription), via RefreshDatabase's $seed/$seeder hooks.
    protected $seed = true;

    protected $seeder = \Database\Seeders\PlanSeeder::class;
}
