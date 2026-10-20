# 4. API Specification

## 4.1 Conventions

- Base path: `/api/v1`
- Format: JSON unless an endpoint explicitly handles binary data.
- Authentication: selected Laravel Sanctum session/cookie or token strategy.
- Use Form Requests for validation and Policies for authorization.
- Use pagination for lists and consistent error responses.
- Use idempotency for payment events and other retry-prone operations.

## 4.2 Endpoint inventory

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/auth/register` | Register |
| POST | `/auth/login` | Login |
| POST | `/auth/logout` | Logout |
| POST | `/auth/forgot-password` | Request reset |
| POST | `/auth/reset-password` | Reset password |
| GET | `/me` | Current user and permitted organization context |
| GET, POST | `/projects` | List/create projects |
| GET, PATCH, DELETE | `/projects/{id}` | Read/update/delete project |
| POST | `/projects/{id}/documents` | Upload PDF |
| GET | `/documents/{id}` | Document metadata |
| GET | `/documents/{id}/pages/{page}` | Authorized page text |
| GET, POST | `/documents/{id}/annotations` | List/create annotations |
| PATCH, DELETE | `/annotations/{id}` | Update/delete annotation |
| GET, POST | `/projects/{id}/excerpts` | List/create excerpts |
| GET, POST | `/projects/{id}/notes` | List/create notes |
| PATCH, DELETE | `/notes/{id}` | Update/delete note |
| GET, POST | `/projects/{id}/workspace-items` | Load/create canvas items |
| PATCH, DELETE | `/workspace-items/{id}` | Update/delete canvas item |
| GET, POST | `/projects/{id}/links` | List/create links |
| GET | `/search` | Search authorized content |
| POST | `/exports` | Start export job |
| GET | `/exports/{id}` | Export status and authorized download |
| GET | `/billing/plans` | List plans |
| POST | `/billing/checkout` | Start checkout |
| POST | `/billing/webhooks/{provider}` | Provider webhook |
| GET | `/billing/subscription` | Current subscription |
| GET | `/usage` | Usage and plan limits |

## 4.3 Example response

```json
{
  "data": {
    "id": "uuid",
    "document_id": "uuid",
    "page_number": 12,
    "text": "Selected text from the original PDF",
    "position": {
      "x": 420,
      "y": 180
    }
  }
}
```

## 4.4 Error format

Use a stable shape such as:

```json
{
  "message": "The request could not be completed.",
  "errors": {
    "name": ["The name field is required."]
  },
  "request_id": "trace-id"
}
```

Do not leak internal stack traces or sensitive information in production responses.

## 4.5 Authorization rules

- A user may only access organizations where they have valid membership.
- A project request must verify tenant and project membership.
- Document downloads must recheck authorization.
- Notes, excerpts, annotations, canvas items, and links inherit project access restrictions.
- Admin operations require explicit permissions and audit records.
- Rate-limit login, password reset, uploads, search, and export initiation.

## 4.6 Webhook handling

1. Read the exact request body required by the provider's signature scheme.
2. Verify the signature and timestamp where applicable.
3. Persist the provider event ID under a unique constraint.
4. Process the event idempotently in a transaction or safe queued workflow.
5. Update subscription/entitlements based on verified event state.
6. Record success/failure and support safe retries.
7. Never trust an unsigned frontend callback as proof of payment.

## 4.7 API documentation

Generate and maintain OpenAPI documentation after request/response schemas are implemented. Keep the spec aligned with tests and actual endpoint behavior.
