# Trustables browser widget

`@trustables/browser` is a preview: a framework-independent TypeScript widget shared by the Trustables hosted verification page and the Linden customer demo. It renders the review, official d-you button, device choices, QR code, progress and result. It does not create or verify credentials itself.

## Install

```sh
npm install @trustables/browser
```

Import `mountVerification` in your browser application. With an asset-aware ESM bundler such as Vite, the package includes the styles and emits the Inter font automatically. No CSS imports, file-copy script or `stylesheetUrl` option is needed. Commit your lockfile to pin the installed version.

The default uses Shadow DOM, constructed stylesheets and the FontFace API in current Chrome, Edge, Firefox and Safari. Your CSP should allow your application asset origin for scripts/fonts and `data:` for button and QR images. It does not require `unsafe-inline` for scripts or styles, and never loads assets from a third-party CDN.

For unbundled ESM, serve the package's `dist/` and `assets/` directories together with their relative layout intact. Bundlers that do not handle `new URL(..., import.meta.url)` assets require explicit asset configuration. The legacy `stylesheetUrl` override remains supported for existing integrations: serve `dist/widget.css`, `dist/fonts.css` and `assets/Inter-latin.woff2` with that layout, then pass the public URL of `widget.css`.

## Develop and release

Use Node.js 24:

```sh
npm ci
npx playwright install chromium --only-shell
npm test
npm pack
```

The package contains compiled ESM, TypeScript declarations, styles and attributed assets. `npm pack` builds it automatically. Tests include a fresh tarball installation and a Vite production build with strict CSP at a nested base path.

Release maintainers: publish the initial package using an npm account that can publish under `@trustables`. Then configure an npm trusted publisher for GitHub organisation `Trustables`, repository `trustables-browser`, workflow `publish.yml`. Tagged releases (`v` followed by the package version) run the tests and publish with provenance through GitHub OIDC. The workflow needs no stored npm token. Never reuse an already published version.

## Integration

Your backend creates a session, binds it to the authenticated customer/order, and returns review metadata. Mount one widget for that session:

```ts
import { mountVerification } from "@trustables/browser";

// callBackend must include your authentication, same-origin credentials and CSRF
// protection. These example paths are your endpoints, not Trustables API URLs.
const review = await callBackend("/verification/prepare");
const widget = mountVerification(document.querySelector("#verification")!, {
  review,
  language: "en", // 'de' is also available
  transport: {
    start: () => callBackend("/verification/start"),
    status: (signal) => callBackend("/verification/status", { signal }),
    cancel: () => callBackend("/verification/cancel"),
  },
  onComplete: () => refreshOrderFromBackend(),
  onCancel: () => refreshOrderFromBackend(),
});
// When the view is removed:
widget.destroy();
```

Pass `alternative: { url, label }` for a merchant-owned HTTPS or email contact route. A URL of `#` is an intentionally non-navigating sales-demo placeholder; it does not satisfy the guideline requirement for a working alternative method.

`Review` has `requester`, `purpose`, `credential`, `expires_at` (ISO date), and `branded`. Take these values from the server; `branded` reflects the session's subscription snapshot and controls the Trustables attribution. Review text is inserted as text, never HTML.

The transport contract is:

