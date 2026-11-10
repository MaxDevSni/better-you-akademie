// Better You Akademie – samostatný web (Node bez frameworku).
// Proměnné prostředí: viz README.md
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const INV = require('./lib/invoice');
const STORE = require('./lib/store');

const PORT = Number(process.env.PORT) || 3000;
const SALON_EMAIL = process.env.NOTIFY_EMAIL || 'info@better-you.cz';
const MAIL_FROM = process.env.MAIL_FROM || `Better You Akademie <${SALON_EMAIL}>`;
const PUBLIC = () => String(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
const origin = (req) => PUBLIC() || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
const escH = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const id = () => crypto.randomBytes(6).toString('hex');
const hashPw = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return { salt, pass: crypto.scryptSync(pw, salt, 32).toString('hex') }; };
const verifyPw = (pw, u) => { if (!u.salt || !u.pass) return false; const h = crypto.scryptSync(pw, u.salt, 32); const x = Buffer.from(u.pass, 'hex'); return x.length === h.length && crypto.timingSafeEqual(x, h); };

// ---------- Data ----------
let db = null;
const normalize = (d) => { d = d || {}; d.academy = d.academy || {}; d.invoices = d.invoices || []; d.settings = d.settings || {}; return d; };
const save = () => STORE.save(db);

// ---------- E-mail (Mailgun API nebo SMTP) ----------
const MG_KEY = String(process.env.MAILGUN_API_KEY || '').trim(), MG_DOMAIN = String(process.env.MAILGUN_DOMAIN || (MG_KEY ? 'mg.better-you.cz' : '')).trim();
const MG_BASE = String(process.env.MAILGUN_REGION || 'eu').toLowerCase() === 'us' ? 'https://api.mailgun.net' : 'https://api.eu.mailgun.net';
let mailer = null;
if (!MG_KEY && process.env.SMTP_HOST) {
  try {
    mailer = require('nodemailer').createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587, secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
  } catch { console.warn('SMTP je nastavené, ale chybí balíček nodemailer.'); }
}
const lastMail = { at: '', ok: null, info: '', to: '' };
async function mail(to, subject, text, html, attachments = []) {
  if (!to) return false;
  try {
    if (MG_KEY && MG_DOMAIN) {
      let body = new URLSearchParams({ from: MAIL_FROM, to, subject, text, 'h:Reply-To': SALON_EMAIL });
      if (html) body.set('html', html);
      if (attachments.length) {
        const fd = new FormData(); for (const [k, v] of body) fd.append(k, v);
        for (const a of attachments) fd.append('attachment', new Blob([a.content], { type: a.type || 'application/octet-stream' }), a.filename);
        body = fd;
      }
      const r = await fetch(`${MG_BASE}/v3/${encodeURIComponent(MG_DOMAIN)}/messages`, { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from('api:' + MG_KEY).toString('base64') }, body });
      const t = await r.text();
      Object.assign(lastMail, { at: new Date().toISOString(), ok: r.ok, info: r.ok ? 'odesláno' : `${r.status} ${t.slice(0, 200)}`, to });
      if (!r.ok) console.error('Mailgun:', r.status, t.slice(0, 300));
      return r.ok;
    }
    if (mailer) { await mailer.sendMail({ from: MAIL_FROM, to, subject, text, html, replyTo: SALON_EMAIL, attachments: attachments.map((x) => ({ filename: x.filename, content: x.content, contentType: x.type })) }); Object.assign(lastMail, { at: new Date().toISOString(), ok: true, info: 'odesláno (SMTP)', to }); return true; }
    console.warn('E-mail není nastavený (MAILGUN_API_KEY nebo SMTP_HOST), zpráva pro', to, 'neodešla:', subject);
  } catch (e) { Object.assign(lastMail, { at: new Date().toISOString(), ok: false, info: e.message, to }); console.error('E-mail se nepodařilo odeslat:', e.message); }
  return false;
}
// HTML šablona e-mailu (Akademie si ji přebarví do svých barev)
function mailHtml(o) {
  const site = PUBLIC(), teal = '#2a837e', ink = '#1f1c19', muted = '#7a6f63', cream = '#f6f2ec', line = '#ece3d6';
  const btn = (t, href, primary) => `<a href="${href}" style="display:inline-block;margin:0 6px 10px 0;background:${primary ? teal : '#ffffff'};color:${primary ? '#ffffff' : teal};border:2px solid ${teal};text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:999px;font-size:15px;line-height:1">${escH(t)}</a>`;
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escH(o.title)}</title></head>
<body style="margin:0;padding:0;background:${cream};font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:${ink}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escH(o.pre || '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${cream}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">
<tr><td align="center" style="padding:0 0 18px"><a href="${site}" style="text-decoration:none;color:${ink};font-size:22px;font-weight:bold"><img src="${site}/img/logo-gold.png" width="40" height="40" alt="" style="vertical-align:middle;border:0;border-radius:8px;margin-right:8px">Better <span style="color:${teal}">You</span> <span style="font-size:13px;letter-spacing:2px;color:${muted}">AKADEMIE</span></a></td></tr>
<tr><td style="background:#ffffff;border-radius:22px;border:1px solid ${line};overflow:hidden">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="background:${teal};border-radius:21px 21px 0 0;padding:30px 28px 26px;color:#ffffff">
  <div style="width:54px;height:54px;line-height:54px;border-radius:50%;background:rgba(255,255,255,.18);font-size:28px;margin:0 auto 12px">${o.icon || '✓'}</div>
  <div style="font-size:12px;letter-spacing:3px;text-transform:uppercase;opacity:.9">${escH(o.eyebrow || '')}</div>
  <h1 style="margin:6px 0 0;font-size:26px;line-height:1.25;color:#ffffff">${escH(o.title)}</h1></td></tr>
