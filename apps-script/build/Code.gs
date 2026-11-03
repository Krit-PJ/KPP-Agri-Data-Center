/** KPP Agri Data Center — Apps Script (ไฟล์รวม สร้างจาก apps-script/*.gs ด้วย npm run build:gas อย่าแก้ไฟล์นี้โดยตรง) */

// ===================== Config.gs =====================
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

// ===================== Api.gs =====================
/**
 * จุดเข้าของ Web App
 *
 * GET  ?action=bootstrap            ข้อมูลทั้งหมดสำหรับหน้าเว็บ (data, districts, links, crops)
 * GET  ?action=hit&v=0|1            นับการเข้าใช้ 1 ครั้ง (v=1 = ผู้เข้าชมใหม่ของวันนี้) แล้วคืนยอด
 * GET  ?action=visits               ยอดผู้เข้าชม
 * GET  ?action=download&token=...   ดาวน์โหลดข้อมูลตามคำขอที่อนุมัติแล้ว
 * GET  ?action=health
 *
 * POST body (text/plain) = {"method": "...", "args": [...], "token": "..."}
 *   ไม่ต้องล็อกอิน: requestDownload
 *   ต้องล็อกอิน: ดู API_METHODS
 */
const API_METHODS = {
  // public
  requestDownload: { role: null, fn: function (a) { return requestDownload_(a[0]); } },
  // auth
  adminLogin: { role: null, fn: function (a) { return adminLogin_(a[0]); } },
  adminClaim: { role: null, fn: function (a) { return adminClaim_(a[0]); } },
  adminLogout: { role: 'admin', fn: function (a, s, t) { return adminLogout_(t); } },
  adminMe: { role: 'admin', fn: function (a, s) { return { username: s.username, name: s.name, role: s.role, version: APP_VERSION }; } },
  adminChangePassword: { role: 'admin', fn: function (a, s) { return adminChangePassword_(a[0], s); } },
  // import
  importCheck: { role: 'admin', fn: function (a) { return importCheck_(a[0]); } },
  importCommit: { role: 'admin', fn: function (a, s) { return importCommit_(a[0], s); } },
  importList: { role: 'admin', fn: function () { return importList_(); } },
  importRollback: { role: 'admin', fn: function (a, s) { return importRollback_(a[0], s); } },
  rebuildViews: { role: 'admin', fn: function (a, s) { const r = rebuildCropViews_(); audit_(s, 'rebuild_views', r.join(', ')); return { views: r }; } },
  districtsList: { role: 'admin', fn: function () { return readDistricts_(); } },
  // download requests
  requestList: { role: 'admin', fn: function (a) { return requestList_(a[0]); } },
  requestDecide: { role: 'admin', fn: function (a, s) { return requestDecide_(a[0], s); } },
  // links (super)
  linkList: { role: 'super', fn: function () { return linkList_(true); } },
  linkSave: { role: 'super', fn: function (a, s) { return linkSave_(a[0], s); } },
  linkDelete: { role: 'super', fn: function (a, s) { return linkDelete_(a[0], s); } },
  // admins (super)
  adminList: { role: 'super', fn: function () { return adminList_(); } },
  adminSave: { role: 'super', fn: function (a, s) { return adminSave_(a[0], s); } },
  adminResetPassword: { role: 'super', fn: function (a, s) { return adminResetPassword_(a[0], s); } },
  auditList: { role: 'super', fn: function () { return auditList_(); } },
  visitStats: { role: 'admin', fn: function () { return visitStats_(60); } }
};

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    autoSetup_();
    switch (String(p.action || 'bootstrap')) {
      case 'bootstrap': return json_({ ok: true, result: bootstrap_() });
      case 'hit': return json_({ ok: true, result: recordVisit_(p.v === '1') });
      case 'visits': return json_({ ok: true, result: visitCounts_() });
      case 'download': return json_({ ok: true, result: downloadByToken_(p.token) });
      case 'health': return json_({ ok: true, result: { version: APP_VERSION, time: new Date().toISOString() } });
      default: throw new Error('ไม่รู้จัก action');
    }
  } catch (err) {
    return json_({ ok: false, error: publicError_(err) });
  }
}

function doPost(e) {
  let out;
  try {
    autoSetup_();
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const def = API_METHODS[String(body.method || '')];
    if (!def) throw new Error('Method not allowed');
    const args = Array.isArray(body.args) ? body.args : [];
    const session = def.role ? requireAdmin_(body.token, def.role) : null;
    out = { ok: true, result: def.fn(args, session, String(body.token || '')) };
  } catch (err) {
    out = { ok: false, error: publicError_(err) };
  }
  return json_(out);
}

// ===================== Auth.gs =====================
/**
 * Super Admin / Admin — รูปแบบเดียวกับ Green Gain Hub
 *   super : ทุกอย่าง + จัดการผู้ดูแล + จัดการลิงก์ + ดู audit log
 *   admin : นำเข้าข้อมูล, ย้อนกลับการนำเข้า, อนุมัติคำขอดาวน์โหลด
 * ชื่อผู้ใช้ 3–32 ตัว (a–z, 0–9, . _ -) ใช้เบอร์โทรศัพท์เป็นชื่อผู้ใช้ได้ เช่น 0812345678
 * ทุกบัญชีต้องมีรหัสผ่าน (อย่างน้อย 8 ตัว) เก็บแบบ salted + iterated SHA-256
 */
const ADMIN_HEADERS = ['Username', 'Name', 'Role', 'Status', 'Pass_Hash', 'Salt', 'Created_At', 'Created_By', 'Last_Login', 'Updated_At', 'Telephone'];
const AUDIT_HEADERS = ['Time', 'Username', 'Name', 'Role', 'Action', 'Detail'];
const ADMIN_ROLES = ['super', 'admin'];
const ADMIN_SESSION_SECONDS = 7200;
const ADMIN_MAX_FAILS = 5;
const ADMIN_LOCK_SECONDS = 900;
const PASSWORD_ROUNDS = 300;

function normalizeUsername_(v) { return String(v === null || v === undefined ? '' : v).trim().toLowerCase(); }
function validUsername_(u) { return /^[a-z0-9._-]{3,32}$/.test(u); }

function hashPassword_(salt, password) {
  let h = String(salt) + ':' + String(password);
  for (let i = 0; i < PASSWORD_ROUNDS; i++) h = sha256Hex_(h);
  return h;
}

function validatePassword_(pw) {
  pw = String(pw || '');
  if (pw.length < 8 || pw.length > 128) throw new Error('รหัสผ่านต้องยาว 8–128 ตัวอักษร');
  return pw;
}

function adminRecord_(username) {
  const rows = dataRows_(sheetByName_('admins'));
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (normalizeUsername_(r[0]) === username) {
      return { row: i + 2, username: username, name: text_(r[1]), role: text_(r[2]), status: text_(r[3]) || 'active',
        hash: String(r[4] || ''), salt: String(r[5] || ''), phone: normalizePhone_(r[10]) };
    }
  }
  return null;
}

