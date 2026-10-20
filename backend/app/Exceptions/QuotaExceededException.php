<?php

namespace App\Exceptions;

use Exception;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class QuotaExceededException extends Exception
{
    public function render(Request $request): JsonResponse
    {
        return response()->json([
            'message' => $this->getMessage(),
            'errors' => (object) [],
            'request_id' => (string) \Illuminate\Support\Str::uuid(),
        ], 402);
    }
}
