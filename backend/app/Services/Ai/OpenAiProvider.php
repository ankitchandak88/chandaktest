<?php

namespace App\Services\Ai;

use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * AI_PROVIDER=openai. Wired against OpenAI's Chat Completions API but not
 * exercised against the real endpoint in this environment - no live
 * OPENAI_API_KEY exists here, same position RazorpayPaymentProvider was
 * left in. Request/response shape is covered by Http::fake() in tests
 * instead (see tests/Feature/Services/Ai/OpenAiProviderTest.php).
 */
class OpenAiProvider implements AiProvider
{
    public function __construct(
        private readonly string $apiKey,
        private readonly string $model,
    ) {
    }

    public function name(): string
    {
        return 'openai';
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

    public function summarizeHighlights(string $highlightsText): string
    {
        return $this->complete(
            'You synthesize a reader\'s own highlighted passages from a document into a short, coherent '.
            "summary (3-5 sentences) of what they found important. Respond with only the summary.",
            [['role' => 'user', 'content' => $highlightsText]]
        );
    }

    public function suggestHighlights(string $documentText): array
    {
        $system = 'You suggest up to 5 short passages (verbatim substrings, copied exactly from the given '.
            'text, not paraphrased) from this document that are worth highlighting as important. '.
            'Respond with ONLY a JSON array of strings, nothing else.';

        $raw = $this->complete($system, [['role' => 'user', 'content' => $documentText]]);
        $decoded = json_decode($raw, true);

        return is_array($decoded) ? array_values(array_filter($decoded, 'is_string')) : [];
    }

    private function complete(string $system, array $messages): string
    {
        $response = Http::withToken($this->apiKey)
            ->timeout(30)
            ->post('https://api.openai.com/v1/chat/completions', [
                'model' => $this->model,
                'messages' => [
                    ['role' => 'system', 'content' => $system],
                    ...$messages,
                ],
            ]);

        if ($response->failed()) {
            throw new RuntimeException('OpenAI request failed: '.$response->body());
        }

        return (string) $response->json('choices.0.message.content', '');
    }
}