const DEFAULT_SUPER_USERNAME = 'krit';
const CLAIM_HOURS = 48;

/**
 * สร้าง Super Admin คนแรก มี 2 วิธี
 *  ก) ตั้ง Script Properties SUPER_ADMIN_USERNAME + SUPER_ADMIN_PASSWORD แล้วรัน setupSystem() (รหัสผ่านถูกลบหลังเก็บ hash)
 *  ข) ไม่ตั้งรหัสผ่าน → ระบบส่ง "ลิงก์ตั้งรหัสผ่าน" (ใช้ได้ครั้งเดียว 48 ชม.) ไปที่อีเมลเจ้าของสคริปต์
 *     เจ้าของตั้งรหัสผ่านเองที่ admin.html — ไม่มีใครอื่นเห็นรหัสผ่าน
 */
function ensureSuperAdmin_() {
  const props = PropertiesService.getScriptProperties();
  const sh = sheetByName_('admins');
  const hasSuper = dataRows_(sh).some(function (r) { return text_(r[2]) === 'super' && text_(r[3]) !== 'disabled' && r[4]; });
  const username = normalizeUsername_(props.getProperty('SUPER_ADMIN_USERNAME') || DEFAULT_SUPER_USERNAME);
  const password = props.getProperty('SUPER_ADMIN_PASSWORD');
  if (!validUsername_(username)) return 'FAIL: SUPER_ADMIN_USERNAME ต้องยาว 3–32 ตัว (a–z, 0–9, . _ -)';
  if (!password) {
    if (hasSuper) return 'PASS: มี Super Admin แล้ว';
    return sendSuperClaim_(username);
  }
  try { validatePassword_(password); } catch (e) { return 'FAIL: SUPER_ADMIN_PASSWORD — ' + e.message; }
  setSuperPassword_(username, password, 'setupSystem');
  props.deleteProperty('SUPER_ADMIN_PASSWORD');
  return 'PASS: Super Admin "' + username + '" พร้อมใช้งาน (ลบ SUPER_ADMIN_PASSWORD ออกจาก Script Properties แล้ว)';
}

function setSuperPassword_(username, password, by) {
  const sh = sheetByName_('admins');
  const salt = Utilities.getUuid();
  const now = new Date();
  const a = adminRecord_(username);
  if (a) {
    sh.getRange(a.row, 3, 1, 4).setValues([['super', 'active', hashPassword_(salt, password), salt]]);
    sh.getRange(a.row, 10).setValue(now);
  } else {
    sh.appendRow([username, 'Super Admin', 'super', 'active', hashPassword_(salt, password), salt, now, by, '', now, '']);
    sh.getRange(sh.getLastRow(), 1).setNumberFormat('@');
  }
  audit_({ username: username, name: 'Super Admin', role: 'super' }, 'super_bootstrap', 'ตั้งรหัสผ่าน Super Admin (' + by + ')');
}

function sendSuperClaim_(username) {
  const props = PropertiesService.getScriptProperties();
  const exp = Number(props.getProperty('SUPER_CLAIM_EXPIRES') || 0);
  if (props.getProperty('SUPER_CLAIM_HASH') && exp > Date.now()) return 'INFO: ส่งลิงก์ตั้งรหัสผ่าน Super Admin ไปแล้ว (ตรวจอีเมลเจ้าของสคริปต์)';
  const token = newToken_();
  props.setProperties({ SUPER_CLAIM_HASH: sha256Hex_(token), SUPER_CLAIM_USER: username, SUPER_CLAIM_EXPIRES: String(Date.now() + CLAIM_HOURS * 3600000) });
  const to = Session.getEffectiveUser().getEmail();
  const link = siteUrl_() + 'admin.html#claim=' + token;
  try {
    MailApp.sendEmail({ to: to, subject: '[KPP Agri Data Center] ตั้งรหัสผ่าน Super Admin',
      body: 'ตั้งรหัสผ่านสำหรับ Super Admin ชื่อผู้ใช้ "' + username + '" ที่ลิงก์นี้ (ใช้ได้ครั้งเดียว ภายใน ' + CLAIM_HOURS + ' ชั่วโมง)\n' + link +
        '\n\nถ้าคุณไม่ได้ติดตั้งระบบนี้ ไม่ต้องทำอะไร' });
  } catch (e) { Logger.log('ส่งอีเมลไม่สำเร็จ ลิงก์: ' + link); }
  Logger.log('ลิงก์ตั้งรหัสผ่าน Super Admin: ' + link);
  return 'INFO: ส่งลิงก์ตั้งรหัสผ่าน Super Admin "' + username + '" ไปที่ ' + to + ' แล้ว (ดูใน Execution log ได้ด้วย)';
}

/** ใช้ลิงก์ตั้งรหัสผ่าน Super Admin (ครั้งเดียว) */
function adminClaim_(input) {
  input = input || {};
  const props = PropertiesService.getScriptProperties();
  const h = props.getProperty('SUPER_CLAIM_HASH');
  if (!h || sha256Hex_(String(input.token || '')) !== h || Number(props.getProperty('SUPER_CLAIM_EXPIRES') || 0) < Date.now()) {
    throw new Error('ลิงก์ตั้งรหัสผ่านไม่ถูกต้อง หมดอายุ หรือถูกใช้ไปแล้ว');
  }
  const password = validatePassword_(input.password);
  const username = props.getProperty('SUPER_CLAIM_USER') || DEFAULT_SUPER_USERNAME;
  setSuperPassword_(username, password, 'claim link');
  ['SUPER_CLAIM_HASH', 'SUPER_CLAIM_USER', 'SUPER_CLAIM_EXPIRES'].forEach(function (k) { props.deleteProperty(k); });
  return { username: username, message: 'ตั้งรหัสผ่านแล้ว เข้าสู่ระบบด้วยชื่อผู้ใช้ "' + username + '"' };
}

