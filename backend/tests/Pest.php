<?php

use App\Models\Document;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;

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
| Shared helpers for exercising the multi-tenant API: `registerUser()`
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

    $response = apiPost('/api/v1/auth/register', [
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

/*
|--------------------------------------------------------------------------
| API request wrappers (IMPORTANT - always use these, never
| test()->postJson() etc directly)
|--------------------------------------------------------------------------
|
| Laravel's Sanctum guard (Illuminate\Auth\RequestGuard under the hood)
| memoizes the resolved user on the guard INSTANCE after the first
| authentication, and that instance is reused for every simulated HTTP call
| within one test method (the container isn't rebuilt between
| test()->postJson() calls the way it would be between separate real HTTP
| requests in production). Concretely: if a test authenticates as user A
| and then makes a second call with user B's bearer token, Auth::user()
| silently keeps returning A - a well known Sanctum+testing gotcha. Calling
| auth()->forgetGuards() before every request clears that cache so each
| call re-resolves the user from whatever token is actually in its headers.
| This bit for real in this project (see docs/PROGRESS.md "fixed bugs"):
| a "viewer can't edit" test and a "cross-tenant search" test both silently
| passed/failed for the wrong reason until these wrappers were introduced.
|
*/

function apiGet(string $uri, array $headers = []): TestResponse
{
    auth()->forgetGuards();

    return test()->getJson($uri, $headers);
}

function apiPost(string $uri, array $data = [], array $headers = []): TestResponse
{
    auth()->forgetGuards();

    return test()->postJson($uri, $data, $headers);
}

function apiPatch(string $uri, array $data = [], array $headers = []): TestResponse
{
    auth()->forgetGuards();

    return test()->patchJson($uri, $data, $headers);
}

function apiPut(string $uri, array $data = [], array $headers = []): TestResponse
{
    auth()->forgetGuards();

    return test()->putJson($uri, $data, $headers);
}

function apiDelete(string $uri, array $data = [], array $headers = []): TestResponse
{
    auth()->forgetGuards();

    return test()->deleteJson($uri, $data, $headers);
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

/**
 * A document that's already past processing (status=ready), for tests that
 * only care about annotations/excerpts/search and don't need to exercise
 * the upload+pdfparser pipeline itself.
 */
function createReadyDocument(Project $project, int $uploaderId): Document
{
    return Document::factory()->create([
        'organization_id' => $project->organization_id,
        'project_id' => $project->id,
        'uploaded_by' => $uploaderId,
    ]);
}

function fakeWebhookHeaders(): array
{
    return ['X-Fake-Webhook-Secret' => config('services.fake_payments.webhook_secret')];
}
