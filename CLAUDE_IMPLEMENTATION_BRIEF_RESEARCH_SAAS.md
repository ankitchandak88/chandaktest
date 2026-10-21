# Claude Implementation Brief — Research SaaS
## Bug Fixes, Security Audit, UX Improvements, and Product Enhancements

**Purpose:** This file is the source of truth for Claude Code (or another coding agent) to inspect the existing repository, verify reported issues, implement fixes safely, and deliver tested improvements.

**Project context supplied by the user**
- Backend: Laravel / PHP
- Frontend: React + TypeScript + Vite
- PDF viewer and research workspace/canvas
- Multi-tenant organizations, memberships, projects, documents, excerpts, notes, annotations, workspace items, links, exports
- Authentication appears to use Laravel Sanctum and organization context middleware
- PDF processing uses `smalot/pdfparser`
- Frontend uses PDF.js and an SVG-based connection layer
- The notes below are reported findings and proposals, not proof that the current checkout still has these exact defects. Verify them against the repository before changing code.

> **Critical instruction:** Do not guess, silently invent requirements, or assume a reported line number still matches the code. Inspect the repository and current branch first. If a decision materially affects security, data deletion, billing, public sharing, AI-provider cost/privacy, or API compatibility, ask the user before implementing it. If a detail can be resolved safely from existing code/tests, investigate and document the evidence instead of asking unnecessarily.

---

# 1. Operating Instructions for Claude

## 1.1 Start with repository discovery

Before editing:
1. Inspect repository root, branch, working tree, package files, Laravel/PHP versions, React version, and existing test/lint/build scripts.
2. Read `README`, architecture docs, `.env.example` files, route files, policies, models, migrations, controllers, jobs, and related frontend components.
3. Search for the named files/symbols in this document. Do not rely on line numbers alone.
4. Run existing tests, lint, and build commands where practical; record baseline failures before changing anything.
5. Identify whether the actual database is MySQL or PostgreSQL. The reported FULLTEXT issue assumes MySQL/InnoDB; do not apply MySQL-specific changes to another database.
6. Check installed package versions and licensing before adding or replacing libraries.
7. Produce a short audit table: `Finding ID | Verified? | Evidence | Risk | Proposed change | Test`.
8. Group work into small, reviewable batches. Fix security/data integrity first, then functional bugs, then UX/performance, then new features.

## 1.2 Evidence and uncertainty rules

For every reported finding, classify it as one of:
- **Verified:** reproduced or proven by current code/tests.
- **Partially verified:** code suggests the issue, but runtime behavior is not confirmed.
- **Not reproduced:** tests/current code do not support the report.
- **Blocked:** cannot verify because a dependency, environment, credential, or required decision is missing.
- **Already fixed:** current branch contains a valid fix; add regression coverage if missing.

Do not claim a test passed unless it was actually run and its output inspected. Do not claim a vulnerability exists solely because it was reported here. Record the command and result for tests/build/lint.

## 1.3 Safe implementation rules

- Do not rewrite the whole application to address a local defect.
- Preserve existing API contracts unless a change is required and documented.
- Do not run destructive migrations, truncate data, hard-delete production records, rotate production secrets, or change payment settings without explicit approval.
- Never expose `is_super_admin`, role, tenant ownership, or billing entitlement through mass assignment.
- Never make documents public by default.
- Do not log access tokens, full PDF text, payment secrets, or sensitive user data.
- Add regression tests for each confirmed bug.
- Keep fixes scoped and commit-ready; summarize changed files, tests, remaining risks, and manual verification needed.
- If the repo differs from this brief, explain the discrepancy and adapt only after confirming the correct behavior.
- If the project uses a different naming convention, follow the repository's convention rather than creating duplicate patterns.

## 1.4 Execution protocol

Use this order:
1. **Audit only:** inspect and report findings; no code edits yet.
2. **Clarifying questions:** ask only questions that block a safe implementation.
3. **Plan:** propose file-level changes, migrations, risks, and tests.
4. **Implement:** small batches; security and integrity first.
5. **Verify:** run targeted tests, full relevant suites, lint, and production build.
6. **Report:** state what changed, evidence, test results, migrations, configuration changes, and uncompleted items.

If the user explicitly asks for implementation in the same prompt, proceed through these stages without waiting at each stage unless a genuine blocker or destructive decision appears.

---

# 2. Priority Model

Use these priorities. Do not let visual polish outrank a confirmed security or data-integrity defect.

- **P0 — Critical:** confirmed exploitable cross-tenant access, privilege escalation, widespread data loss, or broken critical production flow.
- **P1 — High:** confirmed authorization flaw, significant data integrity issue, major core workflow broken.
- **P2 — Medium:** resource exhaustion, information disclosure, pagination/accessibility/performance defects.
- **P3 — UX/product:** interaction and visual improvements that do not create security or data-integrity risk.
- **P4 — Future feature:** AI, collaboration, presentation, advanced export, and other scope expansions.

Initial order recommended:
1. Cross-tenant authorization / BOLA / IDOR
2. Export download authentication
3. Document and workspace orphan-data lifecycle
4. Upload memory safety and PDF processing resource limits
5. Role management and mass-assignment protections
6. Pagination and selection popup functional bugs
7. Security headers/token expiry and information disclosure
8. Canvas SVG alignment, search, export text encoding, build warnings
9. UX enhancements
10. New product features

Priority is provisional until findings are verified.

---

# 3. Confirmed-Only Bug Fix Backlog

## BUG-001 — Export PDF download fails in browser

**Reported severity:** Critical user-facing workflow bug  
**Reported location:** `ProjectWorkspacePage.tsx` around lines 157–164; backend export download route  
**Reported behavior:** UI uses a direct anchor such as:

