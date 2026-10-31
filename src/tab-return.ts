/** Opt-in, same-origin browser coordination; never authorization or identity delivery. */
export type OriginalTabOptions = {
  namespace?: string;
  /** Refresh the exact order/session through your backend; true only after accepted state is restored. */
  resume(signal: AbortSignal): Promise<boolean>;
};
export type OriginalTabReturnResult = "unavailable" | "no-original" | "close-requested";
const receivers = new Map<string, () => void>();
let documentId: string | undefined;
function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
}
function ownId(): string { return documentId ??= randomId(); }
function validId(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{32}$/.test(value); }
async function channelName(session: string, namespace = "default"): Promise<string | null> {
  if (typeof session !== "string" || !/^[A-Za-z0-9._~-]{32,512}$/.test(session) ||
      typeof namespace !== "string" || namespace.length < 1 || namespace.length > 128) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(["trustables-tab-return-v1", namespace, session])));
  return "trustables-wallet-return:" + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

/** Internal widget hook. Keep it across successful widget removal for the merchant's result view. */
export async function registerOriginalTab(session: string, expiresAt: number, options: OriginalTabOptions): Promise<() => void> {
  try {
    const name = await channelName(session, options.namespace);
    if (!name || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return () => {};
    const sender = ownId();
    const channel = new BroadcastChannel(name);
    receivers.get(name)?.();
    let busy = false, lastNonce = "", lastSender = "", restored = false, stopped = false;
    let active: AbortController | undefined;
    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(expiry);
      active?.abort();
      channel.close();
      window.removeEventListener("pagehide", cleanup);
      if (receivers.get(name) === cleanup) receivers.delete(name);
    };
    const expiry = setTimeout(cleanup, Math.min(expiresAt - Date.now() + 15000, 615000));
    receivers.set(name, cleanup);
    window.addEventListener("pagehide", cleanup, {once: true});
    const acknowledge = (nonce: string, to: string) => channel.postMessage({v: 1, type: "restored", nonce, from: sender, to});
    channel.onmessage = async ({data}) => {
      if (stopped || data?.v !== 1 || data.type !== "resume" || !validId(data.nonce) || !validId(data.from) || data.from === sender) return;
      if (data.nonce === lastNonce && data.from === lastSender) {
        if (restored) acknowledge(data.nonce, data.from);
        return;
      }
      if (busy) return;
      busy = true; restored = false; lastNonce = data.nonce; lastSender = data.from;
      active = new AbortController();
      const controller = active;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        const accepted = await Promise.race([
          Promise.resolve().then(() => options.resume(controller.signal)),
          new Promise<false>(resolve => { deadline = setTimeout(() => {controller.abort(); resolve(false);}, 1500); }),
        ]);
        if (accepted === true && !stopped && !controller.signal.aborted) {
          restored = true;
          try { window.focus(); } catch { /* Browser policy decides focus. */ }
          acknowledge(data.nonce, data.from);
        }
      } catch { /* The return document retains its authenticated fallback. */ }
      finally { clearTimeout(deadline); controller.abort(); busy = false; }
    };
    return cleanup;
  } catch { return () => {}; } // Unsupported/blocked storage must not break verification.
}

/** Call on the callback page before its ordinary authenticated recovery. Close is best effort. */
export async function resumeOriginalTab(session: string, options: {namespace?: string} = {}): Promise<OriginalTabReturnResult> {
  let channel: BroadcastChannel | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let repeat: ReturnType<typeof setInterval> | undefined;
  try {
    const name = await channelName(session, options.namespace);
    if (!name) return "unavailable";
    const sender = ownId(), nonce = randomId();
    channel = new BroadcastChannel(name);
    const acknowledged = await new Promise<boolean>(resolve => {
      let finished = false;
      const finish = (ok: boolean) => { if (finished) return; finished = true; clearTimeout(timeout); clearInterval(repeat); resolve(ok); };
      const probe = () => {
        try { channel!.postMessage({v: 1, type: "resume", nonce, from: sender}); }
        catch { finish(false); }
      };
      timeout = setTimeout(() => finish(false), 2000);
      repeat = setInterval(probe, 200);
      channel!.onmessage = ({data}) => {
        if (data?.v === 1 && data.type === "restored" && data.nonce === nonce && data.to === sender && validId(data.from) && data.from !== sender) finish(true);
      };
      probe();
    });
    if (!acknowledged) return "no-original";
    window.close();
    return "close-requested";
  } catch { return "unavailable"; }
  finally { clearTimeout(timeout); clearInterval(repeat); channel?.close(); }
}
