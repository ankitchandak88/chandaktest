# ChandakText — Build Progress

Resume point for future sessions. Update after every phase.

## Decisions locked in
- DB: MySQL (Laragon, root/no password), databases `chandaktext` (dev) and `chandaktext_test` (testing).
- Backend: Laravel 12 at `backend/`, API-only (`/api/v1`), Sanctum bearer tokens (mobile + web both use tokens, no cookie session).
- Admin: Filament at `backend/` (same Laravel app, `/admin`).
- Web: React + TS + Vite + Tailwind at `web/`.
- Mobile: Flutter at `chandaktext_mob/`.
- Payment: Razorpay driver + a `fake` driver for local/dev/testing (no real keys available yet).

## Phase status
- [ ] Phase 0 — Foundation (repo, env, tooling)
- [ ] Phase 1 — Accounts & tenancy
- [ ] Phase 2 — PDF documents
- [ ] Phase 3 — Annotations & excerpts
- [ ] Phase 4 — Workspace
- [ ] Phase 5 — Search & export
- [ ] Phase 6 — SaaS & admin
- [ ] Phase 7 — Quality & staging
- [ ] Phase 8 — Mobile app (chandaktext_mob)
- [ ] Phase 9 — Store submission prep
