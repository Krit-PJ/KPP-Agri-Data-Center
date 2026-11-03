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
