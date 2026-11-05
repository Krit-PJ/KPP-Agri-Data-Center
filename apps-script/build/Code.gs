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
 *   Soil.gs     ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.)  · SoilSeed.gs ข้อมูลตั้งต้น
 *   Datasets.gs ทะเบียนชุดข้อมูล: ตารางข้อมูลแต่ละชั้นข้อมูล เพิ่ม/แก้ไข/ลบ + API สาธารณะแบบ allowlist
 *   FarmSeed.gs ข้อมูลตั้งต้น กลุ่มแปลงใหญ่ / ศพก. · PestSeed.gs ข้อมูลตั้งต้น ศจช. (ไม่มีข้อมูลส่วนบุคคล)
 *   AdminRequests.gs  ขอสิทธิ์ Admin → Super Admin อนุมัติ
 *   Setup.gs    setupSystem() — รันครั้งแรก / หลังอัปเดตโค้ด
 *
 * Script Properties ที่ใช้
 *   SPREADSHEET_ID         (ไม่บังคับ) ค่าเริ่มต้นคือชีต KPP Agri Database
 *   SITE_URL               URL หน้าเว็บบน GitHub Pages (ใช้สร้างลิงก์ดาวน์โหลดในอีเมล)
 *   NOTIFY_EMAIL           อีเมลรับแจ้งเตือนคำขอใหม่ (ไม่ตั้ง = อีเมลเจ้าของสคริปต์)
 *   SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD  ใช้ครั้งแรกเท่านั้น รหัสผ่านถูกลบทันทีหลังเก็บ hash
 *   ADMIN_PREAPPROVED_PHONES  เบอร์ Admin ที่อนุมัติล่วงหน้า (คั่นด้วย ,)
 */
const APP_VERSION = '2.4.0';
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

// ===================== AdminRequests.gs =====================
/**
 * ขอสิทธิ์ Admin: ผู้ขอกรอกแบบฟอร์ม (เบอร์โทร = ชื่อผู้ใช้ + รหัสผ่านที่ตั้งเอง) → Super Admin อนุมัติ
 * รหัสผ่านถูก hash ตั้งแต่ตอนส่งคำขอ ผู้อนุมัติไม่เห็นรหัสผ่าน
 * เบอร์ที่อนุมัติล่วงหน้า: Script Property ADMIN_PREAPPROVED_PHONES (คั่นด้วย ,) — ส่งคำขอแล้วใช้งานได้ทันที
 */
const AREQ_HEADERS = ['Request_ID', 'Time', 'Phone', 'Name', 'Position', 'Agency', 'Email', 'Reason', 'Pass_Hash', 'Salt', 'Status', 'Decided_By', 'Decided_At', 'Note'];

function preapprovedPhones_() {
  return prop_('ADMIN_PREAPPROVED_PHONES').split(/[,\s]+/).map(normalizePhone_).filter(function (p) { return /^0\d{9}$/.test(p); });
}

function adminRequest_(input) {
  input = input || {};
  if (input.website) throw new Error('คำขอไม่ถูกต้อง');
  const phone = normalizePhone_(input.phone);
  const f = { name: cleanText_(input.name, 120), position: cleanText_(input.position, 120), agency: cleanText_(input.agency, 200),
    email: cleanText_(input.email, 120).toLowerCase(), reason: cleanText_(input.reason, 500) };
  if (!/^0\d{9}$/.test(phone)) throw new Error('เบอร์โทรศัพท์ต้องมี 10 หลัก ขึ้นต้นด้วย 0');
  if (!f.name || !f.position || !f.agency) throw new Error('กรุณากรอก ชื่อ-สกุล ตำแหน่ง และหน่วยงาน');
  if (f.email && !validEmail_(f.email)) throw new Error('อีเมลไม่ถูกต้อง');
  const pw = validatePassword_(input.password);
  if (!input.consent) throw new Error('กรุณายินยอมการเก็บข้อมูลส่วนบุคคล');
  const cache = CacheService.getScriptCache();
  const rk = 'areq:' + phone;
  if (Number(cache.get(rk) || 0) >= 3) throw new Error('ส่งคำขอบ่อยเกินไป กรุณาลองใหม่ภายหลัง');
  cache.put(rk, String(Number(cache.get(rk) || 0) + 1), 3600);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let id, pre;
  try {
    if (adminRecord_(phone)) throw new Error('เบอร์นี้มีบัญชีผู้ดูแลแล้ว กรุณาเข้าสู่ระบบ หรือติดต่อ Super Admin เพื่อตั้งรหัสผ่านใหม่');
    const sh = ensureSheet_('admin_requests', AREQ_HEADERS);
    if (dataRows_(sh).some(function (r) { return normalizePhone_(r[2]) === phone && r[10] === 'pending'; })) throw new Error('มีคำขอของเบอร์นี้รอพิจารณาอยู่แล้ว');
    pre = preapprovedPhones_().indexOf(phone) >= 0;
    const salt = Utilities.getUuid();
    id = 'ADM-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd') + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();
    sh.appendRow([id, new Date(), phone, f.name, f.position, f.agency, f.email, f.reason, hashPassword_(salt, pw), salt,
      pre ? 'approved' : 'pending', pre ? 'อนุมัติล่วงหน้า (ADMIN_PREAPPROVED_PHONES)' : '', pre ? new Date() : '', '']);
    sh.getRange(sh.getLastRow(), 3).setNumberFormat('@').setValue(phone);
    if (pre) createAdminFromRequest_(sh.getLastRow(), { username: phone, name: 'ระบบ', role: 'super' });
  } finally {
    lock.releaseLock();
  }
  try {
    const to = prop_('NOTIFY_EMAIL') || Session.getEffectiveUser().getEmail();
    MailApp.sendEmail({ to: to, subject: '[KPP Agri Data Center] ' + (pre ? 'เพิ่ม Admin (อนุมัติล่วงหน้า) ' : 'คำขอสิทธิ์ Admin ใหม่ ') + id,
      body: 'ชื่อ: ' + f.name + '\nตำแหน่ง: ' + f.position + '\nหน่วยงาน: ' + f.agency + '\nเบอร์โทร: ' + phone + '\nเหตุผล: ' + f.reason +
        '\n\n' + (pre ? 'เบอร์นี้อยู่ในรายการอนุมัติล่วงหน้า ใช้งานได้ทันที' : 'พิจารณาได้ที่ ' + siteUrl_() + 'admin.html#adminreq') });
  } catch (e) { /* ไม่กระทบคำขอ */ }
  return { requestId: id, approved: pre,
    message: pre ? 'ลงทะเบียนสำเร็จ เข้าสู่ระบบได้ทันทีด้วยเบอร์ ' + phone + ' และรหัสผ่านที่ตั้งไว้'
      : 'ส่งคำขอแล้ว เลขที่ ' + id + ' รอ Super Admin อนุมัติ' + (f.email ? ' ระบบจะแจ้งผลทางอีเมล' : '') };
}

function createAdminFromRequest_(row, s) {
  const sh = sheetByName_('admin_requests');
  const r = sh.getRange(row, 1, 1, AREQ_HEADERS.length).getValues()[0];
  const phone = normalizePhone_(r[2]);
  if (adminRecord_(phone)) throw new Error('เบอร์นี้มีบัญชีผู้ดูแลแล้ว');
  const ad = sheetByName_('admins');
  const now = new Date();
  ad.appendRow([phone, text_(r[3]) + ' (' + text_(r[4]) + ', ' + text_(r[5]) + ')', 'admin', 'active', r[8], r[9], now, s.name + ' (' + s.username + ')', '', now, phone]);
  ad.getRange(ad.getLastRow(), 1).setNumberFormat('@').setValue(phone);
  ad.getRange(ad.getLastRow(), 11).setNumberFormat('@').setValue(phone);
  sh.getRange(row, 9, 1, 2).setValues([['', '']]); // ลบ hash ออกจากชีตคำขอเมื่อย้ายไปบัญชีแล้ว
  audit_(s, 'admin_request_approve', r[0] + ' ' + phone);
}

function adminRequestList_(input) {
  const status = String((input && input.status) || '');
  return dataRows_(ensureSheet_('admin_requests', AREQ_HEADERS)).map(function (r, i) {
    return { row: i + 2, id: text_(r[0]), time: dateTime_(r[1]), phone: normalizePhone_(r[2]), name: text_(r[3]), position: text_(r[4]), agency: text_(r[5]),
      email: text_(r[6]), reason: text_(r[7]), status: text_(r[10]), decidedBy: text_(r[11]), decidedAt: dateTime_(r[12]), note: text_(r[13]) };
  }).filter(function (x) { return !status || x.status === status; }).reverse();
}

function adminRequestDecide_(input, s) {
  input = input || {};
  const approve = input.decision === 'approve';
  if (['approve', 'reject'].indexOf(input.decision) < 0) throw new Error('การพิจารณาไม่ถูกต้อง');
  const note = cleanText_(input.note, 300);
  if (!approve && !note) throw new Error('กรุณาระบุเหตุผลที่ไม่อนุมัติ');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let req;
  try {
    const sh = sheetByName_('admin_requests');
    req = adminRequestList_({}).find(function (x) { return x.id === String(input.id || ''); });
    if (!req) throw new Error('ไม่พบคำขอ');
    if (req.status !== 'pending') throw new Error('คำขอนี้พิจารณาไปแล้ว');
    if (approve) createAdminFromRequest_(req.row, s);
    sh.getRange(req.row, 11, 1, 4).setValues([[approve ? 'approved' : 'rejected', s.name + ' (' + s.username + ')', new Date(), note]]);
    if (!approve) { sh.getRange(req.row, 9, 1, 2).setValues([['', '']]); audit_(s, 'admin_request_reject', req.id + ' ' + req.phone); }
  } finally {
    lock.releaseLock();
  }
  if (req.email) {
    try {
      MailApp.sendEmail({ to: req.email, subject: '[KPP Agri Data Center] ผลการขอสิทธิ์ผู้ดูแลระบบ ' + req.id,
        body: approve ? 'คำขอได้รับการอนุมัติแล้ว เข้าสู่ระบบที่ ' + siteUrl_() + 'admin.html ด้วยเบอร์ ' + req.phone + ' และรหัสผ่านที่ตั้งไว้'
          : 'คำขอไม่ได้รับการอนุมัติ\nเหตุผล: ' + note });
    } catch (e) { /* ignore */ }
  }
  return { message: approve ? 'อนุมัติแล้ว ' + req.phone + ' เข้าสู่ระบบได้ทันที' : 'ไม่อนุมัติแล้ว' };
}

/** ส่งลิงก์ตั้งรหัสผ่าน Super Admin ใหม่ (ทำงานเฉพาะเมื่อยังไม่มี Super Admin ที่ตั้งรหัสผ่านแล้ว อีเมลไปที่เจ้าของสคริปต์เท่านั้น) */
function superClaimResend_() {
  const sh = sheetByName_('admins');
  if (dataRows_(sh).some(function (r) { return text_(r[2]) === 'super' && text_(r[3]) !== 'disabled' && r[4]; })) throw new Error('มี Super Admin แล้ว');
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('SUPER_CLAIM_EXPIRES');
  return { message: sendSuperClaim_(normalizeUsername_(props.getProperty('SUPER_ADMIN_USERNAME') || DEFAULT_SUPER_USERNAME)).replace(/^INFO: /, '') };
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
  superClaimResend: { role: null, fn: function () { return superClaimResend_(); } },
  adminRequest: { role: null, fn: function (a) { return adminRequest_(a[0]); } },
  adminRequestList: { role: 'super', fn: function (a) { return adminRequestList_(a[0]); } },
  adminRequestDecide: { role: 'super', fn: function (a, s) { return adminRequestDecide_(a[0], s); } },
  soilList: { role: 'admin', fn: function () { return soilList_(); } },
  soilImport: { role: 'admin', fn: function (a, s) { return soilImport_(a[0], s); } },
  soilUpdate: { role: 'admin', fn: function (a, s) { return soilUpdate_(a[0], s); } },
  // ตารางข้อมูลแต่ละชั้นข้อมูล (ลบ = Super Admin)
  dsSchema: { role: 'admin', fn: function (a, s) { return dsSchema_(s); } },
  dsList: { role: 'admin', fn: function (a) { return dsList_(a[0]); } },
  dsSave: { role: 'admin', fn: function (a, s) { return dsSave_(a[0], s); } },
  dsDelete: { role: 'super', fn: function (a, s) { return dsDelete_(a[0], s); } },
  dsImport: { role: 'admin', fn: function (a, s) { return dsImport_(a[0], s); } },
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
const BOOT_CACHE_KEY = 'boot:v2.4';
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
    links: linkList_(false),
    soil: soilPublic_(),
    // ชั้นข้อมูลใหม่ v2.2 — เฉพาะช่องที่อนุญาตให้เผยแพร่ (ไม่มีข้อมูลส่วนบุคคล)
    farms: dsPublic_('farm'),
    pest: dsPublic_('pest'),
    lc: dsPublic_('lc'),
    lcnet: dsPublic_('lcnet'),
    lctype: dsPublic_('lctype')
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

// ===================== Datasets.gs =====================
/**
 * ทะเบียนชุดข้อมูล (Dataset registry) — ตารางข้อมูลของแต่ละชั้นข้อมูลที่ผู้ดูแลเปิดดู เพิ่ม แก้ไข ลบ ได้โดยตรง
 *
 * ชุดข้อมูลใหม่ให้เพิ่มเป็น schema ในไฟล์นี้ (ไม่สร้างจากหน้าเว็บ) เพื่อควบคุมว่าช่องใดเป็นข้อมูลส่วนบุคคล
 *   pii: true    = ข้อมูลส่วนบุคคล (PDPA) — ผู้ดูแลเห็น/แก้ได้ แต่ไม่ส่งออกทาง API สาธารณะ และไม่บันทึกค่าใน log
 *   public: false = ไม่ส่งออกทาง API สาธารณะ (แม้ไม่ใช่ข้อมูลส่วนบุคคล)
 * API สาธารณะส่งเฉพาะช่องที่อนุญาต (allowlist) เท่านั้น
 *
 * สิทธิ์: ดู/เพิ่ม/แก้ไข = Admin ขึ้นไป · ลบ = Super Admin เท่านั้น
 * ทุกการแก้ไข/ลบ บันทึกค่าก่อน-หลังใน admin_log · ตรวจชนกัน: ถ้าแถวถูกแก้หลังจากเปิดอ่าน จะไม่บันทึกทับ
 */

// [key, หัวคอลัมน์ในชีต, ชนิด, ป้ายชื่อ, ตัวเลือกเพิ่มเติม]
// ชนิด: text | long (ข้อความยาว) | int | num | bool | lat | lng | code (รหัสเก็บเป็นข้อความ) | phone | year | select
function f_(key, header, type, label, o) {
  o = o || {};
  return { key: key, header: header || key, type: type || 'text', label: label || key, pii: !!o.pii, public: o.public !== false && !o.pii,
    required: !!o.required, options: o.options || null, max: o.max || (type === 'long' ? 600 : 200), hint: o.hint || '' };
}

// สร้างเมื่อใช้ครั้งแรก (ไฟล์นี้โหลดก่อน Soil.gs จึงอ้างค่าคงที่ของไฟล์อื่นตอนโหลดไม่ได้)
let DATASETS_ = null;
function datasets_() {
  if (DATASETS_) return DATASETS_;
  DATASETS_ = {
  crops: {
    label: 'สถิติพืชเศรษฐกิจที่สำคัญ', sheet: DATA_SHEET, keyFields: ['year', 'crop', 'district_code'], meta: false, order: 1,
    note: 'แก้ไขรายแถวได้ที่นี่ · นำเข้าทั้งไฟล์ใช้แท็บ "นำเข้าข้อมูล" เหมือนเดิม',
    fields: [
      f_('year', 'year', 'year', 'ปี พ.ศ.', { required: true }), f_('crop', 'crop', 'text', 'พืช', { required: true, max: 60 }),
      f_('district_code', 'district_code', 'code', 'รหัสอำเภอ', { required: true }), f_('district', 'district', 'text', 'อำเภอ', { max: 60 }),
      f_('planted', 'planted', 'num', 'เนื้อที่เพาะปลูก (ไร่)'), f_('harvested', 'harvested', 'num', 'เนื้อที่เก็บเกี่ยว (ไร่)'),
      f_('production', 'production', 'num', 'ผลผลิต (ตัน)'), f_('yield_planted', 'yield_planted', 'num', 'ผลผลิต/ไร่ปลูก (กก.)'),
      f_('yield_harvested', 'yield_harvested', 'num', 'ผลผลิต/ไร่เก็บเกี่ยว (กก.)')
    ]
  },
  soil: {
    label: 'ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.)', sheet: SOIL_SHEET, idPrefix: 'S', order: 2, headers: SOIL_HEADERS,
    note: 'นำเข้าทำเนียบทั้งไฟล์ใช้แท็บ "ศดปช." เหมือนเดิม',
    fields: [
      f_('id', 'Center_ID', 'code', 'รหัส'), f_('name', 'Name', 'text', 'ชื่อ ศดปช.', { required: true }),
      f_('district_code', 'District_Code', 'code', 'รหัสอำเภอ'), f_('district', 'District', 'text', 'อำเภอ', { max: 60 }),
      f_('location', 'Location', 'text', 'ที่ตั้ง'), f_('lat', 'Lat', 'lat', 'ละติจูด'), f_('lng', 'Lng', 'lng', 'ลองจิจูด'),
      f_('type', 'Type', 'select', 'ประเภท', { options: ['หลัก', 'เครือข่าย'] }), f_('level', 'Level', 'text', 'ระดับ', { max: 2 }),
      f_('members', 'Members', 'int', 'สมาชิก (ราย)'), f_('year_start', 'Year_Start', 'year', 'ปีที่จัดตั้ง'), f_('fund', 'Fund', 'num', 'กองทุน (บาท)'),
      f_('crops', 'Crops', 'text', 'พืชหลัก'), f_('network', 'Network', 'long', 'เครือข่าย'), f_('organic', 'Organic', 'text', 'ปุ๋ยอินทรีย์'),
      f_('products', 'Products', 'text', 'ผลิตภัณฑ์'), f_('oss', 'OSS', 'text', 'OSS', { max: 20 }), f_('oss_status', 'OSS_Status', 'text', 'สถานะ OSS', { max: 40 }),
      f_('chair', 'Chair', 'text', 'ประธาน', { pii: true }), f_('chair_phone', 'Chair_Phone', 'phone', 'โทรศัพท์ประธาน', { pii: true }),
      f_('note', 'Note', 'long', 'หมายเหตุ'), f_('verified', 'Verified', 'bool', 'ตรวจสอบพิกัดแล้ว')
    ]
  },
  farm: {
    label: 'กลุ่มแปลงใหญ่', sheet: 'large_farms', idPrefix: 'F', order: 3, seed: 'FARM_SEED',
    note: 'นำเข้าไฟล์ส่งออกจากระบบแปลงใหญ่ หรือไฟล์พิกัด ได้ที่ปุ่ม "นำเข้าไฟล์" ของตารางนี้',
    fields: [
      f_('id', 'id', 'code', 'รหัส'), f_('name', 'name', 'text', 'ชื่อแปลงใหญ่', { required: true }),
      f_('year_start', 'year_start', 'year', 'ปีที่เริ่ม'), f_('group', 'group', 'text', 'กลุ่มสินค้า', { max: 60 }),
      f_('commodity', 'commodity', 'text', 'สินค้าหลัก', { required: true, max: 60 }), f_('commodity2', 'commodity2', 'text', 'สินค้ารอง', { max: 60 }),
      f_('moo', 'moo', 'text', 'หมู่ที่', { max: 40 }), f_('tambon', 'tambon', 'text', 'ตำบล', { max: 60 }),
      f_('district', 'district', 'text', 'อำเภอ', { max: 60 }), f_('district_code', 'district_code', 'code', 'รหัสอำเภอ'),
      f_('members', 'members', 'int', 'สมาชิก (ราย)'), f_('member_area', 'member_area', 'num', 'พื้นที่สมาชิก (ไร่)'),
      f_('plot_farmers', 'plot_farmers', 'int', 'เกษตรกรในแปลง (ราย)'), f_('plots', 'plots', 'int', 'จำนวนแปลง'), f_('plot_area', 'plot_area', 'num', 'พื้นที่แปลง (ไร่)'),
      f_('cost_before', 'cost_before', 'num', 'ต้นทุนก่อน (บาท/ไร่)'), f_('cost_after', 'cost_after', 'num', 'ต้นทุนหลัง (บาท/ไร่)'),
      f_('yield_before', 'yield_before', 'num', 'ผลผลิตก่อน (กก./ไร่)'), f_('yield_after', 'yield_after', 'num', 'ผลผลิตหลัง (กก./ไร่)'),
      f_('gap', 'gap', 'bool', 'มาตรฐาน GAP'), f_('organic', 'organic', 'bool', 'อินทรีย์'), f_('grouping', 'grouping', 'text', 'รูปแบบการรวมกลุ่ม', { max: 80 }),
      f_('market_before', 'market_before', 'text', 'ตลาดก่อน'), f_('market_after', 'market_after', 'text', 'ตลาดหลัง'),
      f_('lat', 'lat', 'lat', 'ละติจูด'), f_('lng', 'lng', 'lng', 'ลองจิจูด'), f_('coord_note', 'coord_note', 'text', 'หมายเหตุพิกัด'),
      f_('manager', 'manager', 'text', 'ผู้จัดการ', { pii: true }), f_('manager_position', 'manager_position', 'text', 'ตำแหน่งผู้จัดการ', { pii: true }),
      f_('manager_phone', 'manager_phone', 'phone', 'โทรศัพท์ผู้จัดการ', { pii: true }),
      f_('chair', 'chair', 'text', 'ประธาน', { pii: true }), f_('chair_phone', 'chair_phone', 'phone', 'โทรศัพท์ประธาน', { pii: true })
    ]
  },
  lc: {
    label: 'ศพก. หลัก', sheet: 'lc_centers', idPrefix: 'L', order: 5, seed: 'LC_SEED',
    fields: [
      f_('id', 'id', 'code', 'รหัส'), f_('name', 'name', 'text', 'ชื่อศูนย์', { required: true }),
      f_('district', 'district', 'text', 'อำเภอ', { max: 60 }), f_('district_code', 'district_code', 'code', 'รหัสอำเภอ'),
      f_('moo', 'moo', 'text', 'หมู่ที่', { max: 20 }), f_('tambon', 'tambon', 'text', 'ตำบล', { max: 60 }),
      f_('commodity', 'commodity', 'text', 'สินค้าหลัก', { max: 60 }), f_('lat', 'lat', 'lat', 'ละติจูด'), f_('lng', 'lng', 'lng', 'ลองจิจูด'),
      f_('utm_x', 'utm_x', 'num', 'UTM X (47N)'), f_('utm_y', 'utm_y', 'num', 'UTM Y (47N)'),
      f_('target_area', 'target_area', 'num', 'พื้นที่เป้าหมาย (ไร่)'), f_('target_farmers', 'target_farmers', 'int', 'เกษตรกรเป้าหมาย (ราย)'),
      f_('highlight', 'highlight', 'long', 'จุดเด่นของศูนย์ (คั่นด้วย ;)'), f_('network', 'network', 'int', 'ศพก. เครือข่าย (แห่ง)'),
      f_('coord_note', 'coord_note', 'text', 'หมายเหตุพิกัด'),
      f_('farmer', 'farmer', 'text', 'เกษตรกรต้นแบบ', { pii: true }), f_('farmer_phone', 'farmer_phone', 'phone', 'โทรศัพท์เกษตรกรต้นแบบ', { pii: true }),
      f_('officer', 'officer', 'text', 'เจ้าหน้าที่ตำบล', { pii: true }), f_('officer_phone', 'officer_phone', 'phone', 'โทรศัพท์เจ้าหน้าที่', { pii: true })
    ]
  },
  pest: {
    label: 'ศูนย์จัดการศัตรูพืชชุมชน (ศจช.)', sheet: 'pest_centers', idPrefix: 'P', order: 4, seed: 'PEST_SEED',
    note: 'นำเข้าทำเนียบ ศจช. ทั้งไฟล์ได้ที่ปุ่ม "นำเข้าไฟล์" ของตารางนี้ (พิกัด UTM 47N แปลงให้อัตโนมัติ)',
    fields: [
      f_('id', 'id', 'code', 'รหัส'), f_('name', 'name', 'text', 'ชื่อ ศจช.', { required: true }), f_('full_name', 'full_name', 'text', 'ชื่อเต็มตามทะเบียน'),
      f_('year_start', 'year_start', 'year', 'ปีที่จัดตั้ง'), f_('level', 'level', 'select', 'ระดับชั้น', { options: ['A', 'B', 'C'] }),
      f_('level_year', 'level_year', 'code', 'ระดับชั้นของปีงบประมาณ'), f_('members', 'members', 'int', 'สมาชิก (ราย)'),
      f_('moo', 'moo', 'text', 'หมู่ที่', { max: 20 }), f_('tambon', 'tambon', 'text', 'ตำบล', { max: 60 }),
      f_('district', 'district', 'text', 'อำเภอ', { max: 60 }), f_('district_code', 'district_code', 'code', 'รหัสอำเภอ'),
      f_('lat', 'lat', 'lat', 'ละติจูด'), f_('lng', 'lng', 'lng', 'ลองจิจูด'), f_('utm_x', 'utm_x', 'num', 'UTM X (47N)'), f_('utm_y', 'utm_y', 'num', 'UTM Y (47N)'),
      f_('coord_note', 'coord_note', 'text', 'หมายเหตุพิกัด'), f_('crop', 'crop', 'text', 'พืชหลัก', { max: 60 }),
      f_('area_farm', 'area_farm', 'bool', 'อยู่ในพื้นที่แปลงใหญ่'), f_('area_risk', 'area_risk', 'bool', 'พื้นที่เสี่ยงต่อการระบาด'),
      f_('area_gap', 'area_gap', 'bool', 'พื้นที่ผลิตสินค้าคุณภาพ (GAP)'), f_('area_normal', 'area_normal', 'bool', 'พื้นที่ปกติ/ทั่วไป'),
      f_('other', 'other', 'long', 'สถานะอื่น (คั่นด้วย ;)'), f_('bio', 'bio', 'long', 'การผลิตชีวภัณฑ์ (คั่นด้วย ;)'),
      f_('chair', 'chair', 'text', 'ประธานศูนย์', { pii: true }), f_('chair_phone', 'chair_phone', 'phone', 'โทรศัพท์ประธาน', { pii: true })
    ]
  },
  lcnet: {
    label: 'ศพก. เครือข่าย รายอำเภอ', sheet: 'lc_network', keyFields: ['district_code'], order: 6, seed: 'LCNET_SEED',
    fields: [f_('district_code', 'district_code', 'code', 'รหัสอำเภอ', { required: true }), f_('district', 'district', 'text', 'อำเภอ', { max: 60 }),
      f_('count', 'count', 'int', 'จำนวน (แห่ง)')]
  },
  lctype: {
    label: 'ศพก. เครือข่าย รายประเภท', sheet: 'lc_types', keyFields: ['type'], order: 7, seed: 'LCTYPE_SEED',
    fields: [f_('type', 'type', 'text', 'ประเภท', { required: true, max: 60 }), f_('count', 'count', 'int', 'จำนวน (แห่ง)')]
  }
  };
  return DATASETS_;
}
const DS_META = ['Updated_At', 'Updated_By'];

function dsDef_(name) {
  const d = datasets_()[String(name || '')];
  if (!d) throw new Error('ไม่รู้จักชุดข้อมูล');
  return d;
}
function dsHeaders_(d) { return d.headers || d.fields.map(function (f) { return f.header; }).concat(d.meta === false ? [] : DS_META); }

function dsBlank_(v) { return v === null || v === undefined || v === ''; }
/** แปลงค่าในชีต/จากผู้ใช้ ให้เป็นชนิดของช่อง */
function dsCast_(f, v) {
  switch (f.type) {
    case 'int': case 'num': case 'year': {
      if (dsBlank_(v)) return f.type === 'year' ? null : (f.key.indexOf('cost_') === 0 || f.key.indexOf('yield_') === 0 || f.key.indexOf('target_') === 0 || f.key.indexOf('utm_') === 0 ? null : 0);
      const n = num_(v);
      return isNaN(n) ? NaN : (f.type === 'num' ? n : Math.round(n));
    }
    case 'lat': case 'lng': { if (dsBlank_(v)) return null; const n = Number(v); return isFinite(n) ? n : NaN; }
    case 'bool': return v === true || /^(true|1|ใช่|มี|yes)$/i.test(String(v).trim());
    case 'code': return cleanText_(v, 40).replace(/\.0$/, '');
    case 'phone': return cleanText_(v, 40).replace(/[^\d\-, ]/g, '');
    default: return cleanText_(v, f.max);
  }
}
function dsToCell_(f, v) {
  if (f.type === 'bool') return v === true;
  if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) return '';
  return v;
}
function dsKeyOf_(d, o) { return d.keyFields ? d.keyFields.map(function (k) { return String(o[k]); }).join('|') : String(o.id || ''); }
/** ลายนิ้วมือของแถว ใช้ตรวจว่าแถวถูกแก้ไปแล้วหรือยัง */
function dsVer_(d, o) { return sha256Hex_(JSON.stringify(d.fields.map(function (f) { return o[f.key]; }))).slice(0, 16); }

