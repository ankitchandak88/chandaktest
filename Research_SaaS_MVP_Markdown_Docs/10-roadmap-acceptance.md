# 10. Roadmap and Acceptance Criteria

## Phase 0 — Discovery and foundation

Deliverables:
- Confirm initial target audience and primary use case.
- Finalize feature scope and plan limits.
- Define repositories, branching, coding standards, and environments.
- Create design tokens and component foundations.
- Define API conventions and database ownership.

Exit criteria: requirements, architecture, privacy assumptions, and acceptance criteria reviewed.

## Phase 1 — Accounts and tenancy

Deliverables:
- Registration, login, verification, password reset.
- Organizations, memberships, roles, policies.
- Initial admin authentication.
- Audit-log foundation.

Exit criteria: authorization and cross-tenant tests pass.

## Phase 2 — PDF documents

Deliverables:
- Private upload and metadata.
- PDF processing queue.
- PDF viewer, page navigation, text selection.
- Document status and error handling.

Exit criteria: valid upload, invalid-file rejection, processing retry, and authorized download tests pass.

## Phase 3 — Annotation and excerpts

Deliverables:
- Highlight, underline, comments.
- Excerpt capture with page and coordinates.
- Source-page navigation.

Exit criteria: annotation and excerpt persistence tests pass on representative PDFs.

## Phase 4 — Workspace

Deliverables:
- Notes and excerpt cards.
- Canvas positions, pan/zoom, links.
- Autosave and restore.
- Undo/redo where feasible.

Exit criteria: core workspace workflow passes end-to-end tests and reload/reconnection checks.

## Phase 5 — Search and export

Deliverables:
- Full-text search and source references.
- PDF export and authorized download.
- DOCX export if scope and formatting requirements are confirmed.

Exit criteria: export output validated and temporary files handled according to retention policy.

## Phase 6 — SaaS and admin

Deliverables:
- Configurable plans and server-side limits.
- Usage events and reconciliation.
- Checkout and verified webhooks.
- Filament users, tenants, plans, subscriptions, and audit resources.

Exit criteria: payment retries, duplicate webhooks, plan changes, quota enforcement, and admin authorization tests pass.

## Phase 7 — Quality and staging

Deliverables:
- Automated regression suite.
- Security and performance tests.
- Monitoring, backups, restoration drill.
- Staging smoke tests and release runbook.

Exit criteria: all release-blocking defects resolved and evidence recorded.

## Phase 8 — Mobile apps

Deliverables:
- Flutter Android/iOS applications.
- Authentication, PDF reading, annotations, notes and project access.
- Offline behavior for explicitly supported content.
- Device testing, accessibility, crash monitoring.

Exit criteria: mobile acceptance tests pass on real devices.

## Phase 9 — Store submission

Deliverables:
- Signed Android App Bundle and iOS archive.
- Store listing assets and policy disclosures.
- Privacy policy, account deletion, support contact.
- Billing-policy review and submission.

Exit criteria: submitted builds pass internal checks; approval is subject to store review.

## Phase 10 — Post-launch improvements

Potential additions:
- Real-time collaboration with Yjs and a compatible service.
- OCR for scanned PDFs.
- Advanced gestures.
- AI summaries and semantic search.
- Integrations after API and licensing validation.
- Enterprise SSO and organization policies.

## Planning estimate

A narrow web MVP may target approximately 6–8 weeks for an experienced small team, with substantial scope and delivery risk. Production hardening plus Flutter apps and store submission may require 9–12+ weeks or more. Estimate again after a technical spike for PDF selection, coordinate mapping, canvas persistence, and mobile rendering.

## Final acceptance scenario

A user can register, create a project, upload a PDF, select text, create an excerpt, link it to a note, save the workspace, reopen the project, navigate back to the source page, and export the supported output. Tenant isolation, plan enforcement, payment handling, backup/restore, and release smoke checks must also pass.
