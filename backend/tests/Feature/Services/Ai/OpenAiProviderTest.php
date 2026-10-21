<?php

use App\Services\Ai\OpenAiProvider;
use Illuminate\Support\Facades\Http;

// Verifies the request shape and response parsing against OpenAI's real
// Chat Completions API contract, without needing a live key - see
// OpenAiProvider's class docblock for why this is as far as it's tested.
test('summarize sends the expected request shape and parses the reply', function () {
    Http::fake([
        'api.openai.com/*' => Http::response([
            'choices' => [['message' => ['role' => 'assistant', 'content' => 'A concise summary.']]],
        ]),
    ]);

    $provider = new OpenAiProvider('test-key', 'gpt-4o-mini');
    $result = $provider->summarize('Some document text.');

    expect($result)->toBe('A concise summary.');

    Http::assertSent(function ($request) {
        return $request->url() === 'https://api.openai.com/v1/chat/completions'
            && $request->hasHeader('Authorization', 'Bearer test-key')
            && $request['model'] === 'gpt-4o-mini'
            && $request['messages'][0]['role'] === 'system'
            && $request['messages'][1] === ['role' => 'user', 'content' => 'Some document text.'];
    });
});

test('suggestTags parses a JSON array response', function () {
    Http::fake([
        'api.openai.com/*' => Http::response([
            'choices' => [['message' => ['content' => '["Methodology", "Results"]']]],
        ]),
    ]);

    $provider = new OpenAiProvider('test-key', 'gpt-4o-mini');

    expect($provider->suggestTags('text', ['Methodology']))->toBe(['Methodology', 'Results']);
});

test('suggestTags returns an empty array if the model replies with non-JSON', function () {
    Http::fake([
        'api.openai.com/*' => Http::response([
            'choices' => [['message' => ['content' => 'not json at all']]],
        ]),
    ]);

    $provider = new OpenAiProvider('test-key', 'gpt-4o-mini');

    expect($provider->suggestTags('text', []))->toBe([]);
});

test('chat includes prior history before the new message', function () {
    Http::fake(['api.openai.com/*' => Http::response([
        'choices' => [['message' => ['content' => 'reply']]],
    ])]);

    $provider = new OpenAiProvider('test-key', 'gpt-4o-mini');
    $provider->chat('doc context', [['role' => 'user', 'content' => 'earlier question']], 'new question');

    Http::assertSent(function ($request) {
        $messages = $request['messages'];

        return $messages[1] === ['role' => 'user', 'content' => 'earlier question']
            && $messages[2] === ['role' => 'user', 'content' => 'new question'];
    });
});

test('a failed response throws rather than silently returning an empty string', function () {
    Http::fake(['api.openai.com/*' => Http::response(['error' => 'bad request'], 400)]);

    $provider = new OpenAiProvider('test-key', 'gpt-4o-mini');

    expect(fn () => $provider->summarize('x'))->toThrow(RuntimeException::class);
});