<tr><td style="padding:26px 32px 8px;font-size:16px;line-height:1.6">${(o.intro || []).map((x) => `<p style="margin:0 0 12px">${x}</p>`).join('')}</td></tr>
${o.rows && o.rows.length ? `<tr><td style="padding:0 32px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf7f2;border-radius:14px">${o.rows.map(([k, v], i) => `<tr><td style="padding:11px 16px;font-size:13px;color:${muted};width:36%;vertical-align:top;${i ? `border-top:1px solid ${line};` : ''}">${escH(k)}</td><td style="padding:11px 16px;font-size:15px;color:${ink};font-weight:bold;${i ? `border-top:1px solid ${line};` : ''}">${v}</td></tr>`).join('')}</table></td></tr>` : ''}
${o.ctas && o.ctas.length ? `<tr><td style="padding:4px 32px 14px">${o.ctas.map(([t, h], i) => btn(t, h, i === 0)).join('')}</td></tr>` : ''}
${o.tips && o.tips.length ? `<tr><td style="padding:6px 32px 20px"><div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#8e6f3e;font-weight:bold;margin-bottom:8px">${escH(o.tipsTitle || 'Jak začít')}</div>${o.tips.map((t) => `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td valign="top" style="color:${teal};font-weight:bold;padding:3px 10px 3px 0">✓</td><td style="font-size:15px;line-height:1.5;padding:3px 0">${t}</td></tr></table>`).join('')}</td></tr>` : ''}
${o.note ? `<tr><td style="padding:0 32px 26px"><div style="background:#fbf3e6;border-radius:12px;padding:12px 16px;font-size:14px;line-height:1.5;color:#5a4a33">${o.note}</div></td></tr>` : ''}
</table></td></tr>
<tr><td align="center" style="padding:20px 16px 4px;font-size:13px;line-height:1.7;color:${muted}">
  <b style="color:${ink}">Better You Akademie</b> · marketing a AI pro kosmetické salony<br>
  <a href="mailto:${SALON_EMAIL}" style="color:${teal};text-decoration:none">${SALON_EMAIL}</a> · <a href="${site}" style="color:${teal};text-decoration:none">web</a><br>
  <span style="font-size:12px">BY studios s.r.o., IČO 23367024</span></td></tr>
