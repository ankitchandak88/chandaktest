<?php

namespace App\Policies;

use App\Models\Annotation;
use App\Models\User;
use App\Policies\Concerns\AuthorizesProjectAccess;

class AnnotationPolicy
{
    use AuthorizesProjectAccess;

    public function view(User $user, Annotation $annotation): bool
    {
        return $this->canViewProject($user, $annotation->project);
    }

    public function create(User $user, \App\Models\Project $project): bool
    {
        return $this->canEditProject($user, $project);
    }

    public function update(User $user, Annotation $annotation): bool
    {
        // SEC-001 fix - see ExcerptPolicy::update() for the full explanation:
        // active project access is now a mandatory prerequisite, not an
        // alternative to the creator check.
        return $this->canViewProject($user, $annotation->project)
            && ($annotation->created_by === $user->id || $this->canEditProject($user, $annotation->project));
    }

    public function delete(User $user, Annotation $annotation): bool
    {
        return $this->update($user, $annotation);
    }
}
