<?php

use App\Http\Middleware\ResolveOrganization;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Sentry\Laravel\Integration as SentryIntegration;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Pure bearer-token API: both the React web app and the Flutter app
        // authenticate the same way (Sanctum personal access tokens), so we
        // deliberately skip the cookie/session "stateful" middleware here.
        $middleware->alias([
            'org' => ResolveOrganization::class,
        ]);

        // Phase 14: every request gets one id up front, before anything else
        // runs, so it's available to both the error JSON body (render(),
        // below) and every log line/Sentry event for that request.
        $middleware->api(prepend: [\App\Http\Middleware\AssignRequestId::class]);

        $middleware->throttleApi();
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // Phase 14: routes every reported exception to Sentry too (no-op
        // until SENTRY_LARAVEL_DSN is set - same config-driven-until-an-
        // admin-provides-a-key pattern as AI_PROVIDER/PAYMENT_PROVIDER).
        SentryIntegration::handles($exceptions);

        $exceptions->shouldRenderJsonWhen(fn (Request $request) => $request->is('api/*') || $request->expectsJson());

        $exceptions->reportable(function (\Throwable $e) {
            $request = request();

            \Sentry\configureScope(function (\Sentry\State\Scope $scope) use ($request) {
                $requestId = $request->attributes->get('request_id');

                if ($requestId) {
                    $scope->setTag('request_id', $requestId);
                }

                if ($organization = $request->attributes->get('organization')) {
                    $scope->setTag('organization_id', $organization->id);
                }

                if ($user = $request->user()) {
                    $scope->setUser(['id' => $user->id, 'email' => $user->email]);
                }
            });
        });

        $exceptions->render(function (\Throwable $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            $requestId = $request->attributes->get('request_id') ?? (string) \Illuminate\Support\Str::uuid();

            if ($e instanceof ValidationException) {
                return response()->json([
                    'message' => $e->getMessage(),
                    'errors' => $e->errors(),
                    'request_id' => $requestId,
                ], 422);
            }

            if ($e instanceof HttpExceptionInterface) {
                $status = $e->getStatusCode();

                return response()->json([
                    'message' => $e->getMessage() ?: 'The request could not be completed.',
                    'errors' => (object) [],
                    'request_id' => $requestId,
                ], $status);
            }

            if (! app()->hasDebugModeEnabled()) {
                report($e);

                return response()->json([
                    'message' => 'The request could not be completed.',
                    'errors' => (object) [],
                    'request_id' => $requestId,
                ], 500);
            }

            return null;
        });
    })->create();
