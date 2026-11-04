// node --test tests/backend.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { createGas, seedFromCsv } = require('./gas-mock');

const ROOT = path.join(__dirname, '..');
function boot() {
  const g = createGas({ gsDir: path.join(ROOT, 'apps-script'), seed: seedFromCsv(path.join(ROOT, 'data/agri_data.csv'), path.join(ROOT, 'data/districts.csv')) });
  // ข้อมูลจริงในชีตมีตัวเลขที่เป็นข้อความ เช่น "181,902"
  const d = g.ss.getSheetByName('data');
  d.rows[1][4] = '1,318'; d.rows[2][6] = ' 0 ';
  g.props.set('SUPER_ADMIN_USERNAME', 'Krit');
  g.props.set('SUPER_ADMIN_PASSWORD', 'Dev#pass2026');
  const out = g.api.setupSystem();
  return { g, out };
}
function login(g, u, p) { const r = g.post({ method: 'adminLogin', args: [{ username: u, password: p }] }); assert.ok(r.ok, r.error); return r.result.token; }

test('setup: sheets, normalization, crop views, super admin bootstrap', () => {
  const { g, out } = boot();
  assert.match(out.join('\n'), /Super Admin "krit"/);
  assert.strictEqual(g.props.has('SUPER_ADMIN_PASSWORD'), false, 'plain password must be deleted');
  const d = g.ss.getSheetByName('data');
  assert.strictEqual(d.rows[1][4], 1318);
  const views = g.ss.getSheets().map((s) => s.getName()).filter((n) => n.startsWith('พืช_'));
  assert.strictEqual(views.length, 9);
  assert.match(g.ss.getSheetByName('พืช_ข้าวนาปี').rows[0][0], /^=QUERY\(data!A:I,"select .* where B = 'ข้าวนาปี'/);
  const adm = g.ss.getSheetByName('admins').rows[1];
  assert.strictEqual(adm[0], 'krit'); assert.notStrictEqual(adm[4], 'Dev#pass2026');
  // รันซ้ำได้
  assert.doesNotThrow(() => g.api.setupSystem());
  assert.strictEqual(g.ss.getSheetByName('links').getLastRow(), 3);
});

test('bootstrap returns data, crops in standard order, links', () => {
  const { g } = boot();
  const r = g.get({ action: 'bootstrap' });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.result.rows.length, 946);
  assert.deepStrictEqual(r.result.crops.slice(0, 2), ['ข้าวนาปี', 'ข้าวนาปรัง']);
  assert.strictEqual(r.result.links.length, 2);
  // ข้าวนาปี 2564+2565 ต้องตรงกับ Power BI
  const s = r.result.rows.filter((x) => x[1] === 'ข้าวนาปี' && (x[0] === 2564 || x[0] === 2565)).reduce((a, x) => a + x[4], 0);
  assert.strictEqual(Math.round(s), 2511369);
});

test('auth: login, wrong password lockout, roles', () => {
  const { g } = boot();
  const tok = login(g, 'KRIT', 'Dev#pass2026');
  assert.strictEqual(g.post({ method: 'adminMe', token: tok }).result.role, 'super');
  for (let i = 0; i < 5; i++) assert.strictEqual(g.post({ method: 'adminLogin', args: [{ username: 'krit', password: 'wrongpass' }] }).ok, false);
  assert.match(g.post({ method: 'adminLogin', args: [{ username: 'krit', password: 'Dev#pass2026' }] }).error, /รอ 15 นาที/);
  // super เพิ่ม admin ที่ใช้เบอร์โทรเป็นชื่อผู้ใช้
  const r = g.post({ method: 'adminSave', token: tok, args: [{ username: '0812345678', name: 'แอดมินจังหวัด', role: 'admin', password: 'Temp@2026x' }] });
  assert.ok(r.ok, r.error);
  assert.strictEqual(g.ss.getSheetByName('admins').rows[2][10], '0812345678');
  const at = login(g, '0812345678', 'Temp@2026x');
  assert.match(g.post({ method: 'linkSave', token: at, args: [{ title: 'x', url: 'https://x.org' }] }).error, /Super Admin/);
  assert.match(g.post({ method: 'adminList', token: at }).error, /Super Admin/);
  assert.strictEqual(g.post({ method: 'importList', token: at }).ok, true);
  assert.strictEqual(g.post({ method: 'adminMe', token: 'f'.repeat(64) }).error, 'ADMIN_SESSION_EXPIRED');
  // ห้ามลดสิทธิ์ super คนสุดท้าย / ตนเอง
  assert.match(g.post({ method: 'adminSave', token: tok, args: [{ username: 'krit', name: 'K', role: 'admin' }] }).error, /ตนเอง/);
  // ระงับ admin แล้ว token ใช้ไม่ได้ทันที
  g.post({ method: 'adminSave', token: tok, args: [{ username: '0812345678', name: 'แอดมินจังหวัด', role: 'admin', status: 'disabled' }] });
  assert.match(g.post({ method: 'importList', token: at }).error, /ระงับ/);
});

test('import: check, commit (upsert), backup, rollback', () => {
  const { g } = boot();
  const tok = login(g, 'krit', 'Dev#pass2026');
  const rows = [
    { year: 2567, crop: 'ข้าวนาปี', district_code: '6201', planted: 200000, harvested: 199000, production: 125000, yield_planted: 625, yield_harvested: 628 }, // update
    { year: 2568, crop: 'ข้าวนาปี', district_code: '6202', planted: '1,000', harvested: 900, production: 540, yield_planted: 540, yield_harvested: 600 }, // insert
    { year: 2567, crop: 'ยางพารา', district_code: '6201', planted: 15195, harvested: 12175, production: 2362, yield_planted: 0, yield_harvested: 194 } // unchanged
  ];
  const chk = g.post({ method: 'importCheck', token: tok, args: [{ rows }] });
  assert.ok(chk.ok, chk.error);
  assert.deepStrictEqual([chk.result.insert, chk.result.update, chk.result.unchanged, chk.result.errorCount], [1, 1, 1, 0]);
  const bad = g.post({ method: 'importCheck', token: tok, args: [{ rows: [{ year: 67, crop: 'x', district_code: '9999', planted: -1 }] }] });
  assert.strictEqual(bad.result.errorCount, 1);
  assert.match(bad.result.errors[0].error, /ปี.*รหัสอำเภอ.*planted/);

  const c = g.post({ method: 'importCommit', token: tok, args: [{ rows, fileName: 'test.xlsx' }] });
  assert.ok(c.ok, c.error);
  assert.strictEqual(g.ss.getSheetByName('data').getLastRow() - 1, 947);
  assert.ok(g.ss.getSheetByName('_bak_' + c.result.importId).hidden);
  const b = g.get({ action: 'bootstrap' }).result; // cache ต้องถูกล้าง
  assert.strictEqual(b.rows.length, 947);
  assert.strictEqual(b.rows.find((x) => x[0] === 2567 && x[1] === 'ข้าวนาปี' && x[2] === '6201')[4], 200000);

  const list = g.post({ method: 'importList', token: tok }).result;
  assert.strictEqual(list[0].canRollback, true);
  const rb = g.post({ method: 'importRollback', token: tok, args: [{ id: c.result.importId }] });
  assert.ok(rb.ok, rb.error);
  const b2 = g.get({ action: 'bootstrap' }).result;
  assert.strictEqual(b2.rows.length, 946);
  assert.strictEqual(b2.rows.find((x) => x[0] === 2567 && x[1] === 'ข้าวนาปี' && x[2] === '6201')[4], 197469);
  assert.match(g.post({ method: 'importRollback', token: tok, args: [{ id: c.result.importId }] }).error, /ล่าสุด/);
});

test('download request → approve → email link → download filtered data', () => {
  const { g } = boot();
  const form = { name: 'สมชาย ใจดี', position: 'นักวิชาการ', agency: 'ม.เกษตร', email: 'som@example.org', phone: '0812345678',
    purposeType: 'วิจัย/วิชาการ', purposeDetail: 'ใช้วิเคราะห์ผลผลิตข้าวรายอำเภอ', crops: ['ข้าวนาปี'], yearFrom: 2564, yearTo: 2567, consent: true };
  assert.match(g.post({ method: 'requestDownload', args: [{ ...form, consent: false }] }).error, /ยินยอม/);
  const r = g.post({ method: 'requestDownload', args: [form] });
  assert.ok(r.ok, r.error);
  assert.strictEqual(g.outbox.length, 1); // แจ้ง admin
  const tok = login(g, 'krit', 'Dev#pass2026');
  const pend = g.post({ method: 'requestList', token: tok, args: [{ status: 'pending' }] }).result;
  assert.strictEqual(pend.length, 1);
  assert.match(g.post({ method: 'requestDecide', token: tok, args: [{ id: r.result.requestId, decision: 'reject' }] }).error, /เหตุผล/);
  const d = g.post({ method: 'requestDecide', token: tok, args: [{ id: r.result.requestId, decision: 'approve' }] });
  assert.ok(d.ok, d.error);
  assert.strictEqual(g.outbox[1].to, 'som@example.org');
  const t = d.result.link.split('?dl=')[1];
  assert.match(g.outbox[1].body, new RegExp(t));
  assert.ok(!JSON.stringify(g.ss.getSheetByName('download_requests').rows).includes(t), 'raw token must not be stored');
  const dl = g.get({ action: 'download', token: t });
  assert.ok(dl.ok, dl.error);
  assert.strictEqual(dl.result.rows.length, 44); // ข้าวนาปี 2564–2567 × 11 อำเภอ
  assert.ok(dl.result.rows.every((x) => x[1] === 'ข้าวนาปี' && x[0] >= 2564));
  assert.strictEqual(g.get({ action: 'download', token: 'a'.repeat(64) }).ok, false);
});

test('counter records visits and visitors', () => {
  const { g } = boot();
  g.get({ action: 'hit', v: '1' }); g.get({ action: 'hit', v: '0' });
  const c = g.get({ action: 'hit', v: '1' }).result;
  assert.deepStrictEqual([c.today, c.todayVisitors, c.total], [3, 2, 3]);
});

test('links CRUD (super)', () => {
  const { g } = boot();
  const tok = login(g, 'krit', 'Dev#pass2026');
  assert.match(g.post({ method: 'linkSave', token: tok, args: [{ title: 'bad', url: 'http://x.org' }] }).error, /https/);
  const s = g.post({ method: 'linkSave', token: tok, args: [{ title: 'กรมส่งเสริมการเกษตร', url: 'https://www.doae.go.th', order: 3 }] });
  assert.ok(s.ok, s.error);
  assert.strictEqual(g.get({ action: 'bootstrap' }).result.links.length, 3);
  g.post({ method: 'linkSave', token: tok, args: [{ id: s.result.id, title: 'DOAE', url: 'https://www.doae.go.th', active: false }] });
  assert.strictEqual(g.get({ action: 'bootstrap' }).result.links.length, 2);
  assert.ok(g.post({ method: 'linkDelete', token: tok, args: [{ id: s.result.id }] }).ok);
  assert.strictEqual(g.post({ method: 'linkList', token: tok }).result.length, 2);
});

test('super admin bootstrap by one-time emailed claim link (no password handled by anyone else)', () => {
  const g = createGas({ gsDir: path.join(ROOT, 'apps-script'), seed: seedFromCsv(path.join(ROOT, 'data/agri_data.csv'), path.join(ROOT, 'data/districts.csv')) });
  g.props.set('SITE_URL', 'https://krit-pj.github.io/KPP-Agri-Data-Center/');
  // ไม่ต้องรัน setupSystem: การเรียก Web App ครั้งแรกติดตั้งให้เอง
  assert.ok(g.get({ action: 'bootstrap' }).ok);
  assert.ok(g.ss.getSheetByName('admins') && g.ss.getSheetByName('พืช_อ้อย'));
  assert.strictEqual(g.outbox.length, 1);
  assert.strictEqual(g.outbox[0].to, 'noonoy.cmu@gmail.com');
  const tok = g.outbox[0].body.match(/#claim=([0-9a-f]{64})/)[1];
  assert.match(g.post({ method: 'adminClaim', args: [{ token: 'a'.repeat(64), password: 'Abcdefgh1' }] }).error, /ไม่ถูกต้อง/);
  assert.match(g.post({ method: 'adminClaim', args: [{ token: tok, password: 'short' }] }).error, /8/);
  const c = g.post({ method: 'adminClaim', args: [{ token: tok, password: 'My#Secret2026' }] });
  assert.ok(c.ok, c.error); assert.strictEqual(c.result.username, 'krit');
  assert.match(g.post({ method: 'adminClaim', args: [{ token: tok, password: 'Another#2026' }] }).error, /ถูกใช้ไปแล้ว/);
  assert.ok(login(g, 'krit', 'My#Secret2026'));
  // เรียกซ้ำไม่ส่งอีเมลซ้ำ
  g.get({ action: 'bootstrap' }); assert.strictEqual(g.outbox.length, 1);
});

test('soil centers: seeded, public API hides chair data, admin update/verify, import keeps chair', () => {
  const { g } = boot();
  const b = g.get({ action: 'bootstrap' }).result;
  assert.strictEqual(b.soil.length, 31);
  assert.strictEqual(b.soil.reduce((a, s) => a + s.members, 0), 877);
  assert.ok(b.soil.every((s) => !('chair' in s) && !('chair_phone' in s)));
  assert.strictEqual(b.soil.filter((s) => !s.verified).length, 14);
  const tok = login(g, 'krit', 'Dev#pass2026');
  const one = b.soil.find((s) => /อ่างทอง/.test(s.name));
  const u = g.post({ method: 'soilUpdate', token: tok, args: [{ id: one.id, lat: 16.40, lng: 99.55, verified: true }] });
  assert.ok(u.ok, u.error);
  assert.match(g.post({ method: 'soilUpdate', token: tok, args: [{ id: one.id, lat: 99.5, lng: 16.4 }] }).error, /ประเทศไทย/);
  const b2 = g.get({ action: 'bootstrap' }).result.soil.find((s) => s.id === one.id);
  assert.deepStrictEqual([b2.lat, b2.verified], [16.4, true]);
  // นำเข้าใหม่ที่มีชื่อประธาน → เก็บในชีต แต่ API สาธารณะไม่ส่งออก
  const rows = g.post({ method: 'soilList', token: tok }).result.map((s) => ({ ...s, chair: 'นายทดสอบ', chair_phone: '0812345678' }));
  assert.ok(g.post({ method: 'soilImport', token: tok, args: [{ rows, fileName: 'x.xlsx' }] }).ok);
  assert.ok(JSON.stringify(g.ss.getSheetByName('soil_centers').rows).includes('นายทดสอบ'));
  assert.ok(!JSON.stringify(g.get({ action: 'bootstrap' }).result).includes('นายทดสอบ'));
  assert.ok(g.ss.getSheets().some((s) => s.getName().startsWith('_bak_SOIL')));
});

test('admin access request: phone + password, super approves; preapproved phone is instant', () => {
  const { g } = boot();
  g.props.set('ADMIN_PREAPPROVED_PHONES', '0899999999');
  const form = { phone: '081-234-5678', name: 'สมใจ ใจดี', position: 'นักวิชาการส่งเสริมการเกษตร', agency: 'สนง.เกษตรอำเภอไทรงาม', email: 'a@example.org', reason: 'นำเข้าข้อมูลอำเภอ', password: 'Pass#2026a', consent: true };
  assert.match(g.post({ method: 'adminRequest', args: [{ ...form, phone: '12345' }] }).error, /10 หลัก/);
  assert.match(g.post({ method: 'adminRequest', args: [{ ...form, password: '123' }] }).error, /8/);
  const r = g.post({ method: 'adminRequest', args: [form] });
  assert.ok(r.ok, r.error); assert.strictEqual(r.result.approved, false);
  assert.match(g.post({ method: 'adminRequest', args: [form] }).error, /รอพิจารณา/);
  assert.match(g.post({ method: 'adminLogin', args: [{ username: '0812345678', password: 'Pass#2026a' }] }).error, /ไม่ถูกต้อง/);
  const tok = login(g, 'krit', 'Dev#pass2026');
  const list = g.post({ method: 'adminRequestList', token: tok, args: [{ status: 'pending' }] }).result;
  assert.strictEqual(list.length, 1); assert.ok(!('password' in list[0]));
  assert.ok(g.post({ method: 'adminRequestDecide', token: tok, args: [{ id: list[0].id, decision: 'approve' }] }).ok);
  const at = login(g, '0812345678', 'Pass#2026a');
  assert.strictEqual(g.post({ method: 'adminMe', token: at }).result.role, 'admin');
  assert.match(g.post({ method: 'adminRequestList', token: at }).error, /Super Admin/);
  assert.ok(!JSON.stringify(g.ss.getSheetByName('admin_requests').rows[1].slice(8, 10)).match(/[0-9a-f]{64}/), 'hash removed from request sheet');
  // อนุมัติล่วงหน้า
  const p = g.post({ method: 'adminRequest', args: [{ ...form, phone: '0899999999' }] });
  assert.ok(p.result.approved);
  assert.ok(login(g, '0899999999', 'Pass#2026a'));
  assert.match(g.post({ method: 'superClaimResend' }).error, /มี Super Admin แล้ว/);
});
