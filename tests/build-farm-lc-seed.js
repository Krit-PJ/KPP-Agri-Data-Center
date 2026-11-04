// สร้างข้อมูลตั้งต้น "กลุ่มแปลงใหญ่" และ "ศพก." (ไม่มีข้อมูลส่วนบุคคล — ตัดชื่อ/เบอร์ผู้จัดการ ประธาน เกษตรกรต้นแบบ เจ้าหน้าที่)
// ใช้: node tests/build-farm-lc-seed.js <ไฟล์ส่งออกแปลงใหญ่.xlsx> <ไฟล์พิกัดแปลงใหญ่.xlsx>
// ไฟล์ต้นฉบับมีข้อมูลส่วนบุคคล ห้าม commit เข้า repo
'use strict';
const fs = require('fs'), path = require('path');
const XLSX = require('xlsx'), Papa = require('papaparse');
const S = require('../assets/js/admin/soil-parser.js');
const F = require('../assets/js/admin/farm-parser.js');
const ROOT = path.join(__dirname, '..');
const geo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/kpp_districts.json')));
const districts = Papa.parse(fs.readFileSync(path.join(ROOT, 'data/districts.csv'), 'utf8').trim(), { header: true }).data;
const codeOf = (name) => (districts.find((d) => d.district === name || d.district.replace('กำแพงเพชร', '') === name) || {}).district_code || '';
const grids = (file) => { const wb = XLSX.readFile(file); return wb.SheetNames.map((n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' })); };

// ---------- กลุ่มแปลงใหญ่ ----------
const PII = ['manager', 'manager_position', 'manager_phone', 'chair', 'chair_phone'];
const farms = grids(process.argv[2]).map((g) => F.parse(g, { districts })).filter((r) => r.kind === 'farms').flatMap((r) => r.rows);
const coords = grids(process.argv[3]).map((g) => F.parse(g)).filter((r) => r.kind === 'coords').flatMap((r) => r.rows);
const res = F.applyCoords(farms, coords);
// ตรวจว่าพิกัดอยู่ในอำเภอเดียวกับที่ระบุ (ไม่แก้อัตโนมัติ แค่หมายเหตุ)
farms.forEach((f) => {
  if (f.lat === null) { f.coord_note = 'ยังไม่มีพิกัด'; return; }
  const at = S.districtAt(f.lat, f.lng, geo);
  if (at && f.district_code && at.code !== f.district_code) f.coord_note = (f.coord_note ? f.coord_note + '; ' : '') + 'พิกัดตกในอำเภอ' + at.name;
});
const pubFarms = farms.map((f) => { const o = { ...f }; PII.forEach((k) => delete o[k]); return o; });

// ---------- ศพก. หลัก (บัญชี ศพก. ปี 2567 พิกัด UTM 47N; พื้นที่/เกษตรกรเป้าหมายจากรายละเอียด ศพก. ปี 2566) ----------
const LC_MAIN = [
  ['เมืองกำแพงเพชร', '6', 'เทพนคร', 'ข้าว', 563165, 1821539, 42000, 1200, 'การใช้สารชีวภัณฑ์ในการป้องกันกำจัดศัตรูข้าว', 23],
  ['ไทรงาม', '8', 'มหาชัย', 'ข้าว', 582472, 1824659, 202979, 6804, 'การใช้สารชีวภาพกำจัดแมลงศัตรูพืช; การลดต้นทุนการผลิตข้าว; การใช้ปุ๋ยตามค่าวิเคราะห์ดิน; การผลิตข้าวปลอดภัย (GAP)', 16],
  ['คลองลาน', '12', 'คลองลานพัฒนา', 'ไร่นาสวนผสม', 541117, 1781119, 100, 100, 'การจัดการพื้นที่ตามหลักเกษตรทฤษฎีใหม่', 12],
  ['ขาณุวรลักษบุรี', '8', 'วังหามแห', 'มันสำปะหลัง', 561610, 1773319, 166818, 6433, 'การเพิ่มประสิทธิภาพการผลิตมันสำปะหลัง; การปลูกพืชทางเลือกทดแทนมันสำปะหลัง', 18],
  ['คลองขลุง', '7', 'หัวถนน', 'ข้าว', 564609, 1800944, 180150, 6201, 'การลดต้นทุนการผลิตข้าว; การใช้สารชีวภัณฑ์ลดต้นทุน', 23],
  ['พรานกระต่าย', '3', 'เขาคีริส', 'ข้าว', 577745, 1830763, null, null, 'การใช้สารชีวภัณฑ์', 19],
  ['ลานกระบือ', '2', 'หนองหลวง', 'ข้าว', 578610, 1834643, 157876, 4762, 'การลดต้นทุนการผลิตข้าว; การผลิตเมล็ดพันธุ์ข้าว', 20],
  ['ทรายทองวัฒนา', '9', 'ทุ่งทอง', 'ข้าว', 595446, 1807771, 48250, 500, 'การลดต้นทุนการผลิตข้าว; การผลิตข้าวอินทรีย์', 18],
  ['ปางศิลาทอง', '9', 'โพธิ์ทอง', 'ข้าว', 556830, 1781388, 45589, 6490, 'การลดต้นทุนการผลิตข้าว; การเพิ่มผลผลิตข้าว', 16],
  ['บึงสามัคคี', '2', 'ระหาน', 'ข้าว', 603931, 1784750, null, null, 'การจัดการศัตรูพืชแบบผสมผสาน', 30],
  ['โกสัมพีนคร', '8', 'ลานดอกไม้ตก', 'ข้าว', 548329, 1833415, null, null, 'การลดต้นทุนการผลิตข้าว; ส่งเสริมการใช้เมล็ดพันธุ์ข้าวพันธุ์ดี', 11],
];
const lc = LC_MAIN.map(([district, moo, tambon, commodity, x, y, area, farmers, highlight, network], i) => {
  const [lat, lng] = S.utmToLatLng(x, y);
  const at = S.districtAt(lat, lng, geo);
  return {
    id: 'L' + String(i + 1).padStart(2, '0'), name: 'ศพก. อำเภอ' + district, district, district_code: codeOf(district), moo, tambon, commodity,
    lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, utm_x: x, utm_y: y,
    target_area: area, target_farmers: farmers, highlight, network,
    coord_note: at && at.code !== codeOf(district) ? 'พิกัดตกในอำเภอ' + at.name : '',
  };
});
// ศพก. เครือข่าย 206 แห่ง จำแนกตามประเภท (อินโฟกราฟิก ศพก. จ.กำแพงเพชร อัพเดต 30 ส.ค. 2567)
const LC_TYPE = [['ศดปช.', 11], ['ศชข.', 11], ['ท่องเที่ยวเชิงเกษตร', 1], ['ปราชญ์ชาวบ้าน', 4], ['การจัดการดิน', 2], ['แปรรูปผลิตผล', 22],
  ['ศูนย์ข้าวชุมชน', 35], ['ประมง', 10], ['ปศุสัตว์', 6], ['พืชไร่', 12], ['มาตรฐานการเกษตร', 7], ['ไม้ผล', 11], ['ไม้ยืนต้น', 4],
  ['เศรษฐกิจเกษตร', 3], ['หม่อนไหม', 1], ['พืชผัก', 8], ['เศรษฐกิจพอเพียง', 57], ['อื่นๆ (กล้วยไม้)', 1]].map(([type, count]) => ({ type, count }));
const lcNet = lc.map((r) => ({ district: r.district, district_code: r.district_code, count: r.network }));
const sum = (a, k) => a.reduce((s, r) => s + (r[k] || 0), 0);
if (sum(LC_TYPE, 'count') !== 206 || sum(lcNet, 'count') !== 206) throw new Error('ยอดเครือข่าย ศพก. ไม่ตรง 206');

// ---------- เขียนไฟล์ ----------
const out = (f, o) => fs.writeFileSync(path.join(ROOT, f), JSON.stringify(o, null, 1));
out('data/large_farms.json', { source: 'ระบบแปลงใหญ่ กรมส่งเสริมการเกษตร ปี 2569 + พิกัดแปลงใหญ่ ปี 2566', rows: pubFarms });
out('data/lc_centers.json', { source: 'บัญชี ศพก. หลัก ปี 2567 / รายละเอียด ศพก. ปี 2566 / อินโฟกราฟิก ศพก. (30 ส.ค. 2567)', rows: lc, network: lcNet, types: LC_TYPE });
fs.writeFileSync(path.join(ROOT, 'apps-script/FarmSeed.gs'),
  '/** ข้อมูลตั้งต้น กลุ่มแปลงใหญ่ และ ศพก. (สร้างโดย tests/build-farm-lc-seed.js ไม่มีข้อมูลส่วนบุคคล) */\n' +
  'const FARM_SEED = ' + JSON.stringify(pubFarms) + ';\nconst LC_SEED = ' + JSON.stringify(lc) + ';\n' +
  'const LCNET_SEED = ' + JSON.stringify(lcNet) + ';\nconst LCTYPE_SEED = ' + JSON.stringify(LC_TYPE) + ';\n');
console.log('farms', pubFarms.length, 'with coords', pubFarms.filter((f) => f.lat !== null).length, 'matched', res.matched, 'unmatched', res.unmatched.length);
console.log('farm coord notes:', pubFarms.filter((f) => f.coord_note && f.coord_note !== 'ยังไม่มีพิกัด' && !/^แปลงจาก/.test(f.coord_note)).map((f) => f.name.slice(0, 40) + ' → ' + f.coord_note));
console.log('lc', lc.length, lc.filter((r) => r.coord_note).map((r) => r.name + ' ' + r.coord_note));
