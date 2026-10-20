<?php

namespace App\Services;

use App\Models\AuditLog;
use Illuminate\Http\Request;

/**
 * Records security/admin-sensitive actions (docs/02 section 2.6 and docs/06
 * section 6.2). Called from controllers/Filament actions — never silently
 * skipped for suspend/restore/plan-change/webhook-driven entitlement
 * changes.
 */
class AuditLogger
{
    public function log(?int $actorId, string $action, ?string $targetType = null, ?string $targetId = null, array $metadata = [], ?string $ip = null): AuditLog
    {
        return AuditLog::create([
            'actor_id' => $actorId,
            'action' => $action,
            'target_type' => $targetType,
            'target_id' => $targetId,
            'metadata' => $metadata,
            'ip_address' => $ip,
        ]);
    }

    public function logRequest(Request $request, string $action, ?string $targetType = null, ?string $targetId = null, array $metadata = []): AuditLog
    {
        return $this->log(
            optional($request->user())->id,
            $action,
            $targetType,
            $targetId,
            $metadata,
            $request->ip()
        );
    }
}
