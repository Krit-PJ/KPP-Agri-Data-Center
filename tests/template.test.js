'use strict';
// ตรวจว่า Template ทุกไฟล์ (assets/templates) กรอกแล้วนำเข้าด้วยตัวอ่านของระบบได้จริง
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const XLSX = require('xlsx'), Papa = require('papaparse');
const Importer = require('../assets/js/admin/importer.js');
const SoilParser = require('../assets/js/admin/soil-parser.js');
const PestParser = require('../assets/js/admin/pest-parser.js');
const FarmParser = require('../assets/js/admin/farm-parser.js');
const GenericParser = require('../assets/js/admin/generic-parser.js');
const { createGas, seedFromCsv } = require('./gas-mock');

const ROOT = path.join(__dirname, '..'), T = path.join(ROOT, 'assets/templates');
const geo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/kpp_districts.json')));
const districts = Papa.parse(fs.readFileSync(path.join(ROOT, 'data/districts.csv'), 'utf8').trim(), { header: true }).data;
const CROPS = ['ข้าวนาปี', 'ข้าวนาปรัง', 'ข้าวโพด รุ่น1', 'ข้าวโพด รุ่น2', 'มันสำปะหลัง', 'อ้อย', 'ปาล์มน้ำมัน', 'ยางพารา', 'กล้วยไข่'];
const g = createGas({ gsDir: path.join(ROOT, 'apps-script'), seed: seedFromCsv(path.join(ROOT, 'data/agri_data.csv'), path.join(ROOT, 'data/districts.csv')) });
const SCHEMA = Object.fromEntries(JSON.parse(vm.runInContext('JSON.stringify(dsSchema_({role:"super"}))', g.ctx)).map((d) => [d.name, d]));

/** เปิด Template แล้วเขียนค่าลงเซลล์ (เหมือนผู้ใช้กรอกใน Excel) แล้วอ่านกลับเป็น grid */
function fill(file, cells) {
  const wb = XLSX.readFile(path.join(T, file));
  const ws = wb.Sheets['กรอกข้อมูล'];
  Object.entries(cells).forEach(([a, v]) => { ws[a] = { t: typeof v === 'number' ? 'n' : 's', v }; });
  const out = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  return { grid: XLSX.utils.sheet_to_json(out.Sheets['กรอกข้อมูล'], { header: 1, raw: true, defval: '' }), names: out.SheetNames };
}
const col = (grid, row, re) => (grid[row] || []).findIndex((v) => re.test(String(v)));
const A = (c, r) => XLSX.utils.encode_cell({ c, r });

test('มี Template ครบทุกชุด และชีตคำอธิบาย/รายการ', () => {
  ['crops', 'soil', 'pest', 'farm', 'lc', 'lcnet', 'lctype'].forEach((n) => {
    const wb = XLSX.readFile(path.join(T, `template_${n}.xlsx`));
    assert.deepStrictEqual(wb.SheetNames, ['กรอกข้อมูล', 'รายการ', 'คำอธิบาย'], n);
  });
});

test('Template พืชเศรษฐกิจ: ทุกชนิดพืช × ปี อ่านได้ครบ 11 อำเภอ และคำนวณผลผลิต/ไร่', () => {
  CROPS.forEach((crop) => {
    const cells = { B1: crop, B2: 2568 };
    districts.forEach((d, i) => { cells[`B${6 + i}`] = 1000 + i; cells[`C${6 + i}`] = 900; cells[`D${6 + i}`] = 450; });
    const { grid } = fill('template_crops.xlsx', cells);
    const t = Importer.extractTable(grid, { name: 'กรอกข้อมูล', districts, crops: CROPS });
    assert.deepStrictEqual(t.problems, [], crop);
    assert.strictEqual(t.crop, crop);
    assert.strictEqual(t.year, 2568);
    assert.strictEqual(t.rows.length, 11);
    assert.deepStrictEqual([t.rows[0].planted, t.rows[0].harvested, t.rows[0].production, t.rows[0].yield_harvested], [1000, 900, 450, 500]);
  });
  // ยังไม่เลือกพืช/ปี → ระบบขอให้เลือก (หน้านำเข้ามีช่องเลือก)
  const t = Importer.extractTable(fill('template_crops.xlsx', { B6: 5 }).grid, { name: 'กรอกข้อมูล', districts, crops: CROPS });
  assert.ok(t.problems.some((p) => /ไม่พบปี/.test(p)) && t.problems.some((p) => /ไม่พบชนิดพืช/.test(p)));
});