</table></td></tr></table></body></html>`;
}

// ---------- Konverze: Meta Conversions API (pixel Akademie) a GA4 ----------
const sha = (v) => crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');
async function conversion(e) {
  if (!e.consent) return;
  const pixel = process.env.ACADEMY_META_PIXEL || '1862538181596907', token = process.env.META_CAPI_TOKEN || '', t = Math.floor(Date.now() / 1000);
  if (pixel && token) {
    const ud = { client_ip_address: e.ip || undefined, client_user_agent: e.ua || undefined, fbp: e.fbp || undefined, fbc: e.fbc || undefined, country: [sha('cz')] };
    if (e.email) { ud.em = [sha(e.email)]; ud.external_id = [sha(e.email)]; }
    if (e.firstName) ud.fn = [sha(e.firstName)];
    if (e.lastName) ud.ln = [sha(e.lastName)];
    const cd = { value: e.value || 0, currency: 'CZK', content_name: e.item || undefined };
    if (e.itemId) { cd.content_ids = [e.itemId]; cd.content_type = 'product'; }
    const payload = { data: [{ event_name: e.name, event_time: t, event_id: e.id, action_source: 'website', event_source_url: e.url || undefined, user_data: ud, custom_data: cd }] };
    if (process.env.META_TEST_CODE) payload.test_event_code = process.env.META_TEST_CODE;
    try { await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(pixel)}/events?access_token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); } catch (x) { console.error('Meta CAPI:', x.message); }
  }
  const ga4 = process.env.GA4_ID, gs = process.env.GA4_SECRET;
  if (ga4 && gs) {
    const ev = { Lead: 'generate_lead', Purchase: 'purchase' }[e.name] || 'generate_lead';
    try { await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(ga4)}&api_secret=${encodeURIComponent(gs)}`, { method: 'POST',
      body: JSON.stringify({ client_id: e.gaCid || `${Date.now()}.${t}`, events: [{ name: ev, params: { value: e.value || 0, currency: 'CZK', item_name: e.item || '', transaction_id: e.id, engagement_time_msec: 1 } }] }) }); } catch (x) { console.error('GA4:', x.message); }
  }
}

// ---------- HTTP pomocníci ----------
function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body === null ? '' : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 200_000) { reject(new Error('too_large')); req.destroy(); } });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { reject(new Error('bad_json')); } });
  });
}
const hits = new Map();
const ipOf = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
function limited(req, max = 20, bucket = '', count = true) {
  const ip = bucket + ipOf(req), now = Date.now(), arr = (hits.get(ip) || []).filter((t) => now - t < 10 * 60_000);
  if (count) arr.push(now); hits.set(ip, arr); return arr.length > max;
}
const cookieVal = (req, name) => { const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie || ''); return m ? decodeURIComponent(m[1]) : ''; };

// ---------- Stripe ----------
const STRIPE_KEY = String(process.env.STRIPE_SECRET_KEY || '').trim();
const WEBHOOK_SECRET = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
const onlinePay = () => !!STRIPE_KEY;
function form(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === 'object') form(v, key, out); else if (v !== undefined && v !== null) out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.join('&');
}
async function stripe(method, pth, params) {
  const r = await fetch('https://api.stripe.com/v1' + pth, { method, headers: { Authorization: 'Bearer ' + STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params ? form(params) : undefined });
  const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || 'Platební brána neodpověděla.'); return j;
}

// ---------- Faktury (vlastní řada AK) ----------
const pragueDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).format(iso ? new Date(iso) : new Date());
function issueInvoice(o, who) {
  const S = INV.settings(db), issued = pragueDate();
  const { autoSend, seq, ...supplier } = S;
  const inv = { id: id(), token: crypto.randomBytes(12).toString('hex'), number: INV.nextNumber(db, issued), issued, created: new Date().toISOString(), createdBy: who || '',
    status: 'vystaveno', paid: o.paid !== false, paidAt: o.paid === false ? '' : (o.paidAt || issued), method: o.method || 'online', ref: o.ref || '', bookingId: '',
    customer: o.customer, items: o.items, text: o.text || '', supplier, sentAt: '', sentTo: '', sendError: '' };
  db.invoices.push(inv); return inv;
}
const invoiceUrl = (inv) => `${PUBLIC()}/api/invoices/${inv.id}/pdf?t=${inv.token}`;
async function sendInvoice(inv, to) {
  to = to || inv.customer.email; if (!to) { inv.sendError = 'chybí e-mail'; return false; }
  const total = INV.kc(INV.totals(inv).total), first = inv.items[0] || {};
  const html = mailHtml({ pre: `Faktura ${inv.number} · ${total}`, eyebrow: 'Faktura', title: 'Děkujeme za platbu', icon: '🧾',
    intro: ['Dobrý den,', `v příloze vám posíláme fakturu <b>${escH(inv.number)}</b>${inv.paid ? ' k vaší platbě. Je už uhrazená, nic dalšího platit nemusíte.' : '.'}`],
    rows: [['Číslo faktury', escH(inv.number)], ['Částka', escH(total + (inv.paid ? ' · zaplaceno ✓' : ''))], ['Položka', escH(first.name || '')]],
    ctas: [['Stáhnout fakturu (PDF)', invoiceUrl(inv)]],
    note: 'Kdyby bylo potřeba fakturu upravit (například doplnit firmu a IČO), stačí odpovědět na tento e-mail.' });
  const ok = await mail(to, `Faktura ${inv.number} – Better You Akademie`, `Dobrý den,\n\nv příloze posíláme fakturu ${inv.number} na částku ${total}${inv.paid ? ' (uhrazeno)' : ''}.\nFakturu si můžete stáhnout také zde: ${invoiceUrl(inv)}\n\nDěkujeme,\nBetter You Akademie`, html,
    [{ filename: INV.fileName(inv), content: INV.pdf(inv), type: 'application/pdf' }]);
  if (ok) { inv.sentAt = new Date().toISOString(); inv.sentTo = to; inv.sendError = ''; } else inv.sendError = lastMail.info || 'e-mail se nepodařilo odeslat';
  return ok;
}