```tsx
<a href={`${API_URL}/exports/${exportJob.id}/download`} target="_blank">
  Download
</a>
```

The route reportedly requires `auth:sanctum` and `ResolveOrganization`. A normal anchor navigation does not automatically include the app's custom Bearer token or organization header. This may result in 401/403.

**Claude must verify**
- Actual API client auth mechanism: cookie/session or Bearer token.
- Whether the download route requires `X-Organization-Id` or equivalent context.
- Whether route uses an authenticated stream response or returns a signed URL.
- Whether browser cookie behavior makes the reported issue applicable.

**Preferred fix options**
1. If the existing authenticated Axios client can retrieve the file, request it with `responseType: 'blob'`, then create a temporary object URL and trigger download. Revoke the object URL after use.
2. Alternatively, backend can issue a short-lived signed URL after authorization. Keep the underlying object private; use an expiry and ensure the export belongs to the authorized organization/user.

Do not put long-lived bearer tokens in query strings.

**Acceptance criteria**
- Authorized user can download a completed export.
- Unauthorized user cannot download another user's/tenant's export.
- Expired/missing export gives a useful error.
- Loading/error state is visible.
- Blob URL is cleaned up if that approach is used.
- Add frontend/API regression tests.

## BUG-002 — PDF excerpt selection popup has hardcoded position

**Reported location:** `PdfViewer.tsx` around lines 135–144  
**Reported behavior:** Selection anchor is computed using the first selected text rectangle, but the popup is reportedly rendered at fixed `{ left: 32, top: 32 }`.

**Required investigation**
- Trace the selection geometry, page container, scroll offsets, PDF zoom, and coordinate spaces.
- Check behavior across multiple pages, zoom levels, scroll, and viewport resizing.

**Expected fix**
- Position the popup relative to the actual selection anchor in the correct coordinate system.
- Clamp it within the visible viewport/page area.
- Reposition after scroll/resize/zoom when needed.
- Avoid covering the selected text unnecessarily.
- Keep keyboard and screen-reader access.

**Acceptance criteria**
- Popup appears near the selected text, not fixed at the page's top-left.
- Works at different zoom levels and page positions.
- No clipping outside the visible container.
- Add a focused UI test and document manual browser checks.

## BUG-003 — Soft-deleting a document leaves active related records

**Reported location:** `DocumentController.php` around lines 119–120  
**Reported code:**

```php
Storage::disk('local')->delete($document->storage_key);
$document->delete();
```

The report says `Document` uses `SoftDeletes`; physical file is deleted while excerpts, annotations, and `document_pages` remain visible because soft delete does not trigger normal database `ON DELETE CASCADE`.

**This is a data-lifecycle decision; do not guess.**

**Claude must inspect**
- All foreign keys and delete rules.
- Whether excerpts/annotations/pages use soft deletes.
- Whether projects, canvas items, links, exports, and search results reference documents.
- Whether restoring a soft-deleted document is supported.
- Whether physical file deletion should happen immediately or after a retention window.
- Whether object storage is actually `local` or configured elsewhere.

**Recommended safe approach**
- Define one explicit document deletion lifecycle service/transaction.
- Stop the document from appearing in normal queries/search immediately.
- Preserve or soft-delete dependent records consistently, including workspace references.
- Queue physical-file deletion only when compatible with restore/retention policy.
- Ensure failures are retryable and observable.
- Do not hard-delete records merely to trigger cascades unless the product's retention policy explicitly permits it.

**Acceptance criteria**
- Deleted documents disappear from normal user views and search.
- No dangling excerpts/annotations/pages are rendered as active records.
- Related workspace cards/links follow a documented policy.
- Restore behavior, if supported, is coherent.
- Physical file cleanup is safe, retryable, and tested.
- Add feature tests covering deletion and related records.

## BUG-004 — Deleting excerpt/note leaves workspace items and links

**Reported locations:** `ExcerptController.php` around line 74; `NoteController.php` around line 57  
**Reported structure:** `workspace_items` and `links` refer to polymorphic UUIDs without ordinary foreign keys.

**Claude must inspect**
- Actual schema and relation types.
- Whether source/target objects can include other types besides excerpts/notes.
- Whether deletion should remove links, soft-delete them, or preserve an audit/history record.

**Expected fix**
- Centralize deletion cleanup in a service/model event or another established project pattern.
- Remove or soft-delete workspace items and links referring to the deleted object.
- Avoid deleting unrelated links or items.
- Handle links where the deleted object is either source or target.
- Make cleanup transactional and idempotent where feasible.

**Acceptance criteria**
- Deleting an excerpt or note cannot leave a visible orphan card or line.
- Both incoming and outgoing links are handled.
- Other object types remain unaffected.
- Add regression tests for both source and target link references.

## BUG-005 — Organization member role update missing

**Reported location:** `OrganizationController.php` around lines 62–65  
**Reported behavior:** `Membership::firstOrCreate(...)` returns an existing membership without changing its role. There is reportedly no role-update endpoint.

**Claude must clarify/verify**
- Which roles exist and their exact permissions.
- Whether owners may promote another member to owner.
- Whether an organization must always have at least one owner.
- Whether a user can change their own role.
- Whether role updates need an audit reason.

**Expected fix**
- Add an explicit authorized role-update action only after role-transition rules are clear.
- Validate allowed roles.
- Prevent unauthorized privilege escalation.
- Prevent accidental removal/demotion of the last owner.
- Log role changes.
- Do not let mass-assignment set roles.

