// ===== ตัวอ่านไฟล์ของชุดตารางข้อมูลทั่วไป (เช่น ศพก.) =====
// หัวคอลัมน์ตรงกับรหัสช่อง (key) หรือป้ายชื่อ (label) ใน schema · รองรับ Template ที่มี 🔒 และ * กำกับหัวคอลัมน์
// เติมรหัสอำเภอจากชื่ออำเภอ · แปลง UTM 47N เป็นละติจูด/ลองจิจูด · ใช่/ไม่ใช่ → true/false
// ใช้ได้ทั้งเบราว์เซอร์ (window.GenericParser) และ Node
(function (root) {
  'use strict';
  const SP = (typeof module !== 'undefined' && module.exports) ? require('./soil-parser.js') : root.SoilParser;
  const norm = (v) => String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim();
  const headKey = (v) => norm(v).replace(/^[^\u0E00-\u0E7FA-Za-z0-9(]+/, '').replace(/\s*\*$/, '').trim().toLowerCase();

  /**
   * @param grid    แถวของเซลล์
   * @param schema  { fields: [{ key, label, type }] }
   * @param ctx     { districts, geo }
   * @returns { rows, cols, problems } หรือ null ถ้าไม่พบหัวตาราง
   */
  function parse(grid, schema, ctx) {
    ctx = ctx || {};
    const want = schema.fields.map((f) => [f.key, headKey(f.key), headKey(f.label)]);
    for (let r = 0; r < Math.min(grid.length, 15); r++) {
      const h = (grid[r] || []).map(headKey);
      const map = {};
      want.forEach(([k, a, b]) => { const i = h.findIndex((x) => x && (x === a || x === b)); if (i >= 0) map[k] = i; });
      if (Object.keys(map).length < 2) continue;
      const byName = {};
      (ctx.districts || []).forEach((d) => { byName[norm(d.district).replace(/\s/g, '')] = String(d.district_code); });
      const has = (k) => schema.fields.some((f) => f.key === k);
      const problems = [];
      const rows = grid.slice(r + 1).map((row, i) => [row || [], r + i + 2])
        .filter(([row]) => Object.values(map).some((c) => norm(row[c]) !== ''))
        .map(([row, line]) => {
          const o = {};
          Object.entries(map).forEach(([k, c]) => { o[k] = row[c] === null || row[c] === undefined ? '' : row[c]; });
          schema.fields.forEach((f) => { if (f.type === 'bool' && f.key in o) o[f.key] = /^(ใช่|มี|yes|true|1|✓)$/i.test(norm(o[f.key])); });
          // รหัสอำเภอจากชื่อ
          if (has('district_code') && !norm(o.district_code) && norm(o.district)) {
            o.district_code = byName[norm(o.district).replace(/^อ(ำเภอ|\.)\s*/, '').replace(/\s/g, '')] || '';
            if (!o.district_code) problems.push(`แถว ${line}: ไม่รู้จักอำเภอ "${norm(o.district)}"`);
          }
          // พิกัด: องศา หรือ UTM 47N (จากช่อง lat/lng หรือ utm_x/utm_y)
          if (has('lat')) {
            const src = norm(o.lat) || norm(o.lng) ? [o.lat, o.lng] : (norm(o.utm_x) && norm(o.utm_y) ? [o.utm_x, o.utm_y] : null);
            if (src) {
              const c = SP.fixCoord(src[0], src[1]);
              if (c.lat === null) { o.lat = ''; o.lng = ''; problems.push(`แถว ${line}: พิกัดไม่ถูกต้อง (${norm(src[0])}, ${norm(src[1])})`); }
              else {
                o.lat = Math.round(c.lat * 1e6) / 1e6; o.lng = Math.round(c.lng * 1e6) / 1e6;
                const at = ctx.geo ? SP.districtAt(o.lat, o.lng, ctx.geo) : null;
                o.coord_note = c.note || '';
                if (at && o.district_code && at.code !== o.district_code) { o.coord_note = (o.coord_note ? o.coord_note + '; ' : '') + 'พิกัดตกในอำเภอ' + at.name; problems.push(`แถว ${line}: พิกัดตกในอำเภอ${at.name} แต่ระบุ ${norm(o.district)}`); }
              }
            }
          }
          return o;
        });
      return { rows, cols: Object.keys(map), problems };
    }
    return null;
  }

  const api = { parse, headKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GenericParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
