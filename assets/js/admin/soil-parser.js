// ===== ตัวอ่านทำเนียบ ศดปช. (ศูนย์จัดการดินปุ๋ยชุมชน) =====
// อ่านตาราง (จาก Excel/CSV) → จับหัวตาราง → แก้แถวที่ข้อมูลเลื่อนคอลัมน์ → แปลงเครื่องหมายถูก
// → แก้พิกัด (สลับ lat/long, UTM โซน 47N, "lat, long" ในเซลล์เดียว) → หาอำเภอจากพิกัดด้วย point-in-polygon
// ใช้ได้ทั้งเบราว์เซอร์ (window.SoilParser) และ Node (require)
(function (root) {
  'use strict';
  const PUA = { 0xF700: 0x0E10, 0xF701: 0x0E34, 0xF702: 0x0E35, 0xF703: 0x0E36, 0xF704: 0x0E37, 0xF705: 0x0E48, 0xF706: 0x0E49, 0xF707: 0x0E4A,
    0xF708: 0x0E4B, 0xF709: 0x0E4C, 0xF70A: 0x0E48, 0xF70B: 0x0E49, 0xF70C: 0x0E4A, 0xF70D: 0x0E4B, 0xF70E: 0x0E4C, 0xF70F: 0x0E0D, 0xF710: 0x0E31,
    0xF711: 0x0E4D, 0xF712: 0x0E47, 0xF713: 0x0E48, 0xF714: 0x0E49, 0xF715: 0x0E4A, 0xF716: 0x0E4B, 0xF717: 0x0E4C, 0xF718: 0x0E38, 0xF719: 0x0E39, 0xF71A: 0x0E3A };
  const norm = (s) => String(s === null || s === undefined ? '' : s)
    .replace(/[-]/g, (c) => String.fromCharCode(PUA[c.charCodeAt(0)]))
    .replace(/ํา/g, 'ำ').replace(/[​-‍﻿]/g, '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const isCheck = (v) => /^\s*(p|√|✓|✔|\/|∕|x|1|true|ใช่|มี)\s*$/i.test(String(v === null || v === undefined ? '' : v)) && !/^\s*(×)\s*$/.test(String(v));
  const isNo = (v) => /^\s*(-|–|ไม่|ไม่มี|ไม่เป็น.*|×|no|n\/a)?\s*$/i.test(norm(v));
  const num = (v) => { const s = norm(v).replace(/[,\s]/g, ''); if (!s || /^[-–]$/.test(s)) return null; const n = Number(s); return isFinite(n) ? n : null; };

  // ---------- หัวตาราง ----------
  const RULES = [
    ['no', /^ที่$|^ลำดับ/], ['district', /^อำเภอ/], ['name', /ชื่อ\s*ศดปช|ชื่อศูนย์/], ['location', /ที่ตั้ง/],
    ['coord', /พิกัด/], ['chair', /ประธาน/], ['phone', /โทร/], ['year', /ปีที่เริ่ม|ปีเริ่ม|ปีที่จัดตั้ง/], ['members', /สมาชิก\s*\(|จำนวนสมาชิก/],
    ['fund', /เงินทุน/], ['crops', /พืชหลัก/], ['level', /^ระดับ/], ['type', /^ประเภท/], ['network', /สมาชิกของกลุ่ม|กลุ่มเกษตรกรอื่น/],
    ['organic', /อินทรีย์/], ['products', /สินค้าและบริการ/], ['oss', /ได้รับโครงการ\s*oss/i], ['oss_status', /สถานะ.*oss/i],
  ];
  function detectHeader(grid) {
    for (let r = 0; r < Math.min(grid.length, 30); r++) {
      const map = {};
      (grid[r] || []).forEach((c, i) => { const t = norm(c); for (const [f, re] of RULES) if (re.test(t) && map[f] === undefined) { map[f] = i; break; } });
      if (map.name !== undefined && (map.coord !== undefined || map.members !== undefined)) {
        const sub = (grid[r + 1] || []).map(norm);
        // หัวตารางย่อย: lat / long, ศูนย์หลัก / ศูนย์เครือข่าย, ดำเนินการอยู่ / ไม่มีการดำเนินการ
        sub.forEach((t, i) => {
          if (/^lat/i.test(t)) map.lat = i;
          if (/^(long|lng|lon)/i.test(t)) map.lng = i;
          if (/หลัก/.test(t)) map.type_main = i;
          if (/เครือข่าย/.test(t)) map.type_net = i;
          if (/ดำเนินการอยู่/.test(t)) map.oss_active = i;
          if (/ไม่มีการดำเนินการ/.test(t)) map.oss_inactive = i;
        });
        if (map.lat === undefined && map.coord !== undefined) { map.lat = map.coord; map.lng = map.coord + 1; }
        if (map.type_main === undefined && map.type !== undefined) { map.type_main = map.type; map.type_net = map.type + 1; }
        const hasSub = sub.some((t) => /^lat|หลัก|เครือข่าย/i.test(t));
        return { row: r, dataStart: r + (hasSub ? 2 : 1), map };
      }
    }
    return null;
  }

  // ---------- พิกัด ----------
  /** UTM (WGS84) → lat/lng  ค่าเริ่มต้นโซน 47N (กำแพงเพชร) */
  function utmToLatLng(easting, northing, zone = 47, north = true) {
    const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    const x = easting - 500000, y = north ? northing : northing - 10000000;
    const m = y / k0, mu = m / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
      + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
    const n1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2), t1 = Math.tan(p1) ** 2, c1 = ep2 * Math.cos(p1) ** 2;
    const r1 = a * (1 - e2) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5, d = x / (n1 * k0);
    const lat = p1 - (n1 * Math.tan(p1) / r1) * (d * d / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4 / 24
      + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * d ** 6 / 720);
    const lng = (d - (1 + 2 * t1 + c1) * d ** 3 / 6 + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5 / 120) / Math.cos(p1);
    return [lat * 180 / Math.PI, (zone - 1) * 6 - 180 + 3 + lng * 180 / Math.PI];
  }
  const inTH = (la, lo) => la > 5 && la < 21 && lo > 97 && lo < 106;
  /** คืน { lat, lng, note } note บอกว่าแก้อะไร (ว่าง = ใช้ตามต้นฉบับ) */
  function fixCoord(a, b) {
    let x = num(a), y = num(b);
    if (x === null && typeof a === 'string' && /[,\s]/.test(a.trim())) { const p = a.split(/[,\s]+/).map(num).filter((v) => v !== null); if (p.length === 2) { x = p[0]; y = p[1]; } }
    if (x === null || y === null) return { lat: null, lng: null, note: 'ไม่มีพิกัด' };
    if (inTH(x, y)) return { lat: x, lng: y, note: '' };
    if (inTH(y, x)) return { lat: y, lng: x, note: 'สลับ lat/long' };
    const [e, n] = x > 100000 && x < 900000 && y > 1000000 ? [x, y] : y > 100000 && y < 900000 && x > 1000000 ? [y, x] : [null, null];
    if (e) { const [la, lo] = utmToLatLng(e, n); if (inTH(la, lo)) return { lat: la, lng: lo, note: 'แปลงจาก UTM 47N (' + e + ', ' + n + ')' }; }
    return { lat: null, lng: null, note: 'พิกัดไม่ถูกต้อง (' + norm(a) + ', ' + norm(b) + ')' };
  }

  // ---------- point in polygon ----------
  function inRing(lng, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inGeom(lng, lat, g) {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    return polys.some((p) => inRing(lng, lat, p[0]) && !p.slice(1).some((h) => inRing(lng, lat, h)));
  }
  function districtAt(lat, lng, geo) {
    if (lat === null || !geo) return null;
    const f = geo.features.find((ft) => inGeom(lng, lat, ft.geometry));
    return f ? { code: String(f.properties.code), name: f.properties.name } : null;
  }

  // ---------- แปลงทั้งตาราง ----------
  /**
   * @param grid ตาราง (array of rows)
   * @param ctx { districts: [{district_code, district}], geo: GeoJSON ขอบเขตอำเภอ }
   * @returns { rows: [...], problems: [...], headerRow }
   */
  function parse(grid, ctx) {
    grid = (grid || []).map((r) => (r || []).map((v) => (v === null || v === undefined ? '' : v)));
    const det = detectHeader(grid);
    if (!det) return { rows: [], problems: ['ไม่พบหัวตาราง ศดปช. (ต้องมีคอลัมน์ "ชื่อ ศดปช." และพิกัดหรือจำนวนสมาชิก)'], headerRow: -1 };
    const M = det.map, rows = [];
    const byName = {};
    (ctx.districts || []).forEach((d) => { byName[norm(d.district).replace(/\s/g, '')] = String(d.district_code); });
    let lastDistrict = '';
    for (let r = det.dataStart; r < grid.length; r++) {
      let row = grid[r].slice();
      const name = norm(row[M.name]);
      if (!name || !/ศดปช|ศูนย์/.test(name)) continue;
      const notes = [];
      // แถวที่ข้อมูลเลื่อนไปขวา 1 คอลัมน์ (มีตัวอักษรระดับโผล่ในช่องที่ตั้ง และช่อง lat เป็นข้อความ)
      if (M.location !== undefined && /^[A-Da-d]$/.test(norm(row[M.location])) && num(row[M.lat]) === null && num(row[M.lat + 1]) !== null) {
        const end = M.fund !== undefined ? M.fund : M.members;
        for (let c = M.location; c <= end; c++) row[c] = row[c + 1];
        if (M.crops !== undefined) row[M.crops] = '';
        notes.push('ข้อมูลในแถวต้นฉบับเลื่อนคอลัมน์ (ปรับให้แล้ว ไม่มีข้อมูลพืชหลัก)');
      }
      const c = fixCoord(row[M.lat], row[M.lng]);
      if (c.note) notes.push(c.note);
      let dName = norm(row[M.district]).replace(/^อำเภอ|^อ\./, '').trim();
      const at = districtAt(c.lat, c.lng, ctx.geo);
      let dCode = byName[dName.replace(/\s/g, '')] || '';
      if (!dName && at) { dName = at.name; dCode = at.code; notes.push('ไม่ระบุอำเภอ (ใช้อำเภอจากพิกัด)'); }
      else if (!dName && lastDistrict) { dName = lastDistrict; dCode = byName[dName] || ''; notes.push('ไม่ระบุอำเภอ (ใช้อำเภอแถวก่อนหน้า)'); }
      if (at && dCode && at.code !== dCode) notes.push(`พิกัดอยู่ใน อ.${at.name} แต่ระบุ อ.${dName}`);
      if (c.lat !== null && !at) notes.push('พิกัดอยู่นอกจังหวัดกำแพงเพชร');
      if (dName) lastDistrict = dName.replace(/\s/g, '');
      // ประเภท: เครื่องหมายถูกในคอลัมน์ย่อย หรือข้อความ "หลัก"/"เครือข่าย"
      let type = '';
      if (M.type_main !== undefined && isCheck(row[M.type_main])) type = 'หลัก';
      else if (M.type_net !== undefined && isCheck(row[M.type_net])) type = 'เครือข่าย';
      else {
        const t = row.map(norm).join(' ');
        if (/ศ\S*นย์?เครือข่าย|ศนย์เครือข่าย/.test(t)) type = 'เครือข่าย'; else if (/ศูนย์หลัก/.test(t)) type = 'หลัก';
        else if (/เครือข่าย/.test(name)) type = 'เครือข่าย';
        if (type) notes.push('ประเภทจากข้อความ');
      }
      if (!type) notes.push('ไม่ระบุประเภท');
      const members = num(row[M.members]);
      if (members === null) notes.push('ไม่ระบุจำนวนสมาชิก');
      const year = num(row[M.year]);
      const ossAct = M.oss_active !== undefined && isCheck(row[M.oss_active]);
      const ossIn = M.oss_inactive !== undefined && isCheck(row[M.oss_inactive]);
      const txt = (k) => (M[k] === undefined || isNo(row[M[k]]) ? '' : norm(row[M[k]]));
      rows.push({
        name, district_code: dCode, district: dName, location: txt('location'),
        lat: c.lat === null ? null : Math.round(c.lat * 1e6) / 1e6, lng: c.lng === null ? null : Math.round(c.lng * 1e6) / 1e6,
        type, level: norm(row[M.level]).toUpperCase().replace(/[^A-D]/g, '').slice(0, 1),
        members: members === null ? 0 : members, year_start: year && year > 2400 ? year : null, fund: num(row[M.fund]) || 0,
        crops: txt('crops'), network: txt('network'), organic: txt('organic'), products: txt('products'),
        oss: M.oss !== undefined && isCheck(row[M.oss]) ? 'ได้รับ' : '', oss_status: ossAct ? 'ดำเนินการอยู่' : ossIn ? 'ไม่มีการดำเนินการ' : '',
        chair: norm(row[M.chair]), chair_phone: isNo(row[M.phone]) ? '' : norm(row[M.phone]),
        note: notes.join(' · '), verified: !notes.some((n) => /สลับ|UTM|พิกัด|อำเภอ|เลื่อน/.test(n)),
        line: r + 1,
      });
    }
    return { rows, problems: rows.length ? [] : ['ไม่พบรายการ ศดปช.'], headerRow: det.row };
  }

  const api = { parse, fixCoord, utmToLatLng, districtAt, norm, isCheck };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SoilParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
