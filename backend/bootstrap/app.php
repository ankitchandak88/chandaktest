<?php

use App\Http\Middleware\ResolveOrganization;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
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

        $middleware->throttleApi();
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(fn (Request $request) => $request->is('api/*') || $request->expectsJson());

        $exceptions->render(function (\Throwable $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            $requestId = (string) \Illuminate\Support\Str::uuid();

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
