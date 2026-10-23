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

    /**
     * Phase 6: compiles this document's own highlight-type annotations
     * (the `text` captured on each one at creation time, same field
     * HiLiteView already reads on both platforms) and asks the provider
     * for a synthesis - "what did I think was important", not "what is
     * this document about" (that's summarizeDocument).
     */
    public function summarizeHighlights(Document $document): string
    {
        $highlightsText = $document->annotations()
            ->where('type', 'highlight')
            ->orderBy('page_number')
            ->get()
            ->map(fn ($a) => (string) ($a->payload['text'] ?? ''))
            ->filter()
            ->implode("\n\n");

        return $this->provider->summarizeHighlights(mb_substr($highlightsText, 0, self::MAX_CONTEXT_CHARS));
    }

    /**
     * Suggest-only, never auto-applied (same posture as suggestTags) -
     * the caller is responsible for letting the user review and create
     * each suggested highlight themselves.
     *
     * @return string[]
     */
    public function suggestHighlights(Document $document): array
    {
        return $this->provider->suggestHighlights($this->documentText($document));
    }

    private function documentText(Document $document): string
    {
        $text = $document->pages()->orderBy('page_number')->pluck('text')->implode("\n\n");

        return mb_substr($text, 0, self::MAX_CONTEXT_CHARS);
    }
}