// ---------- Akademie ----------
const ACADEMY = require('./academy')({ db: () => db, save, send, readBody, limited, hashPw, verifyPw, cookieVal, stripe, onlinePay, origin, mail, mailHtml, escH,
  issueInvoice, sendInvoice, conversion, INV, SALON_EMAIL });

// ---------- Obchodní podmínky ----------
const TERMS = fs.readFileSync(path.join(__dirname, 'academy', 'terms.html'), 'utf8');
const termsPage = () => `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Obchodní podmínky | Better You Akademie</title><link rel="icon" href="/img/logo-gold.png"><meta name="robots" content="noindex">
<style>body{margin:0;background:#f7f8fb;color:#121829;font:16px/1.65 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif}.w{max-width:820px;margin:0 auto;padding:28px 18px 60px}
a{color:#3554d1}h1{font-size:30px;line-height:1.2;margin:18px 0 6px}h2{font-size:20px;margin:28px 0 8px}.top{display:flex;justify-content:space-between;align-items:center}
.logo{font-weight:800;text-decoration:none;color:#121829}.logo em{color:#3554d1;font-style:normal}.legal{background:#fff;border:1px solid #e4e7ef;border-radius:18px;padding:8px 26px 20px;margin-top:18px}
.small{font-size:13px}.muted{color:#5d6273}</style></head><body><div class="w"><div class="top"><a class="logo" href="/">Better <em>You</em> Akademie</a><a href="/">Zpět na Akademii</a></div>
<h1>Obchodní podmínky Better You Akademie</h1><p class="muted">Pravidla nákupu cest, členství a služeb v Better You Akademii. Účinné od ${INV_EFFECTIVE}.</p>
<article class="legal">${TERMS}</article></div></body></html>`;
const INV_EFFECTIVE = '1. 11. 2026';

