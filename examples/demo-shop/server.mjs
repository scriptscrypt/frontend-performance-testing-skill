// A tiny product page in two builds, to try the harness on without an app of your own. Zero dependencies.
//
//   node server.mjs --variant slow --port 4100     # the "before" build
//   node server.mjs --variant fast --port 4200     # the "after" build
//
// Both serve the same page at "/". The slow build does what slow apps do:
//   1. a 600 KB render-blocking script in <head>, served after a 1.5 s delay  → white screen
//   2. a spinner, then the product fetched only after that script has run      → a request waterfall
//   3. ~650 ms of synchronous work on the main thread                          → a long task (~2.6 s at 4x CPU)
//   4. content faded in from opacity 0                                         → painted but invisible
//   5. one request per price row, 12 of them                                   → a request storm
// The fast build renders the same page on the server with its data, defers a small script, and fetches nothing.
import http from 'node:http';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const VARIANT = arg('variant', 'slow');
const PORT = Number(arg('port', VARIANT === 'slow' ? 4100 : 4200));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PRODUCT = { name: 'Aurora Desk Lamp', price: 129, blurb: 'Warm, dimmable light for long evenings at the desk.' };
const ROWS = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `Aurora ${['Mini', 'Wall', 'Floor', 'Clip'][i % 4]} ${i + 1}`, price: 39 + i * 7 }));
const money = (n) => `$${n.toFixed(2)}`;

const CSS = `
:root{color-scheme:light;--fg:#111827;--mut:#6b7280;--line:#e5e7eb;--acc:#4f46e5}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,sans-serif;color:var(--fg);background:#fff}
header{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--line);font-weight:700}
header span{margin-left:auto;font-weight:400;color:var(--mut)}
main{max-width:980px;margin:0 auto;padding:24px 20px;display:grid;gap:24px;grid-template-columns:1fr 1fr}
@media (max-width:700px){main{grid-template-columns:1fr}}
.hero{aspect-ratio:4/3;border-radius:16px;background:radial-gradient(circle at 30% 30%,#fde68a,#f59e0b 40%,#78350f)}
h1{margin:0 0 8px;font-size:32px;line-height:1.15}.price{font-size:28px;font-weight:700;margin:8px 0}
button{font:inherit;font-weight:600;color:#fff;background:var(--acc);border:0;border-radius:10px;padding:12px 22px}
ul{list-style:none;padding:0;margin:0;grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}
li{display:flex;justify-content:space-between;border:1px solid var(--line);border-radius:10px;padding:10px 12px}
li b{font-variant-numeric:tabular-nums}
.spinner{width:36px;height:36px;margin:30vh auto;border:4px solid var(--line);border-top-color:var(--acc);border-radius:50%;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.fade{animation:fade .6s ease .4s both}@keyframes fade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
`;

const page = (title, head, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${CSS}</style>${head}</head><body>${body}</body></html>`;

const productHtml = (rowPrice) => `
<header>Demo Shop<span>Free shipping over $50</span></header>
<main>
  <div class="hero" role="img" aria-label="Lamp"></div>
  <section>
    <h1>${PRODUCT.name}</h1>
    <div class="price" data-testid="price">${money(PRODUCT.price)}</div>
    <p>${PRODUCT.blurb}</p>
    <button>Buy now</button>
  </section>
  <ul>${ROWS.map((r) => `<li data-testid="row"><span>${r.name}</span><b data-testid="row-price" data-id="${r.id}">${rowPrice(r)}</b></li>`).join('')}</ul>
</main>`;

const SLOW_HTML = page('Demo Shop — slow build', '<script src="/static/app-slow.js"></script>', '<div id="app"><div class="spinner"></div></div>');
const FAST_HTML = page('Demo Shop — fast build', '<script src="/static/app-fast.js" defer></script>', productHtml((r) => money(r.price)));

// 600 KB of bundle "weight", plus the app: block, fetch, render, fade in, then fetch each row's price separately.
const SLOW_JS = `var __vendor = ${JSON.stringify('x'.repeat(600 * 1024))};
addEventListener('DOMContentLoaded', function () {
  var x = 0; for (var i = 0; i < 8e8; i++) x += Math.sqrt(i); window.__work = x;
  fetch('/api/product').then(function (r) { return r.json(); }).then(function (p) {
    var html = ${JSON.stringify(productHtml(() => '…'))};
    var app = document.getElementById('app'); app.className = 'fade'; app.innerHTML = html;
    document.querySelectorAll('[data-testid=row-price]').forEach(function (el) {
      fetch('/api/price?id=' + el.dataset.id).then(function (r) { return r.json(); }).then(function (x) { el.textContent = '$' + x.price.toFixed(2); });
    });
  });
});`;
const FAST_JS = `console.log('fast build: nothing to do on load');`;

const send = (res, type, body, extra = {}) => {
  res.writeHead(200, { 'cache-control': 'no-store', 'content-type': type, ...extra });
  res.end(body);
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const variant = url.pathname === '/slow' ? 'slow' : url.pathname === '/fast' ? 'fast' : VARIANT;
    switch (url.pathname) {
      case '/':
      case '/slow':
      case '/fast':
        return send(res, 'text/html; charset=utf-8', variant === 'slow' ? SLOW_HTML : FAST_HTML);
      case '/static/app-slow.js':
        await sleep(1500);
        return send(res, 'text/javascript', SLOW_JS);
      case '/static/app-fast.js':
        return send(res, 'text/javascript', FAST_JS, { 'cache-control': 'public, max-age=31536000, immutable' });
      case '/api/product':
        await sleep(1500);
        return send(res, 'application/json', JSON.stringify(PRODUCT));
      case '/api/price': {
        await sleep(300);
        const row = ROWS.find((r) => r.id === Number(url.searchParams.get('id')));
        return send(res, 'application/json', JSON.stringify({ price: row?.price ?? 0 }));
      }
      default:
        res.writeHead(404).end();
    }
  })
  .listen(PORT, () => console.log(`demo-shop (${VARIANT} build) on http://localhost:${PORT}  — also /slow and /fast`));
