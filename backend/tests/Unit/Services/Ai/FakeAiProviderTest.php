<?php

use App\Services\Ai\FakeAiProvider;

beforeEach(function () {
    $this->provider = new FakeAiProvider;
});

test('summarize returns a truncated, clearly-labeled stand-in', function () {
    $summary = $this->provider->summarize('Research about distributed systems and consensus protocols.');

    expect($summary)->toContain('[Fake AI summary');
    expect($summary)->toContain('Research about distributed systems');
});

test('summarize handles empty text without throwing', function () {
    expect($this->provider->summarize(''))->toBe('(No extractable text to summarize.)');
});

test('suggestTags prefers an existing project tag over inventing a new one', function () {
    $suggestions = $this->provider->suggestTags(
        'This paper discusses methodology methodology methodology extensively throughout.',
        ['Methodology', 'Other Tag']
    );

    expect($suggestions)->toContain('Methodology');
});

test('suggestTags falls back to a capitalized frequent word when nothing existing matches', function () {
    $suggestions = $this->provider->suggestTags(
        str_repeat('blockchain blockchain blockchain consensus consensus ', 3),
        []
    );

    expect($suggestions)->toContain('Blockchain');
});

test('chat acknowledges the message and context size', function () {
    $reply = $this->provider->chat('some document context', [], 'What is this about?');

    expect($reply)->toContain('What is this about?');
    expect($reply)->toContain('[Fake AI');
});