**Acceptance criteria**
- Existing member role changes only through an authorized endpoint/action.
- Unauthorized role changes are rejected.
- Invalid transitions and last-owner edge cases are covered.
- API response reflects the updated membership.
- Add tests for owner/member/admin transitions that match the confirmed role model.

## BUG-006 — Pagination hides items beyond first page

**Reported locations:** `queries.ts` around lines 20, 55, 90, 112; `DashboardPage.tsx`  
**Reported behavior:** Backend returns paginated data, reportedly 20 items per page, while frontend reads only `.data.data` and does not expose next-page/load-more controls.

**Claude must inspect**
- Actual pagination response format (`data`, `links`, `meta`, cursor, etc.).
- Which lists are affected: projects, documents, notes, excerpts, or others.
- Existing query library and caching conventions.

**Expected fix**
- Implement a reusable pagination pattern consistent with the existing frontend.
- Support next/previous or load-more where appropriate.
- Preserve loading, empty, and error states.
- Avoid duplicate entries when loading more.
- Keep filters/sorts stable across pages.

**Acceptance criteria**
- More than one page of items can be reached.
- The user can access all authorized records.
- Page transitions and query-cache updates are correct.
- Tests include at least 25 records where page size is 20.

---

# 4. Security Audit Backlog

## SEC-001 — Potential BOLA/IDOR in excerpt, note, annotation policies

**Reported severity:** High  
**Reported files:** `ExcerptPolicy.php`, `NotePolicy.php`, `AnnotationPolicy.php`, reportedly around line 25  
**Reported policy shape:**

```php
return $excerpt->created_by === $user->id
    || $this->canEditProject($user, $excerpt->project);
```

Similar logic is reported for notes and annotations.

**Reported risk:** The creator check may grant access even after the user loses active project/organization access.

**Required action**
- Verify current policy, routes, model relations, organization context middleware, and active membership semantics.
- Make active access to the parent project/organization a prerequisite for any read/write action.
- Apply the correct permission after verifying access.
- Do not rely on `created_by` alone as authorization.
- Review list/search/download/export routes as well as direct resource routes.
- Ensure organization context cannot be switched to bypass policy checks.

**Illustrative logic only — adapt names to actual code:**

```php
return $this->canViewProject($user, $excerpt->project)
    && (
        $excerpt->created_by === $user->id
        || $this->canEditProject($user, $excerpt->project)
    );
```

This is not automatically correct for every operation: read, update, delete, and restore may require different rules.

**Mandatory regression tests**
- User from tenant A cannot read/update/delete tenant B's excerpt, note, or annotation by ID.
- A creator who is removed from the organization loses access.
- A demoted member can perform only actions permitted by the new role.
- Authorized active project members retain the correct access.
- Search, exports, nested endpoints, and direct downloads cannot bypass the policy.

**Treat a reproduced cross-tenant bypass as P0/P1 and fix before UI work.**

## SEC-002 — PDF upload uses `file_get_contents()` and may exhaust memory

**Reported location:** `DocumentController.php` around line 60  
**Reported code:**

```php
Storage::disk('local')->put(
    $storageKey,
    file_get_contents($file->getRealPath())
);
```

The report says validation permits up to `102400` KB (100 MB). Reading the full file into memory can create avoidable memory spikes under concurrent uploads.

**Expected fix**
- Use Laravel's streamed upload/storage APIs appropriate to the configured disk.
- Preserve unique, non-user-controlled storage keys.
- Validate file type/signature, size, and quota before storage.
- Handle partial failure and cleanup.
- Do not assume the disk is local; use configured private storage.

**Acceptance criteria**
- Large allowed files are stored without loading the entire file into one PHP string.
- Upload errors do not leave orphan files or incomplete records.
- Quota checks remain correct under concurrent uploads.
- Add tests for valid, invalid, oversized, and failed storage operations.

## SEC-003 — User enumeration in member-add/suspend APIs

**Reported location:** `OrganizationController.php` around lines 57–59  
**Reported response:** “No account with that email exists yet. They need to register first.”

**Risk:** Responses may reveal whether an email is registered.

**Claude must inspect**
- Whether the endpoint is restricted to organization owners.
- Whether invitation behavior already exists.
- Whether different responses/status codes reveal account existence.

**Potential mitigation**
- Use a consistent response for validly formed invitation requests whether the account exists or not.
- Prefer an invitation flow that avoids revealing account existence.
- Keep internal logs sufficient for operations without exposing account lookup results to unauthorized clients.
- Add rate limiting.

**Acceptance criteria**
- Unauthorized users cannot use the endpoint to enumerate accounts.
- Response content/status behavior does not unnecessarily reveal account existence.
- Existing valid member invitation behavior remains functional.

## SEC-004 — PDF parser resource exhaustion

**Reported location:** `ProcessDocumentJob.php` around line 46  
**Reported dependency:** `smalot/pdfparser`  
**Reported concern:** Malformed/complex PDFs may consume excessive CPU or RAM.

**Required investigation**
- Confirm parser version and actual queue configuration.
- Inspect job timeout, retry count, memory limit, and worker isolation.
- Test representative large and malformed PDFs in a safe non-production environment.

**Mitigation options**
- Enforce file-size and processing-time limits.
- Run PDF processing in a constrained worker/container.
- Configure queue worker memory and timeout according to deployment environment.
- Fail safely and mark documents as processing-failed without blocking the queue.
- Evaluate `pdftotext`/Poppler or another parser only after checking installation, sandboxing, compatibility, and deployment cost.

**Acceptance criteria**
- A problematic PDF cannot indefinitely block all processing workers.
- Timeouts and failures are observable and retry policy is bounded.
- Normal PDFs continue processing.
- Do not claim a parser bomb is fixed solely because a queue timeout exists.

