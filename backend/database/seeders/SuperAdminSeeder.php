<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

/**
 * Creates (or promotes) the local dev super-admin so Filament has someone
 * who can log in at /admin. Change the password immediately outside local
 * development - see docs/09 deployment checklist.
 */
class SuperAdminSeeder extends Seeder
{
    public function run(): void
    {
        $email = env('SUPER_ADMIN_EMAIL', 'admin@chandaktext.test');
        $password = env('SUPER_ADMIN_PASSWORD', 'password');

        User::updateOrCreate(
            ['email' => $email],
            [
                'name' => 'Super Admin',
                'password' => Hash::make($password),
                'is_super_admin' => true,
                'email_verified_at' => now(),
            ]
        );

        $this->command?->info("Super admin ready: {$email}");
    }
}
