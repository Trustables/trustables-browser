import { verifyEn, verifyDe, trustables } from "./assets.js";
import { widgetCss } from "./styles.generated.js";

export type Review = {
  requester: string;
  purpose: string;
  credential: string;
  expires_at: string;
  branded?: boolean;
};
export type Handoff = { url: string; qr_code_base64: string; expires_at?: string };
export type VerificationStatus = {
  status: "pending" | "wallet_opened" | "completed" | "failed" | "expired";
  redirect_uri?: string;
};
/** Implement these calls on your own authenticated backend. Never pass API keys here. */
export type Transport = {
  start(): Promise<Handoff>;
  status(signal: AbortSignal): Promise<VerificationStatus>;
  cancel(): Promise<unknown>;
};
export type Options = {
  /** Explicit test-only presentation. Wallet mode remains the default. */
  simulator?: { origin: string; buttonAppearance?: "wallet" };
  stylesheetUrl?: string;
  review: Review;
  transport: Transport;
  language?: "en" | "de";
  /** Merchant-owned contact or alternative verification route. */
  alternative?: { url: string; label: string };
  onComplete?: (result: VerificationStatus) => void;
  onCancel?: () => void;
};
export type Widget = { destroy(): void };

const labels = {
  en: {
    button: "Verify with d-you Wallet",
    requested: "Requested by",
    request: "Requested information",
    purpose: "Purpose",
    need: "You need the d-you Wallet app. For another verification method, contact the requesting business.",
    title: "Verify now",
    other: "Using the d-you Wallet on another device? Then scan this QR code.",
    same: "Using the d-you Wallet on this device?",
    or: "or",
    info: "What is the d-you Wallet?",
    close: "Close",
    prepare: "Preparing wallet verification…",
    loading: "Continue in the d-you Wallet",
    follow: "Follow the steps shown there.",
    success: "Verification successful!",
    return: "You will be redirected automatically.",
    done: "Your result is available to the requesting business.",
    failed: "Verification unsuccessful",
    expired: "Verification expired",
    retry: "Request a new verification link from the business to try again.",
    connection: "Connection interrupted. Retrying verification status…",
    fallback:
      "If your wallet opened, follow its instructions. Otherwise, scan the QR code with the device that has your wallet.",
    cancelled: "Verification cancelled. Request a new link to try again.",
    cancelFailed:
      "Could not confirm cancellation. The request will expire automatically.",
    error:
      "Could not start verification. Request a new link from the business.",
    powered: "Secure verification powered by Trustables",
  },
  de: {
    button: "Verifizieren mit d-you Wallet",
    requested: "Angefragt von",
    request: "Angefragte Daten",
    purpose: "Zweck",
    need: "Du benötigst die d-you Wallet App. Für eine andere Verifizierungsmethode kontaktiere das anfragende Unternehmen.",
    title: "Jetzt verifizieren",
    other:
      "Du nutzt die d-you Wallet auf einem anderen Gerät? Dann scanne diesen QR-Code.",
    same: "Du nutzt die d-you Wallet auf diesem Gerät?",
    or: "oder",
    info: "Was ist die d-you Wallet?",
    close: "Schließen",
    prepare: "Wallet-Verifizierung wird vorbereitet…",
    loading: "Weiter in der d-you Wallet",
    follow: "Folge dort den angezeigten Schritten.",
    success: "Verifizierung erfolgreich!",
    return: "Du wirst automatisch zurückgeleitet.",
    done: "Dein Ergebnis liegt dem anfragenden Unternehmen vor.",
    failed: "Verifizierung nicht erfolgreich",
    expired: "Verifizierung abgelaufen",
    retry:
      "Fordere beim Unternehmen einen neuen Verifizierungslink an, um es erneut zu versuchen.",
    connection:
      "Verbindung unterbrochen. Der Verifizierungsstatus wird erneut abgefragt…",
    fallback:
      "Wenn sich deine Wallet geöffnet hat, folge ihren Anweisungen. Andernfalls scanne den QR-Code mit dem Gerät, auf dem deine Wallet installiert ist.",
    cancelled: "Verifizierung abgebrochen. Fordere einen neuen Link an.",
    cancelFailed:
      "Der Abbruch konnte nicht bestätigt werden. Die Anfrage läuft automatisch ab.",
    error:
      "Die Verifizierung konnte nicht gestartet werden. Fordere beim Unternehmen einen neuen Link an.",
    powered: "Sichere Verifizierung mit Trustables",
  },
};

