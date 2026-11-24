<?php

namespace App\Policies;

use App\Models\Project;
use App\Models\User;
use App\Models\Workspace;

class WorkspacePolicy
{
    use AuthorizesProjectAccess;

    public function viewAny(User $user, Project $project): bool
    {
        return $this->canAccessProject($user, $project, 'viewer');
    }

    public function view(User $user, Workspace $workspace): bool
    {
        return $this->canAccessProject($user, $workspace->project, 'viewer');
    }

    public function create(User $user, Project $project): bool
    {
        return $this->canAccessProject($user, $project, 'editor');
    }

    public function update(User $user, Workspace $workspace): bool
    {
        return $this->canAccessProject($user, $workspace->project, 'editor');
    }

    public function delete(User $user, Workspace $workspace): bool
    {
        return $this->canAccessProject($user, $workspace->project, 'editor');
    }
}
