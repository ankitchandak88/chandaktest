<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Document;
use App\Models\Excerpt;
use App\Models\Note;
use App\Services\AiAssistantService;
use Illuminate\Http\Request;

class AiController extends Controller
{
    public function __construct(private readonly AiAssistantService $assistant)
    {
    }

    public function summarizeDocument(Request $request, Document $document)
    {
        $this->authorize('view', $document);

        $data = $request->validate(['force' => ['sometimes', 'boolean']]);

        $summary = $this->assistant->summarizeDocument($document, $data['force'] ?? false);

        return response()->json(['data' => ['summary' => $summary]]);
    }

    public function chatAboutDocument(Request $request, Document $document)
    {
        $this->authorize('view', $document);

        $data = $request->validate([
            'message' => ['required', 'string', 'max:4000'],
            'history' => ['sometimes', 'array', 'max:20'],
            'history.*.role' => ['required_with:history', 'in:user,assistant'],
            'history.*.content' => ['required_with:history', 'string', 'max:4000'],
        ]);

        $reply = $this->assistant->chatAboutDocument($document, $data['history'] ?? [], $data['message']);

        return response()->json(['data' => ['reply' => $reply]]);
    }

    public function suggestExcerptTags(Request $request, Excerpt $excerpt)
    {
        $this->authorize('view', $excerpt);

        $existing = $excerpt->project->tags()->pluck('name')->all();
        $suggestions = $this->assistant->suggestTags($excerpt->text, $existing);

        return response()->json(['data' => ['suggestions' => $suggestions]]);
    }

    public function suggestNoteTags(Request $request, Note $note)
    {
        $this->authorize('view', $note);

        $existing = $note->project->tags()->pluck('name')->all();
        $suggestions = $this->assistant->suggestTags((string) $note->content, $existing);

        return response()->json(['data' => ['suggestions' => $suggestions]]);
    }
}
