// ===== ชั้นข้อมูล: โหลดจาก Apps Script (Google Sheets) + measures (แปลงจาก DAX) =====
(function () {
  const C = window.APP_CONFIG;
  const NUM = ['year', 'planted', 'harvested', 'production', 'yield_planted', 'yield_harvested', 'lat', 'lng', 'area_sqkm'];

  function parseCSV(text) {
    const res = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
    return res.data.map((r) => {
      const o = {};
      for (const k in r) {
        const key = k.trim();
        let v = typeof r[k] === 'string' ? r[k].trim() : r[k];
        if (NUM.includes(key)) v = parseFloat(String(v).replace(/,/g, '')) || 0;
        o[key] = v;
      }
      if (o.district_code !== undefined) o.district_code = String(o.district_code).replace(/\.0$/, '');
      return o;
    });
  }
  async function fetchText(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status + ' ' + url);
    return r.text();
  }

  async function load() {
    let source = 'api', rows, districts, links = C.DEFAULT_LINKS, updated = null;
    try {
      const b = await API.get('bootstrap');
      rows = b.rows.map((r) => Object.fromEntries(b.cols.map((c, i) => [c, r[i]])));
      districts = b.districts;
      links = b.links && b.links.length ? b.links : links;
      updated = b.updated;
    } catch (e) {
      console.warn('[data] ใช้ไฟล์สำรอง:', e.message);
      source = 'fallback';
      const [d, s] = await Promise.all([fetchText(C.FALLBACK_DATA), fetchText(C.FALLBACK_DISTRICTS)]);
      rows = parseCSV(d); districts = parseCSV(s);
    }
    rows.forEach((r) => { r.district_code = String(r.district_code); r.year = +r.year; });
    districts.forEach((d) => { d.district_code = String(d.district_code); });
    const geo = await (await fetch(C.GEOJSON)).json();
    rows = rows.filter((r) => r.crop && r.year);
    // ปีที่ทั้งจังหวัดเป็น 0 หมด = ยังไม่มีข้อมูล (ไม่แสดงเป็นลดลง 100%)
    const tot = {};
    rows.forEach((r) => { const k = r.crop + '|' + r.year; tot[k] = (tot[k] || 0) + r.planted + r.production; });
    rows = rows.filter((r) => tot[r.crop + '|' + r.year] > 0);
    const present = new Set(rows.map((r) => r.crop));
    const crops = C.CROPS.filter((c) => present.has(c)).concat([...present].filter((c) => !C.CROPS.includes(c)).sort());
    return { rows, districts, geo, crops, links, source, updated };
  }

  // ---------- Measures (เทียบ DAX ใน docs/DAX_to_JS.md) ----------
  const sum = (rows, k) => rows.reduce((a, r) => a + (+r[k] || 0), 0);
  const M = {
    planted: (rs) => sum(rs, 'planted'),
    harvested: (rs) => sum(rs, 'harvested'),
    production: (rs) => sum(rs, 'production'),
    yield: (rs) => { const h = sum(rs, 'harvested'); return h ? (sum(rs, 'production') / h) * 1000 : 0; },
  };
  const METRICS = {
    planted: { label: 'เนื้อที่เพาะปลูก', unit: 'ไร่', fn: M.planted },
    harvested: { label: 'เนื้อที่เก็บเกี่ยว', unit: 'ไร่', fn: M.harvested },
    production: { label: 'ผลผลิต', unit: 'ตัน', fn: M.production },
    yield: { label: 'ผลผลิตเฉลี่ย', unit: 'กก./ไร่', fn: M.yield },
  };
  function filter(rows, f = {}) {
    return rows.filter((r) =>
      (!f.crop || r.crop === f.crop) &&
      (!f.years || f.years.includes(r.year)) &&
      (f.year === undefined || r.year === f.year) &&
      (!f.district_code || r.district_code === f.district_code));
  }
  function yoy(rows, metric, base, year) {
    const cur = METRICS[metric].fn(filter(rows, { ...base, year }));
    const prev = METRICS[metric].fn(filter(rows, { ...base, year: year - 1 }));
    return prev ? (cur - prev) / prev : null;
  }
  const fmt = (v, d = 0) => (v === null || v === undefined || isNaN(v)) ? '–'
    : Number(v).toLocaleString('th-TH', { maximumFractionDigits: d, minimumFractionDigits: d });
  const fmtShort = (v) => Math.abs(v) >= 1e6 ? fmt(v / 1e6, 2) + 'M' : Math.abs(v) >= 1e3 ? fmt(v / 1e3, 1) + 'K' : fmt(v);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  window.AgriData = { load, M, METRICS, filter, yoy, fmt, fmtShort, esc, parseCSV };
})();
