<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\EntitlementService;
use Illuminate\Http\Request;

class UsageController extends Controller
{
    public function __construct(private readonly EntitlementService $entitlements)
    {
    }

    public function show(Request $request)
    {
        $organization = $request->organization();
        $this->authorize('view', $organization);

        return response()->json(['data' => $this->entitlements->usageSummary($organization)]);
    }
}
