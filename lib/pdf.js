// Better You – malý generátor PDF bez závislostí.
// Vkládá písmo TrueType (jen použité znaky), takže čeština vypadá správně v každém prohlížeči PDF.
'use strict';
const fs = require('fs');
const zlib = require('zlib');

// ---------- TrueType ----------
const FONT_CACHE = new Map();
function loadFont(file) {
  if (FONT_CACHE.has(file)) return FONT_CACHE.get(file);
  const b = fs.readFileSync(file);
  const n = b.readUInt16BE(4), tables = {};
  for (let i = 0; i < n; i++) { const o = 12 + i * 16; tables[b.toString('latin1', o, o + 4)] = { off: b.readUInt32BE(o + 8), len: b.readUInt32BE(o + 12) }; }
  const T = (t) => tables[t].off;
  const upm = b.readUInt16BE(T('head') + 18);
  const bbox = [0, 1, 2, 3].map((i) => b.readInt16BE(T('head') + 36 + i * 2));
  const locFmt = b.readInt16BE(T('head') + 50);
  const ascent = b.readInt16BE(T('hhea') + 4), descent = b.readInt16BE(T('hhea') + 6), numH = b.readUInt16BE(T('hhea') + 34);
  const numGlyphs = b.readUInt16BE(T('maxp') + 4);
  let capHeight = ascent;
  if (tables['OS/2'] && b.readUInt16BE(T('OS/2')) >= 2) capHeight = b.readInt16BE(T('OS/2') + 88);
  const adv = (g) => b.readUInt16BE(T('hmtx') + 4 * Math.min(g, numH - 1));
  const loca = (g) => (locFmt ? b.readUInt32BE(T('loca') + g * 4) : b.readUInt16BE(T('loca') + g * 2) * 2);
  // cmap: Windows Unicode (formát 12 nebo 4)
  const cm = T('cmap'), cn = b.readUInt16BE(cm + 2); let sub4 = 0, sub12 = 0;
  for (let i = 0; i < cn; i++) {
    const pid = b.readUInt16BE(cm + 4 + i * 8), eid = b.readUInt16BE(cm + 6 + i * 8), off = cm + b.readUInt32BE(cm + 8 + i * 8), fmt = b.readUInt16BE(off);
    if (pid === 3 && eid === 10 && fmt === 12) sub12 = off;
    if ((pid === 3 && eid === 1 || pid === 0) && fmt === 4 && !sub4) sub4 = off;
  }
  const gcache = new Map();
  function gid(cp) {
    if (gcache.has(cp)) return gcache.get(cp);
    let g = 0;
    if (sub12) {
      const ng = b.readUInt32BE(sub12 + 12);
      for (let i = 0; i < ng; i++) { const o = sub12 + 16 + i * 12, s = b.readUInt32BE(o), e = b.readUInt32BE(o + 4); if (cp >= s && cp <= e) { g = b.readUInt32BE(o + 8) + cp - s; break; } }
    } else if (sub4 && cp < 0x10000) {
      const seg = b.readUInt16BE(sub4 + 6) / 2, ends = sub4 + 14, starts = ends + seg * 2 + 2, deltas = starts + seg * 2, ranges = deltas + seg * 2;
      for (let i = 0; i < seg; i++) {
        if (b.readUInt16BE(ends + i * 2) < cp) continue;
        const s = b.readUInt16BE(starts + i * 2); if (s > cp) break;
        const d = b.readInt16BE(deltas + i * 2), ro = b.readUInt16BE(ranges + i * 2);
        if (!ro) g = (cp + d) & 0xffff; else { const p = ranges + i * 2 + ro + (cp - s) * 2; const v = b.readUInt16BE(p); g = v ? (v + d) & 0xffff : 0; }
        break;
      }
    }
    gcache.set(cp, g); return g;
  }
  const f = { file, b, tables, upm, bbox, ascent, descent, capHeight, numGlyphs, adv, loca, gid, locFmt };
  FONT_CACHE.set(file, f); return f;
}
// Podmnožina: glyfy, které nepoužijeme, mají nulovou délku (čísla glyfů zůstanou stejná)
function subsetFont(f, used) {
  const b = f.b, glyf = f.tables.glyf.off, keep = new Set([0, ...used]);
  const stack = [...keep];
  while (stack.length) {
    const g = stack.pop(), s = f.loca(g), e = f.loca(g + 1); if (e <= s) continue;
    const o = glyf + s; if (b.readInt16BE(o) >= 0) continue;
    let p = o + 10, flags;
    do {
      flags = b.readUInt16BE(p); const c = b.readUInt16BE(p + 2); p += 4;
      if (!keep.has(c)) { keep.add(c); stack.push(c); }
      p += flags & 1 ? 4 : 2; if (flags & 8) p += 2; else if (flags & 0x40) p += 4; else if (flags & 0x80) p += 8;
    } while (flags & 0x20);
  }
  const parts = [], loca = Buffer.alloc((f.numGlyphs + 1) * 4); let pos = 0;
  for (let g = 0; g < f.numGlyphs; g++) {
    loca.writeUInt32BE(pos, g * 4);
    if (keep.has(g)) { const s = f.loca(g), e = f.loca(g + 1); if (e > s) { let d = b.subarray(glyf + s, glyf + e); if (d.length % 4) d = Buffer.concat([d, Buffer.alloc(4 - (d.length % 4))]); parts.push(d); pos += d.length; } }
  }
  loca.writeUInt32BE(pos, f.numGlyphs * 4);
  const tbl = (t) => b.subarray(f.tables[t].off, f.tables[t].off + f.tables[t].len);
  const head = Buffer.from(tbl('head')); head.writeInt16BE(1, 50); head.writeUInt32BE(0, 8);
  const out = { head, hhea: tbl('hhea'), maxp: tbl('maxp'), hmtx: tbl('hmtx'), loca, glyf: Buffer.concat(parts) };
  for (const t of ['cvt ', 'fpgm', 'prep', 'OS/2', 'post']) if (f.tables[t]) out[t] = t === 'post' ? Buffer.concat([tbl('post').subarray(0, 32)]) : tbl(t);
  if (out.post) { out.post = Buffer.from(out.post); out.post.writeUInt32BE(0x00030000, 0); }
  const names = Object.keys(out).sort(), nt = names.length;
  let es = 0; while ((1 << (es + 1)) <= nt) es++;
  const dir = Buffer.alloc(12 + nt * 16); dir.writeUInt32BE(0x00010000, 0); dir.writeUInt16BE(nt, 4); dir.writeUInt16BE((1 << es) * 16, 6); dir.writeUInt16BE(es, 8); dir.writeUInt16BE(nt * 16 - (1 << es) * 16, 10);
  const sum = (buf) => { let s = 0; const p = Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4)]); for (let i = 0; i < p.length; i += 4) s = (s + p.readUInt32BE(i)) >>> 0; return s; };
  let off = dir.length; const bodies = [];
  names.forEach((t, i) => {
    const d = out[t], o = 12 + i * 16; dir.write(t, o, 'latin1'); dir.writeUInt32BE(sum(d), o + 4); dir.writeUInt32BE(off, o + 8); dir.writeUInt32BE(d.length, o + 12);
    const pad = Buffer.concat([d, Buffer.alloc((4 - (d.length % 4)) % 4)]); bodies.push(pad); off += pad.length;
  });
  const font = Buffer.concat([dir, ...bodies]);
  const hi = 12 + names.indexOf('head') * 16, ho = dir.readUInt32BE(hi + 8);
  font.writeUInt32BE((0xB1B0AFBA - sum(font)) >>> 0, ho + 8);
  return font;
}

