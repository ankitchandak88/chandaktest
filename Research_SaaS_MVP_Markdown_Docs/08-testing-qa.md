# 8. Testing and QA Plan

## 8.1 Test layers

1. Unit tests: domain rules, quota calculations, coordinate conversion.
2. Feature/API tests: authentication, policies, endpoints, database effects.
3. Integration tests: PostgreSQL, object storage, queues, payment webhooks.
4. Component tests: React forms, annotations UI, loading/error states.
5. End-to-end tests: critical browser user journeys.
6. Mobile tests: Flutter unit/widget/integration tests.
7. Security tests: tenant isolation, upload validation, authentication, authorization.
8. Performance tests: large PDFs, search, exports, concurrent quota checks.
9. Smoke tests: critical checks after each staging/production deployment.
10. Regression tests: rerun after fixes and before release.

## 8.2 Backend test cases

| ID | Scenario | Expected |
|---|---|---|
| BE-001 | Register valid account | Account created |
| BE-002 | Duplicate email | Validation failure |
| BE-003 | Invalid login | Rejected |
| BE-004 | Protected route without auth | 401 |
| BE-005 | Cross-tenant project access | 403 or safe 404 |
| BE-006 | Valid PDF upload | Private document record created |
| BE-007 | Executable renamed to PDF | Rejected |
| BE-008 | Upload exceeds plan limit | Rejected; quota remains correct |
| BE-009 | Create annotation | Persisted |
| BE-010 | Modify another user's annotation | Rejected |
| BE-011 | Save excerpt coordinates | Page and coordinates retained |
| BE-012 | Link to nonexistent object | Rejected |
| BE-013 | Cross-tenant search | No unauthorized results |
| BE-014 | Export | Job produces valid authorized output |
| BE-015 | Duplicate payment webhook | No duplicate entitlement/event processing |
| BE-016 | Invalid webhook signature | Rejected |
| BE-017 | Exceed project/storage limit | Blocked server-side |
| BE-018 | Suspend user | Access revoked per policy |
| BE-019 | Delete document | Access revoked; cleanup follows retention policy |
| BE-020 | Retry failed processing job | Safe retry, no duplicate records |

## 8.3 Frontend test cases

| ID | Scenario | Expected |
|---|---|---|
| FE-001 | Form validation | Invalid input is blocked |
| FE-002 | Upload progress | Accurate status and failure state |
| FE-003 | PDF text selection | Correct text/page captured |
| FE-004 | Reload after highlight | Annotation remains |
| FE-005 | Drag excerpt | Position persists |
| FE-006 | Connect two objects | Link persists |
| FE-007 | Canvas zoom/pan | No unexpected jumps |
| FE-008 | Network loss during save | Pending changes handled visibly and safely |
| FE-009 | Search source navigation | Correct page opens |
| FE-010 | Limit reached | Clear limit/upgrade message |
| FE-011 | Keyboard navigation | Core actions accessible |
| FE-012 | Responsive layout | No critical overflow or inaccessible action |

## 8.4 Mobile test cases

| ID | Scenario | Expected |
|---|---|---|
| MOB-001 | Android release build | Installs and launches |
| MOB-002 | iOS test build | Installs and launches |
| MOB-003 | Large PDF | No crash; performance meets target |
| MOB-004 | Rotate screen | Reading state remains stable |
| MOB-005 | Save and reopen annotation | Annotation persists |
| MOB-006 | Offline downloaded document | Opens according to supported offline scope |
| MOB-007 | Expired session | Secure reauthentication |
| MOB-008 | Delete account | Defined deletion workflow completes |
| MOB-009 | Restore/reconcile subscription | Entitlement matches verified provider state |
| MOB-010 | Accessibility | Essential actions work with assistive technology |

## 8.5 Example Laravel tenant-isolation test

This is illustrative and assumes the named models, factories, route, and authorization behavior have been implemented.

```php
public function test_user_cannot_access_another_tenants_project(): void
{
    $userA = User::factory()->create();
    $userB = User::factory()->create();

    $organizationA = Organization::factory()->create();
    $organizationB = Organization::factory()->create();

    Membership::factory()->create([
        'user_id' => $userA->id,
        'organization_id' => $organizationA->id,
    ]);

    Membership::factory()->create([
        'user_id' => $userB->id,
        'organization_id' => $organizationB->id,
    ]);

    $project = Project::factory()->create([
        'organization_id' => $organizationB->id,
    ]);

    $this->actingAs($userA)
        ->getJson("/api/v1/projects/{$project->id}")
        ->assertNotFound();
}
```

Adapt authentication setup to the selected Sanctum/session strategy. This sample is not a test result.

## 8.6 Smoke-test checklist

- [ ] SM-01: Web app and API health endpoint respond.
- [ ] SM-02: Database and queue worker are healthy.
- [ ] SM-03: Login, logout, and protected routes work.
- [ ] SM-04: Valid PDF uploads to private storage.
- [ ] SM-05: PDF processing completes and page count is available.
- [ ] SM-06: Create excerpt, move it, reload, and verify persistence.
- [ ] SM-07: Highlight and comment survive reload.
- [ ] SM-08: Search and export complete successfully.
- [ ] SM-09: A second tenant cannot access the first tenant's project.
- [ ] SM-10: Test payment webhook updates entitlement once.
- [ ] SM-11: Admin actions are authorized and audited.
- [ ] SM-12: Android and iOS test builds launch and open a sample PDF.

## 8.7 CI/CD gates

- PHP formatting and static analysis
- Laravel unit/feature tests
- React lint/type checks/component tests
- Web and mobile build checks
- Integration tests in isolated environments
- Playwright critical-path tests
- Dependency and security scans
- Staging deployment and smoke tests
- Manual approval for production
- Post-deployment health checks and rollback readiness

## 8.8 Exit criteria

Do not release if critical security tests fail, tenant isolation is broken, billing entitlements are incorrect, document data can be lost, the main PDF/workspace flow is broken, or production health checks fail. Record test evidence, build version, environment, failures, and known limitations.
