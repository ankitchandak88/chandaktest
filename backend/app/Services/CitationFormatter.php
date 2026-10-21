<?php

namespace App\Services;

/**
 * Deliberately simplified APA/MLA formatting (PROD-004): takes a flat
 * {author, title, year, publisher, url} shape rather than parsing a name
 * into last/first components or supporting multiple authors/edition
 * numbers/etc. Good enough to produce a usable citation string for a
 * single-author or organizational source; a fuller citation-management
 * feature (multiple authors, more styles, in-text citations) is future
 * work, not in this pass's scope.
 */
class CitationFormatter
{
    public function format(string $style, array $metadata): ?string
    {
        $title = trim((string) ($metadata['title'] ?? ''));

        if ($title === '') {
            return null;
        }

        $author = trim((string) ($metadata['author'] ?? ''));
        $year = trim((string) ($metadata['year'] ?? ''));
        $publisher = trim((string) ($metadata['publisher'] ?? ''));
        $url = trim((string) ($metadata['url'] ?? ''));

        return match ($style) {
            'apa' => $this->apa($author, $title, $year, $publisher, $url),
            'mla' => $this->mla($author, $title, $year, $publisher, $url),
            default => null,
        };
    }

    private function apa(string $author, string $title, string $year, string $publisher, string $url): string
    {
        $parts = [];

        if ($author !== '') {
            $parts[] = rtrim($author, '.').'.';
        }

        $parts[] = '('.($year !== '' ? $year : 'n.d.').').';
        $parts[] = rtrim($title, '.').'.';

        if ($publisher !== '') {
            $parts[] = rtrim($publisher, '.').'.';
        }

        if ($url !== '') {
            $parts[] = $url;
        }

        return implode(' ', $parts);
    }

    private function mla(string $author, string $title, string $year, string $publisher, string $url): string
    {
        $head = $author !== '' ? rtrim($author, '.').'. ' : '';
        $head .= '"'.rtrim($title, '.').'."';

        // Publisher/year/url trail the title as a single comma-joined list
        // ending in one period, regardless of which are actually present -
        // avoids the dangling-comma-with-no-terminator bug a field-by-field
        // join would have whenever only some of them are filled in.
        $tail = array_values(array_filter(
            [rtrim($publisher, ','), $year, $url],
            fn (string $v) => $v !== '',
        ));

        return $tail === [] ? $head : $head.' '.implode(', ', $tail).'.';
    }
}
