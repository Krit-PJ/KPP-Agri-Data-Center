/** อ่านข้อมูลจากชีต data / districts, cache, และชีตมุมมองรายพืช */
const BOOT_CACHE_KEY = 'boot:v2.2';
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