function adminLogin_(input) {
  input = input || {};
  const username = normalizeUsername_(input.username);
  const password = String(input.password || '');
  if (!validUsername_(username) || !password) throw new Error('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
  const cache = CacheService.getScriptCache();
  const failKey = 'afail:' + username;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= ADMIN_MAX_FAILS) throw new Error('ใส่รหัสผ่านผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่');
  const a = adminRecord_(username);
  const ok = a && a.status === 'active' && ADMIN_ROLES.indexOf(a.role) >= 0 && a.hash && hashPassword_(a.salt, password) === a.hash;
  if (!ok) {
    cache.put(failKey, String(fails + 1), ADMIN_LOCK_SECONDS);
    throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  cache.remove(failKey);
  const token = newToken_();
  const session = { username: a.username, role: a.role, name: a.name };
  cache.put('admin:' + token, JSON.stringify(session), ADMIN_SESSION_SECONDS);
  sheetByName_('admins').getRange(a.row, 9).setValue(new Date());
  audit_(session, 'login', 'เข้าสู่ระบบ');
  return { token: token, username: a.username, name: a.name, role: a.role, expiresIn: ADMIN_SESSION_SECONDS };
}

function adminLogout_(token) { CacheService.getScriptCache().remove('admin:' + token); return { done: true }; }

/** ตรวจ token และตรวจสถานะบัญชีซ้ำทุกครั้ง (ระงับบัญชีแล้วมีผลทันที) */
function requireAdmin_(token, minRole) {
  token = String(token || '');
  if (!/^[0-9a-f]{64}$/i.test(token)) throw new Error('ADMIN_SESSION_EXPIRED');
  const cache = CacheService.getScriptCache();
  const raw = cache.get('admin:' + token);
  if (!raw) throw new Error('ADMIN_SESSION_EXPIRED');
  const s = JSON.parse(raw);
  const a = adminRecord_(s.username);
  if (!a || a.status !== 'active' || ADMIN_ROLES.indexOf(a.role) < 0) {
    cache.remove('admin:' + token);
    throw new Error('บัญชีผู้ดูแลถูกระงับหรือถูกลบ');
  }
  if (minRole === 'super' && a.role !== 'super') throw new Error('เฉพาะ Super Admin เท่านั้น');
  const session = { username: a.username, role: a.role, name: a.name };
  cache.put('admin:' + token, JSON.stringify(session), ADMIN_SESSION_SECONDS);
  return session;
}

function adminChangePassword_(input, s) {
  input = input || {};
  const a = adminRecord_(s.username);
  if (!a || hashPassword_(a.salt, String(input.current || '')) !== a.hash) throw new Error('รหัสผ่านปัจจุบันไม่ถูกต้อง');
  const next = validatePassword_(input.next);
  const salt = Utilities.getUuid();
  const sh = sheetByName_('admins');
  sh.getRange(a.row, 5, 1, 2).setValues([[hashPassword_(salt, next), salt]]);
  sh.getRange(a.row, 10).setValue(new Date());
  audit_(s, 'password_change', 'เปลี่ยนรหัสผ่านของตนเอง');
  return { message: 'เปลี่ยนรหัสผ่านแล้ว' };
}

function adminList_() {
  return dataRows_(sheetByName_('admins')).map(function (r) {
    return { username: normalizeUsername_(r[0]), name: text_(r[1]), role: text_(r[2]), status: text_(r[3]) || 'active',
      phone: normalizePhone_(r[10]), createdAt: dateTime_(r[6]), createdBy: text_(r[7]), lastLogin: dateTime_(r[8]) };
  });
}

function activeSuperCount_() {
  return dataRows_(sheetByName_('admins')).filter(function (r) { return text_(r[2]) === 'super' && (text_(r[3]) || 'active') === 'active'; }).length;
}

function adminSave_(input, s) {
  input = input || {};
  const username = normalizeUsername_(input.username);
  if (!validUsername_(username)) throw new Error('ชื่อผู้ใช้ต้องยาว 3–32 ตัว ใช้ a–z, 0–9, จุด, ขีดล่าง หรือขีดกลาง (ใช้เบอร์โทรได้)');
  const phone = input.phone ? normalizePhone_(input.phone) : (/^0\d{9}$/.test(username) ? username : '');
  if (phone && !/^0\d{9}$/.test(phone)) throw new Error('เบอร์โทรศัพท์ต้องมี 10 หลัก');
  const name = cleanText_(input.name, 120);
  const role = String(input.role || 'admin');
  const status = String(input.status || 'active');
  if (!name) throw new Error('กรุณากรอกชื่อ');
  if (ADMIN_ROLES.indexOf(role) < 0) throw new Error('บทบาทไม่ถูกต้อง');
  if (['active', 'disabled'].indexOf(status) < 0) throw new Error('สถานะไม่ถูกต้อง');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheetByName_('admins');
    const existing = adminRecord_(username);
    const now = new Date();
    if (existing) {
      if (username === s.username && (role !== 'super' || status !== 'active')) throw new Error('ไม่สามารถลดสิทธิ์หรือระงับบัญชีของตนเองได้');
      if (existing.role === 'super' && (role !== 'super' || status !== 'active') && activeSuperCount_() <= 1) throw new Error('ต้องมี Super Admin ที่ใช้งานได้อย่างน้อย 1 คน');
      sh.getRange(existing.row, 2, 1, 3).setValues([[name, role, status]]);
      sh.getRange(existing.row, 10, 1, 2).setValues([[now, phone]]);
      audit_(s, 'admin_update', username + ' → ' + role + '/' + status);
      return { message: 'บันทึกผู้ดูแลแล้ว' };
    }
    const password = validatePassword_(input.password);
    const salt = Utilities.getUuid();
    sh.appendRow([username, name, role, status, hashPassword_(salt, password), salt, now, s.name + ' (' + s.username + ')', '', now, phone]);
    sh.getRange(sh.getLastRow(), 1).setNumberFormat('@');
    sh.getRange(sh.getLastRow(), 11).setNumberFormat('@');
    audit_(s, 'admin_create', username + ' (' + role + ')');
    return { message: 'เพิ่มผู้ดูแลแล้ว แจ้งรหัสผ่านเริ่มต้นให้ผู้ใช้ทางช่องทางที่ปลอดภัย' };
  } finally {
    lock.releaseLock();
  }
}

function adminResetPassword_(input, s) {
  input = input || {};
  const a = adminRecord_(normalizeUsername_(input.username));
  if (!a) throw new Error('ไม่พบผู้ดูแล');
  const pw = validatePassword_(input.password);
  const salt = Utilities.getUuid();
  const sh = sheetByName_('admins');
  sh.getRange(a.row, 5, 1, 2).setValues([[hashPassword_(salt, pw), salt]]);
  sh.getRange(a.row, 10).setValue(new Date());
  CacheService.getScriptCache().remove('afail:' + a.username);
  audit_(s, 'password_reset', a.username);
  return { message: 'ตั้งรหัสผ่านใหม่แล้ว' };
}

function audit_(s, action, detail) {
  try {
    sheetByName_('admin_log').appendRow([new Date(), s && s.username || '', s && s.name || '', s && s.role || '', action, cleanText_(detail, 400)]);
  } catch (e) { /* ไม่ให้การบันทึก log ทำให้งานหลักล้ม */ }
}

function auditList_() {
  return dataRows_(sheetByName_('admin_log')).slice(-300).reverse().map(function (r) {
    return { time: dateTime_(r[0]), username: text_(r[1]), name: text_(r[2]), role: text_(r[3]), action: text_(r[4]), detail: text_(r[5]) };
  });
}

