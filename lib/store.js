// Úložiště dat Akademie.
// Produkce: jeden řádek v tabulce `kv` v Supabase (bezplatná databáze), přes REST API bez dalších balíčků.
//   SUPABASE_URL=https://xxxx.supabase.co  SUPABASE_SERVICE_KEY=<service_role klíč>
//   Tabulku vytvořte jednou v Supabase → SQL Editor:
//     create table if not exists kv (id text primary key, data jsonb not null, updated_at timestamptz default now());
//     alter table kv enable row level security;   -- přístup jen přes service_role klíč ze serveru
// Vývoj / bez Supabase: soubor DATA_DIR/db.json.
'use strict';
const fs = require('fs');
const path = require('path');

const URL_ = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const KEY = String(process.env.SUPABASE_SERVICE_KEY || '').trim();
const ROW = process.env.STORE_ROW || 'akademie';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');
const remote = () => !!(URL_ && KEY);
const H = () => ({ apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' });

const status = { mode: remote() ? 'supabase' : 'soubor', lastSave: '', lastError: '' };

async function load() {
  if (remote()) {
    const r = await fetch(`${URL_}/rest/v1/kv?id=eq.${encodeURIComponent(ROW)}&select=data`, { headers: H() });
    if (!r.ok) throw new Error(`Supabase načtení: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    const rows = await r.json();
    return rows[0] ? rows[0].data : null;
  }
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; }
}

let pending = null, timer = null, writing = Promise.resolve();
async function write(data) {
  const body = JSON.stringify(data);
  if (remote()) {
    const r = await fetch(`${URL_}/rest/v1/kv?on_conflict=id`, { method: 'POST', headers: { ...H(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ id: ROW, data, updated_at: new Date().toISOString() }]) });
    if (!r.ok) throw new Error(`Supabase uložení: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + '.tmp', body); fs.renameSync(FILE + '.tmp', FILE);
  }
}
// Ukládání s krátkým odkladem: víc změn za sebou = jeden zápis
function save(data) {
  pending = data;
  if (timer) return;
  timer = setTimeout(() => { timer = null; flush(); }, 800);
}
function flush() {
  if (!pending) return writing;
  const d = pending; pending = null;
  writing = writing.then(() => write(d)).then(() => { status.lastSave = new Date().toISOString(); status.lastError = ''; })
    .catch((e) => { status.lastError = e.message; console.error('Uložení dat selhalo:', e.message); pending = pending || d; setTimeout(flush, 5000); });
  return writing;
}

module.exports = { load, save, flush, status, remote };
