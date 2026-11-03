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

/** สร้าง Super Admin คนแรกจาก Script Properties แล้วลบรหัสผ่านตัวจริงทิ้ง */
function ensureSuperAdmin_() {
  const props = PropertiesService.getScriptProperties();
  const sh = sheetByName_('admins');
  const hasSuper = dataRows_(sh).some(function (r) { return text_(r[2]) === 'super' && text_(r[3]) !== 'disabled'; });
  const username = normalizeUsername_(props.getProperty('SUPER_ADMIN_USERNAME'));
  const password = props.getProperty('SUPER_ADMIN_PASSWORD');
  if (!password) return hasSuper ? 'PASS: มี Super Admin แล้ว' : 'INFO: ยังไม่มี Super Admin — ตั้ง Script Properties SUPER_ADMIN_USERNAME และ SUPER_ADMIN_PASSWORD แล้วรัน setupSystem() อีกครั้ง';
  if (!validUsername_(username)) return 'FAIL: SUPER_ADMIN_USERNAME ต้องยาว 3–32 ตัว (a–z, 0–9, . _ -)';
  try { validatePassword_(password); } catch (e) { return 'FAIL: SUPER_ADMIN_PASSWORD — ' + e.message; }
  const salt = Utilities.getUuid();
  const now = new Date();
  const a = adminRecord_(username);
  if (a) {
    sh.getRange(a.row, 3, 1, 4).setValues([['super', 'active', hashPassword_(salt, password), salt]]);
    sh.getRange(a.row, 10).setValue(now);
  } else {
    sh.appendRow([username, 'Super Admin', 'super', 'active', hashPassword_(salt, password), salt, now, 'setupSystem', '', now, '']);
  }
  props.deleteProperty('SUPER_ADMIN_PASSWORD');
  audit_({ username: username, name: 'Super Admin', role: 'super' }, 'super_bootstrap', 'สร้าง Super Admin จาก Script Properties');
  return 'PASS: Super Admin "' + username + '" พร้อมใช้งาน (ลบ SUPER_ADMIN_PASSWORD ออกจาก Script Properties แล้ว)';
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
