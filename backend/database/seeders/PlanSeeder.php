<?php

namespace Database\Seeders;

use App\Models\Plan;
use Illuminate\Database\Seeder;

/**
 * Advocate & Law Firm Subscription Plans:
 * 1. Solo Advocate (Free) - 1 Advocate seat, individual practice
 * 2. Advocate Chambers (₹1,999) - 10 Advocate/Junior seats, team matters
 * 3. Law Firm Enterprise (₹4,999) - 25+ Advocate seats, unlimited matters
 */
class PlanSeeder extends Seeder
{
    public function run(): void
    {
        Plan::updateOrCreate(
            ['code' => 'free'],
            [
                'name' => 'Solo Advocate (Starter)',
                'limits' => [
                    'seats' => 1,
                    'projects' => 5,
                    'storage_mb' => 1000,
                    'documents_per_project' => 20,
                ],
                'features' => [
                    'practice' => 'Solo Practice (1 Seat)',
                    'court_paper_mode' => 'yes',
                    'chronology' => 'basic',
                    'citations' => '1-tap standard',
                ],
                'price_inr_paise' => 0,
                'active' => true,
            ]
        );

        Plan::updateOrCreate(
            ['code' => 'chambers'],
            [
                'name' => 'Advocate Chambers (10 Seats)',
                'limits' => [
                    'seats' => 10,
                    'projects' => 100,
                    'storage_mb' => 25000,
                    'documents_per_project' => 200,
                ],
                'features' => [
                    'practice' => 'Chambers Team (10 Seats)',
                    'brief_assignment' => 'yes',
                    'court_hearing_mode' => 'full_dais',
                    'paper_book_indexing' => 'yes',
                    'court_synopsis_export' => 'yes',
                ],
                'price_inr_paise' => 199900, // ₹1,999/month
                'active' => true,
            ]
        );

        Plan::updateOrCreate(
            ['code' => 'firm'],
            [
                'name' => 'Law Firm Enterprise (25 Seats)',
                'limits' => [
                    'seats' => 25,
                    'projects' => 1000,
                    'storage_mb' => 100000,
                    'documents_per_project' => 1000,
                ],
                'features' => [
                    'practice' => 'Full Law Firm (25+ Seats)',
                    'hierarchy_roles' => 'senior_partner_associate_junior',
                    'ai_synopsis_extractor' => 'yes',
                    'parallel_bench_compare' => 'yes',
                    'audit_log_compliance' => 'yes',
                    'priority_support' => 'yes',
                ],
                'price_inr_paise' => 499900, // ₹4,999/month
                'active' => true,
            ]
        );

        Plan::updateOrCreate(
            ['code' => 'pro'],
            [
                'name' => 'Senior Counsel Pro (5 Seats)',
                'limits' => [
                    'seats' => 5,
                    'projects' => 50,
                    'storage_mb' => 20000,
                    'documents_per_project' => 500,
                ],
                'features' => [
                    'practice' => 'Boutique Counsel (5 Seats)',
                    'court_hearing_mode' => 'yes',
                    'search' => 'advanced',
                ],
                'price_inr_paise' => 99900,
                'active' => true,
            ]
        );
    }
}
