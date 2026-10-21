<?php

namespace App\Policies;

use App\Models\Document;
use App\Models\User;
use App\Policies\Concerns\AuthorizesProjectAccess;

class DocumentPolicy
{
    use AuthorizesProjectAccess;

    public function view(User $user, Document $document): bool
    {
        return $this->canViewProject($user, $document->project);
    }

    public function create(User $user, \App\Models\Project $project): bool
    {
        return $this->canEditProject($user, $project);
    }

    public function update(User $user, Document $document): bool
    {
        return $this->canEditProject($user, $document->project);
    }

    public function delete(User $user, Document $document): bool
    {
        return $this->canEditProject($user, $document->project);
    }
}
