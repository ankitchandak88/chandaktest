<?php

namespace Database\Factories;

use App\Models\Document;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Document>
 *
 * organization_id, project_id and uploaded_by have no default - always pass
 * them explicitly so a document is never orphaned from a real tenant.
 */
class DocumentFactory extends Factory
{
    public function definition(): array
    {
        return [
            'original_filename' => fake()->word().'.pdf',
            'storage_key' => 'documents/test/'.Str::uuid().'.pdf',
            'checksum' => hash('sha256', Str::random(20)),
            'mime_type' => 'application/pdf',
            'size_bytes' => fake()->numberBetween(1000, 500000),
            'page_count' => fake()->numberBetween(1, 20),
            'status' => 'ready',
        ];
    }
}
