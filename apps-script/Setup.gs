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
