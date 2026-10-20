<?php

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

/*
|--------------------------------------------------------------------------
| Test Case
|--------------------------------------------------------------------------
|
| Every Feature test runs against a freshly migrated database (the
| `chandaktext_test` MySQL database configured via phpunit.xml) and is
| wrapped in a transaction that's rolled back after each test.
|
*/

pest()->extend(Tests\TestCase::class)
    ->use(RefreshDatabase::class)
    ->in('Feature');

/*
|--------------------------------------------------------------------------
| Expectations
|--------------------------------------------------------------------------
*/

expect()->extend('toBeOne', function () {
    return $this->toBe(1);
});

/*
|--------------------------------------------------------------------------
| Functions
|--------------------------------------------------------------------------
|
| Shared helpers for exercising the multi-tenant API: `actingAsNewUser()`
| registers a user (which also creates their personal organization, exactly
| like the real /auth/register endpoint) and returns both plus a ready-to-use
| header array, so every Feature test authenticates the same real way
| instead of faking a token.
|
*/

/**
 * @return array{user: User, organization: Organization, headers: array<string,string>}
 */
function registerUser(?string $email = null): array
{
    $email ??= 'user-'.uniqid().'@example.test';

    $response = test()->postJson('/api/v1/auth/register', [
        'name' => 'Test User',
        'email' => $email,
        'password' => 'Password123!',
        'password_confirmation' => 'Password123!',
    ]);

    $token = $response->json('data.token');
    $organizationId = $response->json('data.organization_id');
    $user = User::where('email', $email)->firstOrFail();
    $organization = Organization::findOrFail($organizationId);

    return [
        'user' => $user,
        'organization' => $organization,
        'headers' => [
            'Authorization' => "Bearer {$token}",
            'X-Organization-Id' => $organizationId,
        ],
    ];
}

function minimalPdfBytes(): string
{
    $content = "BT /F1 24 Tf 72 712 Td (Hello ChandakText World) Tj ET";
    $objs = [
        '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj',
        '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj',
        '3 0 obj<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>endobj',
        '4 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj',
        "5 0 obj<< /Length ".strlen($content)." >>stream\n{$content}\nendstream endobj",
    ];

    $out = "%PDF-1.4\n";
    $offsets = [];

    foreach ($objs as $obj) {
        $offsets[] = strlen($out);
        $out .= $obj."\n";
    }

    $xrefOffset = strlen($out);
    $out .= 'xref'."\n".'0 '.(count($objs) + 1)."\n";
    $out .= "0000000000 65535 f \n";

    foreach ($offsets as $offset) {
        $out .= sprintf("%010d 00000 n \n", $offset);
    }

    $out .= 'trailer<< /Size '.(count($objs) + 1).' /Root 1 0 R >>'."\n".'startxref'."\n".$xrefOffset."\n%%EOF";

    return $out;
}
