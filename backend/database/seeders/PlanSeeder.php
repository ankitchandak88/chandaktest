<?php

namespace Database\Seeders;

use App\Models\Plan;
use Illuminate\Database\Seeder;

/**
 * Plan limits are configurable, not hard-coded (docs/06 section 6.4), so
 * they live in the database and are only seeded here with starting values
 * pulled from .env. Admins can edit them afterwards from Filament.
 */
class PlanSeeder extends Seeder
{
    public function run(): void
    {
        Plan::updateOrCreate(
            ['code' => 'free'],
            [
                'name' => 'Free',
                'limits' => [
                    'projects' => (int) env('PLAN_FREE_PROJECTS', 3),
                    'storage_mb' => (int) env('PLAN_FREE_STORAGE_MB', 500),
                    'documents_per_project' => (int) env('PLAN_FREE_DOCS_PER_PROJECT', 10),
                ],
                'features' => ['search' => 'basic', 'export' => 'limited'],
                'price_inr_paise' => 0,
                'active' => true,
            ]
        );

        Plan::updateOrCreate(
            ['code' => 'pro'],
            [
                'name' => 'Pro',
                'limits' => [
                    'projects' => (int) env('PLAN_PRO_PROJECTS', 100),
                    'storage_mb' => (int) env('PLAN_PRO_STORAGE_MB', 20000),
                    'documents_per_project' => (int) env('PLAN_PRO_DOCS_PER_PROJECT', 500),
                ],
                'features' => ['search' => 'advanced', 'export' => 'higher_allowance'],
                'price_inr_paise' => 99900,
                'active' => true,
            ]
        );
    }
}
