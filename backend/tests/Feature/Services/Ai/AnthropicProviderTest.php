<?php

use App\Services\Ai\AnthropicProvider;
use Illuminate\Support\Facades\Http;

test('summarize sends the expected request shape and parses the reply', function () {
    Http::fake([
        'api.anthropic.com/*' => Http::response([
            'content' => [['type' => 'text', 'text' => 'A concise summary.']],
        ]),
    ]);

    $provider = new AnthropicProvider('test-key', 'claude-haiku-4-5');
    $result = $provider->summarize('Some document text.');

    expect($result)->toBe('A concise summary.');

    Http::assertSent(function ($request) {
        return $request->url() === 'https://api.anthropic.com/v1/messages'
            && $request->hasHeader('x-api-key', 'test-key')
            && $request->hasHeader('anthropic-version', '2023-06-01')
            && $request['model'] === 'claude-haiku-4-5'
            && $request['messages'][0] === ['role' => 'user', 'content' => 'Some document text.'];
    });
});

test('suggestTags parses a JSON array response', function () {
    Http::fake([
        'api.anthropic.com/*' => Http::response([
            'content' => [['type' => 'text', 'text' => '["Methodology"]']],
        ]),
    ]);

    $provider = new AnthropicProvider('test-key', 'claude-haiku-4-5');

    expect($provider->suggestTags('text', []))->toBe(['Methodology']);
});

test('a failed response throws', function () {
    Http::fake(['api.anthropic.com/*' => Http::response(['error' => 'bad'], 500)]);

    $provider = new AnthropicProvider('test-key', 'claude-haiku-4-5');

    expect(fn () => $provider->chat('ctx', [], 'hi'))->toThrow(RuntimeException::class);
});
