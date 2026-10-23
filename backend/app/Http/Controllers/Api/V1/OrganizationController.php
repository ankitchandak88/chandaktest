<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Membership;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\EntitlementService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class OrganizationController extends Controller
{
    public function __construct(
        private readonly AuditLogger $auditLogger,
        private readonly EntitlementService $entitlements,
    ) {
    }

    /** List the organizations the current user belongs to, for a workspace switcher. */
    public function index(Request $request)
    {
        $memberships = $request->user()->memberships()->with('organization.subscription.plan')->get();

        return response()->json(['data' => $memberships]);
    }

    public function show(Request $request)
    {
        $organization = $request->organization();
        $this->authorize('view', $organization);

        return response()->json([
            'data' => $organization->load('subscription.plan'),
            'usage' => $this->entitlements->usageSummary($organization),
        ]);
    }

    public function members(Request $request)
    {
        $organization = $request->organization();
        $this->authorize('view', $organization);

        $members = $organization->memberships()->with('user:id,name,email')->get();

        return response()->json([
            'data' => $members,
            'seats' => [
                'used' => $members->count(),
                'limit' => $this->entitlements->planFor($organization)->limit('seats', 1),
            ],
        ]);
    }

    public function addMember(Request $request)
    {
        $organization = $request->organization();
        $this->authorize('manageMembers', $organization);

        $data = $request->validate([
            'email' => ['required', 'email'],
            'name' => ['nullable', 'string', 'max:255'],
            'role' => ['required', 'string', 'in:owner,partner,associate,junior,clerk,member'],
        ]);

        $user = User::where('email', $data['email'])->first();

        $existing = $user ? Membership::where('organization_id', $organization->id)
            ->where('user_id', $user->id)
            ->first() : null;

        // If this is a new member addition (not a role update of existing member), enforce seat quota
        if (! $existing) {
            $this->entitlements->withinMemberQuota($organization, function () {});
        }

        if (! $user) {
            // Auto-create invited user account so advocate colleagues / juniors can join instantly
            $user = User::create([
                'name' => $data['name'] ?: explode('@', $data['email'])[0],
                'email' => $data['email'],
                'password' => Hash::make(Str::random(16)),
                'email_verified_at' => now(),
            ]);
        }

        // Last-owner protection
        if ($existing && $existing->isOwner() && $data['role'] !== 'owner'
            && $organization->memberships()->where('role', 'owner')->count() <= 1) {
            return response()->json([
                'message' => 'An organization must keep at least one owner.',
                'errors' => (object) [],
            ], 409);
        }

        $membership = Membership::updateOrCreate(
            ['organization_id' => $organization->id, 'user_id' => $user->id],
            ['role' => $data['role']]
        );

        $this->auditLogger->logRequest($request, $existing ? 'organization.member_role_updated' : 'organization.member_added', 'organization', $organization->id, [
            'target_user_id' => $user->id,
            'role' => $data['role'],
        ]);

        return response()->json(['data' => $membership->load('user:id,name,email')], $existing ? 200 : 201);
    }

    public function removeMember(Request $request, Membership $membership)
    {
        $organization = $request->organization();
        $this->authorize('manageMembers', $organization);

        if ($membership->organization_id !== $organization->id) {
            abort(404);
        }

        if ($membership->isOwner() && $organization->memberships()->where('role', 'owner')->count() <= 1) {
            return response()->json([
                'message' => 'An organization must keep at least one owner.',
                'errors' => (object) [],
            ], 409);
        }

        $membership->delete();

        $this->auditLogger->logRequest($request, 'organization.member_removed', 'organization', $organization->id, [
            'removed_user_id' => $membership->user_id,
        ]);

        return response()->json(['data' => ['message' => 'Member removed.']]);
    }

    public function analytics(Request $request)
    {
        $organization = $request->organization();
        $this->authorize('view', $organization);

        $projectIds = $organization->projects()->pluck('id');

        $totalProjects = $projectIds->count();
        $totalDocuments = \App\Models\Document::whereIn('project_id', $projectIds)->count();
        $totalStorageBytes = (int) \App\Models\Document::whereIn('project_id', $projectIds)->sum('size_bytes');
        $totalExcerpts = \App\Models\Excerpt::whereIn('project_id', $projectIds)->count();
        $totalNotes = \App\Models\Note::whereIn('project_id', $projectIds)->count();
        $totalMembers = $organization->memberships()->count();

        $recentLogs = \App\Models\AuditLog::where('target_type', 'organization')
            ->where('target_id', (string) $organization->id)
            ->orWhereIn('target_id', $projectIds->map(fn ($id) => (string) $id))
            ->latest('id')
            ->limit(15)
            ->get();

        return response()->json([
            'data' => [
                'total_projects' => $totalProjects,
                'total_documents' => $totalDocuments,
                'total_storage_bytes' => $totalStorageBytes,
                'total_excerpts' => $totalExcerpts,
                'total_notes' => $totalNotes,
                'total_members' => $totalMembers,
                'recent_activity' => $recentLogs,
            ],
        ]);
    }
}