// ===================== Counter.gs =====================
/**
 * ตัวนับการเข้าใช้งาน (บันทึกจริงในชีต visit_stats)
 * หน้าเว็บเรียก ?action=hit ครั้งเดียวต่อการเปิดใช้งาน (sessionStorage)
 * และส่ง v=1 ถ้าเป็นการเข้าครั้งแรกของวันจากเบราว์เซอร์นั้น (localStorage) → นับเป็นผู้เข้าชม
 * ไม่เก็บ IP หรือข้อมูลระบุตัวตนใด ๆ
 *   visit_stats: Date | Visits (ครั้ง) | Visitors (คน/วัน) | Updated_At
 */
const VISIT_HEADERS = ['Date', 'Visits', 'Visitors', 'Updated_At'];
const VISIT_CACHE_KEY = 'visits:v2';

function recordVisit_(isNewVisitor) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return visitCounts_();
  try {
    const sh = ensureSheet_('visit_stats', VISIT_HEADERS);
    const today = today_();
    const last = sh.getLastRow();
    let row = 0;
    for (let r = last; r >= Math.max(2, last - 3); r--) {
      if (String(sh.getRange(r, 1).getDisplayValue ? sh.getRange(r, 1).getDisplayValue() : sh.getRange(r, 1).getValue()).trim() === today) { row = r; break; }
    }
    if (row) {
      const v = sh.getRange(row, 2, 1, 2).getValues()[0];
      sh.getRange(row, 2, 1, 3).setValues([[(Number(v[0]) || 0) + 1, (Number(v[1]) || 0) + (isNewVisitor ? 1 : 0), new Date()]]);
    } else {
      sh.appendRow([today, 1, isNewVisitor ? 1 : 0, new Date()]);
      sh.getRange(sh.getLastRow(), 1).setNumberFormat('@').setValue(today);
    }
    CacheService.getScriptCache().remove(VISIT_CACHE_KEY);
  } finally {
    lock.releaseLock();
  }
  return visitCounts_();
}

function visitCounts_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(VISIT_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  const rows = dataRows_(ensureSheet_('visit_stats', VISIT_HEADERS));
  const today = today_(), month = today.slice(0, 7);
  const out = { today: 0, todayVisitors: 0, month: 0, total: 0, totalVisitors: 0, since: rows.length ? String(rows[0][0]) : today };
  rows.forEach(function (r) {
    const d = String(r[0]).slice(0, 10), v = Number(r[1]) || 0, u = Number(r[2]) || 0;
    out.total += v; out.totalVisitors += u;
    if (d === today) { out.today += v; out.todayVisitors += u; }
    if (d.slice(0, 7) === month) out.month += v;
  });
  cache.put(VISIT_CACHE_KEY, JSON.stringify(out), 60);
  return out;
}

function visitStats_(days) {
  const rows = dataRows_(ensureSheet_('visit_stats', VISIT_HEADERS));
  return { counts: visitCounts_(), daily: rows.slice(-(days || 60)).map(function (r) { return { date: String(r[0]).slice(0, 10), visits: Number(r[1]) || 0, visitors: Number(r[2]) || 0 }; }) };
}

// ===================== Data.gs =====================
/** อ่านข้อมูลจากชีต data / districts, cache, และชีตมุมมองรายพืช */
const BOOT_CACHE_KEY = 'boot:v2';
const BOOT_CACHE_SECONDS = 600;

/** คืนแถว data เป็น array ตามลำดับ DATA_HEADERS (ตัวเลขแปลงแล้ว) */
function readDataRows_() {
  const sh = sheetByName_(DATA_SHEET);
  const rows = dataRows_(sh);
  return rows.filter(function (r) { return r[0] !== '' && r[1] !== ''; }).map(function (r) {
    return [Number(r[0]), text_(r[1]), String(r[2]).replace(/\.0$/, ''), text_(r[3]),
      num_(r[4]) || 0, num_(r[5]) || 0, num_(r[6]) || 0, num_(r[7]) || 0, num_(r[8]) || 0];
  });
}

function readDistricts_() {
  return dataRows_(sheetByName_(DISTRICT_SHEET)).map(function (r) {
    return { district_code: String(r[0]).replace(/\.0$/, ''), district: text_(r[1]), district_en: text_(r[2]),
      lat: Number(r[3]), lng: Number(r[4]), area_sqkm: Number(r[5]) };
  });
}

function cropList_(rows) {
  const seen = {};
  rows.forEach(function (r) { seen[r[1]] = true; });
  const known = CROP_ORDER.filter(function (c) { return seen[c]; });
  const extra = Object.keys(seen).filter(function (c) { return CROP_ORDER.indexOf(c) < 0; }).sort();
  return known.concat(extra);
}