function dsRead_(d) {
  const sh = sheetByName_(d.sheet);
  const head = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
  const idx = {};
  head.forEach(function (h, i) { idx[h] = i; });
  const items = [];
  dataRows_(sh).forEach(function (r, i) {
    const o = {};
    d.fields.forEach(function (f) { o[f.key] = idx[f.header] === undefined ? dsCast_(f, '') : dsCast_(f, r[idx[f.header]]); });
    if (d.fields.filter(function (f) { return f.required; }).every(function (f) { return dsBlank_(o[f.key]); })) return;
    items.push({ row: i + 2, obj: o, raw: r });
  });
  return { sh: sh, head: head, idx: idx, items: items };
}

function dsValidate_(d, o) {
  const e = [];
  d.fields.forEach(function (f) {
    const v = o[f.key];
    if (f.required && dsBlank_(v)) e.push('ต้องระบุ' + f.label);
    if (typeof v === 'number' && isNaN(v)) e.push(f.label + ' ต้องเป็นตัวเลข');
    if (f.type === 'year' && v !== null && !(v >= 2500 && v <= 2700)) e.push(f.label + ' ต้องเป็นปี พ.ศ.');
    if ((f.type === 'int' || f.type === 'num') && typeof v === 'number' && v < 0 && f.key.indexOf('utm') < 0) e.push(f.label + ' ต้องไม่ติดลบ');
    if (f.options && !dsBlank_(v) && f.options.indexOf(v) < 0) e.push(f.label + ' ต้องเป็น ' + f.options.join(' / '));
  });
  const latF = d.fields.find(function (f) { return f.type === 'lat'; });
  if (latF) {
    const la = o.lat, lo = o.lng;
    if ((la === null) !== (lo === null)) e.push('ต้องระบุทั้งละติจูดและลองจิจูด');
    else if (la !== null && !(la > 5 && la < 21 && lo > 97 && lo < 106)) e.push('พิกัดไม่อยู่ในประเทศไทย');
  }
  return e;
}

/** แถวที่จะเขียน: เรียงตามหัวคอลัมน์ที่มีจริงในชีต คอลัมน์ที่ระบบไม่รู้จักคงค่าเดิม */
function dsRowOut_(d, ctx, o, raw, by) {
  const out = ctx.head.map(function (h, i) { return raw ? raw[i] : ''; });
  d.fields.forEach(function (f) { if (ctx.idx[f.header] !== undefined) out[ctx.idx[f.header]] = dsToCell_(f, o[f.key]); });
  if (ctx.idx.Updated_At !== undefined) out[ctx.idx.Updated_At] = new Date();
  if (ctx.idx.Updated_By !== undefined) out[ctx.idx.Updated_By] = by;
  return out;
}

function dsPublicRow_(d, o) {
  const p = {};
  d.fields.forEach(function (f) { if (f.public) p[f.key] = o[f.key]; });
  return p;
}
/** สำหรับ API สาธารณะ: เฉพาะช่องที่อนุญาต */
function dsPublic_(name) {
  const d = dsDef_(name);
  if (!spreadsheet_().getSheetByName(d.sheet)) return [];
  return dsRead_(d).items.map(function (it) { return dsPublicRow_(d, it.obj); });
}

/** สรุปการเปลี่ยนแปลงสำหรับ log (ไม่บันทึกค่าข้อมูลส่วนบุคคล) */
function dsDiff_(d, a, b) {
  const ch = [];
  d.fields.forEach(function (f) {
    const x = a ? a[f.key] : undefined, y = b ? b[f.key] : undefined;
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    if (f.pii) ch.push(f.key + ': (ข้อมูลส่วนบุคคล เปลี่ยนแปลง)');
    else ch.push(f.key + ': ' + (x === undefined ? '' : JSON.stringify(x)) + ' → ' + (y === undefined ? '' : JSON.stringify(y)));
  });
  return ch.join('; ');
}
function dsMask_(d, o) { const m = {}; d.fields.forEach(function (f) { m[f.key] = f.pii ? (dsBlank_(o[f.key]) ? '' : '***') : o[f.key]; }); return m; }

function dsAfterWrite_(name, d, o) {
  invalidateData_();
  if (name === 'crops' && o && CROP_ORDER.indexOf(o.crop) < 0) rebuildCropViews_();
}

// ---------------- API ----------------

function dsSchema_(s) {
  return Object.keys(datasets_()).sort(function (a, b) { return datasets_()[a].order - datasets_()[b].order; }).map(function (k) {
    const d = datasets_()[k];
    return { name: k, label: d.label, note: d.note || '', key: d.keyFields || ['id'], canDelete: s.role === 'super',
      importable: ['farm', 'pest', 'lc', 'lcnet', 'lctype'].indexOf(k) >= 0,
      fields: d.fields.map(function (f) { return { key: f.key, label: f.label, type: f.type, pii: f.pii, public: f.public, required: f.required, options: f.options }; }) };
  });
}

function dsList_(a) {
  a = a || {};
  const d = dsDef_(a.dataset);
  return { dataset: a.dataset, rows: dsRead_(d).items.map(function (it) {
    const o = it.obj; o._id = dsKeyOf_(d, o); o._v = dsVer_(d, o); return o;
  }) };
}

/** เพิ่ม (ไม่มี id) หรือแก้ไข (มี id + v) หนึ่งแถว */
function dsSave_(a, s) {
  a = a || {};
  const name = String(a.dataset || ''), d = dsDef_(name);
  const input = a.item || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ctx = dsRead_(d);
    let it = null;
    if (!dsBlank_(a.id)) {
      it = ctx.items.find(function (x) { return dsKeyOf_(d, x.obj) === String(a.id); });
      if (!it) throw new Error('ไม่พบแถวนี้แล้ว (อาจถูกลบไปแล้ว) กรุณาโหลดตารางใหม่');
      if (String(a.v || '') !== dsVer_(d, it.obj)) throw new Error('CONFLICT: แถวนี้ถูกแก้ไขโดยผู้อื่นหลังจากคุณเปิดตาราง กรุณาโหลดตารางใหม่แล้วแก้อีกครั้ง');
    }
    const before = it ? it.obj : null;
    const o = {};
    d.fields.forEach(function (f) { o[f.key] = (f.key in input) ? dsCast_(f, input[f.key]) : (before ? before[f.key] : dsCast_(f, '')); });
    if (!d.keyFields && dsBlank_(o.id)) o.id = d.idPrefix + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMddHHmmss') + Math.floor(Math.random() * 90 + 10);
    const e = dsValidate_(d, o);
    if (e.length) throw new Error(e.join(', '));
    const key = dsKeyOf_(d, o);
    const dup = ctx.items.find(function (x) { return x !== it && dsKeyOf_(d, x.obj) === key; });
    if (dup) throw new Error('มีแถว ' + key + ' อยู่แล้ว');
    const row = dsRowOut_(d, ctx, o, it ? it.raw : null, s.username);
    if (it) ctx.sh.getRange(it.row, 1, 1, row.length).setValues([row]);
    else ctx.sh.appendRow(row);
    dsAfterWrite_(name, d, o);
    const diff = dsDiff_(d, before, o);
    audit_(s, (it ? 'ds_update:' : 'ds_add:') + name, key + ' | ' + (it ? diff : JSON.stringify(dsMask_(d, o))));
    o._id = key; o._v = dsVer_(d, o);
    return { message: (it ? 'บันทึกการแก้ไข ' : 'เพิ่ม ') + key + ' แล้ว', item: o, changed: diff };
  } finally {
    lock.releaseLock();
  }
}

/** ลบหนึ่งแถว (Super Admin) บันทึกค่าทั้งแถวใน log */
function dsDelete_(a, s) {
  a = a || {};
  const name = String(a.dataset || ''), d = dsDef_(name);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ctx = dsRead_(d);
    const it = ctx.items.find(function (x) { return dsKeyOf_(d, x.obj) === String(a.id || ''); });
    if (!it) throw new Error('ไม่พบแถวนี้แล้ว กรุณาโหลดตารางใหม่');
    if (String(a.v || '') !== dsVer_(d, it.obj)) throw new Error('CONFLICT: แถวนี้ถูกแก้ไขหลังจากคุณเปิดตาราง กรุณาโหลดตารางใหม่');
    ctx.sh.deleteRow(it.row);
    dsAfterWrite_(name, d, null);
    audit_(s, 'ds_delete:' + name, String(a.id) + ' | ' + JSON.stringify(dsMask_(d, it.obj)));
    return { message: 'ลบ ' + a.id + ' แล้ว' };
  } finally {
    lock.releaseLock();
  }
}

/**
 * นำเข้าหลายแถว
 *  mode 'replace' = แทนที่ทั้งชุด (สำรองชีตเดิมก่อน; ถ้าแถวใหม่ไม่มีข้อมูลส่วนบุคคล ให้คงค่าเดิมของรหัสเดียวกัน)
 *  mode 'upsert'  = แก้เฉพาะช่องที่ส่งมาของแถวที่มีรหัสอยู่แล้ว และเพิ่มแถวใหม่ (เช่น นำเข้าไฟล์พิกัด)
 */
function dsImport_(a, s) {
  a = a || {};
  const name = String(a.dataset || ''), d = dsDef_(name);
  if (['farm', 'pest', 'lc', 'lcnet', 'lctype'].indexOf(name) < 0) throw new Error('ชุดข้อมูลนี้ให้นำเข้าที่แท็บเดิม');
  const rows = Array.isArray(a.rows) ? a.rows : [];
  const mode = a.mode === 'upsert' ? 'upsert' : 'replace';
  if (!rows.length) throw new Error('ไม่มีรายการ');
  if (rows.length > 5000) throw new Error('รายการมากเกินไป');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = spreadsheet_();
    const ctx = dsRead_(d);
    const old = {};
    ctx.items.forEach(function (it) { old[dsKeyOf_(d, it.obj)] = it; });
    const errs = [], out = [], seen = {};
    let updated = 0, added = 0;
    rows.forEach(function (inp, i) {
      const prev = old[dsKeyOf_(d, inp)];
      const o = {};
      d.fields.forEach(function (f) {
        const has = (f.key in inp) && !(f.pii && dsBlank_(inp[f.key]) && prev);
        o[f.key] = has ? dsCast_(f, inp[f.key]) : (prev ? prev.obj[f.key] : dsCast_(f, ''));
      });
      if (!d.keyFields && dsBlank_(o.id)) o.id = d.idPrefix + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd') + String(i + 1).padStart(4, '0');
      const e = dsValidate_(d, o);
      const k = dsKeyOf_(d, o);
      if (seen[k]) e.push('รหัสซ้ำ ' + k);
      seen[k] = true;
      if (e.length) { errs.push('แถว ' + (i + 1) + ': ' + e.join(', ')); return; }
      if (prev) updated++; else added++;
      out.push({ o: o, prev: prev });
    });
    if (errs.length) throw new Error(errs.slice(0, 5).join(' | ') + (errs.length > 5 ? ' (และอีก ' + (errs.length - 5) + ' แถว)' : ''));
    const bakName = '_bak_' + d.sheet + '_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMddHHmmss');
    ctx.sh.copyTo(ss).setName(bakName).hideSheet();
    if (mode === 'replace') {
      const data = out.map(function (x) { return dsRowOut_(d, ctx, x.o, x.prev ? x.prev.raw : null, s.username); });
      if (ctx.sh.getLastRow() > 1) ctx.sh.getRange(2, 1, ctx.sh.getLastRow() - 1, ctx.head.length).clearContent();
      ctx.sh.getRange(2, 1, data.length, ctx.head.length).setValues(data);
    } else {
      out.forEach(function (x) {
        const row = dsRowOut_(d, ctx, x.o, x.prev ? x.prev.raw : null, s.username);
        if (x.prev) ctx.sh.getRange(x.prev.row, 1, 1, row.length).setValues([row]); else ctx.sh.appendRow(row);
      });
    }
    const baks = ss.getSheets().map(function (x) { return x.getName(); }).filter(function (n) { return n.indexOf('_bak_' + d.sheet + '_') === 0; }).sort();
    while (baks.length > 5) ss.deleteSheet(ss.getSheetByName(baks.shift()));
    dsAfterWrite_(name, d, null);
    audit_(s, 'ds_import:' + name, mode + ' ' + cleanText_(a.fileName, 120) + ' แก้ ' + updated + ' เพิ่ม ' + added + (mode === 'replace' ? ' รวม ' + out.length : '') + ' (สำรอง ' + bakName + ')');
    return { message: (mode === 'replace' ? 'แทนที่ข้อมูลทั้งชุด ' + out.length + ' แถว' : 'ปรับปรุง ' + updated + ' แถว เพิ่ม ' + added + ' แถว') +
      ' (สำรองข้อมูลเดิมไว้ที่ชีต ' + bakName + ')', updated: updated, added: added, total: out.length };
  } finally {
    lock.releaseLock();
  }
}

function dsSeed_(name) {
  switch (name) {
    case 'farm': return typeof FARM_SEED === 'undefined' ? null : FARM_SEED;
    case 'pest': return typeof PEST_SEED === 'undefined' ? null : PEST_SEED;
    case 'lc': return typeof LC_SEED === 'undefined' ? null : LC_SEED;
    case 'lcnet': return typeof LCNET_SEED === 'undefined' ? null : LCNET_SEED;
    case 'lctype': return typeof LCTYPE_SEED === 'undefined' ? null : LCTYPE_SEED;
    default: return null;
  }
}

