<?php

namespace App\Services;

use App\Models\Document;
use App\Services\Ai\AiProvider;

/**
 * Sits between controllers and the configured AiProvider driver: builds the
 * actual context text (truncated so a long document doesn't blow past a
 * reasonable prompt size / cost) and caches the one result worth caching
 * (a document's summary - chat and tag suggestions are inherently
 * per-request/per-text, nothing to cache).
 */
class AiAssistantService
{
    private const MAX_CONTEXT_CHARS = 12000;

    public function __construct(private readonly AiProvider $provider)
    {
    }

    public function summarizeDocument(Document $document, bool $force = false): string
    {
        if (! $force && $document->ai_summary !== null) {
            return $document->ai_summary;
        }

        $summary = $this->provider->summarize($this->documentText($document));
        $document->forceFill(['ai_summary' => $summary])->save();

        return $summary;
    }

    /**
     * @param  string[]  $existingTagNames
     * @return string[]
     */
    public function suggestTags(string $text, array $existingTagNames): array
    {
        return $this->provider->suggestTags($text, $existingTagNames);
    }

    /**
     * @param  array<int, array{role: string, content: string}>  $history
     */
    public function chatAboutDocument(Document $document, array $history, string $message): string
    {
        return $this->provider->chat($this->documentText($document), $history, $message);
    }

    private function documentText(Document $document): string
    {
        $text = $document->pages()->orderBy('page_number')->pluck('text')->implode("\n\n");

        return mb_substr($text, 0, self::MAX_CONTEXT_CHARS);
    }
}
