<?php

namespace App\Providers;

use App\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Convenience accessors used throughout controllers/policies once
        // ResolveOrganization middleware has run.
        Request::macro('organization', function (): ?Organization {
            /** @var Request $this */
            return $this->attributes->get('organization');
        });

        Request::macro('membership', function () {
            /** @var Request $this */
            return $this->attributes->get('membership');
        });

        $this->configureRateLimiters();
    }

    private function configureRateLimiters(): void
    {
        // Required by Middleware::throttleApi() (bootstrap/app.php), which
        // applies 'throttle:api' to every api/* route.
        RateLimiter::for('api', fn (Request $request) => Limit::perMinute(120)->by(
            optional($request->user())->id ?: $request->ip()
        ));

        RateLimiter::for('auth', fn (Request $request) => Limit::perMinute(10)->by($request->ip()));

        RateLimiter::for('uploads', fn (Request $request) => Limit::perMinute(20)->by(
            optional($request->user())->id ?: $request->ip()
        ));

        RateLimiter::for('search', fn (Request $request) => Limit::perMinute(60)->by(
            optional($request->user())->id ?: $request->ip()
        ));

        RateLimiter::for('export', fn (Request $request) => Limit::perMinute(5)->by(
            optional($request->user())->id ?: $request->ip()
        ));

        RateLimiter::for('webhooks', fn (Request $request) => Limit::perMinute(120)->by($request->ip()));

        // SEC-003: addMember()'s "no account with that email exists yet"
        // response is deliberately informative for a legitimate owner, but
        // that same owner's account could otherwise be used to enumerate
        // arbitrary emails quickly. This is already gated to authorized
        // organization owners (not an anonymous/public endpoint), so the
        // realistic risk is an authenticated member abusing their own
        // access rather than open enumeration - rate limiting it is
        // defense in depth on top of that gating, not a replacement for it.
        RateLimiter::for('member-management', fn (Request $request) => Limit::perMinute(10)->by(
            optional($request->user())->id ?: $request->ip()
        ));
    }
}
