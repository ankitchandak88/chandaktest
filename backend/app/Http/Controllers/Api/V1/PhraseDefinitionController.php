<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Document;
use App\Models\PhraseDefinition;
use App\Models\Project;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class PhraseDefinitionController extends Controller
{
    public function index(Request $request, Project $project)
    {
        $this->authorize('view', $project);

        $query = $project->phraseDefinitions();

        if ($request->has('document_id')) {
            $query->where('document_id', $request->query('document_id'));
        }

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('term', 'like', "%{$search}%")
                  ->orWhere('definition', 'like', "%{$search}%");
            });
        }

        return response()->json(['data' => $query->get()]);
    }

    public function store(Request $request, Project $project)
    {
        $this->authorize('update', $project);

        $data = $request->validate([
            'document_id' => ['nullable', 'uuid', 'exists:documents,id'],
            'term' => ['required', 'string', 'max:150'],
            'definition' => ['required', 'string'],
            'page_number' => ['nullable', 'integer'],
            'source_rects' => ['nullable', 'array'],
        ]);

        $term = PhraseDefinition::updateOrCreate(
            [
                'project_id' => $project->id,
                'term' => trim($data['term']),
            ],
            [
                'document_id' => $data['document_id'] ?? null,
                'definition' => trim($data['definition']),
                'page_number' => $data['page_number'] ?? null,
                'source_rects' => $data['source_rects'] ?? null,
            ]
        );

        return response()->json(['data' => $term], 201);
    }

    public function destroy(Request $request, PhraseDefinition $phraseDefinition)
    {
        $this->authorize('update', $phraseDefinition->project);

        $phraseDefinition->delete();

        return response()->json(['data' => ['message' => 'Phrase definition removed.']]);
    }

    /**
     * Auto-detect and extract Defined Terms from a document's excerpts or text
     * Matching patterns like: "Term" means..., “Term” shall mean..., "Term" has the meaning...
     */
    public function extract(Request $request, Document $document)
    {
        $this->authorize('update', $document->project);

        $extracted = [];

        // Check document excerpts first
        $excerpts = $document->excerpts()->get();
        foreach ($excerpts as $excerpt) {
            $terms = $this->parseDefinitionSentences($excerpt->text, $excerpt->page_number);
            foreach ($terms as $t) {
                $saved = PhraseDefinition::updateOrCreate(
                    [
                        'project_id' => $document->project_id,
                        'term' => $t['term'],
                    ],
                    [
                        'document_id' => $document->id,
                        'definition' => $t['definition'],
                        'page_number' => $t['page_number'],
                        'source_rects' => $excerpt->source_rects,
                    ]
                );
                $extracted[] = $saved;
            }
        }

        return response()->json([
            'data' => $extracted,
            'message' => count($extracted) . ' defined terms extracted.',
        ]);
    }

    private function parseDefinitionSentences(string $text, ?int $pageNumber): array
    {
        $results = [];

        // Patterns:
        // "Term" means ...
        // “Term” shall mean ...
        // "Term" refers to ...
        // "Term" has the meaning ...
        $pattern = '/["“]([A-Za-z0-9\s\-\(\)\.,]{2,60})["”]\s+(means|shall\s+mean|refers\s+to|has\s+the\s+meaning|shall\s+have\s+the\s+meaning)\s+([^;\.\n]+)/i';

        if (preg_match_all($pattern, $text, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $m) {
                $term = trim($m[1]);
                $connector = trim($m[2]);
                $definitionText = trim($m[3]);

                if (strlen($term) > 1 && strlen($definitionText) > 5) {
                    $results[] = [
                        'term' => $term,
                        'definition' => ucfirst($connector) . ' ' . $definitionText,
                        'page_number' => $pageNumber,
                    ];
                }
            }
        }

        return $results;
    }
}