test('Template ศดปช.: ประเภท ✓ พิกัด UTM/องศา และข้อมูลส่วนบุคคล', () => {
  const { grid: g0 } = fill('template_soil.xlsx', {});
  const c = (re, row = 0) => col(g0, row, re);
  const lat = col(g0, 1, /^lat/), main = col(g0, 1, /ศูนย์หลัก/), net = col(g0, 1, /ศูนย์เครือข่าย/);
  const cells = {};
  const put = (r, ci, v) => { cells[A(ci, r)] = v; };
  put(2, c(/^อำเภอ/), 'เมืองกำแพงเพชร'); put(2, c(/ชื่อ ศดปช/), 'ศดปช.ตำบลทดสอบ'); put(2, lat, 16.4827); put(2, lat + 1, 99.5226); put(2, main, '✓');
  put(2, c(/จำนวนสมาชิก/), 25); put(2, c(/ประธาน$/), 'นายทดสอบ ระบบ'); put(2, c(/ปีที่เริ่ม/), 2560);
  put(3, c(/^อำเภอ/), 'คลองขลุง'); put(3, c(/ชื่อ ศดปช/), 'ศดปช.บ้านทดสอบ'); put(3, lat, 563165); put(3, lat + 1, 1800944); put(3, net, '✓');
  const r = SoilParser.parse(fill('template_soil.xlsx', cells).grid, { geo, districts });
  assert.strictEqual(r.rows.length, 2);
  assert.deepStrictEqual([r.rows[0].type, r.rows[0].members, r.rows[0].chair, r.rows[0].year_start, r.rows[0].district_code], ['หลัก', 25, 'นายทดสอบ ระบบ', 2560, '6201']);
  assert.strictEqual(r.rows[1].type, 'เครือข่าย');
  assert.ok(Math.abs(r.rows[1].lat - 16.29) < 0.05, 'UTM แปลงแล้ว');
});

test('Template ศจช.: รูปแบบเดียวกับไฟล์จากระบบ ศจช.', () => {
  const cells = { B4: 'ศูนย์จัดการศัตรูพืชชุมชนบ้านทดสอบ', C4: 2560, D4: 'B', E4: 20, F4: 'A', G4: 3, H4: 'นครชุม', I4: 'เมืองกำแพงเพชร',
    K4: 553289, L4: 1825788, M4: 'นาย', N4: 'ทดสอบ', O4: 'ระบบ', P4: 'ข้าวเจ้า', Q4: 'ใช่', R4: 'ไม่ใช่', S4: 'ใช่', T4: 'ใช่', U4: 'วิสาหกิจชุมชน; ศูนย์ข้าวชุมชน', V4: 'เชื้อราไตรโคเดอร์มาพร้อมใช้' };
  const r = PestParser.parse(fill('template_pest.xlsx', cells).grid, { geo, districts });
  assert.strictEqual(r.kind, 'pest');
  assert.strictEqual(r.levelYear, '2569');
  assert.strictEqual(r.rows.length, 1);
  const o = r.rows[0];
  assert.deepStrictEqual([o.name, o.level, o.members, o.district_code, o.area_farm, o.area_risk, o.area_gap, o.chair], ['ศจช. บ้านทดสอบ', 'A', 20, '6201', true, false, true, 'นายทดสอบ ระบบ']);
  assert.ok(o.lat > 16 && o.lng > 99);
  assert.deepStrictEqual(r.problems, []);
});

