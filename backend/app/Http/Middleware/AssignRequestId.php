<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Context;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * Phase 14: gives every API request a single id that ties together its
 * error response (`request_id` in the JSON body, see bootstrap/app.php's
 * exception rendering), its log entries, and its Sentry event - so a user
 * reporting "I got an error" can hand over one value that's greppable/
 * searchable everywhere instead of needing a timestamp and a guess.
 */
class AssignRequestId
{
    public function handle(Request $request, Closure $next): Response
    {
        $requestId = (string) Str::uuid();

        $request->attributes->set('request_id', $requestId);
        Context::add('request_id', $requestId);

        $response = $next($request);
        $response->headers->set('X-Request-Id', $requestId);

        return $response;
    }
}
