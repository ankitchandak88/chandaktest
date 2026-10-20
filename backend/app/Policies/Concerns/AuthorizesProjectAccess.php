<?php

namespace App\Policies\Concerns;

use App\Models\Membership;
use App\Models\Project;
use App\Models\User;

/**
 * Shared tenant/project access checks reused by every resource policy that
 * hangs off a project (documents, annotations, excerpts, notes, workspace
 * items, links, exports). Centralising this means every one of those
 * policies enforces the same two rules:
 *
 *  1. The user must have an active membership in the project's organization.
 *  2. If the project has explicit `project_members` rows, the user must be
 *     one of them (project_members is "optional project access" per the
 *     database design doc: most projects won't restrict further).
 */
trait AuthorizesProjectAccess
{
    protected function membershipFor(User $user, string $organizationId): ?Membership
    {
        return $user->memberships()->where('organization_id', $organizationId)->first();
    }

    protected function canViewProject(User $user, Project $project): bool
    {
        $membership = $this->membershipFor($user, $project->organization_id);

        if (! $membership) {
            return false;
        }

        if ($project->members()->exists()) {
            return $project->members()->where('user_id', $user->id)->exists() || $membership->isOwner();
        }

        return true;
    }

    protected function canEditProject(User $user, Project $project): bool
    {
        if (! $this->canViewProject($user, $project)) {
            return false;
        }

        $explicitRole = $project->members()->where('user_id', $user->id)->value('role');

        return $explicitRole !== 'viewer';
    }
}
