# 6. Admin Panel and SaaS Billing

## 6.1 Admin approach

Use Filament within Laravel for the first admin panel. It reduces duplicate UI work and keeps authorization close to the business logic. If a separate admin frontend becomes necessary later, expose narrowly scoped admin APIs.

## 6.2 Admin modules

| Module | Capabilities |
|---|---|
| Dashboard | Signups, active users, storage, processing failures, subscription metrics |
| Users | Search, view, suspend/restore, account status |
| Organizations | Tenant status, membership, plan, usage |
| Plans | Features, limits, active/inactive status |
| Subscriptions | Provider identifiers, state, renewal/cancellation metadata |
| Usage | Storage, projects, document processing and quota events |
| Documents | Metadata, processing status, abuse/support review |
| Audit logs | Actor, action, target, timestamp, reason |
| Feature flags | Controlled rollout |
| Support | Support notes and references to ticketing system |

Any document-content access by support staff should be exceptional, permission-gated, justified, and audited. Avoid implementing unrestricted user impersonation in the first MVP.

## 6.3 Roles

- `user`: personal or permitted project access.
- `organization_owner`: organization administration and billing.
- `organization_member`: project access according to membership.
- `support`: limited troubleshooting access.
- `super_admin`: platform administration.

Use Laravel Gates/Policies and Filament authorization. Do not rely on hiding buttons in the UI.

## 6.4 Initial plans

Plan limits must be configurable rather than hard-coded. Example draft:

| Capability | Free | Pro |
|---|---:|---:|
| Projects | Limited | Higher limit |
| Storage | Limited | Higher limit |
| PDF upload | Size/count capped | Higher limits |
| Search | Basic | Advanced, if implemented |
| Export | Limited | Higher allowance |
| Collaboration | Not in initial MVP | Later tier if built |

Exact limits and prices must be decided from target-user research, storage/processing cost, payment fees, and expected support burden. Do not advertise features that are not implemented.

## 6.5 Entitlement enforcement

- Implement a single server-side entitlement/limit service.
- Check limits before uploads, project creation, processing, and export.
- Handle concurrent requests so they cannot bypass quotas.
- Define whether deleted documents release quota immediately.
- Display current usage and clear limit errors to users.
- Record usage events for reconciliation.

## 6.6 Payment lifecycle

- Create checkout through the selected provider.
- Use provider-hosted checkout where suitable.
- Verify webhook signatures.
- Process events idempotently.
- Track trial, active, past-due, canceled, and expired states as appropriate.
- Reconcile provider status periodically.
- Provide clear cancellation and invoice/payment history behavior.
- Test refunds, failed payments, duplicate events, delayed events, and renewal transitions.

## 6.7 Mobile-store billing

Digital subscription sales inside mobile apps may trigger Google Play Billing or Apple's in-app purchase requirements, subject to current policy and applicable exceptions/programs. Confirm current requirements before implementing payment links or checkout in the mobile app. Server-side receipt/purchase validation and entitlement reconciliation may be needed.