## SEC-005 — `is_super_admin` in mass-assignable fields

**Reported location:** `User.php` around line 30  
**Risk:** A future `update($request->all())` or incorrectly trusted validated input may permit privilege escalation.

**Expected fix**
- Remove `is_super_admin` from general `$fillable` if present.
- Assign it only through a tightly authorized administrative operation using an explicit safe method.
- Search the whole repository for mass assignment of role/admin/organization/billing fields.
- Consider `$guarded`/DTO/service conventions already used in the project.
- Do not use `forceFill()` unless the call site is explicitly privileged and validated; it bypasses mass-assignment protection.

**Acceptance criteria**
- Registration/profile update cannot set or modify super-admin status.
- Untrusted request bodies cannot alter protected role/tenant/billing fields.
- Tests prove attempted mass assignment is ignored/rejected.

## SEC-006 — Sanctum token expiry and security headers

**Reported locations:** `config/sanctum.php`, `backend/.env`, middleware/bootstrap configuration  
**Reported concerns:** Token expiry unset; common security headers missing.

**Claude must clarify/verify**
- Is the app using Sanctum personal access tokens, cookie-based SPA sessions, or both?
- What are the intended session duration and mobile token lifetime?
- Are headers already set by reverse proxy/CDN?
- Does CSP need to allow PDF workers, blob URLs, fonts, or any inline scripts/styles?

**Expected fix**
- Define an explicit token/session lifecycle suitable for web and mobile.
- Do not blindly set a single token expiry if it breaks the SPA session model.
- Add appropriate headers in the correct layer, avoiding duplicate/conflicting proxy rules.
- Build/test CSP against the actual app, PDF.js worker, fonts, and blob usage.
- Use `X-Content-Type-Options: nosniff`; consider `frame-ancestors`/`X-Frame-Options` according to actual embedding needs; enforce HTTPS/HSTS at the correct production layer.

**Acceptance criteria**
- Token/session expiration and revocation behavior is documented and tested.
- Security headers are present in the deployed response and do not break app functionality.
- CSP is tested, not copied blindly from a generic template.

---

# 5. Frontend Build, Performance, and Data Issues

## FE-001 — React `set-state-in-effect` lint warning

**Reported location:** `WorkspaceCanvas.tsx` around lines 47–51  
**Reported code shape:** `useEffect` calls `setPositions(next)` synchronously.

**Required action**
- Inspect why positions are derived or synchronized in an effect.
- Prefer deriving state during render, initializing state correctly, or using an event/data flow that avoids redundant state where possible.
- Do not suppress the lint warning without understanding the state lifecycle.
- Preserve external updates and canvas persistence behavior.

**Acceptance criteria**
- Lint warning is resolved or a documented, justified exception is approved.
- No regression in loading initial positions, server refresh, drag interactions, or saved layout.
- Relevant tests pass.

## FE-002 — Large Vite/PDF.js bundle

**Reported build output**
- `pdf.worker.min-GB3t0DcA.mjs`: 1,369.80 kB
- `index-DT7y55Ey.js`: 686.88 kB

These are reported historical output sizes. Rebuild the current branch before deciding the actual baseline.

**Expected investigation**
- Check current Vite build configuration and PDF.js worker import pattern.
- Identify largest dependencies and whether PDF viewer code is loaded on routes that do not need it.
- Consider lazy-loading the PDF workspace, route-level code splitting, manual chunking only where appropriate, and correct PDF.js worker handling.
- Confirm whether reported sizes are raw or compressed and inspect production network transfer size.

**Acceptance criteria**
- PDF-specific code is not downloaded on unrelated routes where lazy loading is practical.
- PDF worker still loads correctly in production.
- Record before/after bundle and compressed sizes.
- No runtime worker or PDF rendering regression.

## FE-003 — Canvas SVG connection lines misalign on scroll

**Reported location:** `WorkspaceCanvas.tsx` around line 141  
**Reported code shape:**

```tsx
<svg className="pointer-events-none absolute inset-0 h-full w-full">
```

Canvas container reportedly uses `overflow-auto` and `min-h-[600px]`. The SVG may cover only the visible container rather than the full coordinate plane, causing connection lines to misalign while scrolling.

**Required investigation**
- Understand canvas world coordinates, scroll offsets, card coordinates, transforms, and SVG dimensions.
- Determine whether SVG and cards share the same coordinate system.
- Reproduce with cards beyond the initial viewport and after scroll/resize.

**Expected fix**
- Make line geometry use the same world-coordinate transform as cards, or use a deliberate viewport overlay with correct coordinate conversion.
- Keep pointer events from blocking card interactions.
- Handle scroll, resize, zoom, and pan consistently.

**Acceptance criteria**
- Lines remain anchored to correct card edges after scrolling/resizing.
- Links work when both cards are outside the initial viewport.
- No pointer-interaction regression.

## BE-007 — MySQL FULLTEXT two-character search limitation

**Reported location:** `SearchController.php`  
**Reported concern:** Validation permits two-character terms, but default InnoDB `innodb_ft_min_token_size` may be 3, so terms like `AI`, `ML`, `UI` may not be indexed.

**This is database-engine-specific.** First verify database engine/version, FULLTEXT index definition, server settings, and current query implementation.

**Possible approaches**
- Configure/rebuild MySQL FULLTEXT indexes to support two-character tokens, if operationally acceptable; or
- Use a documented fallback for short terms; or
- Change product validation to match actual search capability, if product owner approves.

Do not merely lower validation to three characters without noting that it changes product behavior.

**Acceptance criteria**
- Search behavior for `AI`, `ML`, `UI`, longer terms, punctuation, and empty input is documented and tested against the actual database.