/** สร้างชีตของชุดข้อมูลใหม่ และใส่ข้อมูลตั้งต้นเมื่อชีตยังว่าง */
function ensureDatasets_() {
  const out = [];
  ['farm', 'pest', 'lc', 'lcnet', 'lctype'].forEach(function (name) {
    const d = datasets_()[name];
    const heads = dsHeaders_(d);
    const sh = ensureSheet_(d.sheet, heads);
    d.fields.forEach(function (f, i) { if (f.type === 'code' || f.type === 'phone' || f.key === 'moo') sh.getRange(1, i + 1, Math.max(sh.getMaxRows ? sh.getMaxRows() : 1000, 2), 1).setNumberFormat('@'); });
    if (sh.getLastRow() >= 2) { out.push('PASS: ชีต ' + d.sheet + ' พร้อม (' + (sh.getLastRow() - 1) + ' แถว)'); return; }
    const seed = dsSeed_(name);
    if (!seed || !seed.length) { out.push('INFO: ชีต ' + d.sheet + ' ว่าง'); return; }
    const ctx = { head: heads, idx: {} };
    heads.forEach(function (h, i) { ctx.idx[h] = i; });
    const rows = seed.map(function (src) {
      const o = {};
      d.fields.forEach(function (f) { o[f.key] = dsCast_(f, src[f.key]); });
      return dsRowOut_(d, ctx, o, null, 'seed');
    });
    sh.getRange(2, 1, rows.length, heads.length).setValues(rows);
    out.push('PASS: ใส่ข้อมูลตั้งต้น ' + d.label + ' ' + rows.length + ' แถว');
  });
  return out;
}