function bootstrap_() {
  const hit = cacheGetBig_(BOOT_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  const rows = readDataRows_();
  const out = {
    version: APP_VERSION,
    updated: new Date().toISOString(),
    cols: DATA_HEADERS,
    rows: rows,
    districts: readDistricts_(),
    crops: cropList_(rows),
    links: linkList_(false)
  };
  cachePutBig_(BOOT_CACHE_KEY, JSON.stringify(out), BOOT_CACHE_SECONDS);
  return out;
}

function invalidateData_() { cacheRemoveBig_(BOOT_CACHE_KEY); }

/**
 * ชีตมุมมองรายพืช = QUERY จากชีต data (อ่านอย่างเดียว อัปเดตเองเมื่อ data เปลี่ยน)
 * ชีต data ยังเป็นแหล่งข้อมูลหลักแหล่งเดียว
 */
function rebuildCropViews_() {
  const ss = spreadsheet_();
  const crops = cropList_(readDataRows_());
  const made = [];
  crops.forEach(function (crop, i) {
    const name = VIEW_PREFIX + crop;
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    sh.clear();
    const q = "select A,B,C,D,E,F,G,H,I where B = '" + crop.replace(/'/g, "''") + "' order by A, C label " +
      "A 'ปี พ.ศ.', B 'พืช', C 'รหัสอำเภอ', D 'อำเภอ', E 'เนื้อที่เพาะปลูก (ไร่)', F 'เนื้อที่เก็บเกี่ยว (ไร่)', " +
      "G 'ผลผลิต (ตัน)', H 'ผลผลิตต่อไร่ ปลูก (กก.)', I 'ผลผลิตต่อไร่ เก็บเกี่ยว (กก.)'";
    sh.getRange(1, 1).setFormula('=QUERY(' + DATA_SHEET + '!A:I,"' + q.replace(/"/g, '""') + '",1)');
    sh.setFrozenRows(1);
    if (sh.setTabColorRGB) sh.setTabColorRGB('#1a7f37');
    if (sh.protect) {
      const p = sh.protect().setDescription('มุมมองอัตโนมัติจากชีต data — แก้ไขที่ชีต data หรือผ่านระบบ Import');
      p.setWarningOnly(true);
    }
    made.push(name);
  });
  // ลบมุมมองของพืชที่ไม่มีข้อมูลแล้ว
  ss.getSheets().forEach(function (sh) {
    const n = sh.getName();
    if (n.indexOf(VIEW_PREFIX) === 0 && made.indexOf(n) < 0) ss.deleteSheet(sh);
  });
  return made;
}

/** แปลงตัวเลขที่เก็บเป็นข้อความ (เช่น "181,902") ในชีต data ให้เป็นตัวเลขจริง */
function normalizeDataSheet_() {
  const sh = sheetByName_(DATA_SHEET);
  const n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  const range = sh.getRange(2, 1, n, DATA_HEADERS.length);
  const vals = range.getValues();
  let fixed = 0;
  vals.forEach(function (r) {
    const y = Number(String(r[0]).replace(/\D/g, ''));
    if (r[0] !== '' && r[0] !== y) { r[0] = y; fixed++; }
    for (let c = 4; c <= 8; c++) {
      if (typeof r[c] !== 'number') { const v = num_(r[c]); r[c] = isNaN(v) ? 0 : v; fixed++; }
    }
    r[1] = text_(r[1]); r[3] = text_(r[3]);
  });
  range.setValues(vals);
  sh.getRange(2, 3, n, 1).setNumberFormat('@');
  return fixed;
}

// ===================== Import.gs =====================
/**
 * นำเข้าข้อมูล (Admin)
 * หน้า admin อ่านไฟล์ CSV/Excel/PDF และจับคู่คอลัมน์เองในเบราว์เซอร์ แล้วส่งแถวที่ทำความสะอาดแล้วมาที่นี่
 * ฝั่งนี้ตรวจซ้ำทุกแถว (ห้ามเชื่อข้อมูลจากเบราว์เซอร์) แล้ว upsert ด้วยคีย์ ปี + พืช + รหัสอำเภอ
 * ก่อนเขียนทุกครั้งจะสำรองชีต data ไว้ (ชีตซ่อน _bak_IMP...) และย้อนกลับการนำเข้าล่าสุดได้
 */
const IMPORT_HEADERS = ['Import_ID', 'Time', 'Username', 'Name', 'File', 'Rows', 'Inserted', 'Updated', 'Unchanged', 'Backup_Sheet', 'Status', 'Note'];
const MAX_IMPORT_ROWS = 5000;
const KEEP_BACKUPS = 10;

function validateImportRows_(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('ไม่มีแถวข้อมูล');
  if (rows.length > MAX_IMPORT_ROWS) throw new Error('นำเข้าได้ครั้งละไม่เกิน ' + MAX_IMPORT_ROWS + ' แถว');
  const districts = {};
  readDistricts_().forEach(function (d) { districts[d.district_code] = d.district; });
  const clean = [], errors = [], seen = {};
  rows.forEach(function (r, i) {
    const y = Number(r.year), crop = cleanText_(r.crop, 60), code = String(r.district_code || '').trim();
    const e = [];
    if (!(y >= 2500 && y <= 2700)) e.push('ปี พ.ศ. ไม่ถูกต้อง');
    if (!crop) e.push('ไม่มีชื่อพืช');
    if (!districts[code]) e.push('รหัสอำเภอไม่ถูกต้อง');
    const nums = NUM_COLS.map(function (k) { return num_(r[k]); });
    nums.forEach(function (n, j) { if (isNaN(n) || n < 0) e.push(NUM_COLS[j] + ' ไม่ใช่ตัวเลขที่ถูกต้อง'); });
    const key = y + '|' + crop + '|' + code;
    if (seen[key] !== undefined) e.push('ซ้ำกับแถวที่ ' + (seen[key] + 1));
    if (e.length) { errors.push({ row: i + 1, error: e.join(', ') }); return; }
    seen[key] = i;
    clean.push([y, crop, code, districts[code]].concat(nums.map(round2_)));
  });
  return { clean: clean, errors: errors };
}

function keyOf_(r) { return r[0] + '|' + r[1] + '|' + r[2]; }
function sameRow_(a, b) { for (let i = 4; i < 9; i++) if (Math.abs(Number(a[i]) - Number(b[i])) > 0.005) return false; return true; }

function diffImport_(clean) {
  const existing = {};
  readDataRows_().forEach(function (r, i) { existing[keyOf_(r)] = { i: i, r: r }; });
  let insert = 0, update = 0, unchanged = 0;
  const changes = [];
  clean.forEach(function (r) {
    const ex = existing[keyOf_(r)];
    if (!ex) { insert++; if (changes.length < 30) changes.push({ type: 'ใหม่', key: keyOf_(r), after: r.slice(4) }); }
    else if (sameRow_(ex.r, r)) unchanged++;
    else { update++; if (changes.length < 30) changes.push({ type: 'แก้ไข', key: keyOf_(r), before: ex.r.slice(4), after: r.slice(4) }); }
  });
  return { insert: insert, update: update, unchanged: unchanged, changes: changes, existing: existing };
}

function importCheck_(input) {
  input = input || {};
  const v = validateImportRows_(input.rows);
  const d = diffImport_(v.clean);
  return { valid: v.clean.length, errors: v.errors.slice(0, 200), errorCount: v.errors.length,
    insert: d.insert, update: d.update, unchanged: d.unchanged, changes: d.changes };
}

function importCommit_(input, s) {
  input = input || {};
  const v = validateImportRows_(input.rows);
  if (v.errors.length) throw new Error('มีแถวที่ไม่ถูกต้อง ' + v.errors.length + ' แถว กรุณาแก้ไขก่อนนำเข้า');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = spreadsheet_();
    const sh = sheetByName_(DATA_SHEET);
    const d = diffImport_(v.clean);
    if (!d.insert && !d.update) return { importId: '', insert: 0, update: 0, unchanged: d.unchanged, message: 'ข้อมูลเหมือนเดิมทั้งหมด ไม่มีการเปลี่ยนแปลง' };

    const id = 'IMP' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMddHHmmss');
    const bak = sh.copyTo(ss).setName('_bak_' + id);
    bak.hideSheet();

    const all = readDataRows_();
    v.clean.forEach(function (r) {
      const ex = d.existing[keyOf_(r)];
      if (ex) all[ex.i] = r; else all.push(r);
    });
    writeAllData_(sh, all);

    const log = ensureSheet_('import_log', IMPORT_HEADERS);
    log.appendRow([id, new Date(), s.username, s.name, cleanText_(input.fileName, 200), v.clean.length, d.insert, d.update, d.unchanged, bak.getName(), 'committed', cleanText_(input.note, 300)]);
    pruneBackups_(ss);
    invalidateData_();
    const views = rebuildCropViews_();
    audit_(s, 'import', id + ' ' + cleanText_(input.fileName, 120) + ' ใหม่ ' + d.insert + ' แก้ไข ' + d.update);
    return { importId: id, insert: d.insert, update: d.update, unchanged: d.unchanged, views: views.length,
      message: 'นำเข้าสำเร็จ: เพิ่ม ' + d.insert + ' แถว, แก้ไข ' + d.update + ' แถว, เหมือนเดิม ' + d.unchanged + ' แถว' };
  } finally {
    lock.releaseLock();
  }
}

/** เขียนทั้งชีตใหม่ เรียง ปี → พืช → รหัสอำเภอ */
function writeAllData_(sh, all) {
  all.sort(function (a, b) {
    return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : (a[0] - b[0]) || (String(a[2]) < String(b[2]) ? -1 : String(a[2]) > String(b[2]) ? 1 : 0);
  });
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, Math.max(sh.getLastColumn(), DATA_HEADERS.length)).clearContent();
  if (!all.length) return;
  sh.getRange(2, 3, all.length, 1).setNumberFormat('@');
  sh.getRange(2, 1, all.length, DATA_HEADERS.length).setValues(all);
}

function pruneBackups_(ss) {
  const baks = ss.getSheets().map(function (x) { return x.getName(); }).filter(function (n) { return n.indexOf('_bak_IMP') === 0; }).sort();
  while (baks.length > KEEP_BACKUPS) ss.deleteSheet(ss.getSheetByName(baks.shift()));
}

function importList_() {
  const sh = ensureSheet_('import_log', IMPORT_HEADERS);
  const rows = dataRows_(sh);
  const lastActive = (function () { for (let i = rows.length - 1; i >= 0; i--) if (rows[i][10] === 'committed') return rows[i][0]; return ''; })();
  const ss = spreadsheet_();
  return rows.slice(-100).reverse().map(function (r) {
    return { id: text_(r[0]), time: dateTime_(r[1]), username: text_(r[2]), name: text_(r[3]), file: text_(r[4]), rows: r[5],
      insert: r[6], update: r[7], unchanged: r[8], status: text_(r[10]), note: text_(r[11]),
      canRollback: r[0] === lastActive && !!ss.getSheetByName(String(r[9])) };
  });
}

/** ย้อนกลับได้เฉพาะการนำเข้าล่าสุด เพื่อไม่ให้ย้อนทับการนำเข้าที่เกิดทีหลัง */
function importRollback_(input, s) {
  const id = String((input && input.id) || '');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = spreadsheet_();
    const log = sheetByName_('import_log');
    const rows = dataRows_(log);
    let idx = -1;
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i][10] === 'committed') { idx = i; break; }
    if (idx < 0 || rows[idx][0] !== id) throw new Error('ย้อนกลับได้เฉพาะการนำเข้าล่าสุดเท่านั้น');
    const bak = ss.getSheetByName(String(rows[idx][9]));
    if (!bak) throw new Error('ไม่พบชีตสำรอง ' + rows[idx][9]);
    const vals = bak.getLastRow() > 1 ? bak.getRange(2, 1, bak.getLastRow() - 1, DATA_HEADERS.length).getValues() : [];
    writeAllData_(sheetByName_(DATA_SHEET), vals);
    log.getRange(idx + 2, 11).setValue('rolled_back');
    invalidateData_();
    rebuildCropViews_();
    audit_(s, 'import_rollback', id);
    return { message: 'ย้อนกลับการนำเข้า ' + id + ' แล้ว' };
  } finally {
    lock.releaseLock();
  }
}