## BE-008 — Missing environment keys in `.env.example`

**Reported file:** `backend/.env.example`  
**Reported missing keys:** `PAYMENT_PROVIDER`, `RAZORPAY_*`, `SUPER_ADMIN_*`, `PLAN_*`.

**Required action**
- Search actual config and code for required environment variables.
- Include only variables that are genuinely supported and required.
- Provide safe placeholders and comments, never real secrets.
- Ensure first-time setup does not require undocumented keys.
- Update deployment/setup docs and config validation.

**Acceptance criteria**
- Fresh environment setup instructions match actual configuration.
- No production secret is committed.
- Required/optional variables are clearly documented.

## BE-009 — FPDF UTF-8 text and emoji handling

**Reported concern:** FPDF core fonts may not support all Unicode text, causing question marks or errors for non-English notes/emojis.

**Required investigation**
- Confirm current PDF library and version, fonts, and export path.
- Identify expected languages, Unicode coverage, emoji support, and licensing requirements.
- Test Gujarati/Hindi/English and representative punctuation/emoji if these are intended user inputs.

**Potential fix**
- Evaluate TCPDF, tFPDF, or another appropriate PDF-generation approach based on maintained status, licensing, font embedding, layout needs, and output size.
- Do not assume an emoji will render merely because a Unicode-capable library is installed; font glyph support matters.

**Acceptance criteria**
- Supported language/character scope is documented.
- Test PDFs render expected text correctly with no silent transliteration or replacement.
- Fonts and licenses are included appropriately.

---

# 6. Product and UX Improvements

These are enhancement proposals, not verified bugs. Implement only after the security/data-integrity work is stable. Keep each feature behind a clear acceptance test and avoid implementing every animation at the expense of usability/accessibility.

## UX-001 — Canvas zoom and pan

**Desired behavior**
- Smooth zoom; proposed initial range: 25%–200%.
- Spacebar + drag to pan; middle-mouse drag if compatible.
- Zoom percentage indicator, 100% reset, Zoom to Fit, and minimap/radar view.
- Canvas objects remain in consistent world coordinates.
- Trackpad, wheel, keyboard, and touch behavior do not conflict with browser page scrolling.

**Clarify before finalizing**
- Is 25%–200% the required range, or should it be configurable?
- Is touch/mobile canvas editing in scope for the first release?

**Acceptance tests**
- Zoom around pointer without unexpected jumps.
- Pan does not accidentally move a card.
- Zoom to Fit includes all visible workspace items.
- Minimap reflects current layout and viewport.

## UX-002 — Smart curved connection lines

**Desired behavior**
- SVG cubic Bezier curves with arrowheads.
- Connection endpoints attach to card anchor points (top/right/bottom/left).
- Optional relation labels: `supports`, `contradicts`, `related to`.
- Lines update when cards move, resize, zoom, pan, or scroll.
- Hover effects are subtle and accessible.

**Acceptance tests**
- Geometry remains correct during movement and viewport changes.
- Labels remain readable and do not block card interactions.
- Respect reduced-motion settings.
- Do not add animated gradients/marching ants unless they are performant and useful.

## UX-003 — Card tags, colors, and group frames

**Desired behavior**
- Tag/color categories; suggested semantic colors: green=facts, amber=hypotheses, rose=counter-arguments, violet=conclusions.
- Multi-select cards and group into named section/cluster frames.
- Filter canvas by tag.
- Move a group as a unit without corrupting relative positions.
- Provide labels/icons so meaning is not conveyed by color alone.

**Data model proposal:** `tags` plus a polymorphic pivot or explicit project-tag relationships, depending on the existing schema.

**Clarify**
- Are tags global per organization, per project, or per user?
- Should one card support multiple tags?
- Are cluster frames a separate persisted entity or just a grouping field?

Do not migrate the database until these semantics are agreed or already established by the codebase.

## UX-004 — Card-to-PDF bidirectional navigation

Clicking an excerpt card should switch/focus the PDF panel to its source document and exact page, scroll to the selected region, and apply a subtle temporary pulse/highlight.

**Acceptance tests**
- Correct document and page open.
- Exact saved selection region is brought into view.
- Works after page zoom changes.
- Missing/deleted source is handled gracefully.
- Reduced-motion preference is respected.

## UX-005 — Auto-layout and alignment

Provide `Auto-arrange in Grid`, `Align Horizontally`, and `Distribute Evenly`.

**Acceptance tests**
- Only selected cards are affected unless user explicitly chooses all.
- Relative positions are predictable.
- Undo/redo or a clear revert mechanism exists if workspace supports it.
- Links remain connected after layout changes.

## UX-006 — Light/dark theme switcher

**Reported clue:** `index.css` reportedly contains `:root[data-theme='light']`, but no header toggle.

**Required action**
- Verify theme token implementation and current persisted preference.
- Add a visible toggle in the app header/settings.
- Decide whether default is system preference, dark, or light based on existing product behavior.
- Persist preference without causing a flash of the wrong theme.
- Ensure both themes meet contrast requirements.

## UX-007 — Edit/delete affordances

Add clear, permission-aware actions for:
- Project rename/delete
- Excerpt delete
- Note edit/delete

Use confirmation for destructive actions and show success/error feedback. Ensure backend authorization exists before exposing the UI. Deletion must follow the lifecycle rules in BUG-003/BUG-004.

## UX-008 — PDF viewer controls

Add:
- Page-jump input (with valid page bounds)
- Zoom in/out and visible zoom percentage
- Fit-to-width and fit-to-page
- Collapsible thumbnails and document outline/bookmarks
- In-PDF Ctrl+F / Cmd+F search with match count and highlighted matches

