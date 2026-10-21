<?php

use App\Models\Annotation;
use App\Models\Excerpt;
use App\Models\Membership;
use App\Models\Note;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

// SEC-001 / REG-002: a removed member must lose edit/delete rights on their
// own historical content, not just on other people's. Before the fix, the
// policy's `created_by === user.id` check short-circuited the `||` and
// granted access regardless of whether the user still belonged to the
// organization at all.
test('a user removed from the organization cannot edit or delete their own excerpt, note, or annotation', function () {
    ['headers' => $headers, 'user' => $user, 'organization' => $organization] =
        registerUser('sec001-creator@example.test');

    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');
    $project = Project::find($projectId);
    $document = createReadyDocument($project, $user->id);

    $excerpt = Excerpt::create([
        'organization_id' => $project->organization_id,
        'project_id' => $project->id,
        'document_id' => $document->id,
        'created_by' => $user->id,
        'page_number' => 1,
        'text' => 'mine',
        'source_rects' => [['x' => 0, 'y' => 0, 'width' => 1, 'height' => 1]],
    ]);

    $note = Note::create([
        'project_id' => $project->id,
        'created_by' => $user->id,
        'content' => 'mine too',
    ]);

    $annotation = Annotation::create([
        'document_id' => $document->id,
        'project_id' => $project->id,
        'created_by' => $user->id,
        'page_number' => 1,
        'type' => 'comment',
        'comment_text' => 'mine three',
        'payload' => ['rects' => []],
    ]);

    // Sanity check: while still a member, the creator CAN edit their own stuff.
    apiPatch("/api/v1/excerpts/{$excerpt->id}", ['text' => 'still mine'], $headers)->assertOk();

    // Now the organization removes this user entirely (e.g. they left the
    // company) - delete their membership, but their old content remains.
    Membership::where('organization_id', $organization->id)->where('user_id', $user->id)->delete();

    apiPatch("/api/v1/excerpts/{$excerpt->id}", ['text' => 'hijacked'], $headers)->assertStatus(403);
    apiDelete("/api/v1/excerpts/{$excerpt->id}", [], $headers)->assertStatus(403);
    apiPatch("/api/v1/notes/{$note->id}", ['content' => 'hijacked'], $headers)->assertStatus(403);
    apiPatch("/api/v1/annotations/{$annotation->id}", ['comment_text' => 'hijacked'], $headers)->assertStatus(403);

    expect($excerpt->fresh()->text)->toBe('still mine');
    expect($note->fresh()->content)->toBe('mine too');
    expect($annotation->fresh()->comment_text)->toBe('mine three');
});

// REG-004 / SEC-005: is_super_admin must not be settable via normal profile
// mass assignment.
test('a user cannot escalate themselves to super admin via profile update', function () {
    ['headers' => $headers, 'user' => $user] = registerUser('sec005-user@example.test');

    expect($user->is_super_admin)->toBeFalse();

    // updateProfile() only ever reads 'name'/'password' from validated input
    // and sets those two fields explicitly - but prove the model-level
    // protection holds too, independent of any one controller's care.
    $user->update(['is_super_admin' => true]);

    expect($user->fresh()->is_super_admin)->toBeFalse();
});

test('an admin can still be promoted through the explicit forceFill path', function () {
    $admin = User::create([
        'name' => 'Ops',
        'email' => 'sec005-admin@example.test',
        'password' => Hash::make('Password123!'),
    ]);

    $admin->forceFill(['is_super_admin' => true])->save();

    expect($admin->fresh()->is_super_admin)->toBeTrue();
});