// ===================== Links.gs =====================
/** ลิงก์เชื่อมโยงไปยังเว็บไซต์อื่น — Super Admin เพิ่ม/แก้ไข/ลบ/เรียงลำดับ */
const LINK_HEADERS = ['Link_ID', 'Title', 'URL', 'Description', 'Icon', 'Order', 'Active', 'Updated_At', 'Updated_By'];
const DEFAULT_LINKS = [
  ['L001', 'Agri-Risk Map Burning', 'https://krit-pj.github.io/TH-Agri-Risk-Maps-Burning/', 'ระบบเฝ้าระวังความเสี่ยงการเผาในพื้นที่เกษตร', '🔥', 1, true],
  ['L002', 'Green Gain Hub Kamphaeng Phet', 'https://krit-pj.github.io/Green_Gain_Hub-KPP/', 'ศูนย์กลางข้อมูลเกษตรสีเขียว จังหวัดกำแพงเพชร', '🌿', 2, true]
];

function linkList_(includeInactive) {
  const sh = spreadsheet_().getSheetByName('links');
  if (!sh) return DEFAULT_LINKS.map(function (l) { return { id: l[0], title: l[1], url: l[2], description: l[3], icon: l[4], order: l[5], active: true }; });
  return dataRows_(sh).map(function (r) {
    return { id: text_(r[0]), title: text_(r[1]), url: text_(r[2]), description: text_(r[3]), icon: cleanText_(r[4], 8),
      order: Number(r[5]) || 0, active: r[6] === true || String(r[6]).toUpperCase() === 'TRUE', updatedAt: dateTime_(r[7]), updatedBy: text_(r[8]) };
  }).filter(function (l) { return l.id && (includeInactive || l.active); })
    .sort(function (a, b) { return a.order - b.order; });
}

function linkSave_(input, s) {
  input = input || {};
  const title = cleanText_(input.title, 120), url = cleanText_(input.url, 500);
  if (!title) throw new Error('กรุณากรอกชื่อลิงก์');
  if (!/^https:\/\/[^\s]+$/i.test(url)) throw new Error('URL ต้องขึ้นต้นด้วย https://');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ensureSheet_('links', LINK_HEADERS);
    const rows = dataRows_(sh);
    const vals = [title, url, cleanText_(input.description, 300), cleanText_(input.icon, 8) || '🔗', Number(input.order) || rows.length + 1, input.active !== false, new Date(), s.username];
    let id = String(input.id || '');
    const i = id ? rows.findIndex(function (r) { return r[0] === id; }) : -1;
    if (i >= 0) sh.getRange(i + 2, 2, 1, 8).setValues([vals]);
    else {
      id = 'L' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMddHHmmss');
      sh.appendRow([id].concat(vals));
    }
    invalidateData_();
    audit_(s, i >= 0 ? 'link_update' : 'link_create', id + ' ' + title + ' ' + url);
    return { id: id, message: 'บันทึกลิงก์แล้ว' };
  } finally {
    lock.releaseLock();
  }
}

function linkDelete_(input, s) {
  const id = String((input && input.id) || '');
  const sh = sheetByName_('links');
  const rows = dataRows_(sh);
  const i = rows.findIndex(function (r) { return r[0] === id; });
  if (i < 0) throw new Error('ไม่พบลิงก์');
  sh.deleteRow(i + 2);
  invalidateData_();
  audit_(s, 'link_delete', id + ' ' + rows[i][1]);
  return { message: 'ลบลิงก์แล้ว' };
}

