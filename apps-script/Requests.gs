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