**Acceptance tests**
- Invalid page values are rejected/clamped consistently.
- Search match count and active result are correct.
- Navigation works for long documents and does not break text selection.

## UX-009 — Draggable PDF/workspace split divider

Let the user resize PDF and canvas widths. Support sensible minimum widths and persist preference if appropriate.

**Acceptance tests**
- Divider works with mouse and keyboard.
- Panels do not collapse below usable minimums.
- Resize does not break selection coordinates, canvas lines, or PDF rendering.

## UX-010 — Toasts, undo, skeletons, and card polish

- Use a consistent toast system (e.g. Sonner if compatible with current dependencies).
- Examples: `Excerpt added to canvas`, `Link created`, `Export ready`.
- Offer Undo for reversible actions when feasible.
- Use skeletons for loading lists/cards instead of blank areas or spinners where appropriate.
- Add clear drag handles, focus states, selected-card borders, subtle elevation, and status pills.
- Keep animations subtle and respect reduced motion.
- Avoid claims such as “2x faster” unless measured.

---

# 7. AI and Smart Research Features

These features add provider cost, privacy considerations, data-model changes, and failure modes. Do not integrate a live provider until the user approves the provider, budget, retention policy, and data-processing approach.

## AI-001 — Ask This PDF / AI Research Assistant

**Desired behavior**
- User asks a question about PDFs in a project.
- Assistant answers using project document content.
- Answers include source citations with document name and page number.
- User can inspect cited source passages.
- Show loading, error, rate-limit, and “not enough evidence” states.
- Never fabricate citations; if evidence cannot be retrieved, say so.

**Suggested data model:** `ai_conversations`, `ai_messages`; optionally `ai_message_sources` or an equivalent source-reference structure. Final schema depends on provider and retrieval approach.

**Architecture to evaluate**
1. Extract and chunk document text with stable page/source metadata.
2. Retrieve relevant chunks using database full-text search initially; evaluate embeddings/vector search only if justified.
3. Send only the minimum relevant content to the approved model provider.
4. Validate citations against retrieved source chunks.
5. Store conversation metadata and messages according to approved retention policy.
6. Apply tenant/project authorization to every AI request and retrieval result.

**Required questions before live integration**
- Which provider/model: Anthropic Claude API, OpenAI API, or another provider?
- Is document content allowed to leave the application infrastructure and be sent to that provider?
- What budget/rate limits should apply per user/organization?
- Should conversations be stored, and for how long?
- Which languages must be supported?
- Is AI available on Free, Pro, or a separate paid allowance?

## AI-002 — One-click summaries

Summarize selected text or a whole PDF into three bullet points or an executive summary. Include source references when summarizing a document. Distinguish a summary from a direct quote and show when content is incomplete or OCR-derived.

## AI-003 — Smart synthesis between excerpts

When a user connects two excerpts, suggest a relation label or short explanation (agreement, contradiction, support, related topic). Suggestions must be optional, explain their source, and never silently overwrite a user's link.

## AI-004 — Auto-citation generation

Support APA and BibTeX first only if metadata requirements are defined. MLA and Chicago may be later formats. Extract bibliographic metadata when possible but let the user review/correct it. Do not invent authors, publication dates, DOI, title, or publisher when absent.

**Questions**
- Which citation formats are launch-critical?
- Is citation generation based on PDF metadata, user-entered metadata, DOI lookup, or a combination?
- Should the app support a citation library per project?

---

# 8. Sharing, Collaboration, and Presentation

## COLLAB-001 — Read-only public share link

**Proposal:** project share token and a public read-only view.

**Security requirements**
- Sharing must be explicitly enabled by an authorized project owner.
- Default state is private.
- Use high-entropy, unguessable tokens; store token hashes where practical.
- Support revocation and optional expiry.
- Public routes must return only the minimum data required for the public view.
- Never expose private source file URLs, organization metadata, user email, audit data, or hidden notes.
- Consider password protection and download permissions if requested.
- Audit creation/revocation of shares.

**Clarifying questions**
- Can the link expose source PDFs or only the board/cards?
- Should a visitor need a password?
- Is expiry required?
- Can viewers download/export?
- Should the public board be indexed by search engines? Default recommendation: no indexing unless explicitly requested.

**Acceptance tests**
- Revoked/expired token stops working.
- Public viewer cannot mutate data.
- Private documents are not exposed unless explicitly authorized by the share configuration.
- Token guessing and enumeration are impractical.
- Public page has `noindex` behavior unless search indexing is explicitly approved.

## COLLAB-002 — Real-time cursors/collaboration

Evaluate Laravel Reverb, Pusher, or another supported WebSocket service. Real-time cursor presence is separate from durable workspace synchronization.

**Before implementation decide**
- Presence only, or shared live editing too?
- Maximum collaborators per project/plan?
- Conflict handling and offline merge expectations?
- Hosting and message-volume budget?

Do not imply that live cursors alone provide conflict-safe collaborative editing.

## COLLAB-003 — Presentation mode

Hide editing chrome and walk through selected cards/sections in a guided sequence. Support next/previous, exit, and a clear presentation order. Do not add forced camera motion without user control.

**Acceptance tests**
- User can start, navigate, and exit presentation.
- Canvas data remains unchanged.
- Keyboard navigation and reduced motion work.

---

# 9. Export Improvements

## EXPORT-001 — Original PDF with annotation/highlight overlays

**Reported current behavior:** export may generate a PDF containing notes/excerpts, but not stamp highlights onto the original PDF.

**Desired behavior**
- Export the original PDF with saved highlight/underline/comment overlays aligned to the source pages.
- Preserve original pages/content as much as the chosen library allows.
- Include optional notes/excerpts as a separate report/appendix if required.

