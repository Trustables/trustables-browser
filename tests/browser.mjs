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
        "/dist/index.js",
        "/dist/assets.js",
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
  for (const language of ["en", "de"]) {
    const page = await browser.newPage({
      viewport: { width: language === "de" ? 390 : 1280, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin);
    await page.evaluate(async (language) => {
      const { mountVerification } = await import("/dist/index.js");
      window.calls = { start: 0, cancel: 0, complete: 0 };
      window.status = "pending";
      window.widget = mountVerification(document.getElementById("widget"), {
        language,
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
    }, language);
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
    await page.getByRole("button", { name: label, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator(".qr").waitFor();
    await page.evaluate(() => document.fonts.ready);
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
    if (language === "en") {
      await page.evaluate(() => (window.status = "wallet_opened"));
      await dialog
        .getByText("Continue in the d-you Wallet", { exact: true })
        .waitFor();
      assert.equal(await dialog.locator(".qr").count(), 0);
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
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