| Method           | Result                  | Responsibility                                                                                                                                                        |
| ---------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start()`        | `{url, qr_code_base64}` | Activate the already prepared session after the user selects Verify; return the wallet link and its matching PNG QR. Retries must reuse that session.                 |
| `status(signal)` | `{status}`              | Return `pending`, `wallet_opened`, `completed`, `failed` or `expired` for the exact session. Only backend acceptance may produce `completed`. Honor the abort signal. |
| `cancel()`       | Any resolved value      | Revoke the pending session, idempotently. Closing during activation may call cancellation more than once.                                                             |

Optional `redirect_uri` in a completed result changes the success message; the widget never navigates automatically. Consumers must validate any destination against their registered return URL policy. `onComplete` is only a display notification, never authorization to fulfill an order. Refresh server-owned state or rely on an authenticated webhook for that decision.

The UI polls every three seconds, tolerates temporary status failures until the known expiry, and stops on terminal results or destruction. It never infers success from opening a link, losing focus or returning from the wallet. Both device choices are shown initially; fetching the wallet request drives the loading screen. There is no reliable universal browser API to detect whether a wallet is installed on the current device. A desktop link click keeps the QR available until the server sees the request fetch.

Closing the dialog cancels the session and returns focus. Mount a fresh session for retry. Preparation/session creation is intentionally outside the widget; do not automatically retry a non-idempotent session creation after an uncertain network result. Destroying an unstarted widget does not revoke a prepared session; your backend must enforce its expiry and order lifecycle.

## Trustables backend adapter

The companion platform integration provides authenticated merchant endpoints under `/api/v1/rp/orgs/{org}/sessions/{session}/widget`:

- `GET`: review metadata only.
- `POST`: activate and return the matching wallet link and QR.
- `GET /status`: UI status without identity claims.
- `POST /cancel`: revoke pending state.

Call these with a **server-side** wallet-mode organization API key. Never expose that key to JavaScript. Your same-origin adapter must bind the session to its customer/order, enforce ownership, Origin and CSRF checks, validate expiry, and hide upstream identifiers from request parameters. Simulator credentials are rejected by these endpoints. For fulfillment, use the authenticated session result (`status=completed`, `accepted=true`, exact session match), not widget status alone.

The hosted verification page supplies its existing cookie/CSRF-bound transport instead. Both consumers use this same renderer. Linden's reference adapter is in `apps/customer-demo/internal/demo/widget.go` and its React integration is `web/src/LindenVerification.tsx` in the private Trustables platform repository.

## Design and validation

Uses the unmodified official DE/EN button assets and the [d-you touchpoint guidance](https://bmi.usercontent.opencode.de/eudi-wallet/developer-guide/rp/guide/touchpoint_design/): 54px button, 500px desktop dialog, #e8e8e8 background, Inter, 250px QR, both device options, loading and success states. Narrow screens use a fullscreen dialog; native modality, keyboard focus containment, Escape, focus return and reduced motion are supported. This is a Trustables implementation, not an official d-you SDK or certification.

`npm test` checks URL/image validation, consent, EN/DE, desktop/mobile layout, strict CSP, safe review text, keyboard focus, backend-only completion, cancellation and activation races. Platform integration tests cover tenant isolation and booking ownership. A genuine wallet end-to-end run and deployed signed-in acceptance remain separate release checks.

## License

The widget code is licensed under the [MIT License](LICENSE). Bundled third-party assets retain their own terms: see [third-party notices](THIRD_PARTY_NOTICES.md), [d-you source](assets/d-you-source.md) and the [Inter license](assets/Inter-OFL.txt). The MIT license does not grant rights to use Trustables or d-you trademarks to imply endorsement or affiliation.

## Simulator presentation

Set `simulator: { origin: "https://dev.trustables.de" }` to explicitly enable
synthetic demonstrations. The same modal and accessibility behavior use a neutral
“Open Simulator” button and visible simulation wording, without d-you assets or
wallet installation instructions. Wallet mode remains the default and rejects
HTTPS handoffs. Simulator mode accepts only the pinned HTTPS origin's `/simulator`
or `/verification/start` capability URLs; it never accepts wallet deep links.

For a customer demo that previews the wallet button, add `buttonAppearance: "wallet"`
inside `simulator`. This uses the existing button artwork while retaining visible
simulation wording, a Simulator-qualified accessible label and the Simulator URL.
It does not turn the demonstration into a wallet verification or imply certification.

Return the session's `expires_at` alongside `url` and `qr_code_base64` from
`transport.start()` when the session is created after consent. It can shorten,
never extend, the review expiry. Same-device simulation opens a separate tab so
the merchant page can keep polling. Your backend must still validate the exact
session, synthetic mode, acceptance and business eligibility; a completed widget
is never identity evidence. Cancelling the widget must revoke merchant acceptance.
