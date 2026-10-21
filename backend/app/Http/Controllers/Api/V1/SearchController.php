<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\DocumentPage;
use App\Models\Excerpt;
use App\Models\Note;
use App\Models\Project;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SearchController extends Controller
{
    /**
     * Full-text search scoped to a single project the caller can access
     * (docs/04 endpoint inventory + BE-013 "cross-tenant search -> no
     * unauthorized results"). Uses MySQL's native FULLTEXT indexes rather
     * than a dedicated search service, per docs/02's "PostgreSQL/MySQL
     * full-text initially, evaluate dedicated search only when needed".
     */
    public function index(Request $request)
    {
        // BE-007: validation must match what MySQL can actually index, not
        // just what seems reasonable. This server's innodb_ft_min_token_size
        // is 3 (confirmed via `SHOW VARIABLES`, not assumed) - a 2-character
        // term like "AI"/"ML"/"UI" is never added to a FULLTEXT index in the
        // first place, so `min:2` validation let through searches that
        // could silently never match anything. min:3 is a real product
        // behavior change (very short acronyms are unsearchable) rather
        // than a cosmetic validation tweak; raising
        // innodb_ft_min_token_size itself would require rebuilding every
        // FULLTEXT index and a server-config change, which is a deployment
        // decision, not something to do silently from application code.
        $data = $request->validate([
            'project_id' => ['required', 'uuid', 'exists:projects,id'],
            'q' => ['required', 'string', 'min:3', 'max:200'],
        ]);

        $project = Project::findOrFail($data['project_id']);
        $this->authorize('view', $project);

        $query = $data['q'];

        $pages = DocumentPage::query()
            ->whereHas('document', fn ($q) => $q->where('project_id', $project->id))
            ->whereRaw('MATCH(text) AGAINST (? IN NATURAL LANGUAGE MODE)', [$query])
            ->with('document:id,original_filename')
            ->limit(20)
            ->get(['id', 'document_id', 'page_number'])
            ->map(fn ($page) => [
                'type' => 'document_page',
                'document_id' => $page->document_id,
                'document_name' => $page->document->original_filename ?? null,
                'page_number' => $page->page_number,
            ]);

        $excerpts = Excerpt::query()
            ->where('project_id', $project->id)
            ->whereRaw('MATCH(text) AGAINST (? IN NATURAL LANGUAGE MODE)', [$query])
            ->limit(20)
            ->get(['id', 'document_id', 'page_number', 'text'])
            ->map(fn ($excerpt) => [
                'type' => 'excerpt',
                'id' => $excerpt->id,
                'document_id' => $excerpt->document_id,
                'page_number' => $excerpt->page_number,
                'snippet' => str($excerpt->text)->limit(200)->toString(),
            ]);

        $notes = Note::query()
            ->where('project_id', $project->id)
            ->whereRaw('MATCH(content) AGAINST (? IN NATURAL LANGUAGE MODE)', [$query])
            ->limit(20)
            ->get(['id', 'title', 'content'])
            ->map(fn ($note) => [
                'type' => 'note',
                'id' => $note->id,
                'title' => $note->title,
                'snippet' => str((string) $note->content)->limit(200)->toString(),
            ]);

        return response()->json([
            'data' => [
                'document_pages' => $pages,
                'excerpts' => $excerpts,
                'notes' => $notes,
            ],
        ]);
    }
}
