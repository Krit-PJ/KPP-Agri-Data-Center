/**
 * KPP Agri Data Center — Google Apps Script backend
 *
 * ไฟล์ในโปรเจกต์ (วางทุกไฟล์ใน Apps Script โปรเจกต์เดียวกัน):
 *   Config.gs   ค่าคงที่ + ฟังก์ชันช่วย
 *   Api.gs      doGet / doPost (จุดเข้าเดียวของ Web App)
 *   Data.gs     อ่านข้อมูล, cache, ชีตมุมมองรายพืช
 *   Auth.gs     Super Admin / Admin (รหัสผ่าน salted SHA-256, session ใน CacheService)
 *   Import.gs   ตรวจและนำเข้าข้อมูล (upsert) + สำรอง + ย้อนกลับ
 *   Requests.gs คำขอดาวน์โหลด → อนุมัติ → ส่งลิงก์ทางอีเมล
 *   Counter.gs  ตัวนับผู้เข้าใช้งาน
 *   Links.gs    ลิงก์เชื่อมโยงเว็บไซต์ (Super Admin แก้ไขได้)
 *   Setup.gs    setupSystem() — รันครั้งแรก / หลังอัปเดตโค้ด
 *
 * Script Properties ที่ใช้
 *   SPREADSHEET_ID         (ไม่บังคับ) ค่าเริ่มต้นคือชีต KPP Agri Database
 *   SITE_URL               URL หน้าเว็บบน GitHub Pages (ใช้สร้างลิงก์ดาวน์โหลดในอีเมล)
 *   NOTIFY_EMAIL           อีเมลรับแจ้งเตือนคำขอใหม่ (ไม่ตั้ง = อีเมลเจ้าของสคริปต์)
 *   SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD  ใช้ครั้งแรกเท่านั้น รหัสผ่านถูกลบทันทีหลังเก็บ hash
 */
const APP_VERSION = '2.0.0';
const DEFAULT_SPREADSHEET_ID = '1trKwin7IaNLYQtoxzWZr2wMo2fPGxhynmEzIvLg7DYE';
const DEFAULT_SITE_URL = 'https://krit-pj.github.io/KPP-Agri-Data-Center/';

const DATA_SHEET = 'data';
const DISTRICT_SHEET = 'districts';
const DATA_HEADERS = ['year', 'crop', 'district_code', 'district', 'planted', 'harvested', 'production', 'yield_planted', 'yield_harvested'];
const NUM_COLS = ['planted', 'harvested', 'production', 'yield_planted', 'yield_harvested'];
// ลำดับพืชมาตรฐาน (พืชใหม่ที่ไม่อยู่ในรายการจะต่อท้ายอัตโนมัติ)
const CROP_ORDER = ['ข้าวนาปี', 'ข้าวนาปรัง', 'ข้าวโพด รุ่น1', 'ข้าวโพด รุ่น2', 'มันสำปะหลัง', 'อ้อย', 'ปาล์มน้ำมัน', 'ยางพารา', 'กล้วยไข่'];
const VIEW_PREFIX = 'พืช_';

function prop_(k, d) { return PropertiesService.getScriptProperties().getProperty(k) || d || ''; }
function spreadsheet_() { return SpreadsheetApp.openById(prop_('SPREADSHEET_ID', DEFAULT_SPREADSHEET_ID)); }
function siteUrl_() { const u = prop_('SITE_URL', DEFAULT_SITE_URL); return u.endsWith('/') ? u : u + '/'; }

function sheetByName_(name) {
  const sh = spreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบชีต ' + name + ' กรุณา Run setupSystem()');
  return sh;
}

function ensureSheet_(name, headers) {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    return sh;
  }
  const have = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
  headers.forEach(function (h, i) {
    if (have[i] && have[i] !== h) throw new Error(name + ': คอลัมน์ ' + (i + 1) + ' ต้องเป็น ' + h + ' แต่พบ ' + have[i]);
    if (!have[i]) sh.getRange(1, i + 1).setValue(h);
  });
  return sh;
}

function dataRows_(sh) {
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
}

function cleanText_(v, max) {
  return String(v === null || v === undefined ? '' : v).replace(/[\u0000-\u001F\u007F<>]/g, '').trim().slice(0, max || 500);
}
function text_(v) { return cleanText_(v, 500); }

/** "1,234.5" / " 12 " / "-" / "" → number (ค่าว่างและขีด = 0) */
function num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const s = String(v === null || v === undefined ? '' : v).replace(/[,\s]/g, '').replace(/^[-–—]$/, '');
  if (!s) return 0;
  const n = Number(s);
  return isFinite(n) ? n : NaN;
}
function round2_(n) { return Math.round(n * 100) / 100; }

function toDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function dateTime_(v) {
  const d = toDate_(v);
  return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss') : text_(v);
}
function today_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

function normalizePhone_(v) {
  const digits = String(v === null || v === undefined ? '' : v).replace(/\D/g, '');
  return /^\d{9}$/.test(digits) ? '0' + digits : digits;
}

function sha256Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function newToken_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function publicError_(err) {
  const msg = String(err && err.message || err || 'เกิดข้อผิดพลาด');
  if (msg === 'ADMIN_SESSION_EXPIRED') return 'ADMIN_SESSION_EXPIRED';
  return cleanText_(msg, 300) || 'เกิดข้อผิดพลาด';
}

/** CacheService เก็บได้ 100KB ต่อ key จึงแบ่งเป็นชิ้น */
function cachePutBig_(key, str, seconds) {
  const cache = CacheService.getScriptCache();
  const size = 90000, parts = {};
  const n = Math.ceil(str.length / size);
  for (let i = 0; i < n; i++) parts[key + ':' + i] = str.slice(i * size, (i + 1) * size);
  parts[key + ':n'] = String(n);
  try { cache.putAll(parts, seconds); } catch (e) { /* cache เต็ม ไม่เป็นไร */ }
}
function cacheGetBig_(key) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(key + ':n') || 0);
  if (!n) return null;
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(key + ':' + i);
  const got = cache.getAll(keys);
  let s = '';
  for (let i = 0; i < n; i++) { if (got[keys[i]] === undefined || got[keys[i]] === null) return null; s += got[keys[i]]; }
  return s;
}
function cacheRemoveBig_(key) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(key + ':n') || 0);
  const keys = [key + ':n'];
  for (let i = 0; i < n; i++) keys.push(key + ':' + i);
  cache.removeAll(keys);
}
