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

## Current architecture
`Browser UI → local/session security layer → authenticated local backend → approved integrations`

The browser is treated as an untrusted client. Real credentials and privileged actions belong behind the backend.

## Project layout
```text
Wanda/
├── assets/       # UI styles and visual resources
├── backend/      # local security/backend boundary
├── js/           # browser-side Wanda and security modules
├── index.html    # main operations UI
├── README.md
└── .gitignore
```

## Local backend
The backend is a local development skeleton. Node.js 20+ is required.

From `backend/`:

```powershell
$env:WANDA_DEVICE_SECRET = "replace-with-a-random-secret-at-least-32-bytes"
$env:WANDA_ORIGIN = "https://lalabellabh.github.io"
node server.js
```

It listens on `127.0.0.1:8787` by default. Never commit a real secret.

## Permission flow
```text
VIEW
  ↓
READ
  ↓
PREPARE
  ↓
CONFIRM
  ↓
EXECUTE
```

Wanda must not send WhatsApp messages, modify orders, control Chrome, or perform other external actions without an explicit final confirmation.

## Roadmap
1. QR challenge display/setup
2. Short-lived authenticated session
3. Local Wanda agent
4. Permission and confirmation engine
5. WhatsApp watcher
6. Lalabella order bridge
7. Branch geofence
8. Voice assistant
9. CCTV and Chrome integrations

## Before production
1. Configure HTTPS only.
2. Use production-grade session storage and rotation.
3. Store secrets in environment/secret storage, never GitHub files.
4. Configure strict CORS for the exact production origin.
5. Add rate limiting and replay protection.
6. Add server-side authorization for every privileged action.
7. Keep WhatsApp/order/CCTV connectors behind the backend or a local agent.
8. Test logout, token expiry, QR replay, origin checks, CSRF protection, and failed authorization paths.
