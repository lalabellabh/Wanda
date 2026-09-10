# Wanda Backend Security Contract

This document defines the minimum security boundary before privileged integrations are enabled.

## Rules

1. **Fail closed:** unauthenticated, expired, malformed, or unauthorized requests return a denial.
2. **Server-authoritative authorization:** the client must never decide whether an action is permitted.
3. **HTTPS only:** production traffic and session cookies require TLS.
4. **Session cookies:** use `Secure`, `HttpOnly`, and an appropriate `SameSite` policy. Rotate the session after authentication/privilege changes and invalidate it on logout/lock.
5. **Short-lived sessions:** use server-issued sessions with expiry and replay protection. Never accept arbitrary client-created session IDs.
6. **QR unlock:** QR data is a one-time/short-lived challenge or reference. It is not a permanent master credential.
7. **CORS:** allow only the exact production frontend origin(s). Never use wildcard CORS for credentialed requests.
8. **CSRF:** protect state-changing browser requests when cookie-based authentication is used.
9. **Rate limits:** apply limits to authentication, QR attempts, privileged actions, and integrations.
10. **Input validation:** validate schema, length, type, and authorization context on every request.
11. **External actions:** WhatsApp sends, order changes, Chrome control, and similar actions require an explicit confirmation token tied to the authenticated session and prepared action.
12. **Idempotency/replay:** privileged commands need an expiring nonce/idempotency key so an old confirmation cannot be replayed.
13. **Audit:** record security events and action metadata, but do not log passwords, tokens, session IDs, QR secrets, or unnecessary message contents.
14. **Secrets:** credentials belong in deployment secret storage or secure local storage, never Git history.
15. **Least privilege:** integrations receive only the scopes they need; read, prepare, and execute permissions are separate.

## Recommended request flow

`authenticate → issue session → request/prepare action → server validates → show confirmation → confirmation nonce → server re-validates → execute → audit`

## Production gate

Do not connect WhatsApp sending, Chrome control, CCTV control, order mutation, or other privileged integrations until a real backend implements these rules.
