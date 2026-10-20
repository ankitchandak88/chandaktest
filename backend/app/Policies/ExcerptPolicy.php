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
        return $excerpt->created_by === $user->id || $this->canEditProject($user, $excerpt->project);
    }

    public function delete(User $user, Excerpt $excerpt): bool
    {
        return $this->update($user, $excerpt);
    }
}
