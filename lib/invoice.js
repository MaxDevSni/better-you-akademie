// Better You – faktury: výchozí údaje dodavatele, číslování, PDF a export pro účetní.
'use strict';
const fs = require('fs');
const path = require('path');
const { PDF, zip } = require('./pdf');

const ROOT = path.join(__dirname, '..');
const FONTS = { regular: path.join(ROOT, 'assets/fonts/Carlito-Regular.ttf'), bold: path.join(ROOT, 'assets/fonts/Carlito-Bold.ttf') };
let LOGO = null; try { LOGO = fs.readFileSync(path.join(ROOT, 'assets/invoice-logo.jpg')); } catch (e) { /* bez loga */ }

// Údaje z obchodního rejstříku (lze změnit v administraci → Fakturace)
const DEFAULTS = {
  autoSend: true,
  vatPayer: false, vatRate: 21, dic: '',
  name: 'BY studios s.r.o.', street: 'Příčná 1892/4, Nové Město', city: '110 00 Praha 1', ico: '23367024',
  register: 'Zapsaná v obchodním rejstříku vedeném Městským soudem v Praze, oddíl C, vložka 425165.',
  shop: 'Better You, Gočárova třída 312/52, 500 02 Hradec Králové',
  phone: '+420 602 370 528', email: 'info@better-you.cz', web: 'Fully.cz',
  bank: '', note: 'Děkujeme za vaši důvěru.',
  seq: {},
};
const settings = (db) => { db.invoicing = { ...DEFAULTS, ...(db.invoicing || {}) }; db.invoicing.seq = db.invoicing.seq || {}; return db.invoicing; };

const PAY = { online: 'Platební kartou online', karta: 'Platební kartou v salonu', hotove: 'V hotovosti', prevod: 'Bankovním převodem', poukaz: 'Dárkovým poukazem' };

// Číslo faktury Akademie: AK + rok + pořadí (AK20260001). Vlastní řada, nezávislá na faktuře salonu.
const PREFIX = 'AK';
function nextNumber(db, date) {
  const s = settings(db), y = String(date || new Date().toISOString()).slice(0, 4), p = PREFIX + y;
  const used = new Set(db.invoices.filter((x) => String(x.number).startsWith(p)).map((x) => Number(String(x.number).slice(p.length))));
  let n = Math.max(Number(s.seq[p]) || 0, ...used, 0) + 1;
  while (used.has(n)) n++;
  s.seq[p] = n;
  return p + String(n).padStart(4, '0');
}

