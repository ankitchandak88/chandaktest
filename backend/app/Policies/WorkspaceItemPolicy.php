<?php

namespace App\Policies;

use App\Models\User;
use App\Models\WorkspaceItem;
use App\Policies\Concerns\AuthorizesProjectAccess;

class WorkspaceItemPolicy
{
    use AuthorizesProjectAccess;

    public function view(User $user, WorkspaceItem $item): bool
    {
        return $this->canViewProject($user, $item->project);
    }

    public function create(User $user, \App\Models\Project $project): bool
    {
        return $this->canEditProject($user, $project);
    }

    public function update(User $user, WorkspaceItem $item): bool
    {
        return $this->canEditProject($user, $item->project);
    }

    public function delete(User $user, WorkspaceItem $item): bool
    {
        return $this->update($user, $item);
    }
}
