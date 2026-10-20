<?php

namespace App\Policies;

use App\Models\Project;
use App\Models\User;
use App\Policies\Concerns\AuthorizesProjectAccess;

class ProjectPolicy
{
    use AuthorizesProjectAccess;

    public function viewAny(User $user): bool
    {
        return true; // scoped to the active organization in the controller query itself.
    }

    public function create(User $user): bool
    {
        return true; // any organization member may create a project; limits are enforced separately.
    }

    public function view(User $user, Project $project): bool
    {
        return $this->canViewProject($user, $project);
    }

    public function update(User $user, Project $project): bool
    {
        return $this->canEditProject($user, $project);
    }

    public function delete(User $user, Project $project): bool
    {
        $membership = $this->membershipFor($user, $project->organization_id);

        return $project->created_by === $user->id || ($membership && $membership->isOwner());
    }
}
