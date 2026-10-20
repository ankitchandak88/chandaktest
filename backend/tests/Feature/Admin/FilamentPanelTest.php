<?php

use App\Models\User;
use Illuminate\Support\Facades\Hash;

test('a non-admin user cannot reach the admin panel', function () {
    ['user' => $user] = registerUser();

    // Already authenticated (web guard) but canAccessPanel() is false, so
    // Filament denies with 403 rather than redirecting to login.
    test()->actingAs($user)->get('/admin')->assertForbidden();
});

test('the super admin can load every admin resource page', function () {
    $admin = User::create([
        'name' => 'Admin',
        'email' => 'panel-admin@example.test',
        'password' => Hash::make('Password123!'),
        'is_super_admin' => true,
        'email_verified_at' => now(),
    ]);

    $pages = [
        '/admin',
        '/admin/users',
        '/admin/organizations',
        '/admin/plans',
        '/admin/subscriptions',
        '/admin/documents',
        '/admin/audit-logs',
        '/admin/feature-flags',
    ];

    foreach ($pages as $page) {
        test()->actingAs($admin)->get($page)->assertSuccessful();
    }
});
