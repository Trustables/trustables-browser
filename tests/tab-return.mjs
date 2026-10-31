import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const server = createServer(async (req,res) => {
  if (/^\/dist\/[a-z.-]+\.js$/.test(req.url)) {
    res.setHeader('Content-Type','text/javascript');
    res.end(await readFile(new URL('..'+req.url,import.meta.url)));
  } else res.setHeader('Content-Type','text/html').end('<!doctype html><title>Tab return tests</title>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch();
const session='a'.repeat(32);
async function original(context, mode='accepted') {
  const page=await context.newPage();await page.goto(origin+'/checkout');
  await page.evaluate(async ({session,mode})=>{
    const {registerOriginalTab}=await import('/dist/tab-return.js');
    window.calls=0;window.aborts=0;window.restored=false;window.messages=[];
    const post=BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage=function(message){window.messages.push(message);post.call(this,message);};
    window.cleanup=await registerOriginalTab(session,Date.now()+60000,{namespace:'merchant',resume:async signal=>{
      window.calls++;
      if(mode==='hang') return new Promise(resolve=>signal.addEventListener('abort',()=>{window.aborts++;resolve(false);},{once:true}));
      window.restored=mode==='accepted';return window.restored;
    }});
  },{session,mode});return page;
}
async function callback(context, token=session, namespace='merchant') {
  const page=await context.newPage();await page.goto(origin+'/different-callback-path');
  await page.evaluate(()=>{window.closeCalls=0;window.close=()=>window.closeCalls++;});
  const result=await page.evaluate(async ({token,namespace})=>{
    const {resumeOriginalTab}=await import('/dist/index.js');return resumeOriginalTab(token,{namespace});
  },{token,namespace});return {page,result};
}
try {
  {
    const context=await browser.newContext(), page=await original(context);
    const result=await callback(context);
    assert.equal(result.result,'close-requested');assert.equal(await result.page.evaluate(()=>window.closeCalls),1);
    assert.equal(await page.evaluate(()=>window.restored),true);assert.equal(await page.evaluate(()=>window.calls),1);
    const messages=await page.evaluate(()=>window.messages);
    assert.equal(messages.length,1);assert.deepEqual(Object.keys(messages[0]).sort(),['from','nonce','to','type','v']);
    assert.equal(JSON.stringify(messages).includes(session),false,'No session capability or identity in broadcast messages');
    const popupPromise=page.waitForEvent('popup');await page.evaluate(url=>window.open(url),origin+'/callback');const popup=await popupPromise;
    const closed=popup.waitForEvent('close',{timeout:5000});
    await popup.evaluate(async session=>{const {resumeOriginalTab}=await import('/dist/index.js');await resumeOriginalTab(session,{namespace:'merchant'});},session).catch(error=>{if(!popup.isClosed())throw error;});
    await closed;assert.equal(page.isClosed(),false);
    await page.evaluate(()=>window.cleanup());
    assert.equal((await callback(context)).result,'no-original','Explicit cleanup removes receiver');
    await context.close();
  }
  for(const mode of ['pending','hang']) {
    const context=await browser.newContext(), page=await original(context,mode), result=await callback(context);
    assert.equal(result.result,'no-original');assert.equal(await result.page.evaluate(()=>window.closeCalls),0);
    assert.equal(await page.evaluate(()=>window.calls),1,'Repeated probes do not repeat backend refresh');
    if(mode==='hang')assert.equal(await page.evaluate(()=>window.aborts),1);
    await context.close();
  }
  {
    const context=await browser.newContext(),page=await original(context);
    assert.equal((await callback(context,session,'other-merchant')).result,'no-original');
    assert.equal((await callback(context,'b'.repeat(32))).result,'no-original');
    assert.equal(await page.evaluate(()=>window.calls),0);
    await page.evaluate(()=>{window.closeCalls=0;window.close=()=>window.closeCalls++;});
    const same=await page.evaluate(async session=>{const {resumeOriginalTab}=await import('/dist/index.js');return resumeOriginalTab(session,{namespace:'merchant'});},session);
    assert.equal(same,'no-original');assert.equal(await page.evaluate(()=>window.closeCalls),0,'Never close the original document itself');
    assert.equal(await page.evaluate(()=>window.calls),0);
    const invalid=await callback(context,'not-a-session');assert.equal(invalid.result,'unavailable');
    const unavailable=await context.newPage();await unavailable.goto(origin);await unavailable.evaluate(()=>{window.BroadcastChannel=undefined;});
    assert.equal(await unavailable.evaluate(async session=>{const {resumeOriginalTab}=await import('/dist/index.js');return resumeOriginalTab(session);},session),'unavailable');
    await context.close();
  }
  // Exercise the public widget lifecycle as well as the internal protocol helper.
  for (const lifecycle of ['completed', 'failed', 'expired', 'closed', 'destroyed', 'late-destroy']) {
    const context = await browser.newContext(), page = await context.newPage();
    await page.goto(origin + '/checkout');
    await page.evaluate(async ({session, lifecycle}) => {
      const {mountVerification} = await import('/dist/index.js');
      const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
      if (lifecycle === 'late-destroy') {
        crypto.subtle.digest = (...args) => new Promise(resolve => {
          window.releaseDigest = async () => resolve(await nativeDigest(...args));
        });
      }
      window.calls = 0; window.done = false;
      const target = document.body.appendChild(document.createElement('main'));
      window.widget = mountVerification(target, {
        language: 'en',
        review: {requester:'Merchant',credential:'Name',purpose:'Booking',expires_at:new Date(Date.now()+60000).toISOString()},
        returnToOriginalTab: {namespace:'merchant', async resume() {window.calls++;return true;}},
        transport: {
          async start() {return {url:'haip-vp://?request_uri='+encodeURIComponent('https://verify.example/request?state='+session),qr_code_base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='};},
          async status() {window.done=true;return {status:['completed','failed','expired'].includes(lifecycle) ? lifecycle : 'pending'};},
          async cancel() {},
        },
      });
    }, {session, lifecycle});
    await page.locator('#start').click();
    await page.waitForFunction(() => window.done);
    if (lifecycle === 'closed') await page.locator('.close').click();
    if (['completed','destroyed','late-destroy'].includes(lifecycle)) await page.evaluate(() => window.widget.destroy());
    if (lifecycle === 'late-destroy') await page.evaluate(async () => {await window.releaseDigest();});
    const result = await callback(context);
    assert.equal(result.result, lifecycle === 'completed' ? 'close-requested' : 'no-original', lifecycle);
    assert.equal(await page.evaluate(() => window.calls), lifecycle === 'completed' ? 1 : 0, lifecycle);
    await context.close();
  }
  console.log('Tab-return tests passed: backend-approved restore, cross-path scope, popup close, blocked-close signal, pending/timeout rejection, namespace/session isolation, no self-close, cleanup and unavailable APIs');
} finally {await browser.close();await new Promise(r=>server.close(r));}
