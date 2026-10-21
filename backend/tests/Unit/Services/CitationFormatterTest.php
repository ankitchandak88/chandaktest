<?php

use App\Services\CitationFormatter;

beforeEach(function () {
    $this->formatter = new CitationFormatter;
});

test('apa with full metadata', function () {
    $result = $this->formatter->format('apa', [
        'author' => 'Smith, J',
        'title' => 'A Study of Things',
        'year' => '2020',
        'publisher' => 'Acme Press',
        'url' => 'https://example.test/study',
    ]);

    expect($result)->toBe(
        'Smith, J. (2020). A Study of Things. Acme Press. https://example.test/study'
    );
});

test('apa falls back to n.d. when year is missing', function () {
    $result = $this->formatter->format('apa', ['title' => 'Untitled Work']);

    expect($result)->toBe('(n.d.). Untitled Work.');
});

test('mla with full metadata', function () {
    $result = $this->formatter->format('mla', [
        'author' => 'Smith, Jane',
        'title' => 'A Study of Things',
        'year' => '2020',
        'publisher' => 'Acme Press',
        'url' => 'https://example.test/study',
    ]);

    expect($result)->toBe(
        'Smith, Jane. "A Study of Things." Acme Press, 2020, https://example.test/study.'
    );
});

test('mla with only a title has no dangling punctuation', function () {
    $result = $this->formatter->format('mla', ['title' => 'Untitled Work']);

    expect($result)->toBe('"Untitled Work."');
});

test('mla with a publisher but no year or url still ends cleanly', function () {
    $result = $this->formatter->format('mla', [
        'title' => 'Untitled Work',
        'publisher' => 'Acme Press',
    ]);

    expect($result)->toBe('"Untitled Work." Acme Press.');
});

test('returns null when there is no title', function () {
    expect($this->formatter->format('apa', ['author' => 'Smith']))->toBeNull();
    expect($this->formatter->format('mla', []))->toBeNull();
});

test('returns null for an unknown style', function () {
    expect($this->formatter->format('chicago', ['title' => 'X']))->toBeNull();
});
