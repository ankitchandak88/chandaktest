<?php

namespace App\Policies;

use App\Models\Export;
use App\Models\User;
use App\Policies\Concerns\AuthorizesProjectAccess;

class ExportPolicy
{
    use AuthorizesProjectAccess;

    public function view(User $user, Export $export): bool
    {
        return $this->canViewProject($user, $export->project);
    }

    public function create(User $user, \App\Models\Project $project): bool
    {
        return $this->canViewProject($user, $project);
    }
}
