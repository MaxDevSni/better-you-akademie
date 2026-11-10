// Fully Akademie: účty, chráněný obsah, objednávky a platby (Stripe), administrace.
// Samostatný web Akademie: data v db.academy (úložiště viz lib/store.js).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = __dirname;
const FILES_DIR = path.join(DIR, 'files');
let CONTENT = null; // načteno líně (obsah lekcí je velký)
const content = () => CONTENT || (CONTENT = JSON.parse(fs.readFileSync(path.join(DIR, 'content.json'), 'utf8')));

// Ceník (cena se vždy bere ze serveru, nikdy z prohlížeče)
const CATALOG = {
  meta: { name: 'Reklama, která plní diář', price: 1990, grants: ['meta'] },
  steal: { name: 'Ukradněte naše reklamy', price: 2490, grants: ['steal'] },
  xmas: { name: 'Vyprodané Vánoce 2026', price: 1990, grants: ['xmas'] },
  ai: { name: 'AI asistentka vašeho salonu', price: 4990, grants: ['ai'] },
  elearn: { name: 'Salon, který se objednává sám', price: 3990, grants: ['elearn'] },
  tables: { name: 'Sada 16 excelových nástrojů', price: 1490, grants: ['tables'] },
  prompts: { name: 'Knihovna 120 promptů pro salony', price: 990, grants: ['prompts'] },
  member: { name: 'Členství Fully Akademie', price: 2990, grants: ['member'], recurring: true },
  call: { name: 'Strategický hovor (30 min online)', price: 990, grants: ['call'], service: true },
  consult: { name: 'Konzultace byznysu (1 hodina online)', price: 1990, grants: ['consult'], service: true },
  mentor: { name: 'Online mentoring (3 měsíce)', price: 20000, grants: ['mentor'], service: true },
  // jen jako doplněk objednávky nebo nabídka po nákupu
  'call-bump': { name: 'Strategický hovor (30 min online) k objednávce', price: 690, grants: ['call'], service: true, bumpOnly: true },
  'member-first': { name: 'První měsíc členství Fully Akademie', price: 990, grants: ['member'], days: 31, upsellOnly: true },
  'steal-bump': { name: 'Ukradněte naše reklamy (nabídka k objednávce)', price: 990, grants: ['steal'], bumpOnly: true },
  'steal-up': { name: 'Ukradněte naše reklamy (nabídka k objednávce)', price: 1490, grants: ['steal'], upsellOnly: true },
  'meta-up': { name: 'Reklama, která plní diář (nabídka k objednávce)', price: 1290, grants: ['meta'], upsellOnly: true },
};
const PATHS = ['meta', 'steal', 'xmas', 'ai', 'elearn'];
const PATH_CONTENT_ID = { meta: 'meta', steal: 'steal', xmas: 'xmas', ai: 'ai', elearn: 'booking' };
const LABEL = { meta: 'Reklama, která plní diář', steal: 'Ukradněte naše reklamy', xmas: 'Vyprodané Vánoce 2026', ai: 'AI asistentka', elearn: 'Salon, který se objednává sám', tables: 'Sada 16 tabulek', prompts: 'Knihovna promptů', member: 'Členství', call: 'Strategický hovor', consult: 'Konzultace', mentor: 'Mentoring' };
const FUNNEL_UPSELL = { 'ukradnete-reklamy': 'member-first', 'ai-asistentka': 'member-first', 'plny-diar': 'steal-up', 'vyprodane-vanoce': 'steal-up', 'objednava-sama': 'meta-up' };

