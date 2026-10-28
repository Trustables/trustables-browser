import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import assert from "node:assert/strict";
const server = createServer(async (req, res) => {
  try {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'",
    );
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><html lang="en"><title>Widget tests</title><main id="widget"></main></html>',
      );
    } else if (
      [
        "/node_modules/axe-core/axe.min.js",
        "/dist/index.js",
        "/dist/assets.js",
        "/dist/styles.generated.js",
        "/dist/widget.css",
        "/dist/fonts.css",
        "/assets/Inter-latin.woff2",
      ].includes(req.url)
    ) {
      res.setHeader(
        "Content-Type",
        req.url.endsWith(".css")
          ? "text/css"
          : req.url.endsWith(".woff2")
            ? "font/woff2"
            : "text/javascript",
      );
      res.end(await readFile(new URL(".." + req.url, import.meta.url)));
    } else {
      res.writeHead(404).end();
    }
  } catch {
    res.writeHead(500).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ headless: true });
try {
  for (const [language, width] of [["en", 1280], ["de", 390], ["en", 320], ["en", 1024]]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin);
    await page.evaluate(async ({language, width}) => {
      const { mountVerification } = await import("/dist/index.js");
      window.calls = { start: 0, cancel: 0, complete: 0 };
      window.status = "pending";
      window.widget = mountVerification(document.getElementById("widget"), {
        language,
        ...(width === 1024 ? { stylesheetUrl: "/dist/widget.css" } : {}),
        alternative: { url: "#", label: "Use another verification method" },
        review: {
          requester: "<img src=x onerror=alert(1)>",
          purpose: "Hotel check-in",
          credential: "Name, birth date",
          expires_at: new Date(Date.now() + 60000).toISOString(),
          branded: true,
        },
        transport: {
          async start() {
            window.calls.start++;
            return {
              url: "haip-vp://?request_uri=https%3A%2F%2Fverify.example%2Frequest",
              qr_code_base64:
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
            };
          },
          async status() {
            return { status: window.status };
          },
          async cancel() {
            window.calls.cancel++;
          },
        },
        onComplete() {
          window.calls.complete++;
        },
      });
    }, {language, width});
    const label =
      language === "de"
        ? "Verifizieren mit d-you Wallet"
        : "Verify with d-you Wallet";
    assert.equal(
      await page.locator("#requester img").count(),
      0,
      "Untrusted review is plain text",
    );
    assert.equal((await page.evaluate(() => window.calls)).start, 0);
    const originalURL = page.url();
    await page.getByRole("link", { name: "Use another verification method" }).click();
    assert.equal(page.url(), originalURL, "Sales placeholder does not navigate");
    await page.getByRole("button", { name: label, exact: true }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await dialog.locator(".qr").waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await dialog.evaluate(el => el.contains(el.getRootNode().activeElement)), true);
    const dimensions = await dialog.evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, scroll: el.scrollWidth, client: el.clientWidth }));
    assert.equal(dimensions.width, width <= 540 ? width : 500);
    if (width <= 540) assert.equal(dimensions.height, 900);
    assert.ok(dimensions.scroll <= dimensions.client, "No horizontal scrolling");
    await page.addScriptTag({ url: origin + "/node_modules/axe-core/axe.min.js" });
    const violations = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })));
    assert.deepEqual(violations, [], "Modal accessibility scan");
    assert.equal(
      await page.evaluate(() => document.fonts.check("15px TrustablesInter")),
      true,
    );
    assert.equal(
      await dialog.evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(232, 232, 232)",
    );
    assert.equal(
      await dialog
        .locator(".qr")
        .evaluate((el) => el.getBoundingClientRect().width),
      250,
    );
    assert.equal(
      await dialog.getByRole("link", { name: label, exact: true }).count(),
      1,
    );
    assert.equal((await page.evaluate(() => window.calls)).complete, 0);
    for (let n = 0; n < 6; n++) {
      await page.keyboard.press("Tab");
      assert.equal(
        await dialog.evaluate((el) =>
          el.contains(el.getRootNode().activeElement),
        ),
        true,
      );
    }
    for (let n = 0; n < 6; n++) {
      await page.keyboard.press("Shift+Tab");
      assert.equal(await dialog.evaluate(el => el.contains(el.getRootNode().activeElement)), true);
    }
    if (language === "en") {
      const walletLink = dialog.getByRole("link", { name: label, exact: true });
      // Prevent the OS scheme launch in this deterministic test; preserve widget handler.
      await walletLink.evaluate(el => el.addEventListener("click", event => event.preventDefault()));
      await walletLink.focus();
      await page.keyboard.press("Enter");
      assert.equal(await dialog.locator(".qr").count(), 1, "Laptop click keeps QR until backend sees wallet");
      assert.equal((await page.evaluate(() => window.calls)).complete, 0);
      await page.evaluate(() => (window.status = "wallet_opened"));
      await dialog
        .getByText("Continue in the d-you Wallet", { exact: true })
        .waitFor();
      assert.equal(await dialog.locator(".qr").count(), 0);
      assert.equal(await dialog.evaluate(el => el.contains(el.getRootNode().activeElement)), true, "Focus survives state replacement");
      assert.equal(await dialog.locator("#state").getAttribute("aria-live"), "polite");
      await page.evaluate(() => (window.status = "completed"));
      await dialog
        .getByText("Verification successful!", { exact: true })
        .waitFor();
      assert.equal((await page.evaluate(() => window.calls)).complete, 1);
      assert.equal(await dialog.locator(".success").textContent(), "✓");
    } else {
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      assert.equal((await page.evaluate(() => window.calls)).cancel, 1);
      assert.equal(
        await page
          .locator("#start")
          .evaluate((el) => el.getRootNode().activeElement === el),
        true,
      );
    }
    await page.evaluate(() => window.widget.destroy());
    assert.deepEqual(errors, []);
    await page.close();
  }
  // Closing while activation is in flight must not resurrect the modal or poll.
  const page = await browser.newPage();
  await page.goto(origin);
  await page.evaluate(async () => {
    const { mountVerification } = await import("/dist/index.js");
    window.cancelled = 0;
    window.widget = mountVerification(document.getElementById("widget"), {
      review: {
        requester: "Hotel",
        purpose: "Check-in",
        credential: "PID",
        expires_at: new Date(Date.now() + 60000).toISOString(),
      },
      transport: {
        start: () => new Promise((r) => (window.resolveStart = r)),
        status: async () => {
          throw new Error("must not poll");
        },
        cancel: async () => {
          window.cancelled++;
        },
      },
    });
  });
  await page.locator("#start").click();
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    window.resolveStart({
      url: "haip-vp://?request_uri=https%3A%2F%2Fverify.example%2Frequest",
      qr_code_base64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
    }),
  );
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.ok(await page.evaluate(() => window.cancelled >= 1));
  await page.close();
  console.log(
    "Browser widget: consent, DE/EN, both devices, injection safety, focus, backend-only success and cancellation race passed",
  );
  for (const language of ["en", "de"]) {
    for (const buttonAppearance of [undefined, "wallet"]) {
    const page = await browser.newPage({viewport: {width: language === "en" ? 1280 : 390, height: 900}});
    await page.goto(origin);
    await page.evaluate(async ({language, buttonAppearance}) => {
      const {mountVerification} = await import("/dist/index.js");
      window.calls = {start: 0, complete: 0, cancel: 0};
      window.result = "pending";
      mountVerification(document.getElementById("widget"), {
        language, simulator: {origin: "https://dev.trustables.de", buttonAppearance},
        alternative: {url: "#", label: "Alternative"},
        review: {requester: "Hotel", purpose: "Check-in", credential: "Test name", expires_at: new Date(Date.now()+60000).toISOString(), branded: true},
        transport: {
          async start() { window.calls.start++; return {url: "https://dev.trustables.de/simulator#"+"a".repeat(48), qr_code_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII="}; },
          async status() {return {status: window.result};},
          async cancel() {window.calls.cancel++;},
        },
        onComplete() {window.calls.complete++;},
      });
    }, {language, buttonAppearance});
    const label = buttonAppearance === "wallet"
      ? (language === "en" ? "Verify with d-you Wallet (Simulator)" : "Verifizieren mit d-you Wallet (Simulator)")
      : (language === "en" ? "Open Simulator" : "Simulator öffnen");
    assert.equal(await page.locator("#start img").count(), buttonAppearance === "wallet" ? 1 : 0);
    assert.equal(await page.evaluate(() => window.calls.start), 0);
    await page.getByRole("button", {name: label, exact:true}).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator(".qr").waitFor();
    assert.equal(await dialog.locator(".info").count(), 0);
    const link = dialog.getByRole("link", {name: label, exact:true});
    assert.equal(await link.getAttribute("target"), "_blank");
    assert.match(await link.getAttribute("href"), /^https:\/\/dev.trustables.de\/simulator#/);
    assert.match(await dialog.innerText(), language === "en" ? /Simulation only/ : /Nur eine Simulation/);
    assert.doesNotMatch(await dialog.innerText(), /d-you/);
    await page.evaluate(() => {window.result = "completed";});
    await page.getByRole("heading", {name: language === "en" ? "Simulation completed!" : "Simulation abgeschlossen!", exact:true}).waitFor();
    assert.equal(await page.evaluate(() => window.calls.complete), 1);
    await page.close();
    }
  }
  {
    const page = await browser.newPage();
    await page.goto(origin);
    await page.evaluate(async () => {
      const {mountVerification} = await import("/dist/index.js");
      window.polls = 0;
      mountVerification(document.getElementById("widget"), {
        simulator: {origin: "https://dev.trustables.de"},
        review: {requester:"Hotel", purpose:"Check-in", credential:"Name", expires_at: new Date(Date.now()+60000).toISOString()},
        transport: {
          async start() {return {url:"https://dev.trustables.de/simulator#"+"a".repeat(48), expires_at: new Date(Date.now()-1000).toISOString(), qr_code_base64:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII="};},
          async status() {window.polls++; return {status:"completed"};},
          async cancel() {},
        },
      });
    });
    await page.getByRole("button", {name:"Open Simulator",exact:true}).click();
    await page.getByRole("heading", {name:"Verification expired",exact:true}).waitFor();
    assert.equal(await page.evaluate(() => window.polls), 0, "Actual session expiry bounds the initial review expiry");
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
