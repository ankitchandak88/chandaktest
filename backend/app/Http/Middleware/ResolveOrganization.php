<?php

namespace App\Http\Middleware;

use App\Models\Membership;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves the authenticated user's active organization (tenant) for this
 * request and binds it as `$request->attributes->get('organization')`.
 *
 * The client selects the active organization with the `X-Organization-Id`
 * header. When the user belongs to exactly one organization, that header is
 * optional. Every tenant-owned route further down the stack relies on this
 * middleware having already verified membership, so controllers/policies can
 * trust `$request->organization()`.
 */
class ResolveOrganization
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user) {
            return response()->json([
                'message' => 'Unauthenticated.',
                'errors' => (object) [],
            ], 401);
        }

        $organizationId = $request->header('X-Organization-Id');

        $membership = $organizationId
            ? $user->memberships()->where('organization_id', $organizationId)->with('organization')->first()
            : $user->memberships()->with('organization')->orderBy('created_at')->first();

        if (! $membership || ! $membership->organization) {
            return response()->json([
                'message' => 'No accessible organization. Provide a valid X-Organization-Id header.',
                'errors' => (object) [],
            ], 403);
        }

        if ($membership->organization->isSuspended()) {
            return response()->json([
                'message' => 'This organization has been suspended.',
                'errors' => (object) [],
            ], 403);
        }

        $request->attributes->set('organization', $membership->organization);
        $request->attributes->set('membership', $membership);

        return $next($request);
    }
}
