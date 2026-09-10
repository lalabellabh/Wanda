# Wanda — Lalabella AI Operations Center

Security-first foundation for the Wanda local operations assistant.

## Security principles
- **Zero secrets in the frontend or Git repository.** API keys, tokens, service credentials, webhook secrets, and passwords must stay server-side or in local secure storage.
- **Deny by default.** Wanda may observe and prepare actions, but external actions require explicit confirmation.
- **Least privilege.** Separate read/prepare/send capabilities and grant only what is needed.
- **QR unlock is authentication, not authorization.** A scanned QR must produce a short-lived session; never treat a permanent QR value as a master password.
- **Local-first camera.** QR camera frames should remain local unless an explicit backend flow requires otherwise.
- **Backend validation.** Never trust branch, user, order, receiver, or permission data supplied by the browser.
- **Audit actions.** Log security-relevant events without storing message contents or secrets unnecessarily.

## Planned architecture
`Browser UI → local/session security layer → authenticated backend → approved integrations`

The browser is treated as an untrusted client. Real credentials and privileged actions belong behind the backend.

## Before production
1. Configure HTTPS only.
2. Add a real backend with authentication/session validation.
3. Store secrets in environment/secret storage, never GitHub files.
4. Configure strict CORS for the exact production origin.
5. Add rate limiting and replay protection.
6. Add server-side authorization for every privileged action.
7. Keep WhatsApp/order/CCTV connectors behind the backend or a local agent.
8. Test logout, token expiry, QR replay, origin checks, CSRF protection, and failed authorization paths.
