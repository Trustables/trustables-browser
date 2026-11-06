# Changelog

## 0.4.2

- Notify integrations of all terminal outcomes with onFinish; preserve success-only onComplete.

- Preserve QR and same-device recovery after request retrieval.
- Bound status reads and enforce session expiry even when transport stalls.
- Ignore late results after expiry, cancellation or destruction.
- Keep keyboard focus inside the modal under Safari keyboard preferences.


## 0.4.1

- Export typed Environment values and validate environment configuration at startup.
- Preserve supported string values and reject unavailable Production explicitly.
- Document typed setup and update integration examples.
