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
