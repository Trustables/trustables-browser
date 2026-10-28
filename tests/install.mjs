import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
const dir = await realpath(await mkdtemp(join(tmpdir(), 'trustables-install-')));
let server, browser;
try {
  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', dir], { encoding: 'utf8' }));
  await writeFile(join(dir, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(dir, pack.filename)], { cwd: dir, stdio: 'pipe' });
  await writeFile(join(dir, 'index.html'), '<!doctype html><html lang="en"><title>Installed widget</title><main id="widget"></main><script type="module" src="/main.js"></script></html>');
  await writeFile(join(dir, 'main.js'), `
    import { mountVerification } from '@trustables/browser';
    window.widget = mountVerification(document.getElementById('widget'), {
      review: { requester: 'Example hotel', credential: 'Name', purpose: 'Check-in', expires_at: new Date(Date.now()+60000).toISOString() },
      transport: { start: async () => ({url:'haip-vp://?request_uri=https%3A%2F%2Fexample.com%2Frequest', qr_code_base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='}), status: async()=>({status:'pending'}), cancel:async()=>{} }
    });
  `);
  await build({ root: dir, configFile: false, logLevel: 'warn', base: '/checkout/' });
  server = await preview({ root: dir, configFile: false, base: '/checkout/', preview: { host: '127.0.0.1', port: 0, headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'" } } });
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.csp = []; document.addEventListener('securitypolicyviolation', e=>window.csp.push(e.violatedDirective)); });
  await page.goto(server.resolvedUrls.local[0]);
  await page.getByRole('button', {name:'Verify with d-you Wallet',exact:true}).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('.qr').waitFor();
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await dialog.evaluate(e=>e.getBoundingClientRect().width),500);
  assert.equal(await dialog.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(232, 232, 232)');
  assert.equal(await page.evaluate(()=>[...document.fonts].some(f=>f.family==='TrustablesInter' && f.status==='loaded')),true);
  assert.deepEqual(await page.evaluate(()=>window.csp),[]);
  assert.deepEqual(errors,[]);
  await page.evaluate(()=>window.widget.destroy());
  assert.equal(await page.evaluate(()=>[...document.fonts].some(f=>f.family==='TrustablesInter')),false);
  console.log('Fresh tarball install: Vite production build at nested base, automatic styles/font, strict CSP and cleanup passed');
} finally {
  await browser?.close();
  await new Promise(resolve=>server ? server.httpServer.close(resolve) : resolve());
  await rm(dir, {recursive:true,force:true});
}
