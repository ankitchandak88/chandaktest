<?php

namespace App\Policies;

use App\Models\Excerpt;
use App\Models\User;
use App\Policies\Concerns\AuthorizesProjectAccess;

class ExcerptPolicy
{
    use AuthorizesProjectAccess;

    public function view(User $user, Excerpt $excerpt): bool
    {
        return $this->canViewProject($user, $excerpt->project);
    }

    public function create(User $user, \App\Models\Project $project): bool
    {
        return $this->canEditProject($user, $project);
    }

    public function update(User $user, Excerpt $excerpt): bool
    {
        // SEC-001 fix: canViewProject() is a mandatory prerequisite, not just
        // an alternative path. Before this fix, `created_by === user.id`
        // short-circuited the `||` and granted update/delete rights even to
        // a user who had since been removed from the organization entirely
        // (no membership row at all) - owning content you created doesn't
        // outlive your actual access to the project.
        return $this->canViewProject($user, $excerpt->project)
            && ($excerpt->created_by === $user->id || $this->canEditProject($user, $excerpt->project));
    }

    public function delete(User $user, Excerpt $excerpt): bool
    {
        return $this->update($user, $excerpt);
    }
}