const simulatorLabels = {
  en: {
    button: "Open Simulator", title: "Simulate verification",
    need: "Simulation only. Uses synthetic test data; no real identity is verified. No wallet app is needed.",
    other: "Scan this QR code to open the Simulator on another device.",
    same: "Continue in the Simulator on this device.",
    prepare: "Preparing simulation…", loading: "Continue in the Simulator",
    success: "Simulation completed!", done: "The simulated result is available to the requesting business.",
    fallback: "Complete the steps in the Simulator tab, then return here.",
    powered: "Simulation powered by Trustables",
  },
  de: {
    button: "Simulator öffnen", title: "Verifizierung simulieren",
    need: "Nur eine Simulation mit synthetischen Testdaten. Keine echte Identität wird verifiziert. Du benötigst keine Wallet-App.",
    other: "Scanne diesen QR-Code, um den Simulator auf einem anderen Gerät zu öffnen.",
    same: "Weiter im Simulator auf diesem Gerät.",
    prepare: "Simulation wird vorbereitet…", loading: "Weiter im Simulator",
    success: "Simulation abgeschlossen!", done: "Das simulierte Ergebnis liegt dem anfragenden Unternehmen vor.",
    fallback: "Schließe die Schritte im Simulator-Tab ab und kehre dann hierher zurück.",
    powered: "Simulation mit Trustables",
  },
};

function simulatorOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.origin !== value)
    throw new Error("Invalid simulator origin");
  return url.origin;
}

export function validateHandoff(value: Handoff, simulator?: Options["simulator"]): Handoff {
  const url = new URL(value.url);
  if (simulator) {
    if (url.origin !== simulatorOrigin(simulator.origin) || url.username || url.password ||
        !["/simulator", "/verification/start"].includes(url.pathname) || url.search || url.hash.length < 41)
      throw new Error("Invalid simulator link");
  } else {
    if (!["haip-vp:", "openid4vp:"].includes(url.protocol) || url.username || url.password)
      throw new Error("Invalid wallet link");
    const request = new URL(url.searchParams.get("request_uri") || "");
    if (request.protocol !== "https:" || request.username || request.password)
      throw new Error("Invalid wallet request");
  }
  if (value.expires_at !== undefined && !Number.isFinite(Date.parse(value.expires_at)))
    throw new Error("Invalid handoff expiry");
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value.qr_code_base64) ||
    value.qr_code_base64.length > 500000 ||
    !value.qr_code_base64.startsWith("iVBORw0KGgo")
  )
    throw new Error("Invalid QR image");
  return value;
}

