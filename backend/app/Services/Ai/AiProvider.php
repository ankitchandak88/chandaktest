<?php

namespace App\Services\Ai;

/**
 * Narrow contract every AI driver must satisfy, same reasoning as
 * App\Services\Billing\PaymentProvider - callers never branch on "which
 * provider", and the provider is chosen purely by config (AI_PROVIDER),
 * which the admin controls (see Section 15 of the implementation brief:
 * "AI provider/privacy and budget" was explicitly the user's call, not
 * Claude's, to make). Three distinct methods rather than one generic
 * `complete(prompt)` because each has its own return shape and its own
 * prompt-construction concerns that belong inside the driver, not
 * duplicated at every call site.
 */
interface AiProvider
{
    public function name(): string;

    public function summarize(string $text): string;

    /**
     * @param  string[]  $existingTagNames  preferred over inventing new ones
     * @return string[]
     */
    public function suggestTags(string $text, array $existingTagNames): array;

    /**
     * @param  array<int, array{role: string, content: string}>  $history
     */
    public function chat(string $contextText, array $history, string $message): string;
}