// ===================== Requests.gs =====================
/**
 * คำขอดาวน์โหลดข้อมูล
 * ผู้ใช้กรอกฟอร์ม → สถานะ pending → Admin/Super Admin อนุมัติหรือปฏิเสธ
 * อนุมัติแล้วระบบส่งอีเมลพร้อมลิงก์ดาวน์โหลด (ใช้ได้ 7 วัน) เก็บเฉพาะ hash ของ token
 */
const REQ_HEADERS = ['Request_ID', 'Time', 'Name', 'Position', 'Agency', 'Email', 'Phone', 'Purpose_Type', 'Purpose_Detail',
  'Crops', 'Year_From', 'Year_To', 'Status', 'Decided_By', 'Decided_At', 'Note', 'Token_Hash', 'Token_Expires', 'Download_Count', 'Last_Download'];
const PURPOSE_TYPES = ['วิจัย/วิชาการ', 'วางแผนนโยบาย/งานราชการ', 'การศึกษา', 'ธุรกิจ/การลงทุน', 'สื่อมวลชน', 'อื่น ๆ'];
const TOKEN_DAYS = 7;

function validEmail_(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }

function requestDownload_(input) {
  input = input || {};
  if (input.website) throw new Error('คำขอไม่ถูกต้อง'); // honeypot กันบอต
  const f = {
    name: cleanText_(input.name, 120), position: cleanText_(input.position, 120), agency: cleanText_(input.agency, 200),
    email: cleanText_(input.email, 120).toLowerCase(), phone: normalizePhone_(input.phone),
    purposeType: cleanText_(input.purposeType, 60), purposeDetail: cleanText_(input.purposeDetail, 1000),
    crops: (Array.isArray(input.crops) ? input.crops : []).map(function (c) { return cleanText_(c, 60); }).filter(String),
    yearFrom: Number(input.yearFrom) || '', yearTo: Number(input.yearTo) || ''
  };
  if (!f.name || !f.position || !f.agency) throw new Error('กรุณากรอก ชื่อ-สกุล ตำแหน่ง และหน่วยงาน');
  if (!validEmail_(f.email)) throw new Error('อีเมลไม่ถูกต้อง');
  if (f.phone && !/^0\d{8,9}$/.test(f.phone)) throw new Error('เบอร์โทรศัพท์ไม่ถูกต้อง');
  if (PURPOSE_TYPES.indexOf(f.purposeType) < 0) throw new Error('กรุณาเลือกวัตถุประสงค์');
  if (f.purposeDetail.length < 10) throw new Error('กรุณาอธิบายการนำข้อมูลไปใช้ อย่างน้อย 10 ตัวอักษร');
  if (!input.consent) throw new Error('กรุณายินยอมให้เก็บข้อมูลส่วนบุคคลตามวัตถุประสงค์');
  if (f.yearFrom && f.yearTo && f.yearFrom > f.yearTo) { const t = f.yearFrom; f.yearFrom = f.yearTo; f.yearTo = t; }

  const cache = CacheService.getScriptCache();
  const rk = 'req:' + f.email;
  const cnt = Number(cache.get(rk) || 0);
  if (cnt >= 5) throw new Error('ส่งคำขอบ่อยเกินไป กรุณาลองใหม่ภายหลัง');
  cache.put(rk, String(cnt + 1), 3600);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let id;
  try {
    const sh = ensureSheet_('download_requests', REQ_HEADERS);
    id = 'REQ-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd') + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();
    sh.appendRow([id, new Date(), f.name, f.position, f.agency, f.email, f.phone, f.purposeType, f.purposeDetail,
      f.crops.join(', ') || 'ทุกชนิด', f.yearFrom, f.yearTo, 'pending', '', '', '', '', '', 0, '']);
    sh.getRange(sh.getLastRow(), 7).setNumberFormat('@').setValue(f.phone);
  } finally {
    lock.releaseLock();
  }
  try {
    const to = prop_('NOTIFY_EMAIL') || Session.getEffectiveUser().getEmail();
    if (to) MailApp.sendEmail({ to: to, subject: '[KPP Agri Data Center] คำขอดาวน์โหลดใหม่ ' + id,
      body: 'มีคำขอดาวน์โหลดข้อมูลใหม่\n\nเลขที่: ' + id + '\nชื่อ: ' + f.name + '\nตำแหน่ง: ' + f.position + '\nหน่วยงาน: ' + f.agency +
        '\nวัตถุประสงค์: ' + f.purposeType + ' — ' + f.purposeDetail + '\n\nพิจารณาได้ที่ ' + siteUrl_() + 'admin.html#requests' });
  } catch (e) { /* แจ้งเตือนไม่สำเร็จไม่กระทบคำขอ */ }
  return { requestId: id, message: 'ส่งคำขอแล้ว เลขที่ ' + id + ' เมื่อได้รับอนุมัติ ระบบจะส่งลิงก์ดาวน์โหลดไปที่ ' + f.email };
}

function requestRow_(r, i) {
  return { row: i + 2, id: text_(r[0]), time: dateTime_(r[1]), name: text_(r[2]), position: text_(r[3]), agency: text_(r[4]),
    email: text_(r[5]), phone: normalizePhone_(r[6]), purposeType: text_(r[7]), purposeDetail: text_(r[8]), crops: text_(r[9]),
    yearFrom: r[10], yearTo: r[11], status: text_(r[12]), decidedBy: text_(r[13]), decidedAt: dateTime_(r[14]), note: text_(r[15]),
    expires: dateTime_(r[17]), downloads: Number(r[18]) || 0, lastDownload: dateTime_(r[19]) };
}

function requestList_(input) {
  const status = String((input && input.status) || '');
  const rows = dataRows_(ensureSheet_('download_requests', REQ_HEADERS));
  return rows.map(requestRow_).filter(function (x) { return !status || x.status === status; }).reverse().slice(0, 300);
}

