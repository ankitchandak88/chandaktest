<?php

namespace App\Providers;

use App\Services\Ai\AiProvider;
use App\Services\Ai\AnthropicProvider;
use App\Services\Ai\FakeAiProvider;
use App\Services\Ai\OpenAiProvider;
use Illuminate\Support\ServiceProvider;

class AiServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(AiProvider::class, function () {
            return match (config('services.ai_provider')) {
                'openai' => new OpenAiProvider(
                    config('services.openai.api_key') ?? '',
                    config('services.openai.model'),
                ),
                'anthropic' => new AnthropicProvider(
                    config('services.anthropic.api_key') ?? '',
                    config('services.anthropic.model'),
                ),
                default => new FakeAiProvider,
            };
        });
    }

    public function boot(): void
    {
        //
    }
}
