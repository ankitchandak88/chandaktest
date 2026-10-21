<?php

use App\Http\Controllers\Api\V1\AnnotationController;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\BillingController;
use App\Http\Controllers\Api\V1\DocumentController;
use App\Http\Controllers\Api\V1\ExcerptController;
use App\Http\Controllers\Api\V1\ExportController;
use App\Http\Controllers\Api\V1\LinkController;
use App\Http\Controllers\Api\V1\NoteController;
use App\Http\Controllers\Api\V1\OrganizationController;
use App\Http\Controllers\Api\V1\ProjectController;
use App\Http\Controllers\Api\V1\ProjectShareController;
use App\Http\Controllers\Api\V1\SearchController;
use App\Http\Controllers\Api\V1\TagController;
use App\Http\Controllers\Api\V1\UsageController;
use App\Http\Controllers\Api\V1\WorkspaceItemController;
use Illuminate\Support\Facades\Route;

// --- Public (unauthenticated) -------------------------------------------
Route::post('/auth/register', [AuthController::class, 'register'])->middleware('throttle:auth');
Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:auth');
Route::post('/auth/forgot-password', [AuthController::class, 'forgotPassword'])->middleware('throttle:auth');
Route::post('/auth/reset-password', [AuthController::class, 'resetPassword'])->middleware('throttle:auth');
Route::get('/auth/email/verify/{id}/{hash}', [AuthController::class, 'verifyEmail'])
    ->middleware('signed')
    ->name('verification.verify');

// Public share-link viewing (PROD-002) - deliberately outside auth:sanctum
// and the 'org' tenant-scoping group entirely, since the whole point is
// access without an account. See ProjectShareController's class docblock
// for the scope this was locked in at.
Route::middleware('throttle:share-access')->group(function () {
    Route::get('/shares/{token}', [ProjectShareController::class, 'show']);
    Route::post('/shares/{token}/content', [ProjectShareController::class, 'content']);
});

Route::get('/billing/plans', [BillingController::class, 'plans']);
Route::post('/billing/webhooks/{provider}', [BillingController::class, 'webhook'])->middleware('throttle:webhooks');
Route::get('/billing/fake/simulate/{subscriptionId}', [BillingController::class, 'simulateFakeCheckout'])
    ->name('billing.fake.simulate');

// --- Authenticated, no organization context required --------------------
Route::middleware('auth:sanctum')->group(function () {
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::post('/auth/email/verification-notification', [AuthController::class, 'sendVerificationEmail']);
    Route::get('/me', [AuthController::class, 'me']);
    Route::patch('/me', [AuthController::class, 'updateProfile']);
    Route::delete('/me', [AuthController::class, 'destroy']);

    Route::get('/organizations', [OrganizationController::class, 'index']);
});

// --- Authenticated + tenant-scoped (requires X-Organization-Id) ---------
Route::middleware(['auth:sanctum', 'org'])->group(function () {
    Route::get('/organizations/current', [OrganizationController::class, 'show']);
    Route::get('/organizations/current/members', [OrganizationController::class, 'members']);
    Route::post('/organizations/current/members', [OrganizationController::class, 'addMember'])
        ->middleware('throttle:member-management');
    Route::delete('/organizations/members/{membership}', [OrganizationController::class, 'removeMember'])
        ->middleware('throttle:member-management');

    Route::get('/projects', [ProjectController::class, 'index']);
    Route::post('/projects', [ProjectController::class, 'store']);
    Route::get('/projects/{project}', [ProjectController::class, 'show']);
    Route::patch('/projects/{project}', [ProjectController::class, 'update']);
    Route::delete('/projects/{project}', [ProjectController::class, 'destroy']);

    Route::get('/projects/{project}/documents', [DocumentController::class, 'index']);
    Route::post('/projects/{project}/documents', [DocumentController::class, 'store'])->middleware('throttle:uploads');
    Route::get('/documents/{document}', [DocumentController::class, 'show']);
    Route::patch('/documents/{document}', [DocumentController::class, 'update']);
    Route::get('/documents/{document}/pages/{page}', [DocumentController::class, 'page']);
    Route::get('/documents/{document}/download', [DocumentController::class, 'download']);
    Route::delete('/documents/{document}', [DocumentController::class, 'destroy']);

    Route::get('/documents/{document}/annotations', [AnnotationController::class, 'index']);
    Route::post('/documents/{document}/annotations', [AnnotationController::class, 'store']);
    Route::patch('/annotations/{annotation}', [AnnotationController::class, 'update']);
    Route::delete('/annotations/{annotation}', [AnnotationController::class, 'destroy']);

    Route::get('/projects/{project}/excerpts', [ExcerptController::class, 'index']);
    Route::post('/projects/{project}/excerpts', [ExcerptController::class, 'store']);
    Route::patch('/excerpts/{excerpt}', [ExcerptController::class, 'update']);
    Route::delete('/excerpts/{excerpt}', [ExcerptController::class, 'destroy']);
    Route::put('/excerpts/{excerpt}/tags', [ExcerptController::class, 'syncTags']);

    Route::get('/projects/{project}/notes', [NoteController::class, 'index']);
    Route::post('/projects/{project}/notes', [NoteController::class, 'store']);
    Route::patch('/notes/{note}', [NoteController::class, 'update']);
    Route::delete('/notes/{note}', [NoteController::class, 'destroy']);
    Route::put('/notes/{note}/tags', [NoteController::class, 'syncTags']);

    Route::get('/projects/{project}/tags', [TagController::class, 'index']);
    Route::post('/projects/{project}/tags', [TagController::class, 'store']);
    Route::delete('/tags/{tag}', [TagController::class, 'destroy']);

    Route::get('/projects/{project}/shares', [ProjectShareController::class, 'index']);
    Route::post('/projects/{project}/shares', [ProjectShareController::class, 'store']);
    Route::delete('/shares/{share}', [ProjectShareController::class, 'destroy']);

    Route::get('/projects/{project}/workspace-items', [WorkspaceItemController::class, 'index']);
    Route::post('/projects/{project}/workspace-items', [WorkspaceItemController::class, 'store']);
    Route::post('/projects/{project}/workspace-items/batch', [WorkspaceItemController::class, 'batch']);
    Route::patch('/workspace-items/{workspaceItem}', [WorkspaceItemController::class, 'update']);
    Route::delete('/workspace-items/{workspaceItem}', [WorkspaceItemController::class, 'destroy']);

    Route::get('/projects/{project}/links', [LinkController::class, 'index']);
    Route::post('/projects/{project}/links', [LinkController::class, 'store']);
    Route::delete('/links/{link}', [LinkController::class, 'destroy']);

    Route::get('/search', [SearchController::class, 'index'])->middleware('throttle:search');

    Route::post('/projects/{project}/exports', [ExportController::class, 'store'])->middleware('throttle:export');
    Route::get('/exports/{export}', [ExportController::class, 'show']);
    Route::get('/exports/{export}/download', [ExportController::class, 'download']);

    Route::post('/billing/checkout', [BillingController::class, 'checkout']);
    Route::get('/billing/subscription', [BillingController::class, 'subscription']);

    Route::get('/usage', [UsageController::class, 'show']);
});
