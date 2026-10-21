<?php

namespace App\Policies;

use App\Models\Project;
use App\Models\ProjectShare;
use App\Models\User;
use App\Policies\Concerns\AuthorizesProjectAccess;

class ProjectSharePolicy
{
    use AuthorizesProjectAccess;

    public function viewAny(User $user, Project $project): bool
    {
        return $this->canViewProject($user, $project);
    }

    public function create(User $user, Project $project): bool
    {
        // Sharing is a form of editing the project's exposure, not just
        // viewing it - a viewer-role member shouldn't be able to mint a
        // public link to content they can't themselves modify.
        return $this->canEditProject($user, $project);
    }

    public function delete(User $user, ProjectShare $share): bool
    {
        return $this->canEditProject($user, $share->project);
    }
}
