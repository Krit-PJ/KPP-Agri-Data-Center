// จำลอง Google Apps Script services ที่ backend ใช้ เพื่อรันโค้ด .gs บน Node (ทดสอบ + เซิร์ฟเวอร์ทดสอบในเครื่อง)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function colToIdx(s) { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = this.sh.rows[this.r - 1 + i] || []; const o = []; for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; o.push(v === undefined ? '' : v); } out.push(o); } return out; }
  setValues(v) { if (v.length !== this.nr || v.some((x) => x.length !== this.nc)) throw new Error('setValues size mismatch ' + v.length + 'x' + (v[0] || []).length + ' vs ' + this.nr + 'x' + this.nc); v.forEach((row, i) => row.forEach((x, j) => this.sh.set(this.r + i, this.c + j, x))); return this; }
  getValue() { return this.getValues()[0][0]; }
  getDisplayValue() { const v = this.getValue(); return v instanceof Date ? v.toISOString().slice(0, 10) : String(v); }
  setValue(v) { this.sh.set(this.r, this.c, v); return this; }
  setFormula(f) { this.sh.set(this.r, this.c, f); return this; }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) { const row = this.sh.rows[this.r - 1 + i]; if (row) row[this.c - 1 + j] = ''; } return this; }
  setNumberFormat() { return this; }
}

class Sheet {
  constructor(ss, name) { this.ss = ss; this.name = name; this.rows = []; this.hidden = false; }
  set(r, c, v) { while (this.rows.length < r) this.rows.push([]); const row = this.rows[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getLastRow() { for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i].some((v) => v !== '' && v !== undefined && v !== null)) return i + 1; return 0; }
  getLastColumn() { let m = 0; this.rows.forEach((r) => { for (let j = r.length - 1; j >= 0; j--) if (r[j] !== '' && r[j] !== undefined) { m = Math.max(m, j + 1); break; } }); return m; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') { const m = a.match(/^([A-Z]+)(\d*):?([A-Z]*)(\d*)$/); const c1 = colToIdx(m[1]); return new Range(this, m[2] ? +m[2] : 1, c1, 1, 1); }
    return new Range(this, a, b, c || 1, d || 1);
  }
  appendRow(v) { this.rows.length = this.getLastRow(); this.rows.push(v.slice()); return this; }
  deleteRow(r) { this.rows.splice(r - 1, 1); }
  setFrozenRows() {} setTabColorRGB() {}
  protect() { const p = { setDescription: () => p, setWarningOnly: () => p }; return p; }
  clear() { this.rows = []; return this; }
  hideSheet() { this.hidden = true; return this; }
  copyTo(ss) { const s = ss.insertSheet('Copy of ' + this.name); s.rows = this.rows.map((r) => r.slice()); return s; }
}

class Spreadsheet {
  constructor() { this.sheets = []; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { if (this.getSheetByName(n)) throw new Error('sheet exists ' + n); const s = new Sheet(this, n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets.slice(); }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
}

function fmtDate(d, tz, fmt) {
  const t = new Date(d.getTime() + 7 * 3600000); // Asia/Bangkok
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const map = { yyyy: t.getUTCFullYear(), yy: p(t.getUTCFullYear() % 100), MM: p(t.getUTCMonth() + 1), dd: p(t.getUTCDate()), HH: p(t.getUTCHours()), mm: p(t.getUTCMinutes()), ss: p(t.getUTCSeconds()) };
  return fmt.replace(/yyyy|yy|MM|dd|HH|mm|ss/g, (k) => map[k]);
}

function createGas({ gsDir, seed }) {
  const ss = new Spreadsheet();
  if (seed) seed(ss);
  const cache = new Map(), props = new Map(), outbox = [], logs = [];
  const ctx = {
    console,
    SpreadsheetApp: { openById: () => ss },
    CacheService: { getScriptCache: () => ({
      get: (k) => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, String(v)), remove: (k) => cache.delete(k),
      putAll: (o) => Object.entries(o).forEach(([k, v]) => cache.set(k, String(v))),
      getAll: (ks) => Object.fromEntries(ks.filter((k) => cache.has(k)).map((k) => [k, cache.get(k)])),
      removeAll: (ks) => ks.forEach((k) => cache.delete(k)) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, v), setProperties: (o) => Object.entries(o).forEach(([k, v]) => props.set(k, String(v))), deleteProperty: (k) => props.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(), formatDate: fmtDate },
    Session: { getScriptTimeZone: () => 'Asia/Bangkok', getEffectiveUser: () => ({ getEmail: () => 'noonoy.cmu@gmail.com' }) },
    MailApp: { sendEmail: (m) => outbox.push(m) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ content: s, setMimeType() { return this; }, getContent() { return s; } }) },
    Logger: { log: (s) => logs.push(s) },
  };
  vm.createContext(ctx);
  const files = fs.readdirSync(gsDir).filter((f) => f.endsWith('.gs')).sort();
  // const/function ระดับบนสุดของทุกไฟล์ต้องอยู่ใน scope เดียวกันเหมือน Apps Script
  const src = files.map((f) => fs.readFileSync(path.join(gsDir, f), 'utf8')).join('\n;\n');
  vm.runInContext(src + '\n;this.__api = { doGet, doPost, setupSystem, selfTest };', ctx, { filename: 'apps-script.gs' });
  return { ss, cache, props, outbox, logs, ctx, api: ctx.__api,
    get: (params) => JSON.parse(ctx.__api.doGet({ parameter: params }).getContent()),
    post: (body) => JSON.parse(ctx.__api.doPost({ postData: { contents: JSON.stringify(body) } }).getContent()) };
}

function seedFromCsv(dataCsv, distCsv) {
  return (ss) => {
    const parse = (f) => fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).map((l) => l.split(','));
    const d = ss.insertSheet('data');
    parse(dataCsv).forEach((r, i) => d.appendRow(i ? r.map((v, j) => (j === 0 || j >= 4 ? Number(v) : v)) : r));
    const s = ss.insertSheet('districts');
    parse(distCsv).forEach((r, i) => s.appendRow(i ? r.map((v, j) => (j >= 3 ? Number(v) : v)) : r));
  };
}

module.exports = { createGas, seedFromCsv };