module.exports = function academy(ctx) {
  const { send, readBody, limited, hashPw, verifyPw, cookieVal, stripe, onlinePay, origin, mail, escH, issueInvoice, sendInvoice, conversion, INV } = ctx;
  // E-maily Akademie mají v patičce telefon Akademie, ne salonu
  const mailHtml = (o) => ctx.mailHtml(o).replace(/tel:\+420602370528/g, 'tel:+420737025954').replace(/\+420 602 370 528/g, '+420 737 025 954').replace('kosmetický salon<br>', 'Akademie pro salony<br>')
    .replace(/#2a837e/g, '#2a5ae8').replace(/#3f9e99/g, '#121829').replace(/#f6f2ec/g, '#f5f8fd').replace(/#ece3d6/g, '#e3e8f2').replace(/#faf7f2/g, '#f5f8fd')
    .replace(/#8e6f3e/g, '#e0244c').replace(/#fbf3e6/g, '#eef3ff').replace(/#5a4a33/g, '#1f2a44').replace(/#7a6f63/g, '#5d6273').replace(/#1f1c19/g, '#121829');
  const db = () => ctx.db();
  const save = () => ctx.save();
  const A = () => {
    const d = db();
    d.academy = d.academy || {};
    const a = d.academy;
    a.users = a.users || []; a.sessions = a.sessions || {}; a.orders = a.orders || []; a.leads = a.leads || []; a.resets = a.resets || {};
    if (!a.users.some((u) => u.login === 'admin')) {
      a.users.push({ id: rid(), login: 'admin', email: '', name: 'Administrátor', role: 'admin', ...hashPw(process.env.ACADEMY_ADMIN_PASSWORD || 'admin'), access: [], created: new Date().toISOString() });
      if (!a.demoSeeded) { a.demoSeeded = true; a.users.push({ id: rid(), login: 'user', email: '', name: 'Ukázková členka', role: 'member', demo: true, ...hashPw('user'), access: [...PATHS, 'tables', 'prompts'], created: new Date().toISOString() }); }
      save();
    }
    // Ukázkový účet user / user se vším obsahem (na přání majitele). Když ho v administraci smažete, znovu se nevytvoří.
    if (a.demoVersion !== 2) {
      a.demoVersion = 2;
      let d = a.users.find((u) => u.login === 'user');
      if (!d) { d = { id: rid(), login: 'user', email: '', name: 'Ukázková členka', role: 'member', demo: true, created: new Date().toISOString() }; a.users.push(d); }
      Object.assign(d, hashPw('user'), { disabled: false, access: [...PATHS, 'tables', 'prompts', 'member', 'call'], memberUntil: '2099-12-31T00:00:00.000Z' });
      save();
    }
    return a;
  };
  const rid = () => crypto.randomBytes(8).toString('hex');
  const now = () => new Date().toISOString();
  const kc = (n) => new Intl.NumberFormat('cs-CZ').format(n) + ' Kč';
  const clean = (v, n = 200) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  const okEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
  const PUB = (req) => origin(req);
  const secure = (req) => !!process.env.RENDER || req.headers['x-forwarded-proto'] === 'https';

  // ---------- relace ----------
  const tkey = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
  function startSession(req, res, u) {
    const t = crypto.randomBytes(24).toString('hex'), a = A();
    const nowMs = Date.now(); for (const [k, s] of Object.entries(a.sessions)) if (s.exp < nowMs) delete a.sessions[k];
    a.sessions[tkey(t)] = { uid: u.id, exp: nowMs + 30 * 864e5 }; u.lastLogin = now(); save();
    res.setHeader('Set-Cookie', `bya_s=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure(req) ? '; Secure' : ''}`);
  }
  function me(req) {
    const t = cookieVal(req, 'bya_s'); if (!t) return null;
    const a = A(), s = a.sessions[tkey(t)]; if (!s || s.exp < Date.now()) return null;
    return a.users.find((u) => u.id === s.uid && !u.disabled) || null;
  }
  function endSession(req, res) {
    const t = cookieVal(req, 'bya_s'); if (t) { delete A().sessions[tkey(t)]; save(); }
    res.setHeader('Set-Cookie', `bya_s=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(req) ? '; Secure' : ''}`);
  }

  // ---------- přístupy ----------
  function access(u) {
    const s = new Set();
    if (!u) return s;
    if (u.role === 'admin') { PATHS.forEach((p) => s.add(p)); s.add('tables'); s.add('prompts'); s.add('member'); return s; }
    for (const g of u.access || []) s.add(g);
    if (u.memberUntil && new Date(u.memberUntil) > new Date()) s.add('member'); else s.delete('member');
    if (s.has('member')) { PATHS.forEach((p) => s.add(p)); s.add('tables'); s.add('prompts'); }
    if (PATHS.some((p) => s.has(p))) { s.add('tables'); s.add('prompts'); }
    return s;
  }
  const pub = (u) => u && { id: u.id, name: u.name, email: u.email || u.login, role: u.role, access: [...access(u)], memberUntil: u.memberUntil || '', demo: !!u.demo };

  function grant(u, key, days) {
    for (const g of (CATALOG[key] || { grants: [key] }).grants) {
      if (g === 'member') {
        const base = u.memberUntil && new Date(u.memberUntil) > new Date() ? new Date(u.memberUntil) : new Date();
        base.setDate(base.getDate() + (days || 32)); u.memberUntil = base.toISOString();
      } else if (!u.access.includes(g)) u.access.push(g);
    }
  }

  // ---------- objednávky ----------
  function orderPaid(o, ref, ss) {
    if (o.status === 'zaplaceno') return false;
    const a = A(), u = a.users.find((x) => x.id === o.uid); if (!u) return false;
    o.status = 'zaplaceno'; o.paidAt = now(); o.ref = ref || o.ref || '';
    if (ss && ss.subscription) { o.subscription = ss.subscription; u.subscription = ss.subscription; }
    for (const it of o.items) grant(u, it.key, CATALOG[it.key] && CATALOG[it.key].days);
    save();
    try {
      const inv = issueInvoice({ customer: { name: o.company || u.name, email: u.email, ico: o.ico || '' }, items: o.items.map((it) => ({ name: it.name, sub: 'Fully Akademie', qty: 1, price: it.price })), method: 'online', ref: o.ref }, 'Akademie');
      o.invoiceId = inv.id; save();
      if (INV.settings(db()).autoSend !== false && u.email) sendInvoice(inv).then(save).catch(() => {});
    } catch (e) { console.error('Akademie faktura:', e.message); }
    accessMail(u, o).catch(() => {});
    salonMail(`Akademie: zaplaceno ${kc(o.total)}`, `${u.name} (${u.email}) zaplatil(a): ${o.items.map((i) => i.name).join(', ')}. Celkem ${kc(o.total)}.${o.note ? '\nPoznámka: ' + o.note : ''}`).catch(() => {});
    // Konverze se neposílají přes Conversions API salonu (jiný pixel); Purchase měří pixel Akademie v prohlížeči.
    return true;
  }
  const START = {
    meta: 'Reklama, která plní diář: otevřete 1. týden a nastavte měření. Zabere asi 30 minut a bez něj by reklama nevěděla, kdo nakoupil.',
    steal: 'Ukradněte naše reklamy: začněte lekcí Struktura účtu (20 min) a pak rozborem reklamy, která nám za 30 Kč denně přinesla 34 nákupů.',
    xmas: 'Vyprodané Vánoce 2026: ještě tento týden připravte balíčky poukazů podle 1. kroku. Čím dřív bude nabídka hotová, tím víc poukazů prodáte.',
    ai: 'AI asistentka: v 1. kroku nastavíte hlas značky. Pak vám AI píše příspěvky i odpovědi jako váš salon.',
    elearn: 'Salon, který se objednává sám: začněte Google profilem a recenzemi, to je nejrychlejší cesta k novým klientkám.',
    member: 'Členství: máte všech 5 cest, 16 tabulek a 120 promptů. Nevíte, kde začít? Udělejte si v Akademii plán růstu na 90 dní.',
    call: 'Strategický hovor: do 24 hodin v pracovní dny vám pošleme termíny. Připravte si tržby, útratu za reklamu a počet nových klientek za poslední 3 měsíce.',
    consult: 'Konzultace: do 24 hodin v pracovní dny vám pošleme termíny.',
  };
  const BONUS_END = new Date('2026-11-15T23:59:59+01:00');
  async function accessMail(u, o, opt = {}) {
    const to = opt.to || u.email; if (!to) return;
    const site = PUB({ headers: {} });
    const grants = [...new Set(o.items.flatMap((i) => (CATALOG[i.key] || { grants: [i.key] }).grants))];
    const tips = grants.map((g) => START[g]).filter(Boolean);
    const hasPath = grants.some((g) => PATHS.includes(g));
    if (hasPath && new Date(o.created || Date.now()) < BONUS_END) tips.push('Bonus k objednávce: osobní kontrola (30 min online). Až budete mít první krok hotový, odpovězte na tento e-mail a domluvíme termín.');
    const member = grants.includes('member');
    const first = escH(String(u.name || '').split(/[ ,]/)[0]);
    const html = mailHtml({ pre: 'Přístup do Akademie je aktivní. Tady je, jak začít.', eyebrow: 'Fully Akademie', title: 'Děkujeme, máte přístup', icon: '✓',
      intro: [`Dobrý den${first ? ', ' + first : ''},`, 'děkujeme za důvěru. Platba proběhla a obsah máte odemčený ve svém účtu. Přihlásíte se e-mailem a heslem, které jste si zvolila při objednávce.'],
      rows: [...o.items.map((i) => [i.name, escH(kc(i.price))]), ['Celkem', escH(kc(o.total)) + ' · zaplaceno ✓'], ['Objednávka', escH('#' + String(o.id).slice(0, 8))],
        ['Přístup', member ? escH('členství, obnovuje se měsíčně, zrušíte kdykoli') : escH('12 měsíců od dnešního dne')]],
      ctas: [['Otevřít Akademii', site + '/?ucet=1'], ['Plán růstu zdarma', site + '/#plan']],
      tipsTitle: 'Jak začít', tips,
      note: 'Fakturu vám posíláme samostatným e-mailem. Když se kdekoli zaseknete, odpovězte na tento e-mail nebo zavolejte na <a href="tel:+420737025954" style="color:#2a5ae8">737 025 954</a>. Pomůžeme vám zdarma, dokud to nebude fungovat.' });
    const text = `Dobrý den,\n\nděkujeme za objednávku: ${o.items.map((i) => i.name).join(', ')} (celkem ${kc(o.total)}).\nObsah najdete po přihlášení: ${site}/?ucet=1\n\nJak začít:\n- ${tips.join('\n- ')}\n\nPomoc: odpovězte na tento e-mail nebo volejte 737 025 954.\n\nFully Akademie`;
    return mail(to, (opt.subjectPrefix || '') + 'Děkujeme, váš přístup do Fully Akademie je aktivní', text, html);
  }
  const salonMail = (subj, text) => mail(ctx.SALON_EMAIL, subj, text);

  async function checkout(req, res, u, b) {
    const keys = (Array.isArray(b.items) ? b.items : []).map(String).filter((k) => CATALOG[k]);
    if (!keys.length || keys.length > 3) return send(res, 400, { error: 'Neplatná objednávka.' });
    const a = A();
    if (keys.some((k) => CATALOG[k].upsellOnly)) {
      const prev = a.orders.find((x) => x.id === b.upsellOf && x.uid === u.id && x.status === 'zaplaceno' && Date.now() - new Date(x.paidAt) < 3 * 3600e3);
      if (!prev || keys.length !== 1 || FUNNEL_UPSELL[prev.funnel] !== keys[0]) return send(res, 400, { error: 'Nabídka už neplatí.' });
    }
    if (keys.some((k) => CATALOG[k].bumpOnly) && !keys.some((k) => !CATALOG[k].bumpOnly && !CATALOG[k].upsellOnly)) return send(res, 400, { error: 'Neplatná objednávka.' });
    if (keys.includes('steal-bump') && keys.includes('steal')) return send(res, 400, { error: 'Neplatná objednávka.' });
    if (keys.includes('member') && keys.length > 1) return send(res, 400, { error: 'Členství se objednává samostatně.' });
    if (!b.terms) return send(res, 400, { error: 'Potvrďte prosím souhlas s obchodními podmínkami.' });
    const digital = keys.some((k) => !CATALOG[k].service);
    if (digital && !b.waiver) return send(res, 400, { error: 'Potvrďte prosím, že chcete zpřístupnit obsah hned.' });
    const items = keys.map((k) => ({ key: k, name: CATALOG[k].name, price: CATALOG[k].price }));
    const o = { id: rid(), uid: u.id, created: now(), status: 'čeká na platbu', items, total: items.reduce((s, i) => s + i.price, 0), funnel: clean(b.funnel, 40), upsellOf: clean(b.upsellOf, 40),
      note: clean(b.note, 1000), ico: clean(b.ico, 12), company: clean(b.company, 120), terms: now(), waiver: digital ? now() : '', consent: !!(b.consent && b.consent.marketing),
      ip: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(), ua: clean(req.headers['user-agent'], 300), url: clean(b.url, 300) };
    a.orders.push(o); save();
    if (!onlinePay()) {
      salonMail(`Akademie: nová objednávka ${kc(o.total)} (čeká na platbu)`, `${u.name} (${u.email}) objednal(a): ${items.map((i) => i.name).join(', ')}.\nPlatební brána není nastavená, pošlete prosím platební údaje a po zaplacení přidělte přístup v administraci Akademie.`).catch(() => {});
      return send(res, 200, { pending: true, order: o.id });
    }
    const site = PUB(req);
    const back = b.funnel ? `/${encodeURIComponent(b.funnel)}` : '/';
    const recurring = keys.length === 1 && CATALOG[keys[0]].recurring;
    const params = { mode: recurring ? 'subscription' : 'payment', locale: 'cs', customer_email: u.email || undefined, client_reference_id: o.id,
      success_url: `${site}/dekujeme?o=${o.id}&s={CHECKOUT_SESSION_ID}`, cancel_url: site + back,
      metadata: { academyOrder: o.id, academyUser: u.id } };
    items.forEach((it, i) => {
      params[`line_items[${i}][quantity]`] = 1;
      params[`line_items[${i}][price_data][currency]`] = 'czk';
      params[`line_items[${i}][price_data][unit_amount]`] = it.price * 100;
      params[`line_items[${i}][price_data][product_data][name]`] = it.name;
      if (recurring) params[`line_items[${i}][price_data][recurring][interval]`] = 'month';
    });
    if (recurring) { params['subscription_data[metadata][academyUser]'] = u.id; params['subscription_data[metadata][academyOrder]'] = o.id; }
    else { params['invoice_creation[enabled]'] = undefined; params['payment_intent_data[metadata][academyOrder]'] = o.id; }
    try {
      const flat = {}; for (const [k, v] of Object.entries(params)) if (v !== undefined && typeof v !== 'object') flat[k] = v;
      flat['metadata[academyOrder]'] = o.id; flat['metadata[academyUser]'] = u.id;
      const ss = await stripe('POST', '/checkout/sessions', flat);
      o.session = ss.id; save();
      return send(res, 200, { url: ss.url, order: o.id });
    } catch (e) {
      console.error('Akademie Stripe:', e.message); o.status = 'chyba platby'; o.error = e.message; save();
      return send(res, 502, { error: 'Platební bránu se nepodařilo otevřít. Zkuste to prosím znovu za chvíli, nebo nám napište na ' + ctx.SALON_EMAIL + '.' });
    }
  }

  // ---------- webhook (volá server.js) ----------
  function webhook(ev) {
    const a = A(), obj = ev.data && ev.data.object || {};
    if (ev.type === 'checkout.session.completed') {
      const md = obj.metadata || {}; if (!md.academyOrder) return false;
      const o = a.orders.find((x) => x.id === md.academyOrder);
      if (o && (obj.payment_status === 'paid' || obj.payment_status === 'no_payment_required') && Math.round((obj.amount_total || 0) / 100) === o.total) orderPaid(o, obj.payment_intent || obj.subscription, obj);
      return true;
    }
    if (ev.type === 'invoice.paid' && obj.subscription && obj.billing_reason === 'subscription_cycle') {
      const u = a.users.find((x) => x.subscription === obj.subscription); if (u) { grant(u, 'member', 32); save(); }
      return !!u;
    }
    if (ev.type === 'customer.subscription.deleted') {
      const u = a.users.find((x) => x.subscription === obj.id); if (u) { u.subscriptionEnded = now(); save(); }
      return !!u;
    }
    return false;
  }

  // ---------- API ----------
  async function api(req, res, url) {
    const p = url.pathname, m = req.method, a = A(), u = me(req);
    if (m === 'POST' && /\/(login|register|reset-request|reset|lead|checkout)$/.test(p) && limited(req, p.endsWith('login') ? 15 : 10, 'aka:' + p.split('/').pop() + ':')) return send(res, 429, { error: 'Příliš mnoho pokusů. Zkuste to prosím za pár minut.' });

    if (p === '/api/akademie/me' && m === 'GET') return send(res, 200, { user: pub(u), pay: onlinePay() }, undefined, { 'Cache-Control': 'no-store' });

    if (p === '/api/akademie/login' && m === 'POST') {
      const b = await readBody(req), id = clean(b.login, 120).toLowerCase();
      const x = a.users.find((y) => !y.disabled && (y.login === id || (y.email && y.email === id)));
      if (!x || !verifyPw(String(b.password || ''), x)) return send(res, 401, { error: 'Nesprávný e-mail nebo heslo.' });
      startSession(req, res, x); return send(res, 200, { user: pub(x) });
    }
    if (p === '/api/akademie/register' && m === 'POST') {
      const b = await readBody(req), email = clean(b.email, 120).toLowerCase(), name = clean(b.name, 120), pw = String(b.password || '');
      if (!name) return send(res, 400, { error: 'Vyplňte prosím jméno.' });
      if (!okEmail(email)) return send(res, 400, { error: 'Zkontrolujte prosím e-mail.' });
      if (pw.length < 8) return send(res, 400, { error: 'Heslo musí mít aspoň 8 znaků.' });
      if (a.users.some((y) => y.email === email || y.login === email)) return send(res, 409, { error: 'Účet s tímto e-mailem už existuje. Přihlaste se, nebo si obnovte heslo.' });
      const x = { id: rid(), login: email, email, name, role: 'member', ...hashPw(pw), access: [], created: now(), newsletter: !!b.newsletter };
      a.users.push(x); save(); startSession(req, res, x);
      return send(res, 200, { user: pub(x) });
    }
    if (p === '/api/akademie/logout' && m === 'POST') { endSession(req, res); return send(res, 200, { ok: true }); }
    if (p === '/api/akademie/reset-request' && m === 'POST') {
      const b = await readBody(req), email = clean(b.email, 120).toLowerCase();
      const x = a.users.find((y) => y.email === email && !y.disabled);
      if (x) {
        const t = crypto.randomBytes(20).toString('hex'); a.resets[tkey(t)] = { uid: x.id, exp: Date.now() + 2 * 3600e3 }; save();
        const link = `${PUB(req)}/?obnova=${t}`;
        mail(x.email, 'Obnova hesla do Fully Akademie', `Dobrý den,\n\nnové heslo si nastavíte na tomto odkazu (platí 2 hodiny):\n${link}\n\nPokud jste o obnovu nežádala, e-mail ignorujte.\n\nBetter You`,
          mailHtml({ pre: 'Obnova hesla', eyebrow: 'Fully Akademie', title: 'Nastavte si nové heslo', icon: '🔑', intro: ['Dobrý den,', 'nové heslo si nastavíte na odkazu níže. Odkaz platí 2 hodiny.'], ctas: [['Nastavit nové heslo', link]], note: 'Pokud jste o obnovu hesla nežádala, e-mail můžete ignorovat.' })).catch(() => {});
      }
      return send(res, 200, { ok: true });
    }
    if (p === '/api/akademie/reset' && m === 'POST') {
      const b = await readBody(req), r = a.resets[tkey(String(b.token || ''))];
      if (!r || r.exp < Date.now()) return send(res, 400, { error: 'Odkaz už neplatí. Požádejte prosím o nový.' });
      if (String(b.password || '').length < 8) return send(res, 400, { error: 'Heslo musí mít aspoň 8 znaků.' });
      const x = a.users.find((y) => y.id === r.uid); delete a.resets[tkey(String(b.token))];
      Object.assign(x, hashPw(String(b.password))); startSession(req, res, x); return send(res, 200, { user: pub(x) });
    }
    if (p === '/api/akademie/password' && m === 'POST') {
      if (!u) return send(res, 401, { error: 'Přihlaste se prosím.' });
      const b = await readBody(req);
      if (!verifyPw(String(b.old || ''), u)) return send(res, 400, { error: 'Současné heslo nesouhlasí.' });
      if (String(b.password || '').length < 8) return send(res, 400, { error: 'Nové heslo musí mít aspoň 8 znaků.' });
      Object.assign(u, hashPw(String(b.password))); save(); return send(res, 200, { ok: true });
    }

    if (p === '/api/akademie/checkout' && m === 'POST') {
      const b = await readBody(req); let x = u;
      if (!x) {
        const email = clean(b.email, 120).toLowerCase(), name = clean(b.name, 120), pw = String(b.password || '');
        if (!name) return send(res, 400, { error: 'Vyplňte prosím jméno.' });
        if (!okEmail(email)) return send(res, 400, { error: 'Zkontrolujte prosím e-mail.' });
        if (a.users.some((y) => y.email === email || y.login === email)) return send(res, 409, { error: 'Účet s tímto e-mailem už existuje. Přihlaste se prosím a objednávku dokončete.', login: true });
        if (pw.length < 8) return send(res, 400, { error: 'Heslo musí mít aspoň 8 znaků.' });
        x = { id: rid(), login: email, email, name, role: 'member', ...hashPw(pw), access: [], created: now() };
        a.users.push(x); save(); startSession(req, res, x);
      }
      if (x.role === 'admin' || !x.email) return send(res, 400, { error: 'Pod tímto účtem nelze nakupovat. Odhlaste se a objednejte jako zákaznice.' });
      return checkout(req, res, x, b);
    }
    let mm;
    if ((mm = /^\/api\/akademie\/order\/(\w+)$/.exec(p)) && m === 'GET') {
      if (!u) return send(res, 401, { error: 'Přihlaste se prosím.' });
      const o = a.orders.find((x) => x.id === mm[1] && x.uid === u.id);
      if (!o) return send(res, 404, { error: 'Objednávka nenalezena.' });
      if (o.status !== 'zaplaceno' && o.session && onlinePay()) {
        try { const ss = await stripe('GET', '/checkout/sessions/' + encodeURIComponent(o.session));
          if ((ss.payment_status === 'paid' || ss.payment_status === 'no_payment_required') && ss.metadata && ss.metadata.academyOrder === o.id) orderPaid(o, ss.payment_intent || ss.subscription, ss);
        } catch (e) { console.error('Akademie ověření platby:', e.message); }
      }
      const up = FUNNEL_UPSELL[o.funnel], upsell = o.status === 'zaplaceno' && !o.upsellOf && up && !access(u).has(CATALOG[up].grants[0]) ? { key: up, name: CATALOG[up].name, price: CATALOG[up].price } : null;
      return send(res, 200, { id: o.id, status: o.status, total: o.total, items: o.items, funnel: o.funnel, upsell, user: pub(u) }, undefined, { 'Cache-Control': 'no-store' });
    }
    if (p === '/api/akademie/content' && m === 'GET') {
      if (!u) return send(res, 401, { error: 'Přihlaste se prosím.' });
      const acc = access(u), c = content();
      const paths = c.paths.filter((x) => PATHS.some((k) => acc.has(k) && PATH_CONTENT_ID[k] === x.id));
      const locked = PATHS.filter((k) => !acc.has(k)).map((k) => ({ id: k, title: LABEL[k] }));
      return send(res, 200, { user: u.login, paths, locked, prompts: acc.has('prompts') ? c.prompts : { categories: [] }, hasPrompts: acc.has('prompts'), hasTables: acc.has('tables'), files: acc.has('tables') ? c.files : [] }, undefined, { 'Cache-Control': 'no-store' });
    }
    if ((mm = /^\/api\/akademie\/file\/([\w.-]+\.xlsx)$/.exec(p)) && m === 'GET') {
      if (!u || !access(u).has('tables')) return send(res, 403, { error: 'Soubor je dostupný jen pro členky s přístupem k tabulkám.' });
      const f = path.join(FILES_DIR, path.basename(mm[1]));
      if (!fs.existsSync(f)) return send(res, 404, { error: 'Soubor nenalezen.' });
      return send(res, 200, fs.readFileSync(f), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', { 'Content-Disposition': `attachment; filename="${path.basename(f)}"`, 'Cache-Control': 'no-store' });
    }
    if (p === '/api/akademie/lead' && m === 'POST') {
      const b = await readBody(req), l = { id: rid(), created: now(), type: clean(b.type, 20) || 'poptávka', name: clean(b.name, 120), email: clean(b.email, 120), phone: clean(b.phone, 40), topic: clean(b.topic, 120), message: clean(b.message, 2000) };
      if (!l.name || !okEmail(l.email)) return send(res, 400, { error: 'Vyplňte prosím jméno a e-mail.' });
      if (!b.gdpr) return send(res, 400, { error: 'Potvrďte prosím souhlas se zpracováním údajů.' });
      a.leads.push(l); save();
      salonMail(`Akademie: ${l.type} od ${l.name}`, `Jméno: ${l.name}\nE-mail: ${l.email}\nTelefon: ${l.phone}\nTéma: ${l.topic}\n\n${l.message}`).catch(() => {});
      return send(res, 200, { ok: true });
    }

    // ---- administrace ----
    if (p.startsWith('/api/akademie/admin')) {
      if (!u || u.role !== 'admin') return send(res, 403, { error: 'Na tuto akci nemáte oprávnění.' });
      if (p === '/api/akademie/admin' && m === 'GET') {
        const weak = verifyPw('admin', u);
        return send(res, 200, { weak, pay: onlinePay(), users: a.users.map((x) => ({ ...pub(x), login: x.login, created: x.created, lastLogin: x.lastLogin || '' })),
          orders: a.orders.slice(-500).reverse().map((o) => ({ ...o, ip: undefined, ua: undefined, who: (a.users.find((x) => x.id === o.uid) || {}).email || '' })), leads: a.leads.slice(-300).reverse(), products: LABEL }, undefined, { 'Cache-Control': 'no-store' });
      }
      const b = m === 'POST' ? await readBody(req) : {};
      const x = b.user && a.users.find((y) => y.id === b.user);
      if (p === '/api/akademie/admin/access' && m === 'POST') {
        if (!x || x.role === 'admin' || !LABEL[b.key]) return send(res, 400, { error: 'Neplatný požadavek.' });
        if (b.key === 'member') { if (x.memberUntil && new Date(x.memberUntil) > new Date()) x.memberUntil = now(); else grant(x, 'member', 31); }
        else x.access = x.access.includes(b.key) ? x.access.filter((k) => k !== b.key) : [...x.access, b.key];
        save(); return send(res, 200, { ok: true });
      }
      if (p === '/api/akademie/admin/delete' && m === 'POST') {
        if (!x || x.role === 'admin') return send(res, 400, { error: 'Tento účet nelze smazat.' });
        a.users = a.users.filter((y) => y !== x); for (const [k, s] of Object.entries(a.sessions)) if (s.uid === x.id) delete a.sessions[k];
        save(); return send(res, 200, { ok: true });
      }
      if (p === '/api/akademie/admin/test-mail' && m === 'POST') {
        const to = String(b.email || '').trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return send(res, 400, { error: 'Zadejte platný e-mail.' });
        const items = ['meta', 'call-bump', 'steal-bump'].map((k) => ({ key: k, name: CATALOG[k].name, price: CATALOG[k].price }));
        const fake = { id: 'test' + rid(), created: now(), items, total: items.reduce((s2, i) => s2 + i.price, 0) };
        try { const ok = await accessMail({ name: 'Testovací zákaznice', email: to }, fake, { to, subjectPrefix: '[TEST] ' }); return ok ? send(res, 200, { ok: true }) : send(res, 500, { error: 'E-mail se nepodařilo odeslat. Zkontrolujte nastavení Mailgunu v Renderu.' }); }
        catch (e) { return send(res, 500, { error: 'E-mail se nepodařilo odeslat: ' + e.message }); }
      }
      if (p === '/api/akademie/admin/paid' && m === 'POST') {
        const o = a.orders.find((y) => y.id === b.order); if (!o) return send(res, 404, { error: 'Objednávka nenalezena.' });
        orderPaid(o, 'ručně (' + (u.name || 'admin') + ')'); return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'Nenalezeno.' });
    }
    return send(res, 404, { error: 'Nenalezeno.' });
  }

  // ---------- stránky ----------
  let PAGE = null;
  const page = () => (process.env.NODE_ENV === 'production' && PAGE) || (PAGE = fs.readFileSync(path.join(DIR, 'page.html'), 'utf8'));
  const SLUGS = ['ukradnete-reklamy', 'plny-diar', 'ai-asistentka', 'objednava-sama', 'vyprodane-vanoce', 'sluzby-na-klic', 'dekujeme'];
  function serve(req, res, p, cfg) {
    const slug = p.replace(/^\//, '');
    if (slug && !SLUGS.includes(slug)) return false;
    const conf = { pixel: process.env.ACADEMY_META_PIXEL || '1862538181596907', gtm: process.env.ACADEMY_GTM || '' };
    const html = page().replace('/*__CFG__*/null', JSON.stringify(conf)).replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${PUB(req)}/${slug}">`)
      .replace('<meta name="robots" content="index,follow">', '<meta name="robots" content="noindex,nofollow">');
    send(res, 200, html, 'text/html; charset=utf-8', { 'Cache-Control': 'no-cache' });
    return true;
  }
  const sitemap = () => ['/', ...SLUGS.filter((s) => s !== 'dekujeme').map((s) => '/' + s)];
  return { api, serve, webhook, sitemap };
};