// ===================== FarmSeed.gs =====================
/** ข้อมูลตั้งต้น กลุ่มแปลงใหญ่ และ ศพก. (สร้างโดย tests/build-farm-lc-seed.js ไม่มีข้อมูลส่วนบุคคล) */
const FARM_SEED = [{"id":"F85","name":"แปลงใหญ่มันสำปะหลัง หมู่ 4 ตำบลทรงธรรม อำเภอเมืองกำแพงเพชร จังหวัดกำแพงเพชร","year_start":2559,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"4,6,10","tambon":"ทรงธรรม","district":"เมืองกำแพงเพชร","district_code":"6201","members":100,"member_area":2774.75,"plot_farmers":101,"plots":158,"plot_area":2774.75,"cost_before":4427,"cost_after":3850,"yield_before":4260,"yield_after":5112,"gap":false,"organic":false,"grouping":"สหกรณ์","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":16.519864,"lng":99.433712,"coord_note":"แปลงจาก UTM 47N (546282, 1826491)"},{"id":"F305","name":"แปลงใหญ่ข้าว หมู่ 8 ตำบลมหาชัย อำเภอไทรงาม จังหวัดกำแพงเพชร","year_start":2559,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"8","tambon":"มหาชัย","district":"ไทรงาม","district_code":"6202","members":57,"member_area":2728.75,"plot_farmers":63,"plots":178,"plot_area":3140.5,"cost_before":2881,"cost_after":2304,"yield_before":850,"yield_after":1020,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย, รวบรวมขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย","lat":16.490118,"lng":99.773759,"coord_note":"แปลงจาก UTM 47N (582583, 1823309)"},{"id":"F306","name":"แปลงใหญ่โคเนื้อ หมู่ 11 ตำบลหินดาต อำเภอปางศิลาทอง จังหวัดกำแพงเพชร","year_start":2559,"group":"ปศุสัตว์","commodity":"โคเนื้อ","commodity2":"หญ้าเนเปียร์","moo":"11","tambon":"หินดาต","district":"ปางศิลาทอง","district_code":"6209","members":289,"member_area":1901.75,"plot_farmers":287,"plots":81,"plot_area":3110.25,"cost_before":47350,"cost_after":37880,"yield_before":320,"yield_after":384,"gap":true,"organic":false,"grouping":"สหกรณ์","market_before":"","market_after":"","lat":16.125846,"lng":99.456945,"coord_note":"แปลงจาก UTM 47N (548859, 1782910)"},{"id":"F307","name":"แปลงใหญ่ข้าว หมู่ 3 ตำบลวังบัว อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2559,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"3","tambon":"วังบัว","district":"คลองขลุง","district_code":"6205","members":38,"member_area":2407.5,"plot_farmers":50,"plots":176,"plot_area":3053,"cost_before":3980,"cost_after":3250,"yield_before":800,"yield_after":900,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"รวบรวมขาย","lat":16.317281,"lng":99.705089,"coord_note":"แปลงจาก UTM 47N (575320, 1804162)"},{"id":"F308","name":"แปลงใหญ่ข้าว หมู่ 10 ตำบลสระแก้ว อำเภอเมืองกำแพงเพชร จังหวัดกำแพงเพชร","year_start":2559,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"4,7,10,12","tambon":"สระแก้ว","district":"เมืองกำแพงเพชร","district_code":"6201","members":197,"member_area":7139,"plot_farmers":196,"plots":360,"plot_area":7103.75,"cost_before":4300,"cost_after":3120,"yield_before":800,"yield_after":900,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"","market_after":"","lat":16.540207,"lng":99.587408,"coord_note":"แปลงจาก UTM 47N (562677, 1828783)"},{"id":"F313","name":"แปลงใหญ่มันสำปะหลัง หมู่ 5 ตำบลบ่อถ้ำ อำเภอขาณุวรลักษบุรี จังหวัดกำแพงเพชร","year_start":2559,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"5","tambon":"บ่อถ้ำ","district":"ขาณุวรลักษบุรี","district_code":"6204","members":484,"member_area":12028,"plot_farmers":486,"plots":610,"plot_area":11842,"cost_before":3990,"cost_after":3590,"yield_before":3700,"yield_after":5000,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย","lat":15.941813,"lng":99.686477,"coord_note":"แปลงจาก UTM 47N (573470, 1762620)"},{"id":"F314","name":"แปลงใหญ่ข้าว หมู่ 2 ตำบลประชาสุขสันต์ อำเภอลานกระบือ จังหวัดกำแพงเพชร","year_start":2559,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"2","tambon":"ประชาสุขสันต์","district":"ลานกระบือ","district_code":"6207","members":46,"member_area":2281,"plot_farmers":52,"plots":131,"plot_area":2878,"cost_before":4800,"cost_after":4300,"yield_before":750,"yield_after":800,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย","lat":16.550182,"lng":99.999565,"coord_note":"แปลงจาก UTM 47N (606652, 1830060)"},{"id":"F315","name":"แปลงใหญ่ข้าว หมู่ 14 ตำบลเขาคีริส อำเภอพรานกระต่าย จังหวัดกำแพงเพชร","year_start":2559,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"14","tambon":"เขาคีริส","district":"พรานกระต่าย","district_code":"6206","members":29,"member_area":2507.75,"plot_farmers":56,"plots":228,"plot_area":5388.25,"cost_before":5646,"cost_after":3480,"yield_before":800,"yield_after":900,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย, ซื้อขายแบบมีข้อตกลง","lat":16.548058,"lng":99.697422,"coord_note":"แปลงจาก UTM 47N (574413, 1829689)"},{"id":"F316","name":"แปลงใหญ่ข้าว หมู่ 4 ตำบลห้วยยั้ง อำเภอพรานกระต่าย จังหวัดกำแพงเพชร","year_start":2559,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"4","tambon":"ห้วยยั้ง","district":"พรานกระต่าย","district_code":"6206","members":91,"member_area":3663,"plot_farmers":122,"plots":320,"plot_area":4766.25,"cost_before":3220,"cost_after":2454,"yield_before":500,"yield_after":600,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย, รวบรวมขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย, ซื้อขายแบบมีข้อตกลง","lat":16.739397,"lng":99.648891,"coord_note":"แปลงจาก UTM 47N (569166, 1850839)"},{"id":"F319","name":"แปลงใหญ่ผัก หมู่ 9 ตำบลเขาคีริส อำเภอพรานกระต่าย จังหวัดกำแพงเพชร","year_start":2559,"group":"ผัก/สมุนไพร","commodity":"ผัก/สมุนไพร","commodity2":"ผัก/สมุนไพร","moo":"9,15","tambon":"เขาคีริส","district":"พรานกระต่าย","district_code":"6206","members":47,"member_area":295,"plot_farmers":105,"plots":179,"plot_area":1991,"cost_before":4669,"cost_after":3735,"yield_before":1485,"yield_after":1782,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"","market_after":"","lat":16.630472,"lng":99.715327,"coord_note":"แปลงจาก UTM 47N (576291, 1838813)"},{"id":"F320","name":"แปลงใหญ่ข้าว หมู่ 4 ตำบลถ้ำกระต่ายทอง อำเภอพรานกระต่าย จังหวัดกำแพงเพชร","year_start":2559,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"4","tambon":"ถ้ำกระต่ายทอง","district":"พรานกระต่าย","district_code":"6206","members":71,"member_area":2020.25,"plot_farmers":73,"plots":121,"plot_area":2400.5,"cost_before":3550,"cost_after":2700,"yield_before":500,"yield_after":600,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย, ซื้อขายแบบมีข้อตกลง","lat":16.658763,"lng":99.589241,"coord_note":"แปลงจาก UTM 47N (562834, 1841899)"},{"id":"F321","name":"แปลงใหญ่อ้อย หมู่ 9 ตำบลนครชุม อำเภอเมืองกำแพงเพชร จังหวัดกำแพงเพชร","year_start":2559,"group":"พืชไร่","commodity":"อ้อยโรงงาน","commodity2":"อ้อยโรงงาน","moo":"8,9","tambon":"นครชุม","district":"เมืองกำแพงเพชร","district_code":"6201","members":73,"member_area":1064,"plot_farmers":67,"plots":102,"plot_area":1338,"cost_before":11990,"cost_after":9592,"yield_before":12300,"yield_after":14760,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":16.447042,"lng":99.501388,"coord_note":"แปลงจาก UTM 47N (553524, 1818452)"},{"id":"F676","name":"แปลงใหญ่กล้วยไข่ หมู่ 7 ตำบลท่าพุทรา อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2560,"group":"ไม้ผล","commodity":"กล้วยไข่","commodity2":"กล้วยไข่","moo":"7","tambon":"ท่าพุทรา","district":"คลองขลุง","district_code":"6205","members":57,"member_area":322.75,"plot_farmers":55,"plots":92,"plot_area":427.75,"cost_before":12550,"cost_after":10040,"yield_before":1600,"yield_after":1920,"gap":true,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"","market_after":"","lat":16.258282,"lng":99.696325,"coord_note":"แปลงจาก UTM 47N (574406, 1797632)"},{"id":"F1085","name":"แปลงใหญ่มันสำปะหลัง หมู่ 9 ตำบลคลองน้ำไหล อำเภอคลองลาน จังหวัดกำแพงเพชร","year_start":2560,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"9,28","tambon":"คลองน้ำไหล","district":"คลองลาน","district_code":"6203","members":37,"member_area":1955.25,"plot_farmers":82,"plots":148,"plot_area":1983.75,"cost_before":5625,"cost_after":4500,"yield_before":3000,"yield_after":3600,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"","market_after":"","lat":16.176869,"lng":99.323291,"coord_note":"แปลงจาก UTM 47N (534559, 1788527)"},{"id":"F1086","name":"แปลงใหญ่มันสำปะหลัง หมู่ 6 ตำบลปางตาไว อำเภอปางศิลาทอง จังหวัดกำแพงเพชร","year_start":2560,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"ุ6","tambon":"ปางตาไว","district":"ปางศิลาทอง","district_code":"6209","members":57,"member_area":1244.25,"plot_farmers":57,"plots":69,"plot_area":1409.5,"cost_before":4250,"cost_after":3400,"yield_before":3500,"yield_after":4200,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":16.063477,"lng":99.363581,"coord_note":"แปลงจาก UTM 47N (538888, 1775991); พิกัดตกในอำเภอคลองลาน"},{"id":"F1087","name":"แปลงใหญ่มันสำปะหลัง หมู่ 4 ตำบลเพชรชมภู อำเภอโกสัมพีนคร จังหวัดกำแพงเพชร","year_start":2560,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"4","tambon":"เพชรชมภู","district":"โกสัมพีนคร","district_code":"6211","members":37,"member_area":1955.25,"plot_farmers":44,"plots":144,"plot_area":2217.5,"cost_before":4800,"cost_after":4320,"yield_before":3000,"yield_after":4000,"gap":true,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":16.552165,"lng":99.386715,"coord_note":"แปลงจาก UTM 47N (541260, 1830054)"},{"id":"F1088","name":"แปลงใหญ่กล้วยไข่ หมู่ 2 ตำบลสระแก้ว อำเภอเมืองกำแพงเพชร จังหวัดกำแพงเพชร","year_start":2560,"group":"ไม้ผล","commodity":"กล้วยไข่","commodity2":"กล้วยไข่","moo":"2","tambon":"สระแก้ว","district":"เมืองกำแพงเพชร","district_code":"6201","members":74,"member_area":278,"plot_farmers":74,"plots":82,"plot_area":1410.75,"cost_before":13780,"cost_after":11024,"yield_before":1500,"yield_after":2000,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"รวบรวมขาย","market_after":"รวบรวมขาย, ซื้อขายแบบมีข้อตกลง","lat":16.509691,"lng":99.580129,"coord_note":"แปลงจาก UTM 47N (561910, 1825405)"},{"id":"F1089","name":"แปลงใหญ่กล้วยไข่ หมู่ 2 ตำบลโป่งน้ำร้อน อำเภอคลองลาน จังหวัดกำแพงเพชร","year_start":2560,"group":"ไม้ผล","commodity":"กล้วยไข่","commodity2":"กล้วยไข่","moo":"2","tambon":"โป่งน้ำร้อน","district":"คลองลาน","district_code":"6203","members":36,"member_area":497,"plot_farmers":34,"plots":64,"plot_area":754.75,"cost_before":13575,"cost_after":10860,"yield_before":2000,"yield_after":2400,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"","market_after":"","lat":16.333418,"lng":99.309907,"coord_note":"แปลงจาก UTM 47N (533102, 1805842)"},{"id":"F3042","name":"แปลงใหญ่ข้าว หมู่ 12 ตำบลบึงสามัคคี อำเภอบึงสามัคคี จังหวัดกำแพงเพชร","year_start":2560,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"12","tambon":"บึงสามัคคี","district":"บึงสามัคคี","district_code":"6210","members":31,"member_area":775.5,"plot_farmers":34,"plots":68,"plot_area":1192,"cost_before":3800,"cost_after":2950,"yield_before":800,"yield_after":950,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย","lat":16.312358,"lng":100.005697,"coord_note":"แปลงจาก UTM 47N (607437, 1803752)"},{"id":"F3043","name":"แปลงใหญ่ข้าว หมู่ 2 ตำบลระหาน อำเภอบึงสามัคคี จังหวัดกำแพงเพชร","year_start":2560,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"2","tambon":"ระหาน","district":"บึงสามัคคี","district_code":"6210","members":45,"member_area":778,"plot_farmers":49,"plots":104,"plot_area":1402.5,"cost_before":3600,"cost_after":3100,"yield_before":850,"yield_after":1000,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย","lat":16.149349,"lng":99.97222,"coord_note":"แปลงจาก UTM 47N (603946, 1785701)"},{"id":"F3044","name":"แปลงใหญ่ข้าว หมู่ 2 ตำบลวังชะโอน อำเภอบึงสามัคคี จังหวัดกำแพงเพชร","year_start":2560,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"2","tambon":"วังชะโอน","district":"บึงสามัคคี","district_code":"6210","members":30,"member_area":809.75,"plot_farmers":34,"plots":65,"plot_area":1141.75,"cost_before":4700,"cost_after":3700,"yield_before":900,"yield_after":1000,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":16.173109,"lng":100.008235,"coord_note":"แปลงจาก UTM 47N (607784, 1788348)"},{"id":"F3045","name":"แปลงใหญ่ข้าว หมู่ 2 ตำบลหนองหลวง อำเภอลานกระบือ จังหวัดกำแพงเพชร","year_start":2560,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"2","tambon":"หนองหลวง","district":"ลานกระบือ","district_code":"6207","members":47,"member_area":728.5,"plot_farmers":47,"plots":53,"plot_area":822.25,"cost_before":4300,"cost_after":3440,"yield_before":850,"yield_after":1000,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย","lat":16.556336,"lng":99.917199,"coord_note":"แปลงจาก UTM 47N (597860, 1830699)"},{"id":"F3046","name":"แปลงใหญ่ข้าว หมู่ 6 ตำบลโพธิ์ทอง อำเภอปางศิลาทอง จังหวัดกำแพงเพชร","year_start":2560,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"6","tambon":"โพธิ์ทอง","district":"ปางศิลาทอง","district_code":"6209","members":42,"member_area":1099.75,"plot_farmers":42,"plots":50,"plot_area":1099.75,"cost_before":4200,"cost_after":3890,"yield_before":800,"yield_after":900,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"รวบรวมขาย","lat":16.134614,"lng":99.531654,"coord_note":"แปลงจาก UTM 47N (556845, 1783899)"},{"id":"F3055","name":"แปลงใหญ่ผัก หมู่ 7 ตำบลระหาน อำเภอบึงสามัคคี จังหวัดกำแพงเพชร","year_start":2561,"group":"ผัก/สมุนไพร","commodity":"ผัก/สมุนไพร","commodity2":"ผัก/สมุนไพร","moo":"7","tambon":"ระหาน","district":"บึงสามัคคี","district_code":"6210","members":33,"member_area":230,"plot_farmers":30,"plots":49,"plot_area":586.5,"cost_before":6960,"cost_after":6400,"yield_before":3640,"yield_after":5460,"gap":true,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย, รวบรวมขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย","lat":16.15974,"lng":99.949188,"coord_note":"แปลงจาก UTM 47N (601478, 1786839)"},{"id":"F3056","name":"แปลงใหญ่ผัก หมู่ 8 ตำบลวังหามแห อำเภอขาณุวรลักษบุรี จังหวัดกำแพงเพชร","year_start":2561,"group":"ผัก/สมุนไพร","commodity":"ผัก/สมุนไพร","commodity2":"ผัก/สมุนไพร","moo":"8","tambon":"วังหามแห","district":"ขาณุวรลักษบุรี","district_code":"6204","members":29,"member_area":246,"plot_farmers":29,"plots":31,"plot_area":775.75,"cost_before":5419,"cost_after":5561,"yield_before":1000,"yield_after":1500,"gap":true,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย, ซื้อขายแบบมีข้อตกลง","lat":16.038704,"lng":99.575569,"coord_note":"แปลงจาก UTM 47N (561570, 1773302)"},{"id":"F3057","name":"แปลงใหญ่ยางพารา หมู่ 12 ตำบลไตรตรึงษ์ อำเภอเมืองกำแพงเพชร จังหวัดกำแพงเพชร","year_start":2561,"group":"ไม้ยืนต้น","commodity":"ยางพารา","commodity2":"ยางพารา","moo":"12","tambon":"ไตรตรึงษ์","district":"เมืองกำแพงเพชร","district_code":"6201","members":42,"member_area":991,"plot_farmers":41,"plots":46,"plot_area":991,"cost_before":6500,"cost_after":5800,"yield_before":180,"yield_after":200,"gap":false,"organic":false,"grouping":"สหกรณ์","market_before":"","market_after":"","lat":16.269356,"lng":99.530687,"coord_note":"แปลงจาก UTM 47N (556703, 1798804); พิกัดตกในอำเภอคลองขลุง"},{"id":"F3058","name":"แปลงใหญ่มันสำปะหลัง หมู่ 9 ตำบลสักงาม อำเภอคลองลาน จังหวัดกำแพงเพชร","year_start":2561,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"9","tambon":"สักงาม","district":"คลองลาน","district_code":"6203","members":30,"member_area":546.75,"plot_farmers":54,"plots":94,"plot_area":1185.5,"cost_before":3300,"cost_after":3000,"yield_before":3250,"yield_after":3575,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F3059","name":"แปลงใหญ่มันสำปะหลัง หมู่ 13 ตำบลคลองน้ำไหล อำเภอคลองลาน จังหวัดกำแพงเพชร","year_start":2561,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"13","tambon":"คลองน้ำไหล","district":"คลองลาน","district_code":"6203","members":33,"member_area":1126,"plot_farmers":52,"plots":80,"plot_area":1939.25,"cost_before":3850,"cost_after":3500,"yield_before":5000,"yield_after":5500,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย, ซื้อขายแบบมีข้อตกลง","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F4007","name":"แปลงใหญ่ข้าว หมู่ 4 ตำบลท่าพุทรา อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2561,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"4","tambon":"ท่าพุทรา","district":"คลองขลุง","district_code":"6205","members":42,"member_area":1697.25,"plot_farmers":45,"plots":123,"plot_area":1912,"cost_before":3256,"cost_after":3054,"yield_before":700,"yield_after":800,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"รวบรวมขาย","lat":16.273627,"lng":99.68075,"coord_note":"แปลงจาก UTM 47N (572736, 1799324)"},{"id":"F4008","name":"แปลงใหญ่ข้าว หมู่ 1 ตำบลนิคมทุ่งโพธิ์ทะเล อำเภอเมืองกำแพงเพชร จังหวัดกำแพงเพชร","year_start":2561,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"1","tambon":"นิคมทุ่งโพธิ์ทะเล","district":"เมืองกำแพงเพชร","district_code":"6201","members":83,"member_area":1851.5,"plot_farmers":83,"plots":87,"plot_area":1851.5,"cost_before":3560,"cost_after":3295,"yield_before":800,"yield_after":834,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย","lat":16.47092,"lng":99.68239,"coord_note":"แปลงจาก UTM 47N (572838, 1821150)"},{"id":"F4009","name":"แปลงใหญ่ข้าว หมู่ 2 ตำบลไทรงาม อำเภอไทรงาม จังหวัดกำแพงเพชร","year_start":2561,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"2","tambon":"ไทรงาม","district":"ไทรงาม","district_code":"6202","members":34,"member_area":1474.25,"plot_farmers":34,"plots":66,"plot_area":1533.25,"cost_before":4550,"cost_after":3500,"yield_before":700,"yield_after":800,"gap":true,"organic":true,"grouping":"วิสาหกิจชุมชน","market_before":"","market_after":"","lat":16.503669,"lng":99.895645,"coord_note":"แปลงจาก UTM 47N (595586, 1824862)"},{"id":"F4010","name":"แปลงใหญ่ข้าว หมู่ 9 ตำบลทุ่งทอง อำเภอทรายทองวัฒนา จังหวัดกำแพงเพชร","year_start":2561,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"9","tambon":"ทุ่งทอง","district":"ทรายทองวัฒนา","district_code":"6208","members":40,"member_area":1593,"plot_farmers":39,"plots":97,"plot_area":1593,"cost_before":4200,"cost_after":3850,"yield_before":750,"yield_after":800,"gap":false,"organic":false,"grouping":"ไม่มีการรวมกลุ่ม","market_before":"ต่างคนต่างขาย","market_after":"รวบรวมขาย","lat":16.348104,"lng":99.893875,"coord_note":"แปลงจาก UTM 47N (595473, 1807651)"},{"id":"F4011","name":"แปลงใหญ่ข้าว หมู่ 9 ตำบลพานทอง อำเภอไทรงาม จังหวัดกำแพงเพชร","year_start":2561,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"9","tambon":"พานทอง","district":"ไทรงาม","district_code":"6202","members":44,"member_area":826.5,"plot_farmers":44,"plots":44,"plot_area":826.5,"cost_before":2254,"cost_after":2054,"yield_before":700,"yield_after":750,"gap":true,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย, รวบรวมขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย, ซื้อขายแบบมีข้อตกลง","lat":16.360217,"lng":99.834328,"coord_note":"แปลงจาก UTM 47N (589107, 1808964)"},{"id":"F4012","name":"แปลงใหญ่ข้าว หมู่ 7 ตำบลหัวถนน อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2561,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"7","tambon":"หัวถนน","district":"คลองขลุง","district_code":"6205","members":37,"member_area":810.25,"plot_farmers":38,"plots":42,"plot_area":815.25,"cost_before":4200,"cost_after":3850,"yield_before":750,"yield_after":800,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"รวบรวมขาย","lat":16.286892,"lng":99.602297,"coord_note":"แปลงจาก UTM 47N (564349, 1800765)"},{"id":"F4013","name":"แปลงใหญ่ข้าว หมู่ 13 ตำบลหินดาต อำเภอปางศิลาทอง จังหวัดกำแพงเพชร","year_start":2561,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"13","tambon":"หินดาต","district":"ปางศิลาทอง","district_code":"6209","members":34,"member_area":1174.25,"plot_farmers":40,"plots":65,"plot_area":1220.5,"cost_before":3857,"cost_after":3460,"yield_before":800,"yield_after":850,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"รวบรวมขาย","lat":16.089699,"lng":99.455226,"coord_note":"แปลงจาก UTM 47N (548684, 1778911)"},{"id":"F4014","name":"แปลงใหญ่ข้าว หมู่ 7 ตำบลระหาน อำเภอบึงสามัคคี จังหวัดกำแพงเพชร","year_start":2561,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"7","tambon":"บึงสามัคคี","district":"บึงสามัคคี","district_code":"6210","members":30,"member_area":748.75,"plot_farmers":41,"plots":69,"plot_area":1168.5,"cost_before":4985,"cost_after":4542,"yield_before":800,"yield_after":850,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย","lat":16.199605,"lng":99.948789,"coord_note":"แปลงจาก UTM 47N (601415, 1791249)"},{"id":"F4015","name":"แปลงใหญ่ข้าว หมู่ 11 ตำบลท่าขุนราม อำเภอเมืองกำแพงเพชร จังหวัดกำแพงเพชร","year_start":2561,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"11","tambon":"ท่าขุนราม","district":"เมืองกำแพงเพชร","district_code":"6201","members":34,"member_area":419.5,"plot_farmers":48,"plots":76,"plot_area":656,"cost_before":3980,"cost_after":3860,"yield_before":700,"yield_after":800,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"รวบรวมขาย","lat":16.447069,"lng":99.45769,"coord_note":"แปลงจาก UTM 47N (548859, 1818444)"},{"id":"F4016","name":"แปลงใหญ่โคเนื้อ หมู่ 9 ตำบลถ้ำกระต่ายทอง อำเภอพรานกระต่าย จังหวัดกำแพงเพชร","year_start":2561,"group":"ปศุสัตว์","commodity":"โคเนื้อ","commodity2":"โคเนื้อ","moo":"9","tambon":"ถ้ำกระต่ายทอง","district":"พรานกระต่าย","district_code":"6206","members":32,"member_area":434,"plot_farmers":32,"plots":0,"plot_area":434,"cost_before":49650,"cost_after":48660,"yield_before":305,"yield_after":368,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"","market_after":"","lat":16.720218,"lng":99.527133,"coord_note":"แปลงจาก UTM 47N (556193, 1848679)"},{"id":"F4017","name":"แปลงใหญ่ปลาช่อน หมู่ 6 ตำบลดอนแตง อำเภอขาณุวรลักษบุรี จังหวัดกำแพงเพชร","year_start":2561,"group":"ประมง","commodity":"ปลาช่อน","commodity2":"ปลาช่อน","moo":"6","tambon":"ดอนแตง","district":"ขาณุวรลักษบุรี","district_code":"6204","members":43,"member_area":30.01,"plot_farmers":43,"plots":0,"plot_area":30.01,"cost_before":60,"cost_after":50,"yield_before":70,"yield_after":80,"gap":true,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"","market_after":"","lat":16.012961,"lng":99.752912,"coord_note":"แปลงจาก UTM 47N (580552, 1770515)"},{"id":"F5373","name":"แปลงใหญ่มะนาว หมู่ 11 ตำบลนิคมทุ่งโพธิ์ทะเล อำเภอเมืองกำแพงเพชร จังหวัดกำแพงเพชร","year_start":2561,"group":"ไม้ผล","commodity":"มะนาว","commodity2":"มะนาว","moo":"11","tambon":"นิคมทุ่งโพธิ์ทะเล","district":"เมืองกำแพงเพชร","district_code":"6201","members":21,"member_area":330,"plot_farmers":22,"plots":43,"plot_area":583.75,"cost_before":1500,"cost_after":1350,"yield_before":900,"yield_after":990,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"รวบรวมขาย","market_after":"รวบรวมขาย","lat":16.507114,"lng":99.673756,"coord_note":"แปลงจาก UTM 47N (571903, 1825151)"},{"id":"F5374","name":"แปลงใหญ่มะนาว หมู่ 13 ตำบลนิคมทุ่งโพธิ์ทะเล อำเภอเมืองกำแพงเพชร จังหวัดกำแพงเพชร","year_start":2561,"group":"ไม้ผล","commodity":"มะนาว","commodity2":"มะนาว","moo":"13","tambon":"นิคมทุ่งโพธิ์ทะเล","district":"เมืองกำแพงเพชร","district_code":"6201","members":27,"member_area":516,"plot_farmers":29,"plots":43,"plot_area":571,"cost_before":3500,"cost_after":3150,"yield_before":875,"yield_after":960,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"รวบรวมขาย","market_after":"รวบรวมขาย","lat":16.551945,"lng":99.675168,"coord_note":"แปลงจาก UTM 47N (572037, 1830111)"},{"id":"F5375","name":"แปลงใหญ่หม่อนไหม หมู่ 3 ตำบลสักงาม อำเภอคลองลาน จังหวัดกำแพงเพชร","year_start":2561,"group":"หม่อนไหม","commodity":"หม่อนไหม","commodity2":"หม่อนไหม","moo":"3","tambon":"สักงาม","district":"คลองลาน","district_code":"6203","members":30,"member_area":355.25,"plot_farmers":27,"plots":34,"plot_area":421,"cost_before":4500,"cost_after":3200,"yield_before":55,"yield_after":65,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย, ซื้อขายแบบมีข้อตกลง","market_after":"ต่างคนต่างขาย, รวบรวมขาย, ซื้อขายแบบมีข้อตกลง","lat":16.269568,"lng":99.316395,"coord_note":"แปลงจาก UTM 47N (533806, 1798780)"},{"id":"F5376","name":"แปลงใหญ่ข้าว หมู่ 1 ตำบลหนองไม้กอง อำเภอไทรงาม จังหวัดกำแพงเพชร","year_start":2563,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"1","tambon":"หนองไม้กอง","district":"ไทรงาม","district_code":"6202","members":37,"member_area":823.75,"plot_farmers":37,"plots":40,"plot_area":781.75,"cost_before":3500,"cost_after":2800,"yield_before":500,"yield_after":600,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย, รวบรวมขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย","lat":16.496424,"lng":99.955854,"coord_note":"แปลงจาก UTM 47N (602016, 1824090)"},{"id":"F6544","name":"แปลงใหญ่มันสำปะหลัง หมู่ 15 ตำบลวังไทร อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2562,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"15","tambon":"วังไทร","district":"คลองขลุง","district_code":"6205","members":55,"member_area":1314.25,"plot_farmers":55,"plots":83,"plot_area":1314.25,"cost_before":4300,"cost_after":3870,"yield_before":2000,"yield_after":3500,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"","market_after":"","lat":16.204174,"lng":99.560815,"coord_note":"แปลงจาก UTM 47N (559942, 1791602)"},{"id":"F6545","name":"แปลงใหญ่ข้าว หมู่ 10 ตำบลระหาน อำเภอบึงสามัคคี จังหวัดกำแพงเพชร","year_start":2562,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"10","tambon":"ระหาน","district":"บึงสามัคคี","district_code":"6210","members":32,"member_area":802.25,"plot_farmers":33,"plots":53,"plot_area":843.25,"cost_before":3700,"cost_after":2960,"yield_before":800,"yield_after":960,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย","lat":16.144934,"lng":99.998637,"coord_note":"แปลงจาก UTM 47N (606773, 1785226)"},{"id":"F6546","name":"แปลงใหญ่ข้าว หมู่ 2 ตำบลนิคมทุ่งโพธิ์ทะเล อำเภอเมืองกำแพงเพชร จังหวัดกำแพงเพชร","year_start":2562,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"2","tambon":"นิคมทุ่งโพธิ์ทะเล","district":"เมืองกำแพงเพชร","district_code":"6201","members":43,"member_area":650.5,"plot_farmers":30,"plots":31,"plot_area":650.5,"cost_before":4920,"cost_after":3936,"yield_before":800,"yield_after":960,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"รวบรวมขาย","lat":16.471445,"lng":99.690383,"coord_note":"แปลงจาก UTM 47N (573691, 1821211)"},{"id":"F6547","name":"แปลงใหญ่ข้าว หมู่ 8 ตำบลลานดอกไม้ตก อำเภอโกสัมพีนคร จังหวัดกำแพงเพชร","year_start":2562,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"8","tambon":"ลานดอกไม้ตก","district":"โกสัมพีนคร","district_code":"6211","members":34,"member_area":495.25,"plot_farmers":35,"plots":56,"plot_area":510.5,"cost_before":4500,"cost_after":3600,"yield_before":800,"yield_after":960,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"รวบรวมขาย, ซื้อขายแบบมีข้อตกลง","lat":16.582658,"lng":99.452891,"coord_note":"แปลงจาก UTM 47N (548313, 1833442)"},{"id":"F6548","name":"แปลงใหญ่ข้าว หมู่ 7 ตำบลโค้งไผ่ อำเภอขาณุวรลักษบุรี จังหวัดกำแพงเพชร","year_start":2562,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"7","tambon":"โค้งไผ่","district":"ขาณุวรลักษบุรี","district_code":"6204","members":37,"member_area":2652.75,"plot_farmers":34,"plots":102,"plot_area":2652.75,"cost_before":3500,"cost_after":2800,"yield_before":800,"yield_after":960,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย","lat":16.11269,"lng":99.613308,"coord_note":"แปลงจาก UTM 47N (565583, 1781498)"},{"id":"F6549","name":"แปลงใหญ่ข้าว หมู่ 2 ตำบลช่องลม อำเภอลานกระบือ จังหวัดกำแพงเพชร","year_start":2562,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"2","tambon":"ช่องลม","district":"ลานกระบือ","district_code":"6207","members":51,"member_area":1167.75,"plot_farmers":51,"plots":81,"plot_area":1565,"cost_before":4700,"cost_after":3760,"yield_before":800,"yield_after":960,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย","lat":16.556418,"lng":99.917031,"coord_note":"แปลงจาก UTM 47N (597842, 1830708)"},{"id":"F6588","name":"แปลงใหญ่มันสำปะหลัง หมู่ 12 ตำบลวังไทร อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2562,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"12","tambon":"วังไทร","district":"คลองขลุง","district_code":"6205","members":73,"member_area":1357.25,"plot_farmers":73,"plots":92,"plot_area":1357.25,"cost_before":4200,"cost_after":3400,"yield_before":3600,"yield_after":4200,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":16.196118,"lng":99.57127,"coord_note":"แปลงจาก UTM 47N (561062, 1790714)"},{"id":"F6589","name":"แปลงใหญ่ข้าว 2 หมู่ 7 ตำบลระหาน อำเภอบึงสามัคคี จังหวัดกำแพงเพชร","year_start":2562,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"7","tambon":"ระหาน","district":"บึงสามัคคี","district_code":"6210","members":32,"member_area":1008.75,"plot_farmers":32,"plots":73,"plot_area":1020.5,"cost_before":4220,"cost_after":3800,"yield_before":800,"yield_after":960,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย","lat":16.159785,"lng":99.94916,"coord_note":"แปลงจาก UTM 47N (601475, 1786844)"},{"id":"F8149","name":"แปลงใหญ่ยางพารา หมู่ 10 ตำบลวังไทร อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2562,"group":"ไม้ยืนต้น","commodity":"ยางพารา","commodity2":"ยางพารา","moo":"10","tambon":"วังไทร","district":"คลองขลุง","district_code":"6205","members":33,"member_area":685.5,"plot_farmers":33,"plots":35,"plot_area":685.5,"cost_before":6400,"cost_after":5120,"yield_before":180,"yield_after":200,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"","market_after":"","lat":16.163196,"lng":99.51784,"coord_note":"แปลงจาก UTM 47N (555360, 1787057)"},{"id":"F8152","name":"แปลงใหญ่ข้าว หมู่ 3 ตำบลวังแขม อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2563,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"3","tambon":"วังแขม","district":"คลองขลุง","district_code":"6205","members":32,"member_area":1104.5,"plot_farmers":36,"plots":54,"plot_area":1168.5,"cost_before":4200,"cost_after":3850,"yield_before":750,"yield_after":800,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"","market_after":"ต่างคนต่างขาย","lat":16.183465,"lng":99.781085,"coord_note":"แปลงจาก UTM 47N (583495, 1789388)"},{"id":"F8154","name":"แปลงใหญ่ข้าว หมู่ 13 ตำบลวังชะโอน อำเภอบึงสามัคคี จังหวัดกำแพงเพชร","year_start":2563,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"13","tambon":"วังชะโอน","district":"บึงสามัคคี","district_code":"6210","members":40,"member_area":1201.75,"plot_farmers":40,"plots":67,"plot_area":1201.75,"cost_before":4700,"cost_after":3700,"yield_before":900,"yield_after":1000,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":16.198176,"lng":100.002132,"coord_note":"แปลงจาก UTM 47N (607118, 1791118)"},{"id":"F8792","name":"แปลงใหญ่มันสำปะหลัง หมู่ 14 ตำบลอ่างทอง อำเภอเมืองกำแพงเพชร จังหวัดกำแพงเพชร","year_start":2563,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"14","tambon":"อ่างทอง","district":"เมืองกำแพงเพชร","district_code":"6201","members":34,"member_area":655,"plot_farmers":43,"plots":43,"plot_area":844.75,"cost_before":6128,"cost_after":4902,"yield_before":2500,"yield_after":5000,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":16.18214,"lng":99.496542,"coord_note":"แปลงจาก UTM 47N (553078, 1789147); พิกัดตกในอำเภอคลองขลุง"},{"id":"F8795","name":"แปลงใหญ่ข้าว หมู่ 2 ตำบลเกาะตาล อำเภอขาณุวรลักษบุรี จังหวัดกำแพงเพชร","year_start":2563,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"2","tambon":"เกาะตาล","district":"ขาณุวรลักษบุรี","district_code":"6204","members":67,"member_area":2180,"plot_farmers":71,"plots":117,"plot_area":2180,"cost_before":3500,"cost_after":2800,"yield_before":800,"yield_after":960,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F9560","name":"แปลงใหญ่ยางพารา หมู่ 15 ตำบลคลองน้ำไหล อำเภอคลองลาน จังหวัดกำแพงเพชร","year_start":2563,"group":"ไม้ยืนต้น","commodity":"ยางพารา","commodity2":"ยางพารา","moo":"15","tambon":"คลองน้ำไหล","district":"คลองลาน","district_code":"6203","members":36,"member_area":824.5,"plot_farmers":36,"plots":36,"plot_area":824.5,"cost_before":6500,"cost_after":5900,"yield_before":190,"yield_after":210,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"รวบรวมขาย, ซื้อขายแบบมีข้อตกลง","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F10077","name":"แปลงใหญ่ข้าว หมู่ 6 ตำบลคณฑี อำเภอเมืองกำแพงเพชร จังหวัดกำแพงเพชร","year_start":2564,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"6","tambon":"คณฑี","district":"เมืองกำแพงเพชร","district_code":"6201","members":35,"member_area":724.25,"plot_farmers":35,"plots":36,"plot_area":724.25,"cost_before":4200,"cost_after":3360,"yield_before":750,"yield_after":900,"gap":true,"organic":false,"grouping":"กลุ่มเกษตรกร(นิติบุคคล)","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":16.373134,"lng":99.713913,"coord_note":"แปลงจาก UTM 47N (576241, 1810344)"},{"id":"F10080","name":"แปลงใหญ่ข้าว หมู่ 19 ตำบลนาบ่อคำ อำเภอเมืองกำแพงเพชร จังหวัดกำแพงเพชร","year_start":2564,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"19","tambon":"นาบ่อคำ","district":"เมืองกำแพงเพชร","district_code":"6201","members":30,"member_area":386.25,"plot_farmers":30,"plots":40,"plot_area":386.25,"cost_before":4100,"cost_after":3280,"yield_before":780,"yield_after":936,"gap":true,"organic":false,"grouping":"กลุ่มเกษตรกร(นิติบุคคล)","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":16.436849,"lng":99.368698,"coord_note":"แปลงจาก UTM 47N (539361, 1817294)"},{"id":"F10081","name":"แปลงใหญ่มันสำปะหลัง หมู่ 2 ตำบลคลองสมบูรณ์ อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2564,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"2","tambon":"คลองสมบูรณ์","district":"คลองขลุง","district_code":"6205","members":60,"member_area":1522.75,"plot_farmers":60,"plots":96,"plot_area":1522.75,"cost_before":3900,"cost_after":3040,"yield_before":3000,"yield_after":3600,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":16.230354,"lng":99.57746,"coord_note":"แปลงจาก UTM 47N (561713, 1794503)"},{"id":"F10082","name":"แปลงใหญ่มันสำปะหลัง หมู่ 3 ตำบลคลองสมบูรณ์ อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2564,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"3","tambon":"คลองสมบูรณ์","district":"คลองขลุง","district_code":"6205","members":40,"member_area":1074.5,"plot_farmers":40,"plots":55,"plot_area":1074.5,"cost_before":4000,"cost_after":3200,"yield_before":3000,"yield_after":3600,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":16.238607,"lng":99.514257,"coord_note":"แปลงจาก UTM 47N (554956, 1795398)"},{"id":"F10083","name":"แปลงใหญ่มันสำปะหลัง หมู่ 4 ตำบลคลองสมบูรณ์ อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2564,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"4","tambon":"คลองสมบูรณ์","district":"คลองขลุง","district_code":"6205","members":71,"member_area":1050.5,"plot_farmers":70,"plots":71,"plot_area":1050.5,"cost_before":4500,"cost_after":3450,"yield_before":3500,"yield_after":4200,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":16.254163,"lng":99.584586,"coord_note":"แปลงจาก UTM 47N (562467, 1797139)"},{"id":"F10087","name":"แปลงใหญ่มันสำปะหลัง หมู่ 6 ตำบลคลองสมบูรณ์ อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2564,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"6","tambon":"คลองสมบูรณ์","district":"คลองขลุง","district_code":"6205","members":43,"member_area":957.25,"plot_farmers":43,"plots":61,"plot_area":957.25,"cost_before":3950,"cost_after":3140,"yield_before":3000,"yield_after":3600,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"","market_after":"","lat":16.221648,"lng":99.499111,"coord_note":"แปลงจาก UTM 47N (553342, 1793518)"},{"id":"F10088","name":"แปลงใหญ่ข้าว หมู่ 3 ตำบลหนองไม้กอง อำเภอไทรงาม จังหวัดกำแพงเพชร","year_start":2564,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"3","tambon":"หนองไม้กอง","district":"ไทรงาม","district_code":"6202","members":30,"member_area":477,"plot_farmers":32,"plots":33,"plot_area":471,"cost_before":4200,"cost_after":3700,"yield_before":750,"yield_after":960,"gap":true,"organic":false,"grouping":"กลุ่มเกษตรกร(นิติบุคคล)","market_before":"","market_after":"","lat":16.501485,"lng":99.950257,"coord_note":"แปลงจาก UTM 47N (601416, 1824647)"},{"id":"F10089","name":"แปลงใหญ่ข้าว หมู่ 3 ตำบลหนองคล้า อำเภอไทรงาม จังหวัดกำแพงเพชร","year_start":2564,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"3","tambon":"หนองคล้า","district":"ไทรงาม","district_code":"6202","members":36,"member_area":452,"plot_farmers":36,"plots":36,"plot_area":452,"cost_before":4200,"cost_after":3360,"yield_before":750,"yield_after":960,"gap":true,"organic":false,"grouping":"กลุ่มเกษตรกร(นิติบุคคล)","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย","lat":16.461426,"lng":99.776446,"coord_note":"แปลงจาก UTM 47N (582882, 1820136)"},{"id":"F10090","name":"แปลงใหญ่ข้าว หมู่ 4 ตำบลวังยาง อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2564,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"4","tambon":"วังยาง","district":"คลองขลุง","district_code":"6205","members":34,"member_area":615.75,"plot_farmers":34,"plots":48,"plot_area":615.75,"cost_before":4300,"cost_after":3500,"yield_before":700,"yield_after":820,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย","lat":16.227244,"lng":99.793093,"coord_note":"แปลงจาก UTM 47N (584760, 1794236)"},{"id":"F10091","name":"แปลงใหญ่ข้าว หมู่ 8 ตำบลวังแขม อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2564,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"8","tambon":"วังแขม","district":"คลองขลุง","district_code":"6205","members":34,"member_area":813,"plot_farmers":37,"plots":57,"plot_area":971.75,"cost_before":4117,"cost_after":3573,"yield_before":760,"yield_after":820,"gap":true,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F11644","name":"แปลงใหญ่ข้าวโพด หมู่ 20 ตำบลนาบ่อคำ อำเภอเมืองกำแพงเพชร จังหวัดกำแพงเพชร","year_start":2565,"group":"พืชไร่","commodity":"ข้าวโพดเลี้ยงสัตว์","commodity2":"ข้าวโพดเลี้ยงสัตว์","moo":"20","tambon":"นาบ่อคำ","district":"เมืองกำแพงเพชร","district_code":"6201","members":46,"member_area":449.75,"plot_farmers":49,"plots":63,"plot_area":449.75,"cost_before":4772,"cost_after":4350,"yield_before":1000,"yield_after":1150,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":16.381583,"lng":99.350755,"coord_note":"แปลงจาก UTM 47N (537456, 1811177); พิกัดตกในอำเภอคลองลาน"},{"id":"F11649","name":"แปลงใหญ่ข้าว หมู่ 8 ตำบลลานดอกไม้ อำเภอเมืองกำแพงเพชร จังหวัดกำแพงเพชร","year_start":2565,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"8","tambon":"ลานดอกไม้","district":"เมืองกำแพงเพชร","district_code":"6201","members":30,"member_area":651.25,"plot_farmers":30,"plots":30,"plot_area":651.25,"cost_before":4500,"cost_after":4200,"yield_before":800,"yield_after":850,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"","lat":16.615392,"lng":99.447895,"coord_note":"แปลงจาก UTM 47N (547772, 1837062)"},{"id":"F11661","name":"แปลงใหญ่มะม่วง หมู่ 8 ตำบลเพชรชมภู อำเภอโกสัมพีนคร จังหวัดกำแพงเพชร","year_start":2565,"group":"ไม้ผล","commodity":"มะม่วง","commodity2":"มะม่วง","moo":"8","tambon":"เพชรชมภู","district":"โกสัมพีนคร","district_code":"6211","members":31,"member_area":732,"plot_farmers":38,"plots":47,"plot_area":732,"cost_before":11775,"cost_after":9420,"yield_before":1200,"yield_after":1500,"gap":true,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย, ซื้อขายแบบมีข้อตกลง","lat":16.61136,"lng":99.375105,"coord_note":"แปลงจาก UTM 47N (540009, 1836600)"},{"id":"F11662","name":"แปลงใหญ่มันสำปะหลัง หมู่ 9 ตำบลวังหามแห อำเภอขาณุวรลักษบุรี จังหวัดกำแพงเพชร","year_start":2565,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"9","tambon":"วังหามแห","district":"ขาณุวรลักษบุรี","district_code":"6204","members":30,"member_area":542.75,"plot_farmers":30,"plots":31,"plot_area":542.75,"cost_before":5650,"cost_after":3207,"yield_before":3000,"yield_after":5000,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย","lat":16.038856,"lng":99.575943,"coord_note":"แปลงจาก UTM 47N (561610, 1773319)"},{"id":"F11663","name":"แปลงใหญ่มันสำปะหลัง หมู่ 9 ตำบลวังไทร อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2565,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"9","tambon":"วังไทร","district":"คลองขลุง","district_code":"6205","members":52,"member_area":1148.75,"plot_farmers":52,"plots":53,"plot_area":1148.75,"cost_before":4160,"cost_after":2870,"yield_before":2970,"yield_after":3350,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":16.227145,"lng":99.631383,"coord_note":"แปลงจาก UTM 47N (567477, 1794165)"},{"id":"F11664","name":"แปลงใหญ่มันสำปะหลัง หมู่ 10 ตำบลวังไทร อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2565,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"10","tambon":"วังไทร","district":"คลองขลุง","district_code":"6205","members":30,"member_area":677.75,"plot_farmers":30,"plots":30,"plot_area":677.75,"cost_before":4380,"cost_after":3260,"yield_before":800,"yield_after":960,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":16.15752,"lng":99.517508,"coord_note":"แปลงจาก UTM 47N (555326, 1786429)"},{"id":"F11665","name":"แปลงใหญ่มันสำปะหลัง หมู่ 13 ตำบลวังไทร อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2565,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"13","tambon":"วังไทร","district":"คลองขลุง","district_code":"6205","members":48,"member_area":1182.75,"plot_farmers":48,"plots":75,"plot_area":1182.75,"cost_before":4350,"cost_after":3110,"yield_before":2840,"yield_after":3270,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":16.192469,"lng":99.54254,"coord_note":"แปลงจาก UTM 47N (557992, 1790302)"},{"id":"F11666","name":"แปลงใหญ่ข้าว หมู่ 7 ตำบลคลองขลุง อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2565,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"7","tambon":"คลองขลุง","district":"คลองขลุง","district_code":"6205","members":33,"member_area":949.25,"plot_farmers":33,"plots":42,"plot_area":949.25,"cost_before":3890,"cost_after":3240,"yield_before":680,"yield_after":720,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"","lat":16.132233,"lng":99.715448,"coord_note":"แปลงจาก UTM 47N (576498, 1783695); พิกัดตกในอำเภอขาณุวรลักษบุรี"},{"id":"F11667","name":"แปลงใหญ่ข้าว หมู่ 10 ตำบลคลองขลุง อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2565,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"10","tambon":"คลองขลุง","district":"คลองขลุง","district_code":"6205","members":32,"member_area":826,"plot_farmers":35,"plots":36,"plot_area":882,"cost_before":3890,"cost_after":3240,"yield_before":680,"yield_after":720,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"","lat":16.215057,"lng":99.701094,"coord_note":"แปลงจาก UTM 47N (574932, 1792852)"},{"id":"F11668","name":"แปลงใหญ่ข้าว หมู่ 1 ตำบลหนองแม่แตง อำเภอไทรงาม จังหวัดกำแพงเพชร","year_start":2565,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"1","tambon":"หนองแม่แตง","district":"ไทรงาม","district_code":"6202","members":32,"member_area":611,"plot_farmers":43,"plots":50,"plot_area":804.5,"cost_before":4215,"cost_after":3372,"yield_before":800,"yield_after":960,"gap":true,"organic":true,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"","lat":16.411853,"lng":99.938405,"coord_note":"แปลงจาก UTM 47N (600197, 1814725)"},{"id":"F11669","name":"แปลงใหญ่ข้าว หมู่ 1 ตำบลช่องลม อำเภอลานกระบือ จังหวัดกำแพงเพชร","year_start":2565,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"1","tambon":"ช่องลม","district":"ลานกระบือ","district_code":"6207","members":31,"member_area":996,"plot_farmers":31,"plots":56,"plot_area":996,"cost_before":5420,"cost_after":5070,"yield_before":800,"yield_after":840,"gap":true,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"","lat":16.569068,"lng":99.968049,"coord_note":"แปลงจาก UTM 47N (603279, 1832133)"},{"id":"F11671","name":"แปลงใหญ่ข้าว หมู่ 3 ตำบลระหาน อำเภอบึงสามัคคี จังหวัดกำแพงเพชร","year_start":2565,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"3","tambon":"ระหาน","district":"บึงสามัคคี","district_code":"6210","members":30,"member_area":716.5,"plot_farmers":29,"plots":52,"plot_area":697.25,"cost_before":3900,"cost_after":3120,"yield_before":800,"yield_after":960,"gap":true,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"","lat":16.153606,"lng":99.948233,"coord_note":"แปลงจาก UTM 47N (601379, 1786160)"},{"id":"F11672","name":"แปลงใหญ่ข้าว หมู่ 6 ตำบลระหาน อำเภอบึงสามัคคี จังหวัดกำแพงเพชร","year_start":2565,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"6","tambon":"ระหาน","district":"บึงสามัคคี","district_code":"6210","members":35,"member_area":786.75,"plot_farmers":35,"plots":68,"plot_area":786.75,"cost_before":3800,"cost_after":3040,"yield_before":850,"yield_after":1020,"gap":true,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"","lat":16.1409,"lng":99.927037,"coord_note":"แปลงจาก UTM 47N (599119, 1784744)"},{"id":"F11673","name":"แปลงใหญ่ข้าว หมู่ 11 ตำบลวังชะโอน อำเภอบึงสามัคคี จังหวัดกำแพงเพชร","year_start":2565,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"11","tambon":"วังชะโอน","district":"บึงสามัคคี","district_code":"6210","members":44,"member_area":926.75,"plot_farmers":46,"plots":74,"plot_area":951,"cost_before":4000,"cost_after":3200,"yield_before":800,"yield_after":960,"gap":true,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"","lat":16.214557,"lng":99.974392,"coord_note":"แปลงจาก UTM 47N (604144, 1792916)"},{"id":"F11674","name":"แปลงใหญ่ข้าว หมู่ 5 ตำบลเทพนิมิต อำเภอบึงสามัคคี จังหวัดกำแพงเพชร","year_start":2565,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"5","tambon":"เทพนิมิต","district":"บึงสามัคคี","district_code":"6210","members":31,"member_area":1001.75,"plot_farmers":31,"plots":53,"plot_area":1001.75,"cost_before":3850,"cost_after":3080,"yield_before":800,"yield_after":960,"gap":true,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"","lat":16.174483,"lng":99.897028,"coord_note":"แปลงจาก UTM 47N (595894, 1788445)"},{"id":"F12368","name":"แปลงใหญ่มันสำปะหลัง หมู่ 9 ตำบลหินดาต อำเภอปางศิลาทอง จังหวัดกำแพงเพชร","year_start":2566,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"9","tambon":"หินดาต","district":"ปางศิลาทอง","district_code":"6209","members":33,"member_area":785,"plot_farmers":37,"plots":40,"plot_area":842.5,"cost_before":5300,"cost_after":4200,"yield_before":3000,"yield_after":4000,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":16.143216,"lng":99.467891,"coord_note":"แปลงจาก UTM 47N (550025, 1784834)"},{"id":"F12564","name":"แปลงใหญ่ข้าวหมู่ 4 ตำบลหัวถนน อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2566,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"4","tambon":"หัวถนน","district":"คลองขลุง","district_code":"6205","members":47,"member_area":737.25,"plot_farmers":47,"plots":47,"plot_area":761.5,"cost_before":4200,"cost_after":3300,"yield_before":750,"yield_after":900,"gap":true,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F12566","name":"แปลงใหญ่ข้าว หมู่ 1 ตำบลระหาน อำเภอบึงสามัคคี จังหวัดกำแพงเพชร","year_start":2566,"group":"ข้าว","commodity":"ข้าว","commodity2":"ข้าว","moo":"1","tambon":"ระหาน","district":"บึงสามัคคี","district_code":"6210","members":37,"member_area":885.52,"plot_farmers":40,"plots":40,"plot_area":754,"cost_before":4150,"cost_after":3320,"yield_before":750,"yield_after":900,"gap":true,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F13533","name":"แปลงใหญ่ยางพาราบ้านตากฟ้า หมู่ 5 ตำบลปางตาไว อำเภอปางศิลาทอง จังหวัดกำแพงเพชร","year_start":2567,"group":"ไม้ยืนต้น","commodity":"ยางพารา","commodity2":"ยางพารา","moo":"5","tambon":"ปางตาไว","district":"ปางศิลาทอง","district_code":"6209","members":34,"member_area":727.5,"plot_farmers":40,"plots":40,"plot_area":727.5,"cost_before":4244,"cost_after":3344,"yield_before":560,"yield_after":700,"gap":false,"organic":false,"grouping":"ไม่มีการรวมกลุ่ม","market_before":"ต่างคนต่างขาย","market_after":"รวบรวมขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F13627","name":"แปลงใหญ่ส้มโอ หมู่ 6 ตำบลปางมะค่า อำเภอขาณุวรลักษบุรี จังหวัดกำแพงเพชร","year_start":2567,"group":"ไม้ผล","commodity":"ส้มโอ","commodity2":"ส้มโอ","moo":"6","tambon":"ปางมะค่า","district":"ขาณุวรลักษบุรี","district_code":"6204","members":31,"member_area":526,"plot_farmers":31,"plots":31,"plot_area":526,"cost_before":21250,"cost_after":17500,"yield_before":1200,"yield_after":1250,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F13628","name":"แปลงใหญ่ถั่วเหลือง หมู่ 6 ตำบลบึงทับแรต อำเภอลานกระบือ จังหวัดกำแพงเพชร","year_start":2567,"group":"พืชไร่","commodity":"ถั่วเหลือง","commodity2":"ถั่วเหลือง","moo":"6","tambon":"บึงทับแรต","district":"ลานกระบือ","district_code":"6207","members":30,"member_area":344.5,"plot_farmers":30,"plots":30,"plot_area":344.5,"cost_before":3050,"cost_after":2550,"yield_before":230,"yield_after":320,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย, รวบรวมขาย","market_after":"ต่างคนต่างขาย, รวบรวมขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F13629","name":"แปลงใหญ่มันสำปะหลังเขต1 หมู่ 15 ตำบลคลองลานพัฒนา อำเภอคลองลาน จังหวัดกำแพงเพชร","year_start":2567,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"15","tambon":"คลองลานพัฒนา","district":"คลองลาน","district_code":"6203","members":31,"member_area":521.75,"plot_farmers":31,"plots":33,"plot_area":521.75,"cost_before":5530,"cost_after":4255,"yield_before":3120,"yield_after":4155,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F13630","name":"แปลงใหญ่มันสำปะหลังเขต2 หมู่ 6 ตำบลคลองลานพัฒนา อำเภอคลองลาน จังหวัดกำแพงเพชร","year_start":2567,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"6","tambon":"คลองลานพัฒนา","district":"คลองลาน","district_code":"6203","members":30,"member_area":559,"plot_farmers":30,"plots":32,"plot_area":559,"cost_before":5585,"cost_after":4265,"yield_before":3125,"yield_after":4215,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F13631","name":"แปลงใหญ่มันสำปะหลัง หมู่ 16 ตำบลโกสัมพี อำเภอโกสัมพีนคร จังหวัดกำแพงเพชร","year_start":2567,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"16","tambon":"โกสัมพี","district":"โกสัมพีนคร","district_code":"6211","members":52,"member_area":1297,"plot_farmers":52,"plots":54,"plot_area":1517,"cost_before":6265,"cost_after":4950,"yield_before":3515,"yield_after":4515,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F13632","name":"แปลงใหญ่มันสำปะหลัง หมู่ 11 ตำบลหินดาต อำเภอปางศิลาทอง จังหวัดกำแพงเพชร","year_start":2567,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"มันสำปะหลัง","moo":"11","tambon":"หินดาต","district":"ปางศิลาทอง","district_code":"6209","members":31,"member_area":812.25,"plot_farmers":31,"plots":33,"plot_area":812.25,"cost_before":4660,"cost_after":3950,"yield_before":3120,"yield_after":4250,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F13633","name":"แปลงใหญ่ข้าวโพดเลี้ยงสัตว์ หมู่ 7 ตำบลถาวรวัฒนา อำเภอทรายทองวัฒนา จังหวัดกำแพงเพชร","year_start":2567,"group":"พืชไร่","commodity":"ข้าวโพดเลี้ยงสัตว์","commodity2":"ข้าว","moo":"7","tambon":"ถาวรวัฒนา","district":"ทรายทองวัฒนา","district_code":"6208","members":32,"member_area":1011,"plot_farmers":43,"plots":52,"plot_area":1262,"cost_before":6153,"cost_after":4922,"yield_before":1050,"yield_after":1275,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F13634","name":"แปลงใหญ่ข้าวโพดเลี้ยงสัตว์ หมู่ 6 ตำบลบึงสามัคคี อำเภอบึงสามัคคี จังหวัดกำแพงเพชร","year_start":2567,"group":"พืชไร่","commodity":"ข้าวโพดเลี้ยงสัตว์","commodity2":"ข้าว","moo":"6","tambon":"บึงสามัคคี","district":"บึงสามัคคี","district_code":"6210","members":45,"member_area":1325,"plot_farmers":45,"plots":45,"plot_area":1325,"cost_before":6500,"cost_after":5200,"yield_before":750,"yield_after":1000,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F13680","name":"แปลงใหญ่ข้าว หมู่ 2 ตำบลนาบ่อคำ อำเภอเมืองกำแพงเพชร จังหวัดกำแพงเพชร","year_start":2567,"group":"ข้าว","commodity":"ข้าว","commodity2":"ไม่มีพืชรอง","moo":"2","tambon":"นาบ่อคำ","district":"เมืองกำแพงเพชร","district_code":"6201","members":38,"member_area":512.75,"plot_farmers":35,"plots":38,"plot_area":465.25,"cost_before":3900,"cost_after":3510,"yield_before":650,"yield_after":715,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F14088","name":"แปลงใหญ่ข้าว หมู่ 4 เทพนคร อำเภอเมืองกำแพงเพชร จังหวัดกำแพงเพชร","year_start":2568,"group":"ข้าว","commodity":"ข้าว","commodity2":"ไม่มีพืชรอง","moo":"4","tambon":"เทพนคร","district":"เมืองกำแพงเพชร","district_code":"6201","members":30,"member_area":697.25,"plot_farmers":26,"plots":28,"plot_area":574.5,"cost_before":6000,"cost_after":5280,"yield_before":700,"yield_after":805,"gap":false,"organic":false,"grouping":"","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F14089","name":"แปลงใหญ่ข้าว หมู่ 2 ตำบลวังไทร อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2568,"group":"ข้าว","commodity":"ข้าว","commodity2":"ไม่มีพืชรอง","moo":"2","tambon":"วังไทร","district":"คลองขลุง","district_code":"6205","members":43,"member_area":1437.25,"plot_farmers":88,"plots":149,"plot_area":2369,"cost_before":5856,"cost_after":5270.4,"yield_before":750,"yield_after":825,"gap":false,"organic":false,"grouping":"","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F14090","name":"แปลงใหญ่ข้าว หมู่ 6 ตำบลท่ามะเขือ อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2568,"group":"ข้าว","commodity":"ข้าว","commodity2":"ไม่มีพืชรอง","moo":"6","tambon":"ท่ามะเขือ","district":"คลองขลุง","district_code":"6205","members":44,"member_area":1231.25,"plot_farmers":51,"plots":74,"plot_area":1194,"cost_before":5438,"cost_after":4622.3,"yield_before":750,"yield_after":862.5,"gap":false,"organic":false,"grouping":"","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F14091","name":"แปลงใหญ่ข้าว หมู่ 9 ตำบลวังชะโอน อำเภอบึงสามัคคี จังหวัดกำแพงเพชร","year_start":2568,"group":"ข้าว","commodity":"ข้าว","commodity2":"ไม่มีพืชรอง","moo":"9","tambon":"วังชะโอน","district":"บึงสามัคคี","district_code":"6210","members":34,"member_area":702.4,"plot_farmers":34,"plots":63,"plot_area":812.75,"cost_before":5020,"cost_after":4267,"yield_before":700,"yield_after":805,"gap":false,"organic":false,"grouping":"","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F14426","name":"แปลงใหญ่มันสำปะหลัง หมู่ 2 ตำบลเพชรชมภู อำเภอโกสัมพีนคร จังหวัดกำแพงเพชร","year_start":2568,"group":"พืชไร่","commodity":"มันสำปะหลัง","commodity2":"ไม่มีพืชรอง","moo":"2","tambon":"เพชรชมภู","district":"โกสัมพีนคร","district_code":"6211","members":36,"member_area":330,"plot_farmers":36,"plots":44,"plot_area":742.25,"cost_before":6000,"cost_after":5200,"yield_before":3500,"yield_after":4200,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F14427","name":"แปลงใหญ่ตะไคร้ หมู่ 11 ตำบลลานกระบือ อำเภอลานกระบือ จังหวัดกำแพงเพชร","year_start":2568,"group":"ผัก/สมุนไพร","commodity":"ตะไคร้","commodity2":"ไม่มีพืชรอง","moo":"11","tambon":"ลานกระบือ","district":"ลานกระบือ","district_code":"6207","members":32,"member_area":34,"plot_farmers":26,"plots":26,"plot_area":292,"cost_before":1500,"cost_after":1200,"yield_before":1500,"yield_after":2000,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย, รวบรวมขาย, ซื้อขายแบบมีข้อตกลง","market_after":"ต่างคนต่างขาย, รวบรวมขาย, ซื้อขายแบบมีข้อตกลง","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F14428","name":"แปลงใหญ่ลำไย หมู่ 4 ตำบลโป่งน้ำร้อน อำเภอคลองลาน จังหวัดกำแพงเพชร","year_start":2568,"group":"ไม้ผล","commodity":"ลำไย","commodity2":"ไม่มีพืชรอง","moo":"4","tambon":"โป่งน้ำร้อน","district":"คลองลาน","district_code":"6203","members":27,"member_area":314.24,"plot_farmers":27,"plots":27,"plot_area":431.75,"cost_before":7500,"cost_after":5250,"yield_before":1000,"yield_after":1300,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย, ซื้อขายแบบมีข้อตกลง","market_after":"ต่างคนต่างขาย, รวบรวมขาย, ซื้อขายแบบมีข้อตกลง","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F14429","name":"แปลงใหญ่ทุเรียน หมู่2 ตำบลโป่งน้ำร้อน อำเภอคลองลาน จังหวัดกำแพงเพชร","year_start":2568,"group":"ไม้ผล","commodity":"ทุเรียน","commodity2":"ไม่มีพืชรอง","moo":"2","tambon":"โป่งน้ำร้อน","district":"คลองลาน","district_code":"6203","members":33,"member_area":173.24,"plot_farmers":33,"plots":36,"plot_area":420.5,"cost_before":50000,"cost_after":40000,"yield_before":750,"yield_after":975,"gap":false,"organic":false,"grouping":"วิสาหกิจชุมชน","market_before":"ต่างคนต่างขาย, ซื้อขายแบบมีข้อตกลง","market_after":"ต่างคนต่างขาย, รวบรวมขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F14462","name":"แปลงใหญ่ข้าว หมู่ 7 ตำบลหนองหลวง อำเภอลานกระบือ จังหวัดกำแพงเพชร","year_start":2568,"group":"ข้าว","commodity":"ข้าว","commodity2":"ไม่มีพืชรอง","moo":"7","tambon":"หนองหลวง","district":"ลานกระบือ","district_code":"6207","members":41,"member_area":797,"plot_farmers":41,"plots":67,"plot_area":943.5,"cost_before":0,"cost_after":0,"yield_before":0,"yield_after":0,"gap":false,"organic":false,"grouping":"","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F14708","name":"แปลงใหญ่ข้าว หมู่ 1 ตำบลท่าพุทรา อำเภอคลองขลุง จังหวัดกำแพงเพชร","year_start":2569,"group":"ข้าว","commodity":"ข้าว","commodity2":"ไม่มีพืชรอง","moo":"1","tambon":"ท่าพุทรา","district":"คลองขลุง","district_code":"6205","members":54,"member_area":1173,"plot_farmers":44,"plots":88,"plot_area":1170.75,"cost_before":0,"cost_after":0,"yield_before":0,"yield_after":0,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F14709","name":"แปลงใหญ่ข้าว หมู่ 2 ตำบลสระแก้ว อำเภอเมืองกำแพงเพชร จังหวัดกำแพงเพชร","year_start":2569,"group":"ข้าว","commodity":"ข้าว","commodity2":"ไม่มีพืชรอง","moo":"2","tambon":"สระแก้ว","district":"เมืองกำแพงเพชร","district_code":"6201","members":30,"member_area":599,"plot_farmers":30,"plots":56,"plot_area":643.75,"cost_before":0,"cost_after":0,"yield_before":0,"yield_after":0,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"},{"id":"F14710","name":"แปลงใหญ่ข้าว หมู่ 1 ตำบลนครชุม อำเภอเมืองกำแพงเพชร จังหวัดกำแพงเพชร","year_start":2569,"group":"ข้าว","commodity":"ข้าว","commodity2":"ไม่มีพืชรอง","moo":"1","tambon":"นครชุม","district":"เมืองกำแพงเพชร","district_code":"6201","members":56,"member_area":923,"plot_farmers":56,"plots":112,"plot_area":1082.25,"cost_before":0,"cost_after":0,"yield_before":0,"yield_after":0,"gap":false,"organic":false,"grouping":"อื่นๆ","market_before":"ต่างคนต่างขาย","market_after":"ต่างคนต่างขาย","lat":null,"lng":null,"coord_note":"ยังไม่มีพิกัด"}];
const LC_SEED = [{"id":"L01","name":"ศพก. อำเภอเมืองกำแพงเพชร","district":"เมืองกำแพงเพชร","district_code":"6201","moo":"6","tambon":"เทพนคร","commodity":"ข้าว","lat":16.474712,"lng":99.591782,"utm_x":563165,"utm_y":1821539,"target_area":42000,"target_farmers":1200,"highlight":"การใช้สารชีวภัณฑ์ในการป้องกันกำจัดศัตรูข้าว","network":23,"coord_note":""},{"id":"L02","name":"ศพก. อำเภอไทรงาม","district":"ไทรงาม","district_code":"6202","moo":"8","tambon":"มหาชัย","commodity":"ข้าว","lat":16.502324,"lng":99.772768,"utm_x":582472,"utm_y":1824659,"target_area":202979,"target_farmers":6804,"highlight":"การใช้สารชีวภาพกำจัดแมลงศัตรูพืช; การลดต้นทุนการผลิตข้าว; การใช้ปุ๋ยตามค่าวิเคราะห์ดิน; การผลิตข้าวปลอดภัย (GAP)","network":16,"coord_note":""},{"id":"L03","name":"ศพก. อำเภอคลองลาน","district":"คลองลาน","district_code":"6203","moo":"12","tambon":"คลองลานพัฒนา","commodity":"ไร่นาสวนผสม","lat":16.109798,"lng":99.38451,"utm_x":541117,"utm_y":1781119,"target_area":100,"target_farmers":100,"highlight":"การจัดการพื้นที่ตามหลักเกษตรทฤษฎีใหม่","network":12,"coord_note":""},{"id":"L04","name":"ศพก. อำเภอขาณุวรลักษบุรี","district":"ขาณุวรลักษบุรี","district_code":"6204","moo":"8","tambon":"วังหามแห","commodity":"มันสำปะหลัง","lat":16.038856,"lng":99.575943,"utm_x":561610,"utm_y":1773319,"target_area":166818,"target_farmers":6433,"highlight":"การเพิ่มประสิทธิภาพการผลิตมันสำปะหลัง; การปลูกพืชทางเลือกทดแทนมันสำปะหลัง","network":18,"coord_note":""},{"id":"L05","name":"ศพก. อำเภอคลองขลุง","district":"คลองขลุง","district_code":"6205","moo":"7","tambon":"หัวถนน","commodity":"ข้าว","lat":16.288503,"lng":99.604736,"utm_x":564609,"utm_y":1800944,"target_area":180150,"target_farmers":6201,"highlight":"การลดต้นทุนการผลิตข้าว; การใช้สารชีวภัณฑ์ลดต้นทุน","network":23,"coord_note":""},{"id":"L06","name":"ศพก. อำเภอพรานกระต่าย","district":"พรานกระต่าย","district_code":"6206","moo":"3","tambon":"เขาคีริส","commodity":"ข้าว","lat":16.557659,"lng":99.728685,"utm_x":577745,"utm_y":1830763,"target_area":null,"target_farmers":null,"highlight":"การใช้สารชีวภัณฑ์","network":19,"coord_note":""},{"id":"L07","name":"ศพก. อำเภอลานกระบือ","district":"ลานกระบือ","district_code":"6207","moo":"2","tambon":"หนองหลวง","commodity":"ข้าว","lat":16.592702,"lng":99.736925,"utm_x":578610,"utm_y":1834643,"target_area":157876,"target_farmers":4762,"highlight":"การลดต้นทุนการผลิตข้าว; การผลิตเมล็ดพันธุ์ข้าว","network":20,"coord_note":""},{"id":"L08","name":"ศพก. อำเภอทรายทองวัฒนา","district":"ทรายทองวัฒนา","district_code":"6208","moo":"9","tambon":"ทุ่งทอง","commodity":"ข้าว","lat":16.34919,"lng":99.893627,"utm_x":595446,"utm_y":1807771,"target_area":48250,"target_farmers":500,"highlight":"การลดต้นทุนการผลิตข้าว; การผลิตข้าวอินทรีย์","network":18,"coord_note":""},{"id":"L09","name":"ศพก. อำเภอปางศิลาทอง","district":"ปางศิลาทอง","district_code":"6209","moo":"9","tambon":"โพธิ์ทอง","commodity":"ข้าว","lat":16.111915,"lng":99.531454,"utm_x":556830,"utm_y":1781388,"target_area":45589,"target_farmers":6490,"highlight":"การลดต้นทุนการผลิตข้าว; การเพิ่มผลผลิตข้าว","network":16,"coord_note":""},{"id":"L10","name":"ศพก. อำเภอบึงสามัคคี","district":"บึงสามัคคี","district_code":"6210","moo":"2","tambon":"ระหาน","commodity":"ข้าว","lat":16.140754,"lng":99.972038,"utm_x":603931,"utm_y":1784750,"target_area":null,"target_farmers":null,"highlight":"การจัดการศัตรูพืชแบบผสมผสาน","network":30,"coord_note":""},{"id":"L11","name":"ศพก. อำเภอโกสัมพีนคร","district":"โกสัมพีนคร","district_code":"6211","moo":"8","tambon":"ลานดอกไม้ตก","commodity":"ข้าว","lat":16.582413,"lng":99.45304,"utm_x":548329,"utm_y":1833415,"target_area":null,"target_farmers":null,"highlight":"การลดต้นทุนการผลิตข้าว; ส่งเสริมการใช้เมล็ดพันธุ์ข้าวพันธุ์ดี","network":11,"coord_note":""}];
const LCNET_SEED = [{"district":"เมืองกำแพงเพชร","district_code":"6201","count":23},{"district":"ไทรงาม","district_code":"6202","count":16},{"district":"คลองลาน","district_code":"6203","count":12},{"district":"ขาณุวรลักษบุรี","district_code":"6204","count":18},{"district":"คลองขลุง","district_code":"6205","count":23},{"district":"พรานกระต่าย","district_code":"6206","count":19},{"district":"ลานกระบือ","district_code":"6207","count":20},{"district":"ทรายทองวัฒนา","district_code":"6208","count":18},{"district":"ปางศิลาทอง","district_code":"6209","count":16},{"district":"บึงสามัคคี","district_code":"6210","count":30},{"district":"โกสัมพีนคร","district_code":"6211","count":11}];
const LCTYPE_SEED = [{"type":"ศดปช.","count":11},{"type":"ศชข.","count":11},{"type":"ท่องเที่ยวเชิงเกษตร","count":1},{"type":"ปราชญ์ชาวบ้าน","count":4},{"type":"การจัดการดิน","count":2},{"type":"แปรรูปผลิตผล","count":22},{"type":"ศูนย์ข้าวชุมชน","count":35},{"type":"ประมง","count":10},{"type":"ปศุสัตว์","count":6},{"type":"พืชไร่","count":12},{"type":"มาตรฐานการเกษตร","count":7},{"type":"ไม้ผล","count":11},{"type":"ไม้ยืนต้น","count":4},{"type":"เศรษฐกิจเกษตร","count":3},{"type":"หม่อนไหม","count":1},{"type":"พืชผัก","count":8},{"type":"เศรษฐกิจพอเพียง","count":57},{"type":"อื่นๆ (กล้วยไม้)","count":1}];

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

