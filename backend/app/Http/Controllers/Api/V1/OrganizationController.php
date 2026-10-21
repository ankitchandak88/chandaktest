<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Membership;
use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class OrganizationController extends Controller
{
    public function __construct(private readonly AuditLogger $auditLogger)
    {
    }

    /** List the organizations the current user belongs to, for a workspace switcher. */
    public function index(Request $request)
    {
        $memberships = $request->user()->memberships()->with('organization')->get();

        return response()->json(['data' => $memberships]);
    }

    public function show(Request $request)
    {
        $organization = $request->organization();
        $this->authorize('view', $organization);

        return response()->json(['data' => $organization->load('subscription.plan')]);
    }

    public function members(Request $request)
    {
        $organization = $request->organization();
        $this->authorize('view', $organization);

        $members = $organization->memberships()->with('user:id,name,email')->get();

        return response()->json(['data' => $members]);
    }

    public function addMember(Request $request)
    {
        $organization = $request->organization();
        $this->authorize('manageMembers', $organization);

        $data = $request->validate([
            'email' => ['required', 'email'],
            'role' => ['required', 'in:owner,member'],
        ]);

        $user = User::where('email', $data['email'])->first();

        if (! $user) {
            throw ValidationException::withMessages([
                'email' => ['No account with that email exists yet. They need to register first.'],
            ]);
        }

        $existing = Membership::where('organization_id', $organization->id)
            ->where('user_id', $user->id)
            ->first();

        // BUG-005 fix: this used to be firstOrCreate(), which silently kept
        // the OLD role if the membership already existed - an owner trying
        // to promote/demote an existing member through this same endpoint
        // (the obvious thing to try) saw a 201 "success" that changed
        // nothing. updateOrCreate() actually applies the requested role,
        // guarded by the same last-owner protection removeMember() already
        // has (demoting the sole owner would leave the organization
        // ownerless, same failure mode as removing them outright).
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
}
