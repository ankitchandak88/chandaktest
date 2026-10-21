<?php

namespace App\Services\Ai;

use Illuminate\Support\Str;

/**
 * Local/dev/test-only driver (AI_PROVIDER=fake, the default - the brief's
 * Section 15 flagged provider choice/budget as something only the user
 * should decide, and no real key exists in this environment, so this is
 * what every environment gets until an admin configures OPENAI_API_KEY/
 * ANTHROPIC_API_KEY and sets AI_PROVIDER accordingly). Deterministic,
 * heuristic, and clearly labeled as a stand-in rather than pretending to
 * be a real model - same spirit as FakePaymentProvider.
 */
class FakeAiProvider implements AiProvider
{
    private const STOPWORDS = [
        'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has',
        'are', 'was', 'were', 'but', 'not', 'you', 'your', 'our', 'their',
        'which', 'what', 'when', 'where', 'who', 'will', 'can', 'could',
        'would', 'should', 'into', 'about', 'than', 'then', 'them', 'they',
        'its', 'it is', 'also', 'such', 'these', 'those', 'been', 'being',
        'more', 'most', 'some', 'each', 'other', 'only', 'very', 'just',
    ];

    public function name(): string
    {
        return 'fake';
    }

    public function summarize(string $text): string
    {
        $plain = trim(preg_replace('/\s+/', ' ', strip_tags($text)) ?? '');

        if ($plain === '') {
            return '(No extractable text to summarize.)';
        }

        return '[Fake AI summary - configure AI_PROVIDER for a real one] '.Str::words($plain, 60, '…');
    }

    public function suggestTags(string $text, array $existingTagNames): array
    {
        $words = str_word_count(strtolower(strip_tags($text)), 1);
        $counts = [];

        foreach ($words as $word) {
            if (strlen($word) < 5 || in_array($word, self::STOPWORDS, true)) {
                continue;
            }
            $counts[$word] = ($counts[$word] ?? 0) + 1;
        }

        arsort($counts);
        $topWords = array_slice(array_keys($counts), 0, 5);

        // Prefer an existing tag name if it happens to match a frequent
        // word, so suggestions reuse the project's tag vocabulary instead
        // of always minting near-duplicates.
        $existingLower = array_map('strtolower', $existingTagNames);

        return array_map(function (string $word) use ($existingTagNames, $existingLower) {
            $match = array_search($word, $existingLower, true);

            return $match !== false ? $existingTagNames[$match] : ucfirst($word);
        }, $topWords);
    }

    public function chat(string $contextText, array $history, string $message): string
    {
        $contextLength = strlen($contextText);

        return "[Fake AI - configure AI_PROVIDER for real answers] You asked: \"{$message}\". ".
            "I have {$contextLength} characters of context and ".count($history).' prior message(s), '.
            'but this driver only returns canned text.';
    }
}