const kc = (v) => { const n = Math.round(Number(v) * 100) / 100; const [a, b] = n.toFixed(2).split('.'); return a.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + b + ' Kč'; };
const czDate = (d) => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${Number(dd)}. ${Number(m)}. ${y}`; };

function totals(inv) {
  const total = Math.round(inv.items.reduce((s, i) => s + i.qty * i.price, 0) * 100) / 100;
  if (!inv.supplier.vatPayer) return { total };
  const r = Number(inv.supplier.vatRate) || 21, base = Math.round((total / (1 + r / 100)) * 100) / 100;
  return { total, base, vat: Math.round((total - base) * 100) / 100, rate: r };
}

function pdf(inv) {
  const d = new PDF(FONTS), S = inv.supplier, M = 46, R = d.W - M;
  const teal = '#2a837e', ink = '#1f1c19', muted = '#7a6f63', line = '#e6dccd', cream = '#f7f2ea', gold = '#8e6f3e';
  const t = totals(inv), storno = inv.status === 'stornováno';
  // Hlavička
  if (LOGO) d.image(LOGO, M, 40, 38, 38);
  d.text('Better', M + 48, 66, { size: 20, font: 'bold', color: ink });
  d.text('You', M + 48 + d.width('Better ', 20, 'bold'), 66, { size: 20, font: 'bold', color: teal });
  d.text(S.vatPayer ? 'FAKTURA – DAŇOVÝ DOKLAD' : 'FAKTURA', R, 56, { size: 17, font: 'bold', align: 'right', color: ink });
  d.text(`č. ${inv.number}`, R, 74, { size: 12, align: 'right', color: muted });
  d.line(M, 96, R, 96, { color: line, lw: 1 });
  // Dodavatel a odběratel
  const col2 = M + (R - M) / 2 + 10;
  d.text('DODAVATEL', M, 120, { size: 8, font: 'bold', color: gold });
  let y = 138;
  for (const [s, f] of [[S.name, 'bold'], [S.street], [S.city], [`IČO: ${S.ico}${S.vatPayer && S.dic ? `   DIČ: ${S.dic}` : ''}`], [S.vatPayer ? 'Plátce DPH' : 'Není plátcem DPH']]) { if (!s) continue; d.text(s, M, y, { size: f ? 11.5 : 10, font: f || 'regular', color: ink }); y += f ? 16 : 14; }
  if (S.shop) { y += 4; d.text('Provozovna: ' + S.shop, M, y, { size: 8.5, color: muted }); y += 12; }
  if (S.register) y += 11.5 * d.wrap(S.register, M, y, (R - M) / 2 - 20, { size: 8, color: muted, lh: 11.5 });
  d.text('ODBĚRATEL', col2, 120, { size: 8, font: 'bold', color: gold });
  let y2 = 138; const C = inv.customer || {};
  for (const [s, f] of [[C.name || 'Zákazník', 'bold'], [C.street], [C.city], [C.ico ? `IČO: ${C.ico}${C.dic ? `   DIČ: ${C.dic}` : ''}` : ''], [C.email], [C.phone]]) { if (!s) continue; d.text(s, col2, y2, { size: f ? 11.5 : 10, font: f || 'regular', color: ink }); y2 += f ? 16 : 14; }
  // Údaje faktury
  y = Math.max(y, y2) + 16;
  d.rect(M, y, R - M, 58, { fill: cream, r: 8 });
  const facts = [['Datum vystavení', czDate(inv.issued)], [S.vatPayer ? 'Datum zdanit. plnění' : 'Datum úhrady', czDate(S.vatPayer ? (inv.duzp || inv.paidAt || inv.issued) : (inv.paidAt || inv.issued))], ['Způsob úhrady', PAY[inv.method] || inv.method || ''], ['Variabilní symbol', inv.number]];
  const cw = (R - M) / 4;
  facts.forEach(([k, v], i) => { d.text(k.toUpperCase(), M + 14 + i * cw, y + 22, { size: 7.5, font: 'bold', color: muted }); d.text(v, M + 14 + i * cw, y + 40, { size: 10.5, font: 'bold', color: ink }); });
  y += 84;
  // Položky
  const cQ = R - 190, cP = R - 110;
  d.text('POLOŽKA', M, y, { size: 8, font: 'bold', color: muted });
  d.text('MNOŽSTVÍ', cQ, y, { size: 8, font: 'bold', color: muted, align: 'right' });
  d.text('CENA', cP, y, { size: 8, font: 'bold', color: muted, align: 'right' });
  d.text('CELKEM', R, y, { size: 8, font: 'bold', color: muted, align: 'right' });
  y += 8; d.line(M, y, R, y, { color: line, lw: 1 }); y += 18;
  for (const it of inv.items) {
    const lines = d.wrap(it.name, M, y, cQ - M - 60, { size: 10.5, color: ink, lh: 14 });
    if (it.sub) d.text(it.sub, M, y + lines * 14, { size: 8.5, color: muted });
    d.text(`${it.qty} ×`, cQ, y, { size: 10.5, align: 'right', color: ink });
    d.text(kc(it.price), cP, y, { size: 10.5, align: 'right', color: ink });
    d.text(kc(it.qty * it.price), R, y, { size: 10.5, font: 'bold', align: 'right', color: ink });
    const bottom = y + (lines - 1) * 14 + (it.sub ? 13 : 0); d.line(M, bottom + 9, R, bottom + 9, { color: line }); y = bottom + 27;
  }
  // Součty
  y += 10; const bx = R - 230;
  if (t.base !== undefined) {
    d.text(`Základ daně (${t.rate} %)`, bx, y, { size: 10, color: muted }); d.text(kc(t.base), R, y, { size: 10, align: 'right', color: ink }); y += 16;
    d.text(`DPH ${t.rate} %`, bx, y, { size: 10, color: muted }); d.text(kc(t.vat), R, y, { size: 10, align: 'right', color: ink }); y += 18;
  }
  d.rect(bx - 14, y - 4, R - bx + 14, 40, { fill: teal, r: 8 });
  d.text('Celkem', bx, y + 21, { size: 12, font: 'bold', color: '#ffffff' });
  d.text(kc(t.total), R - 12, y + 21, { size: 15, font: 'bold', align: 'right', color: '#ffffff' });
  y += 54;
  if (inv.paid) {
    d.rect(bx - 14, y - 4, R - bx + 14, 26, { fill: '#e9f4f2', r: 6 });
    d.text(`Uhrazeno ${czDate(inv.paidAt)} · neplaťte`, bx, y + 13, { size: 10, font: 'bold', color: teal });
    d.text('K úhradě 0,00 Kč', R - 12, y + 13, { size: 10, align: 'right', color: teal });
    y += 34;
  } else if (S.bank) {
    d.text(`Úhrada na účet ${S.bank}, VS ${String(inv.number).replace(/\D/g, "")}`, R, y + 10, { size: 9.5, align: 'right', color: ink }); y += 24;
  }
  if (storno) { d.rect(M, y + 6, R - M, 28, { stroke: '#b3261e', r: 6, lw: 1.2 }); d.text(`STORNOVÁNO${inv.cancelReason ? ' – ' + inv.cancelReason : ''}`, M + 14, y + 24, { size: 11, font: 'bold', color: '#b3261e' }); y += 40; }
  if (inv.text) { y += 14; y += 13 * d.wrap(inv.text, M, y, R - M, { size: 9.5, color: ink, lh: 13 }); }
  // Patička
  const fy = d.H - 70;
  d.line(M, fy, R, fy, { color: line, lw: 1 });
  if (S.note) d.text(S.note, M, fy + 18, { size: 9.5, color: ink });
  d.text(`${S.phone} · ${S.email} · ${S.web}`, M, fy + 33, { size: 8.5, color: muted });
  d.text(`Faktura ${inv.number} · vystavena elektronicky`, R, fy + 33, { size: 8.5, color: muted, align: 'right' });
  return d.build({ title: `Faktura ${inv.number}`, author: S.name });
}

const fileName = (inv) => `faktura-${inv.number}.pdf`;

function csv(list) {
  const q = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [['Číslo', 'Datum vystavení', 'Datum úhrady', 'Odběratel', 'E-mail', 'IČO odběratele', 'Položky', 'Celkem (Kč)', 'Způsob úhrady', 'Stav', 'Platba (Stripe)']];
  for (const i of list) rows.push([i.number, czDate(i.issued), czDate(i.paidAt), i.customer.name, i.customer.email, i.customer.ico || '', i.items.map((x) => x.name).join(' + '), totals(i).total.toFixed(2).replace('.', ','), PAY[i.method] || i.method, i.status, i.ref || '']);
  return '﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n');
}

module.exports = { DEFAULTS, settings, nextNumber, pdf, csv, zip, totals, fileName, PAY, kc, czDate };