// ---------- Dokument ----------
const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(c || '#000000'); const n = parseInt(m ? m[1] : '000000', 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => (x / 255).toFixed(3)).join(' '); };
const num = (x) => (Math.round(x * 100) / 100).toString();

class PDF {
  constructor(fonts) {
    this.W = 595.28; this.H = 841.89; this.pages = []; this.fonts = {};
    for (const [k, file] of Object.entries(fonts)) this.fonts[k] = { f: loadFont(file), used: new Map(), name: 'F' + (Object.keys(this.fonts).length + 1) };
    this.addPage();
  }
  addPage() { this.cur = []; this.pages.push(this.cur); return this; }
  width(str, size, font = 'regular') {
    const F = this.fonts[font].f; let w = 0;
    for (const ch of String(str)) w += F.adv(F.gid(ch.codePointAt(0)));
    return (w / F.upm) * size;
  }
  // y = vzdálenost od horního okraje (jednodušší sazba)
  text(str, x, y, o = {}) {
    const font = o.font || 'regular', size = o.size || 10, F = this.fonts[font];
    str = String(str ?? '');
    let tx = x; const w = this.width(str, size, font);
    if (o.align === 'right') tx = x - w; else if (o.align === 'center') tx = x - w / 2;
    let h = '';
    for (const ch of str) { const cp = ch.codePointAt(0), g = F.f.gid(cp); F.used.set(g, cp); h += g.toString(16).padStart(4, '0'); }
    this.cur.push(`BT ${hex(o.color)} rg /${F.name} ${num(size)} Tf ${num(tx)} ${num(this.H - y)} Td <${h}> Tj ET`);
    return w;
  }
  // zalomení textu do šířky, vrací počet řádků
  wrap(str, x, y, maxW, o = {}) {
    const size = o.size || 10, lh = o.lh || size * 1.35, words = String(str || '').split(/\s+/); let line = '', n = 0;
    const flush = () => { if (line) { this.text(line, x, y + n * lh, o); n++; line = ''; } };
    for (const w of words) { const t = line ? line + ' ' + w : w; if (this.width(t, size, o.font) > maxW && line) { flush(); line = w; } else line = t; }
    flush(); return n;
  }
  rect(x, y, w, h, o = {}) {
    const r = o.r || 0, Y = this.H - y - h;
    let path;
    if (r) { const k = 0.5523 * r; path = `${num(x + r)} ${num(Y)} m ${num(x + w - r)} ${num(Y)} l ${num(x + w - r + k)} ${num(Y)} ${num(x + w)} ${num(Y + r - k)} ${num(x + w)} ${num(Y + r)} c ${num(x + w)} ${num(Y + h - r)} l ${num(x + w)} ${num(Y + h - r + k)} ${num(x + w - r + k)} ${num(Y + h)} ${num(x + w - r)} ${num(Y + h)} c ${num(x + r)} ${num(Y + h)} l ${num(x + r - k)} ${num(Y + h)} ${num(x)} ${num(Y + h - r + k)} ${num(x)} ${num(Y + h - r)} c ${num(x)} ${num(Y + r)} l ${num(x)} ${num(Y + r - k)} ${num(x + r - k)} ${num(Y)} ${num(x + r)} ${num(Y)} c h`; }
    else path = `${num(x)} ${num(Y)} ${num(w)} ${num(h)} re`;
    const ops = [];
    if (o.fill) ops.push(`${hex(o.fill)} rg`);
    if (o.stroke) ops.push(`${hex(o.stroke)} RG ${num(o.lw || 0.6)} w`);
    this.cur.push(`q ${ops.join(' ')} ${path} ${o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S'} Q`);
  }
  // JPEG obrázek (logo); y = horní okraj
  image(buf, x, y, w, h) {
    if (!this.images) this.images = [];
    let i = this.images.findIndex((m) => m.buf === buf);
    if (i < 0) {
      let p = 2, iw = 0, ih = 0, comp = 3;
      while (p < buf.length) { const mk = buf[p + 1], len = buf.readUInt16BE(p + 2); if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) { ih = buf.readUInt16BE(p + 5); iw = buf.readUInt16BE(p + 7); comp = buf[p + 9]; break; } p += 2 + len; }
      this.images.push({ buf, iw, ih, comp, name: 'Im' + (this.images.length + 1) }); i = this.images.length - 1;
    }
    this.cur.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.H - y - h)} cm /${this.images[i].name} Do Q`);
  }
  line(x1, y1, x2, y2, o = {}) { this.cur.push(`q ${hex(o.color || '#dddddd')} RG ${num(o.lw || 0.6)} w ${num(x1)} ${num(this.H - y1)} m ${num(x2)} ${num(this.H - y2)} l S Q`); }

  build(meta = {}) {
    const objs = []; const add = (s) => { objs.push(s); return objs.length; };
    const catalog = add(null), pagesId = add(null);
    const fontRefs = {};
    for (const F of Object.values(this.fonts)) {
      if (!F.used.size) continue;
      const f = F.f, k = 1000 / f.upm, gids = [...F.used.keys()].sort((a, b) => a - b);
      const raw = subsetFont(f, gids), z = zlib.deflateSync(raw);
      const ff = add({ dict: `/Length1 ${raw.length} /Filter /FlateDecode`, data: z });
      const tag = 'BYAAAA'.slice(0, 2) + F.name.padEnd(4, 'X').toUpperCase().slice(0, 4);
      const base = `${tag}+${(f.file.split('/').pop() || 'Font').replace(/\.ttf$/i, '').replace(/[^A-Za-z0-9-]/g, '')}`;
      const fd = add(`<< /Type /FontDescriptor /FontName /${base} /Flags 32 /FontBBox [${f.bbox.map((v) => Math.round(v * k)).join(' ')}] /ItalicAngle 0 /Ascent ${Math.round(f.ascent * k)} /Descent ${Math.round(f.descent * k)} /CapHeight ${Math.round(f.capHeight * k)} /StemV 80 /FontFile2 ${ff} 0 R >>`);
      const W = gids.map((g) => `${g} [${Math.round(f.adv(g) * k)}]`).join(' ');
      const cid = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${base} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${fd} 0 R /W [${W}] /CIDToGIDMap /Identity >>`);
      const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n`
        + gids.reduce((acc, g, i) => { if (i % 100 === 0) acc.push([]); acc[acc.length - 1].push(g); return acc; }, []).map((ch) => `${ch.length} beginbfchar\n${ch.map((g) => { const cp = F.used.get(g); const u = cp > 0xffff ? Buffer.from(String.fromCodePoint(cp), 'utf16le').swap16().toString('hex') : cp.toString(16).padStart(4, '0'); return `<${g.toString(16).padStart(4, '0')}> <${u}>`; }).join('\n')}\nendbfchar`).join('\n')
        + '\nendcmap CMapName currentdict /CMap defineresource pop end end';
      const tu = add({ dict: '/Filter /FlateDecode', data: zlib.deflateSync(Buffer.from(cmap)) });
      fontRefs[F.name] = add(`<< /Type /Font /Subtype /Type0 /BaseFont /${base} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tu} 0 R >>`);
    }
    const imgRefs = (this.images || []).map((m) => [m.name, add({ dict: `/Type /XObject /Subtype /Image /Width ${m.iw} /Height ${m.ih} /ColorSpace /${m.comp === 1 ? 'DeviceGray' : m.comp === 4 ? 'DeviceCMYK' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode`, data: m.buf })]);
    const res = `<< /Font << ${Object.entries(fontRefs).map(([n, id]) => `/${n} ${id} 0 R`).join(' ')} >>${imgRefs.length ? ` /XObject << ${imgRefs.map(([n, id]) => `/${n} ${id} 0 R`).join(' ')} >>` : ''} >>`;
    const kids = [];
    for (const pg of this.pages) {
      const c = add({ dict: '/Filter /FlateDecode', data: zlib.deflateSync(Buffer.from(pg.join('\n'))) });
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(this.W)} ${num(this.H)}] /Resources ${res} /Contents ${c} 0 R >>`));
    }
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    const pdfStr = (s) => '<FEFF' + Buffer.from(String(s), 'utf16le').swap16().toString('hex') + '>';
    const info = add(`<< /Title ${pdfStr(meta.title || '')} /Author ${pdfStr(meta.author || '')} /Producer (Better You) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z) >>`);
    const chunks = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1')]; const offs = []; let len = chunks[0].length;
    objs.forEach((o, i) => {
      offs.push(len);
      const b = typeof o === 'string' ? Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1')
        : Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< ${o.dict} /Length ${o.data.length} >>\nstream\n`, 'latin1'), o.data, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
      chunks.push(b); len += b.length;
    });
    const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${len}\n%%EOF\n`;
    chunks.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(chunks);
  }
}

// ---------- ZIP (bez komprese, pro hromadné stažení faktur) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const local = [], central = []; let off = 0;
  const d = new Date(), dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff, dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), data = f.data, c = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8); h.writeUInt16LE(dt, 10); h.writeUInt16LE(dd, 12); h.writeUInt32LE(c, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
    local.push(h, name, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10); ch.writeUInt16LE(dt, 12); ch.writeUInt16LE(dd, 14); ch.writeUInt32LE(c, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, name); off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, end]);
}

module.exports = { PDF, zip };