// ---------- Statické soubory ----------
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.css': 'text/css', '.js': 'text/javascript', '.txt': 'text/plain; charset=utf-8' };
const PUB_DIR = path.join(__dirname, 'public');
function serveStatic(res, p) {
  const f = path.normalize(path.join(PUB_DIR, p));
  if (!f.startsWith(PUB_DIR) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return false;
  send(res, 200, fs.readFileSync(f), MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', { 'Cache-Control': 'public, max-age=604800' });
  return true;
}

// ---------- Server ----------
async function handle(req, res) {
  const url = new URL(req.url, 'http://x'), p = url.pathname, m = req.method;
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (p === '/healthz') return send(res, 200, { ok: true, store: STORE.status, mail: lastMail.at ? lastMail : 'zatím nic' });
  if (p.startsWith('/api/akademie/')) return ACADEMY.api(req, res, url);
  if (p === '/api/stripe/webhook' && m === 'POST') {
    const raw = await new Promise((ok) => { let d = ''; req.on('data', (c) => { d += c; }); req.on('end', () => ok(d)); });
    const sig = String(req.headers['stripe-signature'] || ''), t = (/t=(\d+)/.exec(sig) || [])[1], v1 = (/v1=([a-f0-9]+)/.exec(sig) || [])[1];
    if (!WEBHOOK_SECRET || !t || !v1) return send(res, 400, { error: 'bad signature' });
    const exp = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex');
    if (exp.length !== v1.length || !crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(v1)) || Math.abs(Date.now() / 1000 - Number(t)) > 600) return send(res, 400, { error: 'bad signature' });
    ACADEMY.webhook(JSON.parse(raw));
    return send(res, 200, { received: true }); // události salonu sem nepatří, potvrdíme je a ignorujeme
  }
  let mm;
  if ((mm = /^\/api\/invoices\/(\w+)\/pdf$/.exec(p)) && m === 'GET') {
    const inv = db.invoices.find((x) => x.id === mm[1]);
    if (!inv || url.searchParams.get('t') !== inv.token) return send(res, 404, 'Faktura nenalezena.', 'text/plain; charset=utf-8');
    return send(res, 200, INV.pdf(inv), 'application/pdf', { 'Content-Disposition': `inline; filename="${INV.fileName(inv)}"` });
  }
  if (m !== 'GET' && m !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
  if (p === '/robots.txt') return send(res, 200, `User-agent: *\nDisallow: /\n`, 'text/plain; charset=utf-8');
  if (p === '/sitemap.xml') return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${ACADEMY.sitemap().map((u) => `<url><loc>${origin(req)}${u === '/' ? '/' : u}</loc></url>`).join('')}</urlset>`, 'application/xml; charset=utf-8');
  if (p === '/obchodni-podminky') return send(res, 200, termsPage(), 'text/html; charset=utf-8');
  if (p.startsWith('/img/') && serveStatic(res, p)) return;
  if (p === '/favicon.ico' && serveStatic(res, '/img/logo-gold.png')) return;
  // Staré adresy /akademie/... z prvních odkazů vedou na nový kořen
  if (p === '/akademie' || p.startsWith('/akademie/')) { res.writeHead(301, { Location: (p.replace(/^\/akademie/, '') || '/') + url.search }); return res.end(); }
  if (ACADEMY.serve(req, res, p)) return;
  return send(res, 404, '<!doctype html><meta charset="utf-8"><title>Nenalezeno</title><p style="font-family:sans-serif;padding:40px">Stránka nenalezena. <a href="/">Zpět na Akademii</a></p>', 'text/html; charset=utf-8');
}

// ---------- Jednorázový přenos dat ze starého webu better-you.cz ----------
// Když je úložiště prázdné a je nastavené IMPORT_FROM (např. https://www.better-you.cz), stáhne účty, objednávky a faktury Akademie.
// Klíč se odvozuje ze STRIPE_SECRET_KEY, který mají oba weby stejný, takže se nikam nemusí kopírovat.
const exportKey = () => crypto.createHash('sha256').update('akademie-export:' + STRIPE_KEY).digest('hex');
async function importOld() {
  const from = String(process.env.IMPORT_FROM || '').trim().replace(/\/+$/, '');
  if (!from || !STRIPE_KEY) return false;
  const r = await fetch(from + '/api/akademie-export', { headers: { 'X-Export-Key': exportKey() } });
  if (!r.ok) throw new Error(`Import: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  db.academy = j.academy || {}; db.invoices = j.invoices || []; db.importedAt = new Date().toISOString(); db.importedFrom = from;
  console.log(`Import ze starého webu: ${(db.academy.users || []).length} účtů, ${(db.academy.orders || []).length} objednávek, ${db.invoices.length} faktur.`);
  return true;
}

(async () => {
  db = normalize(await STORE.load());
  if (!db.academy.users && !db.importedAt) { try { if (await importOld()) await STORE.save(db); } catch (e) { console.error(e.message); } }
  await STORE.flush();
  const server = http.createServer((req, res) => handle(req, res).catch((e) => { console.error(e); if (!res.headersSent) send(res, 500, { error: 'Chyba serveru.' }); }));
  server.listen(PORT, () => console.log(`Better You Akademie běží na portu ${PORT} (úložiště: ${STORE.status.mode})`));
  const bye = () => { STORE.flush().finally(() => process.exit(0)); };
  process.on('SIGTERM', bye); process.on('SIGINT', bye);
})();
