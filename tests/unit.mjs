import { test } from "node:test";
import assert from "node:assert/strict";
import { validateHandoff } from "../dist/index.js";
const qr =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
test("only wallet schemes with HTTPS requests and PNG QR images are accepted", () => {
  for (const scheme of ["haip-vp", "openid4vp"])
    assert.equal(
      validateHandoff({
        url: scheme + "://?request_uri=https%3A%2F%2Fverify.example%2Frequest",
        qr_code_base64: qr,
      }).qr_code_base64,
      qr,
    );
  for (const url of [
    "javascript:alert(1)",
    "https://attacker.example",
    "haip-vp://?request_uri=http%3A%2F%2Funsafe.example",
    "haip-vp://?request_uri=https%3A%2F%2Fu%3Ap%40example.com",
  ])
    assert.throws(() => validateHandoff({ url, qr_code_base64: qr }));
  assert.throws(() =>
    validateHandoff({
      url: "haip-vp://?request_uri=https%3A%2F%2Fverify.example",
      qr_code_base64: "<svg onload=alert(1)>",
    }),
  );
});

test("simulator handoffs require explicit mode, pinned HTTPS origin and capability path", () => {
  const simulator = { origin: "https://dev.trustables.de" };
  const url = simulator.origin + "/simulator#" + "a".repeat(48);
  assert.equal(validateHandoff({ url, qr_code_base64: qr }, simulator).url, url);
  assert.throws(() => validateHandoff({ url, qr_code_base64: qr }));
  for (const invalid of [url.replace("https:", "http:"), url.replace("dev.trustables.de", "evil.example"), url.replace("/simulator", "/other"), url.replace("#", "?query=x#"), url.replace("#" + "a".repeat(48), "#short"), url.replace("https://", "https://user:pass@"), "haip-vp://?request_uri=https%3A%2F%2Fverify.example"]) {
    assert.throws(() => validateHandoff({ url: invalid, qr_code_base64: qr }, simulator));
  }
  assert.throws(() => validateHandoff({url, qr_code_base64: qr, expires_at: "invalid"}, simulator));
});