// ===================== PestSeed.gs =====================
/** ข้อมูล ศจช. ตั้งต้น (สร้างโดย tests/build-pest-seed.js ไม่มีข้อมูลส่วนบุคคล) */
const PEST_SEED = [{"id":"P001","name":"ศจช. บ้านหนองโดนใต้","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านหนองโดนใต้","year_start":2555,"level":"B","level_year":"2569","members":10,"moo":"9","tambon":"พานทอง","district":"ไทรงาม","district_code":"6202","lat":16.360181,"lng":99.834168,"utm_x":589090,"utm_y":1808960,"coord_note":"แปลงจาก UTM 47N (589090, 1808960)","crop":"ข้าวเจ้า","area_farm":true,"area_risk":false,"area_gap":false,"area_normal":true,"other":"ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.); วิสาหกิจชุมชน","bio":""},{"id":"P002","name":"ศจช. บ้านศรีวิไล","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านศรีวิไล","year_start":2561,"level":"A","level_year":"2569","members":30,"moo":"8","tambon":"มหาชัย","district":"ไทรงาม","district_code":"6202","lat":16.502333,"lng":99.772768,"utm_x":582472,"utm_y":1824660,"coord_note":"แปลงจาก UTM 47N (582472, 1824660)","crop":"ข้าวเจ้า","area_farm":true,"area_risk":false,"area_gap":false,"area_normal":true,"other":"ศูนย์เรียนรู้การเพิ่มประสิทธิภาพการผลิตสินค้าเกษตร (ศพก.); ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.); วิสาหกิจชุมชน","bio":""},{"id":"P003","name":"ศจช. บ้านทรงธรรม","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านทรงธรรม","year_start":2555,"level":"C","level_year":"2569","members":30,"moo":"4","tambon":"ทรงธรรม","district":"เมืองกำแพงเพชร","district_code":"6201","lat":16.519287,"lng":99.445621,"utm_x":547553,"utm_y":1826430,"coord_note":"แปลงจาก UTM 47N (547553, 1826430)","crop":"มันสำปะหลังโรงงาน","area_farm":false,"area_risk":false,"area_gap":false,"area_normal":true,"other":"ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.)","bio":""},{"id":"P004","name":"ศจช. บ้านกระบวยทองใต้","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านกระบวยทองใต้","year_start":2560,"level":"A","level_year":"2569","members":46,"moo":"2","tambon":"ระหาน","district":"บึงสามัคคี","district_code":"6210","lat":16.141026,"lng":99.971955,"utm_x":603922,"utm_y":1784780,"coord_note":"แปลงจาก UTM 47N (603922, 1784780)","crop":"ข้าวเจ้า","area_farm":true,"area_risk":true,"area_gap":true,"area_normal":true,"other":"ศูนย์เรียนรู้การเพิ่มประสิทธิภาพการผลิตสินค้าเกษตร (ศพก.); ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.); วิสาหกิจชุมชน; ศูนย์ข้าวชุมชน","bio":"เชื้อราไตรโคเดอร์มาพร้อมใช้; เชื้อราบิวเวอเรียพร้อมใช้; เชื้อราเมตาไรเซียมพร้อมใช้"},{"id":"P005","name":"ศจช. บ้านหนองเสือ","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านหนองเสือ","year_start":2558,"level":"A","level_year":"2569","members":36,"moo":"2","tambon":"วังชะโอน","district":"บึงสามัคคี","district_code":"6210","lat":16.172856,"lng":100.008028,"utm_x":607762,"utm_y":1788320,"coord_note":"แปลงจาก UTM 47N (607762, 1788320)","crop":"ข้าวเจ้า","area_farm":true,"area_risk":true,"area_gap":true,"area_normal":true,"other":"ศูนย์เรียนรู้การเพิ่มประสิทธิภาพการผลิตสินค้าเกษตร (ศพก.); ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.); วิสาหกิจชุมชน; ศูนย์ข้าวชุมชน","bio":""},{"id":"P006","name":"ศจช. บ้านพงษ์ทองคำ","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านพงษ์ทองคำ","year_start":2561,"level":"A","level_year":"2569","members":32,"moo":"7","tambon":"ระหาน","district":"บึงสามัคคี","district_code":"6210","lat":16.161284,"lng":99.94956,"utm_x":601517,"utm_y":1787010,"coord_note":"แปลงจาก UTM 47N (601517, 1787010)","crop":"ข้าวเจ้า","area_farm":true,"area_risk":true,"area_gap":true,"area_normal":true,"other":"ศูนย์เรียนรู้การเพิ่มประสิทธิภาพการผลิตสินค้าเกษตร (ศพก.); ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.); วิสาหกิจชุมชน","bio":"เชื้อราไตรโคเดอร์มาพร้อมใช้; เชื้อราบิวเวอเรียพร้อมใช้; เชื้อราเมตาไรเซียมพร้อมใช้"},{"id":"P007","name":"ศจช. บ้านสักงาม","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านสักงาม","year_start":2550,"level":"B","level_year":"2569","members":30,"moo":"1","tambon":"สักงาม","district":"คลองลาน","district_code":"6203","lat":16.327777,"lng":99.322471,"utm_x":534445,"utm_y":1805220,"coord_note":"แปลงจาก UTM 47N (534445, 1805220)","crop":"ข้าวเจ้า","area_farm":false,"area_risk":false,"area_gap":false,"area_normal":true,"other":"ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.); วิสาหกิจชุมชน","bio":""},{"id":"P008","name":"ศจช. บ้านมอมะรื่น","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านมอมะรื่น","year_start":2562,"level":"B","level_year":"2569","members":30,"moo":"15","tambon":"คลองลานพัฒนา","district":"คลองลาน","district_code":"6203","lat":16.122911,"lng":99.333454,"utm_x":535655,"utm_y":1782560,"coord_note":"แปลงจาก UTM 47N (535655, 1782560)","crop":"มันสำปะหลังโรงงาน","area_farm":false,"area_risk":false,"area_gap":false,"area_normal":true,"other":"ศูนย์เรียนรู้การเพิ่มประสิทธิภาพการผลิตสินค้าเกษตร (ศพก.)","bio":""},{"id":"P009","name":"ศจช. ตำบลโค้งไผ่","full_name":"ศูนย์จัดการศัตรูพืชชุมชนตำบลโค้งไผ่","year_start":2557,"level":"B","level_year":"2569","members":30,"moo":"5","tambon":"โค้งไผ่","district":"ขาณุวรลักษบุรี","district_code":"6204","lat":16.122976,"lng":99.712824,"utm_x":576221,"utm_y":1782670,"coord_note":"แปลงจาก UTM 47N (576221, 1782670)","crop":"ข้าวเจ้า","area_farm":false,"area_risk":false,"area_gap":false,"area_normal":true,"other":"ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.)","bio":""},{"id":"P010","name":"ศจช. บ้านบ่อทอง","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านบ่อทอง","year_start":2560,"level":"A","level_year":"2569","members":33,"moo":"8","tambon":"วังแขม","district":"คลองขลุง","district_code":"6205","lat":16.214986,"lng":99.840113,"utm_x":589791,"utm_y":1792900,"coord_note":"แปลงจาก UTM 47N (589791, 1792900)","crop":"ข้าวเจ้า","area_farm":true,"area_risk":false,"area_gap":false,"area_normal":false,"other":"ศูนย์เรียนรู้การเพิ่มประสิทธิภาพการผลิตสินค้าเกษตร (ศพก.); ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.); วิสาหกิจชุมชน","bio":"เชื้อราไตรโคเดอร์มาพร้อมใช้; เชื้อราบิวเวอเรียพร้อมใช้; เชื้อราเมตาไรเซียมพร้อมใช้; แมลงหางหนีบ; สารสกัดธรรมชาติ; แหนแดง"},{"id":"P011","name":"ศจช. บ้านวังตะกู","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านวังตะกู","year_start":2557,"level":"B","level_year":"2569","members":30,"moo":"11","tambon":"วังควง","district":"พรานกระต่าย","district_code":"6206","lat":16.84663,"lng":99.436824,"utm_x":546535,"utm_y":1862640,"coord_note":"แปลงจาก UTM 47N (546535, 1862640)","crop":"มันสำปะหลังโรงงาน","area_farm":false,"area_risk":false,"area_gap":false,"area_normal":true,"other":"","bio":""},{"id":"P012","name":"ศจช. บ้านนาถัง","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านนาถัง","year_start":2554,"level":"B","level_year":"2569","members":20,"moo":"7","tambon":"ถ้ำกระต่ายทอง","district":"พรานกระต่าย","district_code":"6206","lat":16.656024,"lng":99.602163,"utm_x":564213,"utm_y":1841600,"coord_note":"แปลงจาก UTM 47N (564213, 1841600)","crop":"ข้าวเจ้า","area_farm":true,"area_risk":false,"area_gap":false,"area_normal":false,"other":"วิสาหกิจชุมชน","bio":""},{"id":"P013","name":"ศจช. บ้านทุ่งรวงทอง","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านทุ่งรวงทอง","year_start":2559,"level":"B","level_year":"2569","members":20,"moo":"14","tambon":"เขาคีริส","district":"พรานกระต่าย","district_code":"6206","lat":16.546523,"lng":99.699384,"utm_x":574623,"utm_y":1829520,"coord_note":"แปลงจาก UTM 47N (574623, 1829520)","crop":"ข้าวเจ้า","area_farm":true,"area_risk":false,"area_gap":false,"area_normal":false,"other":"วิสาหกิจชุมชน","bio":""},{"id":"P014","name":"ศจช. บ้านตะแบกงาม","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านตะแบกงาม","year_start":2557,"level":"B","level_year":"2569","members":20,"moo":"15","tambon":"เขาคีริส","district":"พรานกระต่าย","district_code":"6206","lat":16.672046,"lng":99.594327,"utm_x":563372,"utm_y":1843370,"coord_note":"แปลงจาก UTM 47N (563372, 1843370)","crop":"พริกยักษ์","area_farm":true,"area_risk":false,"area_gap":false,"area_normal":false,"other":"วิสาหกิจชุมชน","bio":""},{"id":"P015","name":"ศจช. บ้านไร่สุขขุม","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านไร่สุขขุม","year_start":2559,"level":"B","level_year":"2569","members":30,"moo":"4","tambon":"ห้วยยั้ง","district":"พรานกระต่าย","district_code":"6206","lat":16.736674,"lng":99.655261,"utm_x":569846,"utm_y":1850540,"coord_note":"แปลงจาก UTM 47N (569846, 1850540)","crop":"ข้าวเจ้า","area_farm":true,"area_risk":false,"area_gap":false,"area_normal":false,"other":"วิสาหกิจชุมชน","bio":""},{"id":"P016","name":"ศจช. บ้านปางเหนือ","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านปางเหนือ","year_start":2559,"level":"C","level_year":"2569","members":30,"moo":"6","tambon":"ปางตาไว","district":"ปางศิลาทอง","district_code":"6209","lat":16.056082,"lng":99.347244,"utm_x":537142,"utm_y":1775170,"coord_note":"แปลงจาก UTM 47N (537142, 1775170)","crop":"มันสำปะหลังโรงงาน","area_farm":true,"area_risk":false,"area_gap":false,"area_normal":false,"other":"ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.)","bio":""},{"id":"P017","name":"ศจช. บ้านปางมะละกอ","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านปางมะละกอ","year_start":2559,"level":"B","level_year":"2569","members":30,"moo":"8","tambon":"ปางตาไว","district":"ปางศิลาทอง","district_code":"6209","lat":15.994072,"lng":99.281106,"utm_x":530077,"utm_y":1768300,"coord_note":"แปลงจาก UTM 47N (530077, 1768300)","crop":"มันสำปะหลังโรงงาน","area_farm":false,"area_risk":true,"area_gap":false,"area_normal":true,"other":"ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.)","bio":""},{"id":"P018","name":"ศจช. บ้านฟากทุ่ง","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านฟากทุ่ง","year_start":2554,"level":"B","level_year":"2569","members":30,"moo":"1","tambon":"โนนพลวง","district":"ลานกระบือ","district_code":"6207","lat":16.577121,"lng":99.856795,"utm_x":591405,"utm_y":1832970,"coord_note":"แปลงจาก UTM 47N (591405, 1832970)","crop":"ข้าวเจ้า","area_farm":false,"area_risk":false,"area_gap":false,"area_normal":true,"other":"","bio":""},{"id":"P019","name":"ศจช. บ้านลำมะโกรก","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านลำมะโกรก","year_start":2558,"level":"B","level_year":"2569","members":30,"moo":"2","tambon":"หนองหลวง","district":"ลานกระบือ","district_code":"6207","lat":16.592675,"lng":99.736878,"utm_x":578605,"utm_y":1834640,"coord_note":"แปลงจาก UTM 47N (578605, 1834640)","crop":"ข้าวเจ้า","area_farm":true,"area_risk":false,"area_gap":true,"area_normal":false,"other":"ศูนย์เรียนรู้การเพิ่มประสิทธิภาพการผลิตสินค้าเกษตร (ศพก.); ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.); วิสาหกิจชุมชน; ศูนย์ข้าวชุมชน","bio":""},{"id":"P020","name":"ศจช. บ้านมะหาดหวาน","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านมะหาดหวาน","year_start":2565,"level":"B","level_year":"2569","members":30,"moo":"11","tambon":"ลานกระบือ","district":"ลานกระบือ","district_code":"6207","lat":16.650086,"lng":99.829542,"utm_x":588464,"utm_y":1841030,"coord_note":"แปลงจาก UTM 47N (588464, 1841030)","crop":"พริก","area_farm":false,"area_risk":false,"area_gap":false,"area_normal":true,"other":"ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.); วิสาหกิจชุมชน","bio":"เชื้อราไตรโคเดอร์มาพร้อมใช้"},{"id":"P021","name":"ศจช. บ้านศาลาโป่งแดง","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านศาลาโป่งแดง","year_start":2564,"level":"C","level_year":"2569","members":30,"moo":"19","tambon":"นาบ่อคำ","district":"เมืองกำแพงเพชร","district_code":"6201","lat":16.436994,"lng":99.368745,"utm_x":539366,"utm_y":1817310,"coord_note":"แปลงจาก UTM 47N (539366, 1817310)","crop":"ข้าวโพดเลี้ยงสัตว์","area_farm":true,"area_risk":false,"area_gap":false,"area_normal":false,"other":"","bio":""},{"id":"P022","name":"ศจช. บ้านบึงสำราญ","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านบึงสำราญ","year_start":2559,"level":"B","level_year":"2569","members":33,"moo":"7","tambon":"ถาวรวัฒนา","district":"ทรายทองวัฒนา","district_code":"6208","lat":16.314653,"lng":99.934983,"utm_x":599881,"utm_y":1803970,"coord_note":"แปลงจาก UTM 47N (599881, 1803970)","crop":"ข้าวโพดเลี้ยงสัตว์","area_farm":false,"area_risk":false,"area_gap":false,"area_normal":true,"other":"ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.)","bio":""},{"id":"P023","name":"ศจช. บ้านอุบลสามัคคี","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านอุบลสามัคคี","year_start":2559,"level":"B","level_year":"2569","members":20,"moo":"9","tambon":"ทุ่งทอง","district":"ทรายทองวัฒนา","district_code":"6208","lat":16.349181,"lng":99.893627,"utm_x":595446,"utm_y":1807770,"coord_note":"แปลงจาก UTM 47N (595446, 1807770)","crop":"ข้าวเจ้า","area_farm":true,"area_risk":false,"area_gap":false,"area_normal":false,"other":"ศูนย์เรียนรู้การเพิ่มประสิทธิภาพการผลิตสินค้าเกษตร (ศพก.)","bio":""},{"id":"P024","name":"ศจช. บ้านอมฤต","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านอมฤต","year_start":2558,"level":"B","level_year":"2569","members":30,"moo":"8","tambon":"ลานดอกไม้ตก","district":"โกสัมพีนคร","district_code":"6211","lat":16.58255,"lng":99.452825,"utm_x":548306,"utm_y":1833430,"coord_note":"แปลงจาก UTM 47N (548306, 1833430)","crop":"ข้าวเจ้า","area_farm":true,"area_risk":false,"area_gap":true,"area_normal":true,"other":"ศูนย์เรียนรู้การเพิ่มประสิทธิภาพการผลิตสินค้าเกษตร (ศพก.); วิสาหกิจชุมชน; ศูนย์ข้าวชุมชน","bio":""},{"id":"P025","name":"ศจช. บ้านท่าคูณ","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านท่าคูณ","year_start":2559,"level":"C","level_year":"2569","members":30,"moo":"1","tambon":"โกสัมพี","district":"โกสัมพีนคร","district_code":"6211","lat":16.684507,"lng":99.310757,"utm_x":533133,"utm_y":1844680,"coord_note":"แปลงจาก UTM 47N (533133, 1844680)","crop":"ข้าวเจ้า","area_farm":false,"area_risk":true,"area_gap":false,"area_normal":true,"other":"","bio":""},{"id":"P026","name":"ศจช. ตำบลคณฑี","full_name":"ศูนย์จัดการศัตรูพืชชุมชนศูนย์จัดการศัตรูพืชชุมตำบลคณฑี","year_start":2566,"level":"B","level_year":"2569","members":31,"moo":"2","tambon":"คณฑี","district":"เมืองกำแพงเพชร","district_code":"6201","lat":16.363169,"lng":99.653804,"utm_x":569825,"utm_y":1809220,"coord_note":"แปลงจาก UTM 47N (569825, 1809220)","crop":"ข้าวเจ้า","area_farm":false,"area_risk":false,"area_gap":false,"area_normal":true,"other":"","bio":""},{"id":"P027","name":"ศจช. บ้านคลองสมบูรณ์","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านคลองสมบูรณ์","year_start":2566,"level":"C","level_year":"2569","members":20,"moo":"4","tambon":"คลองสมบูรณ์","district":"คลองขลุง","district_code":"6205","lat":16.254082,"lng":99.584595,"utm_x":562468,"utm_y":1797130,"coord_note":"แปลงจาก UTM 47N (562468, 1797130)","crop":"มันสำปะหลังโรงงาน","area_farm":true,"area_risk":false,"area_gap":false,"area_normal":false,"other":"","bio":"เชื้อราไตรโคเดอร์มาพร้อมใช้"},{"id":"P028","name":"ศจช. บ้านสามง่าม","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านสามง่าม","year_start":2559,"level":"B","level_year":"2569","members":30,"moo":"3","tambon":"วังบัว","district":"คลองขลุง","district_code":"6205","lat":16.31327,"lng":99.709895,"utm_x":575835,"utm_y":1803720,"coord_note":"แปลงจาก UTM 47N (575835, 1803720)","crop":"ข้าวเจ้า","area_farm":true,"area_risk":false,"area_gap":false,"area_normal":false,"other":"วิสาหกิจชุมชน","bio":"เชื้อราไตรโคเดอร์มาพร้อมใช้"},{"id":"P029","name":"ศจช. บ้านตะเคียนงาม","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านตะเคียนงาม","year_start":2566,"level":"B","level_year":"2569","members":30,"moo":"6","tambon":"โพธิ์ทอง","district":"ปางศิลาทอง","district_code":"6209","lat":16.126633,"lng":99.545615,"utm_x":558340,"utm_y":1783020,"coord_note":"แปลงจาก UTM 47N (558340, 1783020)","crop":"ข้าวเจ้า","area_farm":true,"area_risk":false,"area_gap":false,"area_normal":false,"other":"ศูนย์เรียนรู้การเพิ่มประสิทธิภาพการผลิตสินค้าเกษตร (ศพก.); วิสาหกิจชุมชน; ศูนย์ข้าวชุมชน","bio":""},{"id":"P030","name":"ศจช. บ้านดงเย็น","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านดงเย็น","year_start":2566,"level":"C","level_year":"2569","members":37,"moo":"1","tambon":"ระหาน","district":"บึงสามัคคี","district_code":"6210","lat":16.157719,"lng":99.997757,"utm_x":606672,"utm_y":1786640,"coord_note":"แปลงจาก UTM 47N (606672, 1786640)","crop":"ข้าวเจ้า","area_farm":true,"area_risk":false,"area_gap":false,"area_normal":false,"other":"ศูนย์เรียนรู้การเพิ่มประสิทธิภาพการผลิตสินค้าเกษตร (ศพก.); ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.); วิสาหกิจชุมชน","bio":""},{"id":"P031","name":"ศจช. บ้านหนองจิก","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านหนองจิก","year_start":2565,"level":"C","level_year":"2569","members":35,"moo":"6","tambon":"ระหาน","district":"บึงสามัคคี","district_code":"6210","lat":16.141135,"lng":99.926991,"utm_x":599114,"utm_y":1784770,"coord_note":"แปลงจาก UTM 47N (599114, 1784770)","crop":"ข้าวเจ้า","area_farm":true,"area_risk":false,"area_gap":false,"area_normal":true,"other":"ศูนย์เรียนรู้การเพิ่มประสิทธิภาพการผลิตสินค้าเกษตร (ศพก.); ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.); วิสาหกิจชุมชน","bio":""},{"id":"P032","name":"ศจช. บ้านทุ่งทรายเหนือ","full_name":"ศูนย์จัดการศัตรูพืชชุมชนศจช.บ้านทุ่งทรายเหนือ","year_start":2567,"level":"C","level_year":"2569","members":20,"moo":"15","tambon":"ทุ่งทราย","district":"ทรายทองวัฒนา","district_code":"6208","lat":16.312113,"lng":99.828947,"utm_x":588554,"utm_y":1803640,"coord_note":"แปลงจาก UTM 47N (588554, 1803640)","crop":"ข้าวเจ้า","area_farm":false,"area_risk":false,"area_gap":false,"area_normal":true,"other":"ศูนย์ข้าวชุมชน","bio":""},{"id":"P033","name":"ศจช. บ้านหนองแม่แตง","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านหนองแม่แตง","year_start":2567,"level":"C","level_year":"2569","members":10,"moo":"1","tambon":"หนองแม่แตง","district":"ไทรงาม","district_code":"6202","lat":null,"lng":null,"utm_x":6200220,"utm_y":1814560,"coord_note":"พิกัดไม่ถูกต้อง (X=6200220, Y=1814560)","crop":"ข้าวเจ้า","area_farm":true,"area_risk":true,"area_gap":false,"area_normal":true,"other":"","bio":""},{"id":"P034","name":"ศจช. ศูนย์เรียนรู้การผลิตปุ๋ยอินทรีย์และสารชีวภัณฑ์","full_name":"ศูนย์จัดการศัตรูพืชชุมชนศูนย์เรียนรู้การผลิตปุ๋ยอินทรีย์และสารชีวภัณฑ์","year_start":2566,"level":"B","level_year":"2569","members":32,"moo":"1","tambon":"แสนตอ","district":"ขาณุวรลักษบุรี","district_code":"6204","lat":16.039307,"lng":99.850814,"utm_x":591015,"utm_y":1773470,"coord_note":"แปลงจาก UTM 47N (591015, 1773470)","crop":"ข้าวเจ้า","area_farm":false,"area_risk":false,"area_gap":false,"area_normal":true,"other":"ศูนย์เรียนรู้การเพิ่มประสิทธิภาพการผลิตสินค้าเกษตร (ศพก.)","bio":""},{"id":"P035","name":"ศจช. บ้านเทพนคร","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านเทพนคร","year_start":2568,"level":"B","level_year":"2569","members":30,"moo":"4","tambon":"เทพนคร","district":"เมืองกำแพงเพชร","district_code":"6201","lat":16.37923,"lng":99.570499,"utm_x":560923,"utm_y":1810970,"coord_note":"แปลงจาก UTM 47N (560923, 1810970)","crop":"ข้าวเจ้า","area_farm":true,"area_risk":false,"area_gap":false,"area_normal":false,"other":"ศูนย์ข้าวชุมชน","bio":"เชื้อราไตรโคเดอร์มาพร้อมใช้"},{"id":"P036","name":"ศจช. บ้านโคกเจริญ ต.หนองทอง","full_name":"ศูนย์จัดการศัตรูพืชชุมชนบ้านโคกเจริญ ต.หนองทอง","year_start":2568,"level":"C","level_year":"2569","members":23,"moo":"4","tambon":"หนองทอง","district":"ไทรงาม","district_code":"6202","lat":16.427933,"lng":99.774496,"utm_x":582688,"utm_y":1816430,"coord_note":"แปลงจาก UTM 47N (582688, 1816430)","crop":"ข้าวเจ้า","area_farm":false,"area_risk":true,"area_gap":false,"area_normal":true,"other":"ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.); วิสาหกิจชุมชน","bio":""}];

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
  ensureSheet_('admin_requests', AREQ_HEADERS).getRange('C:C').setNumberFormat('@');
  out.push(ensureSoil_());
  ensureDatasets_().forEach(function (m) { out.push(m); });
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
  const res = ['rows=' + b.rows.length, 'crops=' + b.crops.join('/'), 'districts=' + b.districts.length, 'links=' + b.links.length, 'soil=' + b.soil.length, 'farms=' + b.farms.length, 'pest=' + b.pest.length, 'lc=' + b.lc.length,
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

// ===================== Soil.gs =====================
/**
 * ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.)
 * ชีต soil_centers — ข้อมูลประธานศูนย์ (ชื่อ/เบอร์) เก็บในชีตเท่านั้น ไม่ส่งออกทาง API สาธารณะ
 */
const SOIL_SHEET = 'soil_centers';
const SOIL_HEADERS = ['Center_ID', 'Name', 'District_Code', 'District', 'Location', 'Lat', 'Lng', 'Type', 'Level', 'Members', 'Year_Start', 'Fund',
  'Crops', 'Network', 'Organic', 'Products', 'OSS', 'OSS_Status', 'Chair', 'Chair_Phone', 'Note', 'Verified', 'Updated_At', 'Updated_By'];
const SOIL_PUBLIC = ['id', 'name', 'district_code', 'district', 'location', 'lat', 'lng', 'type', 'level', 'members', 'year_start', 'fund',
  'crops', 'network', 'organic', 'products', 'oss', 'oss_status', 'note', 'verified'];
const SOIL_KEYS = ['id', 'name', 'district_code', 'district', 'location', 'lat', 'lng', 'type', 'level', 'members', 'year_start', 'fund',
  'crops', 'network', 'organic', 'products', 'oss', 'oss_status', 'chair', 'chair_phone', 'note', 'verified'];

function soilRowToObj_(r) {
  const o = {};
  SOIL_KEYS.forEach(function (k, i) { o[k] = r[i]; });
  o.id = text_(o.id); o.district_code = String(o.district_code).replace(/\.0$/, '');
  o.lat = o.lat === '' ? null : Number(o.lat); o.lng = o.lng === '' ? null : Number(o.lng);
  o.members = Number(o.members) || 0; o.year_start = Number(o.year_start) || null; o.fund = Number(o.fund) || 0;
  o.verified = o.verified === true || String(o.verified).toUpperCase() === 'TRUE';
  ['name', 'district', 'location', 'type', 'level', 'crops', 'network', 'organic', 'products', 'oss', 'oss_status', 'chair', 'note'].forEach(function (k) { o[k] = text_(o[k]); });
  o.chair_phone = text_(o.chair_phone);
  return o;
}

function soilAll_() {
  const sh = spreadsheet_().getSheetByName(SOIL_SHEET);
  if (!sh) return [];
  return dataRows_(sh).filter(function (r) { return r[0] && r[1]; }).map(soilRowToObj_);
}

/** สำหรับหน้าเว็บสาธารณะ: ไม่มีชื่อ/เบอร์ประธาน */
function soilPublic_() {
  return soilAll_().map(function (o) { const p = {}; SOIL_PUBLIC.forEach(function (k) { p[k] = o[k]; }); return p; });
}

function soilObjToRow_(o, by) {
  return [o.id, cleanText_(o.name, 200), String(o.district_code || ''), cleanText_(o.district, 60), cleanText_(o.location, 200),
    o.lat === null || o.lat === undefined || o.lat === '' ? '' : Number(o.lat), o.lng === null || o.lng === undefined || o.lng === '' ? '' : Number(o.lng),
    cleanText_(o.type, 20), cleanText_(o.level, 2), Number(o.members) || 0, Number(o.year_start) || '', Number(o.fund) || 0,
    cleanText_(o.crops, 200), cleanText_(o.network, 400), cleanText_(o.organic, 200), cleanText_(o.products, 300),
    cleanText_(o.oss, 20), cleanText_(o.oss_status, 40), cleanText_(o.chair, 120), cleanText_(o.chair_phone, 40),
    cleanText_(o.note, 400), o.verified === true, new Date(), by];
}

function validateSoil_(o) {
  const e = [];
  if (!cleanText_(o.name, 200)) e.push('ไม่มีชื่อ ศดปช.');
  if (['หลัก', 'เครือข่าย', ''].indexOf(String(o.type || '')) < 0) e.push('ประเภทต้องเป็น หลัก หรือ เครือข่าย');
  const hasLat = o.lat !== null && o.lat !== undefined && o.lat !== '';
  if (hasLat && !(Number(o.lat) > 5 && Number(o.lat) < 21 && Number(o.lng) > 97 && Number(o.lng) < 106)) e.push('พิกัดไม่อยู่ในประเทศไทย');
  if (Number(o.members) < 0 || isNaN(Number(o.members || 0))) e.push('จำนวนสมาชิกไม่ถูกต้อง');
  return e;
}

/** ติดตั้งข้อมูลตั้งต้นเมื่อชีตยังว่าง */
function ensureSoil_() {
  const sh = ensureSheet_(SOIL_SHEET, SOIL_HEADERS);
  sh.getRange('C:C').setNumberFormat('@');
  sh.getRange('T:T').setNumberFormat('@');
  if (sh.getLastRow() >= 2 || typeof SOIL_SEED === 'undefined') return 'PASS: ชีต soil_centers พร้อม (' + Math.max(0, sh.getLastRow() - 1) + ' ศูนย์)';
  const rows = SOIL_SEED.map(function (o) { return soilObjToRow_(o, 'seed ทำเนียบ 2569'); });
  sh.getRange(2, 1, rows.length, SOIL_HEADERS.length).setValues(rows);
  return 'PASS: ใส่ข้อมูล ศดปช. ตั้งต้น ' + rows.length + ' ศูนย์';
}

function soilList_() { return soilAll_(); }

/** นำเข้าทำเนียบทั้งชุด (แทนที่ทั้งหมด) สำรองชีตเดิมไว้ก่อน */
function soilImport_(input, s) {
  input = input || {};
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (!rows.length) throw new Error('ไม่มีรายการ ศดปช.');
  if (rows.length > 2000) throw new Error('รายการมากเกินไป');
  const errs = [];
  rows.forEach(function (o, i) { const e = validateSoil_(o); if (e.length) errs.push('แถว ' + (i + 1) + ': ' + e.join(', ')); });
  if (errs.length) throw new Error(errs.slice(0, 5).join(' | '));
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = spreadsheet_();
    const sh = ensureSheet_(SOIL_SHEET, SOIL_HEADERS);
    const bakName = '_bak_SOIL' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMddHHmmss');
    sh.copyTo(ss).setName(bakName).hideSheet();
    const old = {};
    soilAll_().forEach(function (o) { old[o.name + '|' + o.district_code] = o; });
    const data = rows.map(function (o, i) {
      const prev = old[cleanText_(o.name, 200) + '|' + String(o.district_code || '')];
      // ถ้าไฟล์ใหม่ไม่มีข้อมูลประธาน ให้คงค่าเดิมไว้
      if (prev) { if (!o.chair) o.chair = prev.chair; if (!o.chair_phone) o.chair_phone = prev.chair_phone; }
      o.id = prev ? prev.id : 'S' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd') + String(i + 1).padStart(3, '0');
      return soilObjToRow_(o, s.username);
    });
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, SOIL_HEADERS.length).clearContent();
    sh.getRange(2, 1, data.length, SOIL_HEADERS.length).setValues(data);
    const baks = ss.getSheets().map(function (x) { return x.getName(); }).filter(function (n) { return n.indexOf('_bak_SOIL') === 0; }).sort();
    while (baks.length > 5) ss.deleteSheet(ss.getSheetByName(baks.shift()));
    invalidateData_();
    audit_(s, 'soil_import', cleanText_(input.fileName, 120) + ' ' + data.length + ' ศูนย์ (สำรอง ' + bakName + ')');
    return { message: 'นำเข้า ศดปช. ' + data.length + ' ศูนย์แล้ว (สำรองข้อมูลเดิมไว้ที่ชีต ' + bakName + ')', count: data.length };
  } finally {
    lock.releaseLock();
  }
}

