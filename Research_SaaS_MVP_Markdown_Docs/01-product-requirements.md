# 1. Product Requirements Document

## 1.1 Overview

Create a SaaS document-reading and research workspace inspired by active-reading tools. The application combines PDF reading, annotation, excerpts, notes, visual connections, project organization, export, subscription management, and administration.

## 1.2 Goals

- Make it easy to read and annotate PDF documents.
- Let users save selected source text as linked excerpts.
- Organize excerpts and notes on a flexible workspace canvas.
- Preserve links back to original document pages and coordinates.
- Provide a secure multi-tenant SaaS with plans and usage enforcement.
- Provide a responsive web application and Flutter mobile apps.
- Ship with documented tests, smoke checks, monitoring, and release procedures.

## 1.3 Target users

Initial potential segments include students, researchers, legal and contract professionals, consultants, and teams that work with multiple documents. Validate the first niche through user interviews before expanding.

## 1.4 MVP functional requirements

### Accounts and access
- Register, log in, log out, verify email, and reset password.
- Manage profile and account settings.
- Enforce authenticated access to private resources.
- Support organization membership and role-based access.

### Projects and documents
- Create, rename, list, and delete projects.
- Upload PDF files with file-size, MIME/signature, and quota validation.
- Store source documents privately.
- Show document metadata, page count, processing status, and thumbnails where supported.
- Open PDF pages, zoom, navigate, and select text.
- Search extracted text and navigate to source pages.

### Annotations and excerpts
- Create, update, list, and delete highlights, underlines, comments, and supported ink data.
- Capture selected text with its document ID, page number, and source coordinates.
- Open the original page from an excerpt.
- Preserve annotation alignment when zoom changes.

### Workspace
- Create and edit notes.
- Place excerpt and note cards on a canvas.
- Drag and reposition canvas objects.
- Create typed links between supported objects.
- Persist positions, zoom, and layout state.
- Restore workspace after reload or sign-in.
- Show saving, saved, offline, and error states.

### Export
- Queue export jobs.
- Generate an output PDF with supported annotations/notes.
- Offer DOCX export only after a suitable library and formatting scope are selected.
- Authorize downloads and expire temporary export links.

### SaaS and billing
- Configure Free and Pro plans.
- Enforce storage, project, document, and other limits on the server.
- Track usage.
- Start checkout using a supported payment provider.
- Process signed/verified webhooks idempotently.
- Display subscription status and support cancellation/expiry behavior.

### Administration
- View signups, active usage, storage, and subscription metrics.
- Search and view users and organizations.
- Suspend/restore accounts with reason and audit trail.
- Manage plans and limits.
- Review payment/subscription status.
- View security-sensitive audit events.
- Use explicit permissions for all administrative actions.

## 1.5 Out of scope for the initial MVP

- Real-time multi-user canvas collaboration.
- Advanced pinch-to-collapse gestures.
- Handwriting recognition and advanced OCR.
- AI summarization and semantic recommendations.
- Enterprise SSO/SAML.
- Native desktop applications.
- Integrations whose API access and licensing have not been verified.

## 1.6 Non-functional requirements

- Security: tenant isolation, private files, secure authentication, input validation.
- Reliability: queued processing, retries, backups, observable failures.
- Performance: pagination, indexed queries, asynchronous PDF processing, large-file testing.
- Accessibility: target WCAG 2.2 AA, keyboard access, focus visibility, reduced motion.
- Maintainability: modular Laravel domains, automated tests, documented API contracts.
- Portability: environment-based configuration and reproducible builds.
- Privacy: clear retention, deletion, export, and privacy-policy processes.

## 1.7 Core user journey

1. User registers and verifies their email.
2. User creates a project.
3. User uploads a PDF.
4. Background processing extracts metadata/text.
5. User opens the PDF and selects text.
6. User saves the selection as an excerpt.
7. User adds a note and connects it to the excerpt.
8. Workspace state is saved.
9. User reopens the project and verifies source navigation.
10. User exports the supported research output.

## 1.8 MVP acceptance criteria

The MVP is not accepted until the core journey passes automated and manual tests, tenant isolation is verified, billing test events are idempotent, document access is private, backups/restoration are tested, and deployment smoke checks pass.
