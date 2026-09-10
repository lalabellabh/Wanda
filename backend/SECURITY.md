# Wanda Backend Security Contract

The backend/local agent is the security authority. The frontend must never be trusted.

## Required controls

### Authentication
- Use short-lived access sessions and refresh/re-authentication where appropriate.
- QR unlock must be challenge-response or exchange for a short-lived server-issued session.
- Include nonce/replay protection and expiry.
- Never accept a static QR string as permanent authentication.

### Authorization
Every privileged endpoint must verify authorization server-side. Suggested capabilities:
- `orders.read`
- `whatsapp.read`
- `whatsapp.prepare`
- `whatsapp.send`
- `cctv.read`
- `chrome.read`
- `chrome.control`
- `system.admin`

Default: deny.

### External actions
Sending WhatsApp messages, changing orders, controlling Chrome, or other external actions must use a two-step flow:
1. `prepare` — return a human-readable action preview and a one-time action ID.
2. `confirm` — accept only the unexpired action ID and execute it server-side.

The confirm endpoint must reject expired, already-used, mismatched, or unauthorized action IDs.

### Network
- HTTPS only in production.
- Strict CORS: allow only the exact Wanda origin(s).
- Rate-limit authentication, QR validation, and privileged endpoints.
- Validate JSON schema, sizes, types, and identifiers server-side.
- Do not expose stack traces or secrets to clients.

### CSRF / sessions
If cookie-based authentication is used, use Secure + HttpOnly + appropriate SameSite cookies and CSRF protection. If bearer tokens are used, keep them short-lived and do not place long-lived secrets in URLs.

### Logging
Audit authentication, authorization failures, action preparation, confirmation, cancellation, and lock events. Avoid logging message bodies, credentials, tokens, or unnecessary personal data.

### Secrets
Never commit API keys, service-account JSON, webhook secrets, private keys, passwords, or production tokens. Use deployment secret storage/environment variables.

## Integration rule
Google Apps Script, WhatsApp Web automation, CCTV, Chrome control, and Lalabella order integrations must be treated as separate trust boundaries. A compromise of one integration must not automatically grant full Wanda control.