function requestDecide_(input, s) {
  input = input || {};
  const id = String(input.id || '');
  const approve = input.decision === 'approve';
  if (['approve', 'reject'].indexOf(input.decision) < 0) throw new Error('การพิจารณาไม่ถูกต้อง');
  const note = cleanText_(input.note, 500);
  if (!approve && !note) throw new Error('กรุณาระบุเหตุผลที่ไม่อนุมัติ');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let req, token = '', link = '';
  try {
    const sh = sheetByName_('download_requests');
    const rows = dataRows_(sh);
    const i = rows.findIndex(function (r) { return r[0] === id; });
    if (i < 0) throw new Error('ไม่พบคำขอ');
    req = requestRow_(rows[i], i);
    if (req.status !== 'pending' && !(approve && req.status === 'approved')) throw new Error('คำขอนี้พิจารณาไปแล้ว');
    const expires = new Date(Date.now() + TOKEN_DAYS * 86400000);
    if (approve) { token = newToken_(); link = siteUrl_() + '?dl=' + token; }
    sh.getRange(req.row, 13, 1, 6).setValues([[approve ? 'approved' : 'rejected', s.name + ' (' + s.username + ')', new Date(), note,
      approve ? sha256Hex_(token) : '', approve ? expires : '']]);
  } finally {
    lock.releaseLock();
  }
  let mailed = false;
  try {
    MailApp.sendEmail({ to: req.email,
      subject: approve ? '[KPP Agri Data Center] อนุมัติคำขอดาวน์โหลดข้อมูล ' + id : '[KPP Agri Data Center] ผลการพิจารณาคำขอ ' + id,
      body: approve
        ? 'เรียน ' + req.name + '\n\nคำขอดาวน์โหลดข้อมูลเลขที่ ' + id + ' ได้รับการอนุมัติแล้ว\nดาวน์โหลดได้ที่ลิงก์นี้ (ใช้ได้ถึง ' +
          Utilities.formatDate(new Date(Date.now() + TOKEN_DAYS * 86400000), Session.getScriptTimeZone(), 'dd/MM/yyyy') + ')\n' + link +
          (note ? '\n\nหมายเหตุ: ' + note : '') + '\n\nกรุณาอ้างอิงแหล่งที่มา: สำนักงานเกษตรจังหวัดกำแพงเพชร\n\nศูนย์ข้อมูลการเกษตรจังหวัดกำแพงเพชร'
        : 'เรียน ' + req.name + '\n\nคำขอดาวน์โหลดข้อมูลเลขที่ ' + id + ' ไม่ได้รับการอนุมัติ\nเหตุผล: ' + note + '\n\nศูนย์ข้อมูลการเกษตรจังหวัดกำแพงเพชร' });
    mailed = true;
  } catch (e) { mailed = false; }
  audit_(s, approve ? 'request_approve' : 'request_reject', id + (mailed ? '' : ' (ส่งอีเมลไม่สำเร็จ)'));
  return { message: (approve ? 'อนุมัติแล้ว' : 'ไม่อนุมัติแล้ว') + (mailed ? ' และส่งอีเมลแจ้งผู้ขอแล้ว' : ' แต่ส่งอีเมลไม่สำเร็จ กรุณาคัดลอกลิงก์ส่งให้ผู้ขอเอง'),
    link: link, mailed: mailed };
}

function downloadByToken_(token) {
  token = String(token || '');
  if (!/^[0-9a-f]{64}$/i.test(token)) throw new Error('ลิงก์ดาวน์โหลดไม่ถูกต้อง');
  const h = sha256Hex_(token);
  const sh = sheetByName_('download_requests');
  const rows = dataRows_(sh);
  const i = rows.findIndex(function (r) { return r[16] === h; });
  if (i < 0) throw new Error('ลิงก์ดาวน์โหลดไม่ถูกต้องหรือถูกยกเลิกแล้ว');
  const req = requestRow_(rows[i], i);
  if (req.status !== 'approved') throw new Error('คำขอนี้ยังไม่ได้รับอนุมัติ');
  const exp = toDate_(rows[i][17]);
  if (!exp || exp.getTime() < Date.now()) throw new Error('ลิงก์ดาวน์โหลดหมดอายุแล้ว กรุณาส่งคำขอใหม่');
  const crops = req.crops && req.crops !== 'ทุกชนิด' ? req.crops.split(/\s*,\s*/) : null;
  const yf = Number(req.yearFrom) || 0, yt = Number(req.yearTo) || 9999;
  const out = readDataRows_().filter(function (r) { return (!crops || crops.indexOf(r[1]) >= 0) && r[0] >= yf && r[0] <= yt; });
  sh.getRange(req.row, 19, 1, 2).setValues([[req.downloads + 1, new Date()]]);
  return { requestId: req.id, name: req.name, cols: DATA_HEADERS, rows: out, crops: req.crops, yearFrom: req.yearFrom, yearTo: req.yearTo,
    expires: req.expires, citation: 'ที่มา: สำนักงานเกษตรจังหวัดกำแพงเพชร (KPP Agri Data Center)' };
}

// ===================== Setup.gs =====================
/**
 * รันครั้งแรก และทุกครั้งหลังอัปเดตโค้ด (รันซ้ำได้ ไม่ทำข้อมูลเสีย)
 * 1) สร้างชีตระบบที่ยังไม่มี  2) แปลงตัวเลขที่เป็นข้อความในชีต data
 * 3) สร้างชีตมุมมองรายพืช     4) สร้าง Super Admin จาก Script Properties
 */
function setupSystem() {
  const out = [];
  sheetByName_(DATA_SHEET);
  sheetByName_(DISTRICT_SHEET);
  ensureSheet_('admins', ADMIN_HEADERS).getRange('A:A').setNumberFormat('@');
  sheetByName_('admins').getRange('K:K').setNumberFormat('@');
  ensureSheet_('admin_log', AUDIT_HEADERS);
  ensureSheet_('import_log', IMPORT_HEADERS);
  ensureSheet_('download_requests', REQ_HEADERS).getRange('G:G').setNumberFormat('@');
  ensureSheet_('visit_stats', VISIT_HEADERS).getRange('A:A').setNumberFormat('@');
  const links = ensureSheet_('links', LINK_HEADERS);
  if (links.getLastRow() < 2) DEFAULT_LINKS.forEach(function (l) { links.appendRow(l.concat([new Date(), 'setupSystem'])); });
  out.push('PASS: ชีตระบบพร้อม');
  out.push('PASS: แปลงค่าตัวเลขในชีต data ' + normalizeDataSheet_() + ' เซลล์');
  out.push('PASS: ชีตมุมมองรายพืช ' + rebuildCropViews_().length + ' ชีต');
  out.push(ensureSuperAdmin_());
  invalidateData_();
  PropertiesService.getScriptProperties().setProperty('SETUP_VERSION', APP_VERSION);
  if (!prop_('SITE_URL')) out.push('INFO: ยังไม่ได้ตั้ง SITE_URL ใช้ค่าเริ่มต้น ' + DEFAULT_SITE_URL);
  Logger.log(out.join('\n'));
  return out;
}

/** ทดสอบหลัง deploy: Run แล้วดู Execution log */
function selfTest() {
  const b = bootstrap_();
  const res = ['rows=' + b.rows.length, 'crops=' + b.crops.join('/'), 'districts=' + b.districts.length, 'links=' + b.links.length,
    'visits=' + JSON.stringify(visitCounts_())];
  Logger.log(res.join('\n'));
  return res;
}

/** ติดตั้งอัตโนมัติครั้งแรกที่ Web App ถูกเรียก (และหลังอัปเดตเวอร์ชันโค้ด) จึงไม่ต้องกด Run เอง */
function autoSetup_() {
  if (prop_('SETUP_VERSION') === APP_VERSION) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return;
  try { if (prop_('SETUP_VERSION') !== APP_VERSION) setupSystem(); } finally { lock.releaseLock(); }
}