**Important:** FPDI may import pages and overlay drawing, but exact behavior depends on PDF version, encryption, fonts, annotations, and library edition. Verify license and feature support before committing to FPDI.

**Required clarification**
- Should the output be an exact visual copy with overlays, or should annotations become editable native PDF annotations?
- Should notes/excerpts be appended, printed in margins, or exported as a separate report?
- Are password-protected PDFs in scope?

**Acceptance tests**
- Overlay aligns with the original highlight position at different page sizes/rotations.
- Original content is not unexpectedly lost.
- Export supports defined PDF cases and fails clearly for unsupported/encrypted files.
- Unicode text is handled according to supported language scope.

## EXPORT-002 — Branded PDF research report

Include configurable cover page, organization logo, title, source document details, styled notes/cards, page numbers, headers/footers, and links where supported.

Confirm brand/logo permissions and define which plan can use branding. Ensure layout does not clip long notes or non-Latin text.

## EXPORT-003 — Interactive HTML report

Generate a self-contained or clearly packaged HTML report with table of contents, clickable internal links, and supported embedded charts. Decide whether all assets must be embedded or can be included in a ZIP folder. Sanitize user-generated HTML and avoid executable user content.

## EXPORT-004 — Markdown export

Provide a `.md` download/copy format for notes, excerpts, citations, and source references. Define how images, links, page references, and metadata are represented. Do not promise direct Notion API integration unless a separate integration is implemented.

---

# 10. Canvas, PDF, and UX Enhancement Inventory

Use this checklist to ensure no user-requested improvement is silently dropped.

## Canvas and visual workspace
- [ ] Infinite-style canvas with zoom/pan (proposed 25%–200%)
- [ ] 100% reset, Zoom to Fit, minimap
- [ ] Curved Bezier connection lines with arrowheads
- [ ] Relation labels: supports / contradicts / related to
- [ ] Card color tags/categories
- [ ] Cluster/section frames with multi-card drag
- [ ] Card click navigates to exact source PDF page/selection
- [ ] Auto-arrange grid, align horizontally, distribute evenly
- [ ] Fix SVG/card alignment during scroll/resize/zoom
- [ ] Edit/delete actions for projects, excerpts, and notes
- [ ] Drag handles, active states, subtle elevation, status pills

## PDF reading and annotation
- [ ] Multi-color highlight toolbar
- [ ] Add comment, copy citation, pin to canvas actions
- [ ] Correctly positioned excerpt-selection popup
- [ ] Resizable PDF/canvas split view
- [ ] Page thumbnails and document outline/bookmarks
- [ ] In-PDF Ctrl+F / Cmd+F with result count and overlays
- [ ] Page-jump input
- [ ] Zoom in/out, fit-to-width, fit-to-page
- [ ] Box selection for charts/tables saved as image cards
- [ ] Real original-PDF annotation-overlay export

## Design and feedback
- [ ] Dark and light theme switcher
- [ ] Warm, readable light theme
- [ ] Accessible typography and contrast
- [ ] Optional Plus Jakarta Sans/Outfit headings and Inter/Newsreader reading font after license/performance check
- [ ] Subtle create/drag transitions; respect reduced motion
- [ ] Toasts with undo where safe
- [ ] Skeleton loaders
- [ ] Responsive layout and keyboard accessibility

## AI and smart features
- [ ] Ask This PDF with page citations
- [ ] Selected-text/PDF summarizer
- [ ] Suggested links/insights between excerpts
- [ ] APA/BibTeX citation generation (additional formats pending decision)
- [ ] Usage limits, provider budget, data retention, and privacy controls

## Collaboration and presentation
- [ ] Read-only shareable board link with revocation/expiry policy
- [ ] Presentation/pitch mode
- [ ] Real-time cursors (provider and scope to be decided)
- [ ] Do not expose private files/data via public share

## Export
- [ ] Original PDF with overlay highlights
- [ ] Branded PDF report
- [ ] Interactive HTML report
- [ ] Markdown export for Notion/Obsidian-compatible workflows
- [ ] Validate Unicode/Indic language rendering

## First-time user experience
- [ ] Sample demo project for new users
- [ ] Demo project contains a clearly licensed/sample PDF, sample excerpts, notes, and links
- [ ] User can remove/reset demo content
- [ ] Command palette (`Ctrl+K` / `Cmd+K`) for search, create note, theme switch, and supported actions

---

# 11. Additional Product Proposals from the User

## PROD-001 — AI Research Assistant data model
Proposed tables:
- `ai_conversations`
- `ai_messages`
- Optional `ai_message_sources` for validated citations.

Before migrations, define ownership scope (user/project/organization), provider/model metadata, token/cost accounting, retention/deletion, and whether messages can reference multiple documents.

## PROD-002 — Public share token
Proposal: `projects.share_token` or a dedicated share table. Prefer a dedicated share model if multiple links, expiries, revocation, password protection, or different permission scopes are needed. Decide after inspecting the current schema.

## PROD-003 — Tags and color categories
Proposal: `tags` and a polymorphic pivot. Decide organization/project/user scope, multi-tag behavior, allowed colors, and whether tags apply to notes, excerpts, or other canvas objects.

## PROD-004 — Citation export
Start with only formats approved by product owner. Citation fields may include title, author, publication date, publisher, DOI/URL, access date, and source document/page. Missing metadata must remain unknown rather than invented.

---

# 12. Environment and Configuration Requirements

Claude must compare `.env.example`, config files, deployment docs, and actual environment reads. Candidate keys mentioned in the report include:
- `PAYMENT_PROVIDER`
- `RAZORPAY_*`
- `SUPER_ADMIN_*`
- `PLAN_*`

