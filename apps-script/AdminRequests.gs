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
