# Local backend setup

The backend is intentionally local-first. Do not deploy `server.js` with a real secret until HTTPS, production session storage, authorization, CSRF/origin protections, and an audited deployment are in place.

## Requirements

- Node.js 20+
- A local `WANDA_DEVICE_SECRET` with at least 32 bytes

## Windows PowerShell

```powershell
$env:WANDA_DEVICE_SECRET = "replace-with-a-random-secret-at-least-32-bytes"
$env:WANDA_ORIGIN = "https://lalabellabh.github.io"
node server.js
```

The local service listens on `127.0.0.1:8787` by default.

Never commit the real device secret. Keep it in the local environment or an OS secret store.
