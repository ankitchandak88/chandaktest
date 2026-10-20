<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Services\AuditLogger;
use App\Services\EntitlementService;
use Illuminate\Http\Request;

class ProjectController extends Controller
{
    public function __construct(
        private readonly EntitlementService $entitlements,
        private readonly AuditLogger $auditLogger,
    ) {
    }

    public function index(Request $request)
    {
        $this->authorize('viewAny', Project::class);

        $organization = $request->organization();

        $projects = Project::where('organization_id', $organization->id)
            ->withCount(['documents', 'notes', 'excerpts'])
            ->orderByDesc('created_at')
            ->paginate((int) $request->integer('per_page', 20));

        return response()->json($projects);
    }

    public function store(Request $request)
    {
        $this->authorize('create', Project::class);

        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:5000'],
        ]);

        $organization = $request->organization();

        $project = $this->entitlements->withinProjectQuota($organization, function () use ($organization, $data, $request) {
            return Project::create([
                'organization_id' => $organization->id,
                'created_by' => $request->user()->id,
                'name' => $data['name'],
                'description' => $data['description'] ?? null,
            ]);
        });

        $this->auditLogger->logRequest($request, 'project.created', 'project', $project->id);

        return response()->json(['data' => $project], 201);
    }

    public function show(Request $request, Project $project)
    {
        $this->authorize('view', $project);

        return response()->json(['data' => $project->loadCount(['documents', 'notes', 'excerpts'])]);
    }

    public function update(Request $request, Project $project)
    {
        $this->authorize('update', $project);

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:5000'],
        ]);

        $project->update($data);

        $this->auditLogger->logRequest($request, 'project.updated', 'project', $project->id);

        return response()->json(['data' => $project]);
    }

    public function destroy(Request $request, Project $project)
    {
        $this->authorize('delete', $project);

        $project->delete();

        $this->auditLogger->logRequest($request, 'project.deleted', 'project', $project->id);

        return response()->json(['data' => ['message' => 'Project deleted.']]);
    }
}
