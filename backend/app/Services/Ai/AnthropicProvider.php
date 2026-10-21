<?php

namespace App\Services\Ai;

use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * AI_PROVIDER=anthropic. Same disclaimer as OpenAiProvider - wired against
 * the real Messages API shape but never exercised against a live key here.
 */
class AnthropicProvider implements AiProvider
{
    public function __construct(
        private readonly string $apiKey,
        private readonly string $model,
    ) {
    }

    public function name(): string
    {
        return 'anthropic';
    }

    public function summarize(string $text): string
    {
        return $this->complete(
            'You summarize research document text concisely (3-5 sentences). Respond with only the summary.',
            [['role' => 'user', 'content' => $text]]
        );
    }

    public function suggestTags(string $text, array $existingTagNames): array
    {
        $existing = implode(', ', $existingTagNames) ?: '(none yet)';
        $system = 'You suggest up to 5 short topical tags for the given research excerpt/note text. '.
            "Prefer reusing one of these existing project tags when it genuinely fits: {$existing}. ".
            'Respond with ONLY a JSON array of strings, nothing else.';

        $raw = $this->complete($system, [['role' => 'user', 'content' => $text]]);
        $decoded = json_decode($raw, true);

        return is_array($decoded) ? array_values(array_filter($decoded, 'is_string')) : [];
    }

    public function chat(string $contextText, array $history, string $message): string
    {
        $system = "You answer questions about the following source document. If the answer isn't in the ".
            "text, say so rather than guessing.\n\n---\n{$contextText}\n---";

        $messages = [...$history, ['role' => 'user', 'content' => $message]];

        return $this->complete($system, $messages);
    }

    private function complete(string $system, array $messages): string
    {
        $response = Http::withHeaders([
            'x-api-key' => $this->apiKey,
            'anthropic-version' => '2023-06-01',
        ])
            ->timeout(30)
            ->post('https://api.anthropic.com/v1/messages', [
                'model' => $this->model,
                'max_tokens' => 1024,
                'system' => $system,
                'messages' => $messages,
            ]);

        if ($response->failed()) {
            throw new RuntimeException('Anthropic request failed: '.$response->body());
        }

        return (string) $response->json('content.0.text', '');
    }
}