/** Mount once per session. Completion is a UI notification, never proof of identity. */
export function mountVerification(
  container: HTMLElement,
  options: Options,
): Widget {
  if (!Number.isFinite(Date.parse(options.review.expires_at)))
    throw new Error("Invalid session expiry");
  if (options.simulator) simulatorOrigin(options.simulator.origin);
  let expiresAt = Date.parse(options.review.expires_at);
  let alternative: URL | undefined;
  if (options.alternative) {
    alternative = new URL(options.alternative.url, document.baseURI);
    if ((options.alternative.url !== "#" && !["https:", "mailto:"].includes(alternative.protocol)) || alternative.username || alternative.password)
      throw new Error("Invalid alternative verification link");
  }
  const host = document.createElement("div");
  container.append(host);
  const root = host.attachShadow({ mode: "open" }),
    l = { ...labels[options.language || "en"], ...(options.simulator ? simulatorLabels[options.language || "en"] : {}) };
  const artwork = options.language === "de" ? verifyDe : verifyEn;
  const useWalletArtwork = !options.simulator || options.simulator.buttonAppearance === "wallet";
  if (options.simulator && useWalletArtwork) {
    l.button = `${labels[options.language || "en"].button} (Simulator)`;
  }
  const buttonClass = useWalletArtwork ? "wallet-button" : "wallet-button simulator-button";
  const buttonImage = useWalletArtwork ? `<img src="${artwork}" alt="${l.button}">` : l.button;
  root.innerHTML = `<section class="review" aria-label="${l.title}"><div><small>${l.requested}</small><p id="requester"></p></div><div><small>${l.request}</small><p id="credential"></p></div><div><small>${l.purpose}</small><p id="purpose"></p></div></section><p class="need">${l.need}</p><button class="${buttonClass}" id="start" aria-label="${l.button}">${buttonImage}</button><p id="message" class="message" role="status"></p>${options.review.branded ? `<div class="brand"><img src="${trustables}" alt="Trustables">${l.powered}</div>` : ""}<dialog aria-labelledby="title"><button class="close" aria-label="${l.close}">×</button><div id="state" aria-live="polite" aria-atomic="true"></div><p id="connection" role="status"></p></dialog>`;
  if (alternative && options.alternative) {
    const need = root.querySelector<HTMLElement>(".need")!;
    need.textContent = options.simulator ? l.need + " " : options.language === "de"
      ? "Du benötigst die d-you Wallet App. " : "You need the d-you Wallet app. ";
    const link = document.createElement("a");
    link.href = alternative.href;
    link.textContent = options.alternative.label;
    if (options.alternative.url === "#") link.onclick = (event) => event.preventDefault();
    need.append(link);
  }
  let fonts: HTMLLinkElement | undefined;
  let fontFace: FontFace | undefined;
  if (options.stylesheetUrl) {
    // Compatibility for integrations that explicitly self-host the legacy files.
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = options.stylesheetUrl;
    root.prepend(stylesheet);
    fonts = document.createElement("link");
    fonts.rel = "stylesheet";
    fonts.href = new URL("./fonts.css", stylesheet.href).href;
    document.head.append(fonts);
  } else {
    // Constructed stylesheets work under strict CSP without inline style tags.
    const stylesheet = new CSSStyleSheet();
    stylesheet.replaceSync(widgetCss);
    root.adoptedStyleSheets = [stylesheet];
    // A static module-relative URL lets bundlers emit the font automatically.
    const fontUrl = new URL("../assets/Inter-latin.woff2", import.meta.url).href;
    fontFace = new FontFace("TrustablesInter", `url(${JSON.stringify(fontUrl)})`, {
      weight: "100 900", display: "swap",
    });
    document.fonts.add(fontFace);
  }
  for (const key of ["requester", "credential", "purpose"] as const)
    root.getElementById(key)!.textContent = options.review[key];
  const dialog = root.querySelector("dialog")!,
    trigger = root.getElementById("start") as HTMLButtonElement;
  const state = root.getElementById("state")!,
    message = root.getElementById("message")!,
    connection = root.getElementById("connection")!;
  let disposed = false,
    closed = false,
    terminal = false,
    starting = false,
    started = false,
    walletOpened = false;
  let timer: ReturnType<typeof setTimeout> | undefined,
    controller: AbortController | undefined;
  const stop = () => {
    clearTimeout(timer);
    controller?.abort();
  };
  const cancel = async () => {
    try {
      await options.transport.cancel();
    } catch {
      if (!disposed) message.textContent = l.cancelFailed;
    }
  };
  const close = () => {
    if (closed) return;
    closed = true;
    stop();
    dialog.close();
    trigger.focus();
    if (!terminal) {
      message.textContent = l.cancelled;
      void cancel().then(() => {
        if (!disposed) options.onCancel?.();
      });
    }
  };
  root.querySelector<HTMLButtonElement>(".close")!.onclick = close;
  dialog.oncancel = (e) => {
    e.preventDefault();
    close();
  };
  dialog.onkeydown = (e) => {
    if (e.key !== "Tab") return;
    const items = Array.from(
      dialog.querySelectorAll<HTMLElement>("button:not(:disabled),a[href]"),
    );
    const first = items[0],
      last = items.at(-1);
    if (e.shiftKey && root.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && root.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };
  // Replacing focused controls must not strand keyboard focus outside the dialog.
  const renderState = (html: string) => {
    const hadFocus = !!root.activeElement && state.contains(root.activeElement);
    state.innerHTML = html;
    if (hadFocus) root.querySelector<HTMLButtonElement>(".close")!.focus();
  };
  const finish = (result: VerificationStatus) => {
    terminal = true;
    stop();
    connection.textContent = "";
    const ok = result.status === "completed";
    renderState(`<h2 id="title">${ok ? l.success : result.status === "expired" ? l.expired : l.failed}</h2><p>${ok ? (result.redirect_uri ? l.return : l.done) : l.retry}</p>${ok ? '<div class="success" aria-hidden="true">✓</div>' : ""}`);
    if (ok) options.onComplete?.(result);
  };
  const poll = async () => {
    if (disposed || closed || terminal) return;
    if (expiresAt <= Date.now()) {
      finish({ status: "expired" });
      return;
    }
    controller = new AbortController();
    try {
      const result = await options.transport.status(controller.signal);
      if (disposed || closed) return;
      if (
        ![
          "pending",
          "wallet_opened",
          "completed",
          "failed",
          "expired",
        ].includes(result.status)
      )
        throw new Error("Unknown status");
      connection.textContent = "";
      if (["completed", "failed", "expired"].includes(result.status)) {
        finish(result);
        return;
      }
      if (result.status === "wallet_opened" && !walletOpened) {
        walletOpened = true;
        renderState(`<h2 id="title">${l.loading}</h2><p>${l.follow}</p><div class="spinner" aria-hidden="true"></div>`);
      }
    } catch {
      if (!disposed && !closed) connection.textContent = l.connection;
    }
    if (!disposed && !closed && !terminal) timer = setTimeout(poll, 3000);
  };
  trigger.onclick = async () => {
    if (started || disposed) return;
    started = true;
    starting = true;
    trigger.setAttribute("aria-disabled", "true");
    renderState(`<h2 id="title">${l.title}</h2><p>${l.prepare}</p>`);
    dialog.showModal();
    try {
      const handoff = validateHandoff(await options.transport.start(), options.simulator);
      if (handoff.expires_at) expiresAt = Math.min(expiresAt, Date.parse(handoff.expires_at));
      starting = false;
      if (closed || disposed) {
        await cancel();
        return;
      }
      renderState(`<h2 id="title">${l.title}</h2><p>${l.other}</p>${options.simulator ? `<p class="need">${l.need}</p>` : ""}<img class="qr" alt="${l.other}"><div class="divider">${l.or}</div><p>${l.same}</p><a class="${buttonClass}" aria-label="${l.button}">${buttonImage}</a><p id="fallback" role="status"></p>${options.simulator ? "" : `<a class="info" href="https://eudi-wallet.gov.de" target="_blank" rel="noreferrer">${l.info}</a>`}`);
      state.querySelector<HTMLImageElement>(".qr")!.src =
        "data:image/png;base64," + handoff.qr_code_base64;
      const link = state.querySelector<HTMLAnchorElement>(".wallet-button")!;
      link.href = handoff.url;
      if (options.simulator) { link.target = "_blank"; link.rel = "noopener noreferrer"; }
      link.onclick = () => {
        root.getElementById("fallback")!.textContent = l.fallback;
      };
      void poll();
    } catch {
      starting = false;
      if (!disposed && !closed) {
        renderState(`<h2 id="title">${l.failed}</h2><p class="error">${l.error}</p>`);
        void cancel();
      }
    }
  };
  return {
    destroy() {
      if (disposed) return;
      disposed = true;
      stop();
      dialog.close();
      host.remove();
      fonts?.remove();
      if (fontFace) document.fonts.delete(fontFace);
      if (started && !terminal && !closed && !starting) void cancel();
      closed = true;
    },
  };
}
