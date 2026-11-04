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
