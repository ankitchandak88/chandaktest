# 9. Deployment and Production Readiness

## 9.1 Environments

Maintain separate local, test, staging, and production environments. Use separate credentials, payment modes, storage buckets, and databases. Never use production personal data in tests without an approved data-protection process.

## 9.2 Deployment checklist

- [ ] Configure domain, TLS, DNS, and secure headers.
- [ ] Configure environment variables/secrets outside source control.
- [ ] Provision managed PostgreSQL and private object storage.
- [ ] Configure Redis and queue workers.
- [ ] Configure scheduler and required recurring tasks.
- [ ] Run database migrations through a controlled deployment step.
- [ ] Build frontend assets in CI.
- [ ] Configure private file access and short-lived signed URLs.
- [ ] Configure payment webhook URLs and secret verification.
- [ ] Configure email delivery, verification, and password-reset flows.
- [ ] Configure error tracking, metrics, logs, and alerts.
- [ ] Verify database backups and object-storage retention.
- [ ] Run smoke tests against staging.
- [ ] Verify rollback/forward-fix procedure.
- [ ] Run production smoke tests after release.

## 9.3 Observability

Monitor:
- API error rates and latency
- Login failures and rate limits
- PDF processing queue depth and duration
- Export failures
- Storage consumption
- Database health and slow queries
- Webhook processing failures
- Payment reconciliation discrepancies
- Mobile crash reports
- Availability and backup status

Avoid logging passwords, access tokens, payment secrets, full document text, or other unnecessary sensitive data.

## 9.4 Backup and recovery

- Define database backup frequency and retention.
- Define object-storage recovery/versioning strategy.
- Encrypt backups where supported.
- Restrict backup access.
- Test restoration in a separate environment.
- Document recovery objectives and the owner responsible for recovery.
- Do not mark backups as verified until a restoration drill succeeds.

## 9.5 Security checklist

- Authentication and session expiry reviewed
- Tenant isolation tests passing
- Authorization applied to all resource operations
- Upload validation and processing limits enabled
- Private storage and download authorization verified
- CSRF/CORS/session settings reviewed for the chosen architecture
- Rate limits and abuse controls enabled
- Dependency scans reviewed
- Secrets rotated and stored safely
- Audit logging for sensitive administrative actions
- Data deletion and retention procedures tested
- Incident response and rollback procedures documented

## 9.6 Rollback approach

Use versioned releases and backward-compatible database migrations where possible. Prefer forward fixes for irreversible data migrations. Preserve the previous working build, define who can initiate rollback, and verify the application after rollback.

## 9.7 Operational runbooks

Write runbooks for:
- PDF processing backlog
- Failed export jobs
- Payment webhook outage
- Database connection failure
- Storage access failure
- Suspected cross-tenant data exposure
- Backup restoration
- Mobile release rollback or store hotfix
