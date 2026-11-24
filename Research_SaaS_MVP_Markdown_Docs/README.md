# Research SaaS Platform — MVP Documentation

**Project type:** LiquidText-inspired SaaS document research platform  
**Backend:** Laravel + PostgreSQL  
**Web frontend:** React + TypeScript + Vite  
**Mobile:** Flutter for Android and iOS  
**Admin:** Filament for Laravel  
**Document status:** MVP planning specification  
**Scope note:** This is a proposed engineering plan, not evidence that the software has already been implemented or tested.

## Documentation index

1. [Product Requirements](01-product-requirements.md)
2. [Architecture and Technology Stack](02-architecture.md)
3. [Database Design](03-database-design.md)
4. [API Specification](04-api-specification.md)
5. [Frontend and UI/UX](05-frontend-ui-ux.md)
6. [Admin Panel and SaaS Billing](06-admin-saas-billing.md)
7. [Mobile Apps and Store Release](07-mobile-apps-store-release.md)
8. [Testing and QA Plan](08-testing-qa.md)
9. [Deployment and Production Readiness](09-deployment-production-readiness.md)
10. [Phases and Acceptance Criteria](10-roadmap-acceptance.md)

## Product objective

Build a document research workspace where users can upload PDFs, select and save excerpts, annotate documents, create notes, connect ideas on a canvas, search content, and export their work. The SaaS includes tenant isolation, plans and usage limits, an admin panel, and Android/iOS applications.

## Core workflow

Upload PDF → open document → select text → create excerpt → connect excerpt to note → save workspace → reopen project → export.

## Important constraints

- Take inspiration from the product category, not from copying LiquidText's proprietary branding, UI assets, or potentially protected interactions.
- Confirm current third-party SDK, library, payment, and app-store requirements before implementation and release.
- Store private documents in private object storage and authorize every access server-side.
- No test result should be reported as passed until the relevant test has actually been executed and evidence recorded.
