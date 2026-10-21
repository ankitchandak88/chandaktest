<?php

namespace App\Policies;

use App\Models\Project;
use App\Models\Tag;
use App\Models\User;
use App\Policies\Concerns\AuthorizesProjectAccess;

class TagPolicy
{
    use AuthorizesProjectAccess;

    public function view(User $user, Tag $tag): bool
    {
        return $this->canViewProject($user, $tag->project);
    }

    public function create(User $user, Project $project): bool
    {
        return $this->canEditProject($user, $project);
    }

    public function delete(User $user, Tag $tag): bool
    {
        return $this->canEditProject($user, $tag->project);
    }
}
