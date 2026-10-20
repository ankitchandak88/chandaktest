<?php

namespace App\Filament\Widgets;

use App\Models\Document;
use App\Models\Organization;
use App\Models\Subscription;
use App\Models\User;
use Filament\Widgets\StatsOverviewWidget as BaseWidget;
use Filament\Widgets\StatsOverviewWidget\Stat;

/**
 * Admin dashboard metrics (docs/06 section 6.2 "Dashboard: Signups, active
 * users, storage, processing failures, subscription metrics").
 */
class AdminOverviewWidget extends BaseWidget
{
    protected function getStats(): array
    {
        return [
            Stat::make('Signups (7 days)', User::where('created_at', '>=', now()->subDays(7))->count())
                ->description('New user registrations')
                ->color('success'),

            Stat::make('Organizations', Organization::count())
                ->description(Organization::where('status', 'suspended')->count().' suspended')
                ->color('primary'),

            Stat::make('Storage used', $this->formatBytes(Document::sum('size_bytes')))
                ->description('Across all organizations')
                ->color('warning'),

            Stat::make('Processing failures', Document::where('status', 'failed')->count())
                ->description('Documents that failed to process')
                ->color(Document::where('status', 'failed')->count() > 0 ? 'danger' : 'success'),

            Stat::make('Active subscriptions', Subscription::where('status', 'active')->count())
                ->description(Subscription::where('status', 'past_due')->count().' past due')
                ->color('success'),
        ];
    }

    private function formatBytes(?int $bytes): string
    {
        $bytes ??= 0;

        return $bytes >= 1073741824
            ? number_format($bytes / 1073741824, 2).' GB'
            : number_format($bytes / 1048576, 1).' MB';
    }
}
