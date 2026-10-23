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

test('summarizeHighlights returns a truncated, clearly-labeled stand-in', function () {
    $summary = $this->provider->summarizeHighlights('Important finding about distributed consensus.');

    expect($summary)->toContain('[Fake AI summary');
    expect($summary)->toContain('Important finding about distributed consensus');
});

test('summarizeHighlights handles no-highlights-yet text without throwing', function () {
    expect($this->provider->summarizeHighlights(''))->toBe('(No highlights yet to summarize.)');
});

test('suggestHighlights returns verbatim sentences from the source text, not paraphrases', function () {
    $text = 'Methodology methodology methodology was rigorous throughout. The weather was mild that day.';

    $suggestions = $this->provider->suggestHighlights($text);

    expect($suggestions)->not->toBeEmpty();
    foreach ($suggestions as $suggestion) {
        expect($text)->toContain($suggestion);
    }
});

test('suggestHighlights returns nothing for empty text', function () {
    expect($this->provider->suggestHighlights(''))->toBe([]);
});
