<?php

namespace App\Policies;

use App\Models\Note;
use App\Models\User;
use App\Policies\Concerns\AuthorizesProjectAccess;

class NotePolicy
{
    use AuthorizesProjectAccess;

    public function view(User $user, Note $note): bool
    {
        return $this->canViewProject($user, $note->project);
    }

    public function create(User $user, \App\Models\Project $project): bool
    {
        return $this->canEditProject($user, $project);
    }

    public function update(User $user, Note $note): bool
    {
        // SEC-001 fix - see ExcerptPolicy::update() for the full explanation:
        // active project access is now a mandatory prerequisite, not an
        // alternative to the creator check.
        return $this->canViewProject($user, $note->project)
            && ($note->created_by === $user->id || $this->canEditProject($user, $note->project));
    }

    public function delete(User $user, Note $note): bool
    {
        return $this->update($user, $note);
    }
}
