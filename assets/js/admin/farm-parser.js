// ===== ตัวอ่านข้อมูลกลุ่มแปลงใหญ่ =====
// รองรับ 2 รูปแบบ
//  1) ไฟล์ส่งออกจากระบบแปลงใหญ่ของกรมฯ (หัวตาราง: รหัส, ประเภทแปลงใหญ่, กลุ่มสินค้า, สินค้าหลัก, ชื่อแปลงใหญ่, ...)
//     ใช้เฉพาะแถวของจังหวัดกำแพงเพชร (ไฟล์ทั้งประเทศก็ใช้ได้)
//  2) ไฟล์พิกัด (หัวตาราง: แปลงใหญ่ / พิกัด X / Y แบบ UTM 47N หรือ lat/lng) → จับคู่กับกลุ่มเดิมด้วยชื่อ
// ใช้ได้ทั้งเบราว์เซอร์ (window.FarmParser) และ Node
(function (root) {
  'use strict';
  const SP = (typeof module !== 'undefined' && module.exports) ? require('./soil-parser.js') : root.SoilParser;
  const norm = SP.norm;
  const num = (v) => { const s = norm(v).replace(/[,\s]/g, ''); if (!s || /^[-–]$/.test(s)) return null; const n = Number(s); return isFinite(n) ? n : null; };
  const phone = (v) => norm(v).replace(/^"+|"+$/g, '').replace(/[^\d-]/g, '');
  /** คีย์จับคู่ชื่อแปลงใหญ่: ตัดช่องว่าง และคำว่า จังหวัดกำแพงเพชร (บางไฟล์ถูกตัดท้ายเป็น "กำแพงเพช") */
  const nameKey = (s) => norm(s).replace(/\s+/g, '').replace(/จังหวัดกำแพงเพช?ร?$/, '').replace(/จ\.กำแพงเพชร$/, '');
  /** คีย์สำรอง: สินค้า + หมู่ + ตำบล ที่อยู่ในชื่อ */
  function looseKey(s) {
    const t = norm(s);
    const crop = (t.match(/แปลงใหญ่\s*([^\s]+)/) || [])[1] || '';
    const moo = (t.match(/หมู่(?:ที่)?\s*([\d,\s]+)/) || [])[1] || '';
    const tam = (t.match(/ตำบล\s*([^\s]+)/) || [])[1] || '';
    return crop && tam ? crop + '|' + moo.replace(/\s/g, '') + '|' + tam : '';
  }

  function findHeader(grid, test) {
    for (let r = 0; r < Math.min(grid.length, 15); r++) if (test((grid[r] || []).map(norm))) return r;
    return -1;
  }

  /** รูปแบบ 1: ไฟล์ส่งออกระบบแปลงใหญ่ */
  function parseDoae(grid, ctx) {
    const hr = findHeader(grid, (h) => h.includes('ชื่อแปลงใหญ่') && h.includes('สินค้าหลัก'));
    if (hr < 0) return null;
    const h = grid[hr].map(norm);
    const at = (name, nth = 0) => { let k = -1; for (let i = 0; i <= nth; i++) k = h.indexOf(name, k + 1); return k; };
    const C = {
      code: at('รหัส'), type: at('ประเภทแปลงใหญ่'), group: at('กลุ่มสินค้า'), commodity: at('สินค้าหลัก'), commodity2: at('สินค้ารอง'),
      name: at('ชื่อแปลงใหญ่'), moo: at('หมู่ที่'), province: at('จังหวัด'), district: at('อำเภอ'), tambon: at('ตำบล'),
      mgr_first: at('ชื่อผู้จัดการ'), mgr_last: at('นามสกุลผู้จัดการ'), mgr_pos: at('ตำแหน่ง'), mgr_phone: at('โทรศัพท์'),
      chair_first: at('ชื่อประธาน'), chair_last: at('นามสกุลประธาน'), chair_phone: at('โทรศัพท์', 1),
      members: at('เกษตรกร'), member_area: at('พื้นที่(ไร่)'), plot_farmers: at('เกษตรกร', 1), plots: at('แปลง'), plot_area: at('พื้นที่(ไร่)', 1),
      cost_before: at('ต้นทุนก่อน'), cost_after: at('ต้นทุนหลัง'), yield_before: at('ผลผลิตก่อน'), yield_after: at('ผลผลิตหลัง'),
      gap: at('GAP'), organic: at('อินทรีย์'), grouping: at('รวมกลุ่ม'), market_before: at('รูปแบบตลาดก่อน'), market_after: at('รูปแบบตลาดหลัง'),
    };
    const byName = {};
    (ctx.districts || []).forEach((d) => { byName[norm(d.district).replace(/\s/g, '')] = String(d.district_code); });
    const g = (r, k) => (C[k] >= 0 ? r[C[k]] : '');
    const rows = [], skipped = [];
    for (let i = hr + 1; i < grid.length; i++) {
      const r = grid[i] || [];
      if (!norm(g(r, 'name'))) continue;
      const prov = norm(g(r, 'province'));
      if (prov && prov !== 'กำแพงเพชร') { skipped.push(i + 1); continue; }
      const dName = norm(g(r, 'district'));
      const yr = (norm(g(r, 'type')).match(/25\d\d/) || [])[0];
      rows.push({
        id: norm(g(r, 'code')) ? 'F' + norm(g(r, 'code')) : '', name: norm(g(r, 'name')).replace(/\s+/g, ' '),
        year_start: yr ? +yr : null, group: norm(g(r, 'group')), commodity: norm(g(r, 'commodity')), commodity2: norm(g(r, 'commodity2')),
        moo: norm(g(r, 'moo')), tambon: norm(g(r, 'tambon')), district: dName, district_code: byName[dName.replace(/\s/g, '')] || '',
        members: num(g(r, 'members')) || 0, member_area: num(g(r, 'member_area')) || 0, plot_farmers: num(g(r, 'plot_farmers')) || 0,
        plots: num(g(r, 'plots')) || 0, plot_area: num(g(r, 'plot_area')) || 0,
        cost_before: num(g(r, 'cost_before')), cost_after: num(g(r, 'cost_after')), yield_before: num(g(r, 'yield_before')), yield_after: num(g(r, 'yield_after')),
        gap: !!num(g(r, 'gap')), organic: !!num(g(r, 'organic')), grouping: norm(g(r, 'grouping')),
        market_before: norm(g(r, 'market_before')), market_after: norm(g(r, 'market_after')),
        lat: null, lng: null, coord_note: '',
        manager: [norm(g(r, 'mgr_first')), norm(g(r, 'mgr_last'))].filter(Boolean).join(' '), manager_position: norm(g(r, 'mgr_pos')),
        manager_phone: phone(g(r, 'mgr_phone')), chair: [norm(g(r, 'chair_first')), norm(g(r, 'chair_last'))].filter(Boolean).join(' '),
        chair_phone: phone(g(r, 'chair_phone')),
      });
    }
    return { kind: 'farms', rows, skipped: skipped.length };
  }

  /** รูปแบบ 2: ไฟล์พิกัด */
  function parseCoords(grid) {
    const hr = findHeader(grid, (h) => h.some((t) => /แปลงใหญ่|ชื่อกลุ่ม/.test(t)) && h.some((t) => /พิกัด|^x$|lat/i.test(t)));
    if (hr < 0) return null;
    const h = grid[hr].map(norm), sub = (grid[hr + 1] || []).map(norm);
    const nameC = h.findIndex((t) => /แปลงใหญ่|ชื่อกลุ่ม/.test(t));
    let xC = sub.findIndex((t) => /^(x|lat)/i.test(t)), yC = sub.findIndex((t) => /^(y|long|lng|lon)/i.test(t));
    let start = hr + 2;
    if (xC < 0) { xC = h.findIndex((t) => /^(x|lat|พิกัด)/i.test(t)); yC = xC + 1; start = hr + 1; }
    const rows = [];
    for (let i = start; i < grid.length; i++) {
      const r = grid[i] || [];
      const name = norm(r[nameC]);
      if (!name) continue;
      const c = SP.fixCoord(r[xC], r[yC]);
      rows.push({ name, lat: c.lat, lng: c.lng, note: c.note });
    }
    return { kind: 'coords', rows };
  }

  /** จับคู่ไฟล์พิกัดกับกลุ่มแปลงใหญ่ คืนจำนวนที่จับคู่ได้ */
  function applyCoords(farms, coords) {
    const exact = {}, loose = {};
    farms.forEach((f) => { exact[nameKey(f.name)] = f; const lk = looseKey(f.name); if (lk) (loose[lk] = loose[lk] || []).push(f); });
    let matched = 0;
    const unmatched = [];
    coords.forEach((c) => {
      const k = nameKey(c.name);
      let f = exact[k];
      if (!f) { const cand = Object.keys(exact).filter((x) => x.startsWith(k) || k.startsWith(x)); if (cand.length === 1) f = exact[cand[0]]; }
      if (!f) { const l = loose[looseKey(c.name)]; if (l && l.length === 1) f = l[0]; }
      if (!f || c.lat === null) { unmatched.push(c.name); return; }
      f.lat = Math.round(c.lat * 1e6) / 1e6; f.lng = Math.round(c.lng * 1e6) / 1e6;
      f.coord_note = c.note || '';
      matched++;
    });
    return { matched, unmatched };
  }

  function parse(grid, ctx) {
    grid = (grid || []).map((r) => (r || []).map((v) => (v === null || v === undefined ? '' : v)));
    return parseDoae(grid, ctx || {}) || parseCoords(grid) || { kind: 'unknown', rows: [] };
  }

  const api = { parse, applyCoords, nameKey, looseKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FarmParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
