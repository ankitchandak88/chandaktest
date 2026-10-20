<?php

namespace App\Policies;

use App\Models\Link;
use App\Models\User;
use App\Policies\Concerns\AuthorizesProjectAccess;

class LinkPolicy
{
    use AuthorizesProjectAccess;

    public function view(User $user, Link $link): bool
    {
        return $this->canViewProject($user, $link->project);
    }

    public function create(User $user, \App\Models\Project $project): bool
    {
        return $this->canEditProject($user, $project);
    }

    public function delete(User $user, Link $link): bool
    {
        return $this->canEditProject($user, $link->project);
    }
}