/** แก้ไข/ยืนยันศูนย์เดียว (เช่น แก้พิกัด แล้วกดยืนยัน) */
function soilUpdate_(input, s) {
  input = input || {};
  const sh = sheetByName_(SOIL_SHEET);
  const rows = dataRows_(sh);
  const i = rows.findIndex(function (r) { return text_(r[0]) === String(input.id || ''); });
  if (i < 0) throw new Error('ไม่พบ ศดปช.');
  const o = soilRowToObj_(rows[i]);
  ['name', 'district_code', 'district', 'location', 'type', 'level', 'members', 'year_start', 'crops', 'note'].forEach(function (k) { if (k in input) o[k] = input[k]; });
  if ('lat' in input) { o.lat = input.lat === '' || input.lat === null ? null : Number(input.lat); o.lng = input.lng === '' || input.lng === null ? null : Number(input.lng); }
  if ('verified' in input) o.verified = !!input.verified;
  const e = validateSoil_(o);
  if (e.length) throw new Error(e.join(', '));
  sh.getRange(i + 2, 1, 1, SOIL_HEADERS.length).setValues([soilObjToRow_(o, s.username)]);
  invalidateData_();
  audit_(s, 'soil_update', o.id + ' ' + o.name + (o.verified ? ' (ยืนยันแล้ว)' : ''));
  return { message: 'บันทึก ' + o.name + ' แล้ว', item: o };
}

