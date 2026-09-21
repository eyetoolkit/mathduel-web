import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const p = await b.newPage();
p.on('pageerror', e => console.log('[pageerror]', e.message.slice(0,300)));
b.on('disconnected', () => console.log('[disconnected]'));
await p.goto('http://127.0.0.1:5199/tests/min/index.html', { waitUntil: 'commit', timeout: 15000 });
console.log('committed (both)');
for (const ms of [300, 800, 1500]) { await new Promise(r=>setTimeout(r,ms));
  try { console.log(ms+'ms:', await p.evaluate(()=>document.body.getAttribute('data-x')||document.body.getAttribute('data-err')||'(none)')); } catch(e){ console.log(ms+'ms ERR', e.message.slice(0,40)); break; } }
await b.close().catch(()=>{});
