<?php

namespace App\Policies;

use App\Models\Organization;
use App\Models\User;

class OrganizationPolicy
{
    public function view(User $user, Organization $organization): bool
    {
        return $user->memberships()->where('organization_id', $organization->id)->exists();
    }

    public function update(User $user, Organization $organization): bool
    {
        return $user->memberships()
            ->where('organization_id', $organization->id)
            ->where('role', 'owner')
            ->exists();
    }

    public function manageMembers(User $user, Organization $organization): bool
    {
        return $this->update($user, $organization);
    }
}
