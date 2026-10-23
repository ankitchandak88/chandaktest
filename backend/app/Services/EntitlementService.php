<?php

namespace App\Services;

use App\Models\Organization;
use Illuminate\Support\Facades\DB;

/**
 * Single server-side source of truth for plan limits (docs/06, section 6.5:
 * "Implement a single server-side entitlement/limit service"). Every quota
 * check in the app goes through here so there is exactly one place that can
 * be wrong, and concurrent requests are protected with a row lock on the
 * organization's subscription during the check-and-create.
 */
class EntitlementService
{
    public function planFor(Organization $organization): \App\Models\Plan
    {
        $subscription = $organization->subscription;

        if ($subscription && $subscription->isActive()) {
            return $subscription->plan;
        }

        return \App\Models\Plan::where('code', 'free')->firstOrFail();
    }

    public function limits(Organization $organization): array
    {
        return $this->planFor($organization)->limits;
    }

    /**
     * Run $callback only if the organization is still under its project
     * quota, inside a transaction with a row lock so two concurrent
     * "create project" requests can't both slip past the limit.
     *
     * @throws \App\Exceptions\QuotaExceededException
     */
    public function withinProjectQuota(Organization $organization, callable $callback): mixed
    {
        return DB::transaction(function () use ($organization, $callback) {
            DB::table('organizations')->where('id', $organization->id)->lockForUpdate()->first();

            $limit = $this->planFor($organization)->limit('projects', 3);
            $current = $organization->projects()->count();

            if ($current >= $limit) {
                throw new \App\Exceptions\QuotaExceededException(
                    "Project limit reached ({$limit}). Upgrade your plan to create more projects."
                );
            }

            return $callback();
        });
    }

    public function withinDocumentQuota(Organization $organization, \App\Models\Project $project, int $uploadSizeBytes, callable $callback): mixed
    {
        return DB::transaction(function () use ($organization, $project, $uploadSizeBytes, $callback) {
            DB::table('organizations')->where('id', $organization->id)->lockForUpdate()->first();

            $plan = $this->planFor($organization);

            $docLimit = $plan->limit('documents_per_project', 10);
            $docCount = $project->documents()->count();

            if ($docCount >= $docLimit) {
                throw new \App\Exceptions\QuotaExceededException(
                    "Document limit reached for this project ({$docLimit})."
                );
            }

            $storageLimitBytes = $plan->limit('storage_mb', 500) * 1024 * 1024;
            $storageUsed = $this->storageUsedBytes($organization);

            if ($storageUsed + $uploadSizeBytes > $storageLimitBytes) {
                throw new \App\Exceptions\QuotaExceededException(
                    'Storage limit reached for your plan. Delete documents or upgrade to upload more.'
                );
            }

            return $callback();
        });
    }

    public function withinMemberQuota(Organization $organization, callable $callback): mixed
    {
        return DB::transaction(function () use ($organization, $callback) {
            DB::table('organizations')->where('id', $organization->id)->lockForUpdate()->first();

            $limit = $this->planFor($organization)->limit('seats', 1);
            $current = $organization->memberships()->count();

            if ($current >= $limit) {
                throw new \App\Exceptions\QuotaExceededException(
                    "Seat limit reached for your plan ({$limit} seats). Upgrade to Chambers (10 Seats) or Law Firm Enterprise (25 Seats) to add more members."
                );
            }

            return $callback();
        });
    }

    public function storageUsedBytes(Organization $organization): int
    {
        return (int) \App\Models\Document::where('organization_id', $organization->id)
            ->whereNull('deleted_at')
            ->sum('size_bytes');
    }

    public function usageSummary(Organization $organization): array
    {
        $plan = $this->planFor($organization);

        return [
            'plan' => $plan->code,
            'plan_name' => $plan->name,
            'members' => [
                'used' => $organization->memberships()->count(),
                'limit' => $plan->limit('seats', 1),
            ],
            'projects' => [
                'used' => $organization->projects()->count(),
                'limit' => $plan->limit('projects', 5),
            ],
            'storage_bytes' => [
                'used' => $this->storageUsedBytes($organization),
                'limit' => $plan->limit('storage_mb', 1000) * 1024 * 1024,
            ],
            'documents_per_project_limit' => $plan->limit('documents_per_project', 20),
        ];
    }
}