test('Template แปลงใหญ่: หัวคอลัมน์ระบบแปลงใหญ่ + พิกัด + ใช่/ไม่ใช่', () => {
  const { grid: g0 } = fill('template_farm.xlsx', {});
  const h = g0[1];
  const at = (name, nth = 0) => { let k = -1; for (let i = 0; i <= nth; i++) k = h.indexOf(name, k + 1); return k; };
  const cells = {};
  const put = (ci, v) => { cells[A(ci, 2)] = v; };
  put(at('ประเภทแปลงใหญ่'), 'แปลงใหญ่ปี 2567'); put(at('สินค้าหลัก'), 'ข้าว'); put(at('ชื่อแปลงใหญ่'), 'แปลงใหญ่ข้าว หมู่ 1 ตำบลทดสอบ');
  put(at('อำเภอ'), 'ไทรงาม'); put(at('เกษตรกร'), 40); put(at('พื้นที่(ไร่)', 1), 812.5); put(at('GAP'), 'ใช่'); put(at('อินทรีย์'), 'ไม่ใช่');
  put(at('ชื่อประธาน'), 'ทดสอบ'); put(at('โทรศัพท์', 1), '0812345678');
  put(h.findIndex((t) => /^ละติจูด/.test(t)), 582472); put(h.findIndex((t) => /^ลองจิจูด/.test(t)), 1824659);
  const r = FarmParser.parse(fill('template_farm.xlsx', cells).grid, { districts });
  assert.strictEqual(r.kind, 'farms');
  const o = r.rows[0];
  assert.deepStrictEqual([o.year_start, o.district_code, o.members, o.plot_area, o.gap, o.organic, o.chair_phone], [2567, '6202', 40, 812.5, true, false, '0812345678']);
  assert.ok(o.lat > 16.4 && o.lat < 16.6, 'UTM → lat');
});

test('Template ศพก. (สร้างจาก schema): อ่านด้วย GenericParser', () => {
  const { grid: g0 } = fill('template_lc.xlsx', {});
  const h = g0[0].map(GenericParser.headKey);
  const ci = (label) => h.indexOf(label);
  const cells = {};
  cells[A(ci('ชื่อศูนย์'), 1)] = 'ศพก. อำเภอทดสอบ'; cells[A(ci('อำเภอ'), 1)] = 'ไทรงาม'; cells[A(ci('utm x (47n)'), 1)] = 582472; cells[A(ci('utm y (47n)'), 1)] = 1824659;
  cells[A(ci('เกษตรกรต้นแบบ'), 1)] = 'นายทดสอบ';
  const r = GenericParser.parse(fill('template_lc.xlsx', cells).grid, SCHEMA.lc, { districts, geo });
  assert.strictEqual(r.rows.length, 1);
  assert.deepStrictEqual([r.rows[0].district_code, r.rows[0].farmer], ['6202', 'นายทดสอบ']);
  assert.ok(r.rows[0].lat > 16.4, 'UTM → lat');
  // ศพก. เครือข่าย: มีชื่อ 11 อำเภอให้แล้ว กรอกแค่จำนวน
  const g1 = fill('template_lcnet.xlsx', {}).grid;
  const cnt = g1[0].map(GenericParser.headKey).indexOf('จำนวน (แห่ง)');
  const cells2 = {}; districts.forEach((d, i) => { cells2[A(cnt, i + 1)] = i + 1; });
  const n = GenericParser.parse(fill('template_lcnet.xlsx', cells2).grid, SCHEMA.lcnet, { districts });
  assert.strictEqual(n.rows.length, 11);
  assert.ok(n.rows.every((x) => /^62\d\d$/.test(x.district_code)));
  const t = GenericParser.parse(fill('template_lctype.xlsx', { A2: 'ปราชญ์ชาวบ้าน', B2: 4 }).grid, SCHEMA.lctype, {});
  assert.deepStrictEqual(t.rows, [{ type: 'ปราชญ์ชาวบ้าน', count: 4 }]);
  // ส่งเข้าระบบหลังบ้านได้จริง
  g.api.setupSystem();
  const tok = JSON.parse(g.ctx.__api.doPost({ postData: { contents: JSON.stringify({ method: 'adminLogin', args: [{ username: 'krit', password: 'Dev#pass2026' }] }) } }).getContent());
  if (tok.ok) {
    const res = JSON.parse(g.ctx.__api.doPost({ postData: { contents: JSON.stringify({ method: 'dsImport', token: tok.result.token, args: [{ dataset: 'lcnet', mode: 'replace', rows: n.rows }] }) } }).getContent());
    assert.ok(res.ok, res.error);
  }
});
