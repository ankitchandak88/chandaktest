<?php

namespace Database\Factories;

use App\Models\Excerpt;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Excerpt>
 *
 * organization_id, project_id, document_id and created_by have no default -
 * always pass them explicitly.
 */
class ExcerptFactory extends Factory
{
    public function definition(): array
    {
        return [
            'page_number' => fake()->numberBetween(1, 10),
            'text' => fake()->sentence(),
            'source_rects' => [['x' => 0.1, 'y' => 0.1, 'width' => 0.5, 'height' => 0.05]],
        ];
    }
}
