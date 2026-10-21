<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Models\ProjectShare;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Share links (PROD-002 / brief Section 15). Scope locked in for this pass:
 * read-only, compiled notes+excerpts view (never the raw source PDF or its
 * storage_key - see publicContent()), optional password, and always a
 * bounded expiry (config('shares.default_days')/max_days) rather than a
 * link that's public forever by default.
 */
class ProjectShareController extends Controller
{
    public function __construct(private readonly AuditLogger $auditLogger)
    {
    }

    public function index(Request $request, Project $project)
    {
        $this->authorize('viewAny', [ProjectShare::class, $project]);

        return response()->json(['data' => $project->shares()->orderByDesc('created_at')->get()]);
    }

    public function store(Request $request, Project $project)
    {
        $this->authorize('create', [ProjectShare::class, $project]);

        $maxDays = (int) config('shares.max_days', 90);
        $data = $request->validate([
            'password' => ['nullable', 'string', 'min:4', 'max:255'],
            'expires_in_days' => ['nullable', 'integer', 'min:1', "max:{$maxDays}"],
        ]);

        $days = $data['expires_in_days'] ?? (int) config('shares.default_days', 7);

        $share = ProjectShare::create([
            'project_id' => $project->id,
            'created_by' => $request->user()->id,
            'token' => Str::random(40),
            'password_hash' => isset($data['password']) ? Hash::make($data['password']) : null,
            'expires_at' => now()->addDays($days),
        ]);

        $this->auditLogger->logRequest($request, 'share.created', 'project_share', $share->id);

        return response()->json(['data' => $share], 201);
    }

    public function destroy(Request $request, ProjectShare $share)
    {
        $this->authorize('delete', $share);

        $share->update(['revoked_at' => now()]);

        $this->auditLogger->logRequest($request, 'share.revoked', 'project_share', $share->id);

        return response()->json(['data' => ['message' => 'Share link revoked.']]);
    }

    /**
     * Public, unauthenticated: just enough to let the client decide whether
     * to show a password prompt. A missing/expired/revoked token returns the
     * same 404 as a token that never existed - not distinguishing those
     * avoids confirming to a prober which case they hit.
     */
    public function show(Request $request, string $token)
    {
        $share = $this->findActiveShare($token);

        return response()->json(['data' => [
            'project_name' => $share->project->name,
            'requires_password' => $share->requiresPassword(),
        ]]);
    }

    public function content(Request $request, string $token)
    {
        $share = $this->findActiveShare($token);

        if ($share->requiresPassword()) {
            $password = (string) $request->input('password', '');

            if (! $share->verifyPassword($password)) {
                abort(403, 'Incorrect password.');
            }
        }

        $share->update(['last_accessed_at' => now()]);

        $project = $share->project;

        return response()->json(['data' => [
            'project_name' => $project->name,
            'excerpts' => $project->excerpts()
                ->orderByDesc('created_at')
                ->get(['id', 'page_number', 'text']),
            'notes' => $project->notes()
                ->orderByDesc('created_at')
                ->get(['id', 'title', 'content']),
        ]]);
    }

    private function findActiveShare(string $token): ProjectShare
    {
        $share = ProjectShare::where('token', $token)->first();

        if (! $share || ! $share->isActive()) {
            abort(404, 'This share link is no longer available.');
        }

        return $share;
    }
}