// ===================== SoilSeed.gs =====================
/** ข้อมูล ศดปช. ตั้งต้น (สร้างโดย tests/build-soil-seed.js ไม่มีข้อมูลส่วนบุคคล) */
const SOIL_SEED = [{"id":"S001","name":"ศดปช.บ้านพงษ์ทองคำ","district_code":"6210","district":"บึงสามัคคี","location":"หมู่ 7 ตำบลระหาน","lat":16.161338,"lng":99.949682,"type":"หลัก","level":"B","members":32,"year_start":2562,"fund":30000,"crops":"ข้าว","network":"ศพก.เครือข่าย,วสช.ข้าวปลอดภัยบ้านพงษ์ทองคำ,ศจช.บ้านพงษ์ทองคำ,แปลงใหญ่ข้าว2 หมู่ 7 ตำบลระหาน","organic":"","products":"ธาตุอาหารเสริมฤฉพืชทางใบ","oss":"ได้รับ","oss_status":"ดำเนินการอยู่","note":"","verified":true},{"id":"S002","name":"ศดปช.บ้านกระบวยทองใต้","district_code":"6210","district":"บึงสามัคคี","location":"หมู่ 2 ตำบลระหาน","lat":16.14098,"lng":99.971974,"type":"เครือข่าย","level":"C","members":46,"year_start":2560,"fund":20000,"crops":"ข้าว/ผัก","network":"ศพก.หลัก,วสช.กลุ่มเมล็ดเมล็ดพันธุ์ข้าวบ้านกระบวยทองใต้,ศจช.บ้านกระบวยทองใต้,แปลงใหญ่ข้าว หมู่ 2 ตำบลระหาน","organic":"","products":"ธาตุอาหารเสริมพืชทางใบ","oss":"","oss_status":"ไม่มีการดำเนินการ","note":"","verified":true},{"id":"S003","name":"ศดปช.บ้านดงเย็น","district_code":"6210","district":"บึงสามัคคี","location":"หมู่ 1 ตำบลระหาน","lat":16.156628,"lng":99.999117,"type":"เครือข่าย","level":"C","members":39,"year_start":2565,"fund":20000,"crops":"ข้าว","network":"ศพก.เครือข่าย.วสช.กลุ่มข้าวปลอดภัยบ้านดงเย็น,ศจช.บ้านดงเย็น,แปลงใหญ่ข้าว หมู่ 1 ตำบลระหาน","organic":"","products":"ธาตุอาหารเสริมพืชทางใบ","oss":"","oss_status":"ไม่มีการดำเนินการ","note":"","verified":true},{"id":"S004","name":"ศดปช.บ้านทุ่งสนุ่นใต้","district_code":"6210","district":"บึงสามัคคี","location":"หมู่ 3 ตำบลระหาน","lat":16.154494,"lng":99.943757,"type":"เครือข่าย","level":"C","members":30,"year_start":2565,"fund":20000,"crops":"ข้าว","network":"ศพก.เครือข่าย,วสช.ผลผลิตการเกษตรบ้านทุ่งสนุ่นใต้,ศจช.บ้านทุ่งสนุ่นใต้,แปลงใหญ่ข้าว หมู่ 3 ตำบลระหาน","organic":"","products":"","oss":"","oss_status":"ไม่มีการดำเนินการ","note":"","verified":true},{"id":"S005","name":"ศดปช.บ้านหนองจิก","district_code":"6210","district":"บึงสามัคคี","location":"หมู่ 6 ตำบลระหาน","lat":16.14109,"lng":99.926944,"type":"เครือข่าย","level":"C","members":35,"year_start":2564,"fund":30000,"crops":"ข้าว","network":"ศพก.เครือข่าย,วสช.ผู้ผลิตเมล็ดพันธุ์ข้าวบ้านหนองจิก,ศจช.บ้านหนองจิก,แปลงใหญ่ข้าว หมู่ 6 ตำบลระหาน","organic":"","products":"","oss":"","oss_status":"ไม่มีการดำเนินการ","note":"","verified":true},{"id":"S006","name":"ศดปช.บ้านคลองเจริญสุขพัฒนา","district_code":"6210","district":"บึงสามัคคี","location":"หมู่ 10 ตำบลระหาน","lat":16.136101,"lng":99.998883,"type":"เครือข่าย","level":"C","members":32,"year_start":2562,"fund":20000,"crops":"ข้าว","network":"ศพก.เครือข่าย,วสช.ข้าวปลอดภัยบ้านคลองเจริญสุขพัฒนา,ศจช.บ้านคลองเจริญสุขพัฒนา,แปลงใหญ่ข้าว หมู่ 10 ตำบลระหาน","organic":"","products":"","oss":"","oss_status":"ไม่มีการดำเนินการ","note":"","verified":true},{"id":"S007","name":"ศดปช.บ้านบึงบ้านพัฒนา","district_code":"6210","district":"บึงสามัคคี","location":"หมู่ 12 ตำบลบึงสามัคคี","lat":16.309828,"lng":100.009194,"type":"เครือข่าย","level":"C","members":31,"year_start":2560,"fund":0,"crops":"ข้าว","network":"ศพก.เครือข่าย,วสช.กลุ่มข้าวเข้มแข็งบ้านบึงบ้านพัฒนา,ศจช.บ้านบึงบ้านพัฒนา,แปลงใหญ่ข้าว หมู่ 12 ตำบลบึงสามัคคี","organic":"","products":"","oss":"","oss_status":"ไม่มีการดำเนินการ","note":"","verified":true},{"id":"S008","name":"ศดปช.บ้านหนองเสือ","district_code":"6210","district":"บึงสามัคคี","location":"หมู่ 2 ตำบลวังชะโอน","lat":16.17254,"lng":100.007961,"type":"เครือข่าย","level":"B","members":35,"year_start":2560,"fund":100000,"crops":"ข้าว","network":"ศพก.เครือข่าย,วสช.กลุ่มโรงสีข้าวเพื่อชุมชนบ้านหนองเสือ,ศจช.บ้านหนองเสือ,แปลงใหญ่ข้าว หมู่ 2 ตำบลวังชะโอน","organic":"","products":"ธาตุอาหารเสริมพืชทางใบ","oss":"","oss_status":"ไม่มีการดำเนินการ","note":"","verified":true},{"id":"S009","name":"ศดปช. ต.มหาชัย","district_code":"6202","district":"ไทรงาม","location":"ต.มหาชัย","lat":16.502324,"lng":99.772768,"type":"หลัก","level":"C","members":37,"year_start":2559,"fund":3700,"crops":"ข้าว","network":"ศพก. ศจช.บ้านศรีวิไล วสช.กลุ่มข้าวนาแปลงใหญ่บ้านศรีวิไล","organic":"","products":"","oss":"","oss_status":"","note":"","verified":true},{"id":"S010","name":"ศดปช. ต.พานทอง","district_code":"6202","district":"ไทรงาม","location":"ต.พานทอง","lat":16.35795,"lng":99.840581,"type":"เครือข่าย","level":"C","members":44,"year_start":2565,"fund":0,"crops":"ข้าว","network":"ศพก. ศจช.บ้านหนองโดนใต้","organic":"","products":"","oss":"","oss_status":"","note":"ไม่ระบุอำเภอ (ใช้อำเภอจากพิกัด)","verified":false},{"id":"S011","name":"ศดปช. บ้านโคกเจริญ ต.หนองทอง","district_code":"6202","district":"ไทรงาม","location":"ต.หนองทอง","lat":16.427929,"lng":99.774497,"type":"เครือข่าย","level":"C","members":20,"year_start":2568,"fund":0,"crops":"ข้าว","network":"ศจช.บ้านโคกเจริญ","organic":"","products":"","oss":"","oss_status":"","note":"ไม่ระบุอำเภอ (ใช้อำเภอจากพิกัด)","verified":false},{"id":"S012","name":"ศดปช. บ้านลำมะโกรก","district_code":"6207","district":"ลานกระบือ","location":"ม.2 ต.หนองหลวง อ.ลานกระบือ","lat":16.592702,"lng":99.736925,"type":"หลัก","level":"C","members":20,"year_start":2558,"fund":5000,"crops":"ข้าว","network":"ศพก.บ้านลำมะโกรก, วสช.กลุ่มเมล็ดพันธุ์ข้าวก้าวหน้าบ้านลำมะโกรก, ศจช.บ้านลำมะโกรก","organic":"","products":"","oss":"","oss_status":"ไม่มีการดำเนินการ","note":"","verified":true},{"id":"S013","name":"ศดปช. บ้านมะหาดหวาน","district_code":"6207","district":"ลานกระบือ","location":"ม.11 ต.ลานกระบือ","lat":16.649636,"lng":99.829222,"type":"เครือข่าย","level":"C","members":20,"year_start":2566,"fund":0,"crops":"ผักปลอดภัย","network":"ศพก.บ้านมะหาดหวาน, วสช.เกษตรปลอดภัยบ้านมะหาดหวาน, ศจช.บ้านมะหาดหวาน","organic":"","products":"","oss":"","oss_status":"ไม่มีการดำเนินการ","note":"","verified":true},{"id":"S014","name":"ศดปช. บ้านนาถัง","district_code":"6206","district":"พรานกระต่าย","location":"ม.5 ต.ถ้ำกระต่ายทอง","lat":16.6587,"lng":99.592,"type":"หลัก","level":"C","members":25,"year_start":2559,"fund":0,"crops":"","network":"","organic":"","products":"","oss":"","oss_status":"","note":"ข้อมูลในแถวต้นฉบับเลื่อนคอลัมน์ (ปรับให้แล้ว ไม่มีข้อมูลพืชหลัก) · ประเภทจากข้อความ","verified":false},{"id":"S015","name":"ศดปช. บ้านวังตะกู","district_code":"6206","district":"พรานกระต่าย","location":"ม.11 ต.วังควง","lat":16.829146,"lng":99.43301,"type":"เครือข่าย","level":"C","members":25,"year_start":2558,"fund":0,"crops":"","network":"","organic":"","products":"","oss":"","oss_status":"","note":"ข้อมูลในแถวต้นฉบับเลื่อนคอลัมน์ (ปรับให้แล้ว ไม่มีข้อมูลพืชหลัก) · ประเภทจากข้อความ","verified":false},{"id":"S016","name":"ศดปช.บ้านปางเหนือ","district_code":"6209","district":"ปางศิลาทอง","location":"ม.6 ต.ปางตาไว อ.ปางศิลาทอง","lat":16.056091,"lng":99.347075,"type":"หลัก","level":"C","members":30,"year_start":2558,"fund":4000,"crops":"มันสำปะหลัง","network":"ศจช. บ้านปางเหนือ","organic":"","products":"","oss":"","oss_status":"","note":"","verified":true},{"id":"S017","name":"ศดปช.บ้านปางมะละกอ","district_code":"6209","district":"ปางศิลาทอง","location":"ม.8 ต.ปางตาไว อ.ปางศิลาทอง","lat":15.993821,"lng":99.399754,"type":"เครือข่าย","level":"C","members":30,"year_start":2558,"fund":0,"crops":"มันสำปะหลัง","network":"ศจช. บ้านปางมะละกอ","organic":"","products":"","oss":"","oss_status":"","note":"","verified":true},{"id":"S018","name":"ศดปช.บ้านเพชรเจริญ","district_code":"6209","district":"ปางศิลาทอง","location":"ม.3 ต.ปางตาไว อ.ปางศิลาทอง","lat":16.023136,"lng":99.370751,"type":"เครือข่าย","level":"C","members":20,"year_start":2568,"fund":0,"crops":"มันสำปะหลัง","network":"","organic":"","products":"","oss":"","oss_status":"","note":"","verified":true},{"id":"S019","name":"ศดปช.บ้านสักงาม","district_code":"6203","district":"คลองลาน","location":"หมู่ 1 ต.สักงาม อ.คลองลาน จ.กำแพงเพชร","lat":16.327747,"lng":99.32257,"type":"หลัก","level":"C","members":20,"year_start":2558,"fund":0,"crops":"ข้าว,มันสำปะหลัง,ข้าวโพด และถั่วเหลือง","network":"ศจช., วสช.","organic":"","products":"","oss":"","oss_status":"ไม่มีการดำเนินการ","note":"สลับ lat/long","verified":false},{"id":"S020","name":"ศดปช.บ้านสามัคคีธรรม","district_code":"6203","district":"คลองลาน","location":"หมู่ 16 ต.คลองน้ำไหล อ.คลองลาน จ.กำแพงเพชร","lat":16.22686,"lng":99.2894,"type":"เครือข่าย","level":"C","members":20,"year_start":2566,"fund":0,"crops":"มันสำปะหลัง","network":"","organic":"","products":"","oss":"","oss_status":"ไม่มีการดำเนินการ","note":"สลับ lat/long","verified":false},{"id":"S021","name":"ศดปช. บ้านอุบลสามัคคี","district_code":"6208","district":"ทรายทองวัฒนา","location":"ม.9 ต.ทุ่งทอง","lat":16.34918,"lng":99.89362,"type":"หลัก","level":"C","members":25,"year_start":2559,"fund":0,"crops":"ข้าว","network":"แปลงใหญ่","organic":"","products":"","oss":"","oss_status":"ไม่มีการดำเนินการ","note":"สลับ lat/long","verified":false},{"id":"S022","name":"ศดปช. บ้านบึงสำราญ","district_code":"6208","district":"ทรายทองวัฒนา","location":"ม.7 ต.ถาวรวัฒนา","lat":16.31461,"lng":99.93496,"type":"เครือข่าย","level":"C","members":30,"year_start":2559,"fund":0,"crops":"ข้าว","network":"แปลงใหญ่","organic":"","products":"","oss":"","oss_status":"ไม่มีการดำเนินการ","note":"สลับ lat/long","verified":false},{"id":"S023","name":"ศดปช. ทุ่งทรายเหนือ","district_code":"6208","district":"ทรายทองวัฒนา","location":"ม.15 ต.ทุ่งทราย","lat":16.31193,"lng":99.8289,"type":"เครือข่าย","level":"C","members":28,"year_start":2566,"fund":0,"crops":"ข้าว","network":"","organic":"","products":"","oss":"","oss_status":"ไม่มีการดำเนินการ","note":"สลับ lat/long","verified":false},{"id":"S024","name":"ศดปช.ตำบลวังแขม","district_code":"6205","district":"คลองขลุง","location":"ม.8 ต.วังแขม","lat":16.2056,"lng":99.8558,"type":"หลัก","level":"C","members":33,"year_start":2564,"fund":60000,"crops":"ข้าว","network":"ศจช.บ้านบ่อทอง วสช.กลุ่มผู้ผลิตพืชปลอดภัยตำบลวังแขม","organic":"","products":"ผสมปุ๋ย","oss":"","oss_status":"","note":"","verified":true},{"id":"S025","name":"ศดปช. บ้านคลองสมบูรณ์","district_code":"6205","district":"คลองขลุง","location":"ม.7 ต.คลองสมบูรณ์","lat":16.2321,"lng":99.5421,"type":"เครือข่าย","level":"C","members":30,"year_start":2558,"fund":0,"crops":"มันสำปะหลัง","network":"","organic":"","products":"","oss":"","oss_status":"","note":"","verified":true},{"id":"S026","name":"ศดปช. เครือข่ายบ้านเกาะรากเสียดใน","district_code":"6211","district":"โกสัมพีนคร","location":"หมู่ 7 ตำบลเพชรชมภู","lat":16.634948,"lng":99.404226,"type":"เครือข่าย","level":"C","members":20,"year_start":2566,"fund":0,"crops":"ข้าว","network":"ศพก.","organic":"","products":"","oss":"","oss_status":"ไม่มีการดำเนินการ","note":"","verified":true},{"id":"S027","name":"ศดปช. บ้านหนองบง","district_code":"6211","district":"โกสัมพีนคร","location":"หมู่ 21 ตำบลโกสัมพี","lat":16.648688,"lng":99.357329,"type":"หลัก","level":"C","members":30,"year_start":2559,"fund":2000,"crops":"มันสำปะหลัง","network":"วสช./ศพก.","organic":"","products":"","oss":"","oss_status":"ไม่มีการดำเนินการ","note":"ไม่ระบุอำเภอ (ใช้อำเภอจากพิกัด)","verified":false},{"id":"S028","name":"ศดปช.เครือข่าย ตำบลอ่างทอง","district_code":"6201","district":"เมืองกำแพงเพชร","location":"หมู่ที่ 14 ต.อ่างทอง","lat":16.183328,"lng":99.491157,"type":"เครือข่าย","level":"C","members":30,"year_start":2562,"fund":0,"crops":"มันสำปะหลัง","network":"วิสาหกิจชุมชน เกษตรแปลงใหญ่ บ้านทุ่งรวงทอง","organic":"","products":"","oss":"","oss_status":"ไม่มีการดำเนินการ","note":"แปลงจาก UTM 47N (552502, 1789277) · พิกัดอยู่ใน อ.คลองขลุง แต่ระบุ อ.เมืองกำแพงเพชร","verified":false},{"id":"S029","name":"ศดปช.ตำบลบ้านทรงธรรม","district_code":"6201","district":"เมืองกำแพงเพชร","location":"หมู่ที่ 4 ต.ทรงธรรม","lat":16.519963,"lng":99.433618,"type":"หลัก","level":"C","members":20,"year_start":2555,"fund":0,"crops":"มันสำปะหลัง","network":"","organic":"","products":"","oss":"","oss_status":"ไม่มีการดำเนินการ","note":"แปลงจาก UTM 47N (546272, 1826502)","verified":false},{"id":"S030","name":"ศดปช.ตำบลโค้งไผ่","district_code":"6204","district":"ขาณุวรลักษบุรี","location":"ม.5 ต.โค้งไผ่ อ.ขาณุวรลักษบุรี","lat":16.122985,"lng":99.712824,"type":"เครือข่าย","level":"C","members":20,"year_start":2558,"fund":0,"crops":"ข้าว","network":"ศพก.","organic":"","products":"","oss":"","oss_status":"ไม่มีการดำเนินการ","note":"แปลงจาก UTM 47N (576221, 1782671)","verified":false},{"id":"S031","name":"ศดปช.บ้านใหม่คลองสะพานช้าง","district_code":"6204","district":"ขาณุวรลักษบุรี","location":"24 ต.ปางมะค่า อ.ขาณุวรลักษบุรี","lat":15.935994,"lng":99.64461,"type":"หลัก","level":"C","members":20,"year_start":2567,"fund":0,"crops":"ข้าว","network":"ศพก.","organic":"","products":"","oss":"","oss_status":"ไม่มีการดำเนินการ","note":"แปลงจาก UTM 47N (568991, 1761962)","verified":false}];