These are not guaranteed to be the exact required variable names. Discover the actual names from code and document them. Include placeholder values only; never include secrets.

Also document:
- PDF storage disk and path
- Max upload size and PHP/web-server limits
- Queue connection, worker timeout, memory and retry configuration
- Sanctum/session/token behavior
- Frontend API URL and organization-context header behavior
- PDF.js worker configuration
- Export temp-file lifecycle
- AI provider/model keys only after provider approval
- Public-share URL configuration only after sharing is approved

---

# 13. Required Regression Test Matrix

At minimum, add tests for these cases once the matching fix/feature is implemented.

| ID | Area | Scenario | Expected |
|---|---|---|---|
| REG-001 | Security | Cross-tenant excerpt read by ID | Denied |
| REG-002 | Security | Removed creator accesses old project item | Denied |
| REG-003 | Security | Cross-tenant note/annotation access | Denied |
| REG-004 | Security | User attempts mass assignment of `is_super_admin` | Ignored/rejected |
| REG-005 | Security | Unauthorized user attempts role update | Denied |
| REG-006 | Upload | Large valid PDF stored using streaming | Success within limits |
| REG-007 | Upload | Invalid/oversized PDF | Rejected safely |
| REG-008 | Lifecycle | Soft-delete document | No active orphan data |
| REG-009 | Lifecycle | Delete excerpt used as link source | Link/card cleanup follows policy |
| REG-010 | Lifecycle | Delete note used as link target | Link/card cleanup follows policy |
| REG-011 | Export | Authenticated export download | File downloads |
| REG-012 | Export | Cross-tenant export download | Denied |
| REG-013 | Pagination | 25+ projects/documents | All pages accessible |
| REG-014 | Viewer | Selection popup after scroll/zoom | Anchored correctly |
| REG-015 | Canvas | Lines after scroll/resize | Stay aligned |
| REG-016 | Search | `AI`, `ML`, `UI` against actual DB | Defined, tested behavior |
| REG-017 | PDF export | Indic/non-Latin content | Matches documented support |
| REG-018 | Share | Revoke public share | Link no longer exposes content |
| REG-019 | AI | Answer cites actual retrieved page | Citation validated |
| REG-020 | AI | No relevant source found | Assistant does not invent evidence |
| REG-021 | UI | Theme preference survives reload | Correct theme restored |
| REG-022 | UI | Undo toast action | Reverses supported action safely |
| REG-023 | UX | Canvas zoom-to-fit | All items fit within viewport |
| REG-024 | UX | PDF search results | Correct match count/navigation |
| REG-025 | Export | HTML report sanitization | User content cannot execute scripts |

Do not add placeholder tests that assert success without exercising the actual behavior.

---

# 14. Definition of Done

A task is complete only when all applicable items are satisfied:
- [ ] Current code was inspected and the reported issue was verified or marked not reproduced.
- [ ] The implementation follows existing repository conventions.
- [ ] Authorization and tenant isolation are tested for data-related changes.
- [ ] Input validation and error states are handled.
- [ ] Regression tests are added.
- [ ] Relevant tests were actually run and their results recorded.
- [ ] Lint/typecheck/build were run where applicable.
- [ ] Database migrations and rollback/forward strategy are documented.
- [ ] Configuration changes are reflected in `.env.example` and setup docs.
- [ ] No secrets or personal document content were committed/logged.
- [ ] User-facing behavior and limitations are documented.
- [ ] Remaining risks and manual checks are listed.

## Final response format required from Claude

When reporting a work batch, provide:
1. **Summary** — what changed.
2. **Verified findings** — issue IDs and evidence.
3. **Files changed** — file path and purpose.
4. **Tests executed** — exact commands and pass/fail counts.
5. **Build/lint results** — exact commands and outcome.
6. **Migration/configuration impact** — including deployment steps.
7. **Security/data risks** — what was addressed and what remains.
8. **Manual verification** — steps the user must perform.
9. **Not done / blocked** — explicit reasons and required decisions.
10. **Next recommended batch** — highest-priority remaining work.

Never say “all fixed” if any item is unverified, untested, or blocked.

---

# 15. Questions Claude Must Ask Before Making Decisions

Ask the user only when the answer cannot be safely determined from the repository and materially affects implementation.

1. **AI provider and privacy:** Should AI use Anthropic Claude API specifically, and may PDF text be sent to the external provider? What usage budget/limits are acceptable?
2. **Share links:** Should a public read-only link expose the source PDF or only excerpts/notes/canvas? Should it expire or require a password?
3. **Document deletion:** Should soft-deleted documents be restorable? What retention period applies to original PDFs and dependent data?
4. **Membership roles:** What are the allowed roles and who can promote/demote owners? Must there always be at least one owner?
5. **Citation scope:** Which citation formats are mandatory for the first release: APA, BibTeX, MLA, Chicago?
6. **PDF export:** Should highlights become visual overlays on the original pages, editable native PDF annotations, or both? Should notes be appended or exported separately?
7. **Tags and groups:** Are tags project-level, organization-level, or user-level? Can a card have multiple tags? Are frames separate entities?
8. **Collaboration:** Is the first collaboration milestone live cursors only, or simultaneous editing with conflict resolution?
9. **Database:** Is the actual production target MySQL or PostgreSQL? This affects FULLTEXT and migration choices.
10. **Mobile scope:** Is full canvas editing required in the first mobile release, or is PDF reading plus notes/excerpts sufficient?

If work can proceed without these answers, Claude should continue with the independent, verified bug fixes and leave the blocked decisions clearly documented.
