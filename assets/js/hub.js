// ===== แดชบอร์ด กลุ่มแปลงใหญ่ และ ศพก. (รูปแบบเดียวกับ ศดปช.) =====
(function () {
  const D = window.AgriData;
  const isMobile = () => window.innerWidth < 760;
  const BAR = { borderRadius: 4, borderSkipped: 'start', borderColor: '#fff', borderWidth: 1 };
  const kpiHtml = (items) => items.map(([c, l, v, d]) => `<div class="kpi"><div class="h ${c}">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join('');
  const sortTh = (a, b) => String(a).localeCompare(String(b), 'th');
  const countBy = (list, key) => { const m = {}; list.forEach((o) => { const k = (typeof key === 'function' ? key(o) : o[key]) || 'ไม่ระบุ'; m[k] = (m[k] || 0) + 1; }); return m; };

  function makeCharts() {
    const charts = {};
    return function draw(id, cfg) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart(document.getElementById(id), cfg); };
  }
  // แท่งแนวนอนบนมือถือ, แนวตั้งบนจอใหญ่ (เหมือนหน้า ศดปช.)
  function opts(unit, { horizontal = isMobile(), legend = false, stacked = false } = {}) {
    const cat = { stacked, grid: { display: false }, ticks: { autoSkip: false, font: { size: horizontal ? 11 : 10 }, ...(horizontal ? {} : { maxRotation: 50, minRotation: 40 }) } };
    const val = { stacked, beginAtZero: true, grid: { color: '#eef1f4' }, border: { display: false }, ticks: { precision: 0 } };
    return { maintainAspectRatio: false, indexAxis: horizontal ? 'y' : 'x', interaction: { mode: 'index', intersect: false, axis: horizontal ? 'y' : 'x' },
      plugins: { legend: { display: legend, position: 'top', align: 'start', labels: { usePointStyle: true, boxWidth: 8 } },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${D.fmt(horizontal ? c.parsed.x : c.parsed.y, unit === '%' ? 1 : 0)} ${unit}` } } },
      scales: horizontal ? { y: cat, x: val } : { x: cat, y: val } };
  }
  function goMap(kind, id) {
    App.state.layers[kind] = true;
    App.go('map');
    if (id) setTimeout(() => SmartMap.focusPoint(kind, id), 150);
  }

  // ---------------- กลุ่มแปลงใหญ่ ----------------
  window.FarmView = (function () {
    let ctx, inited = false, lastMobile = null;
    const draw = makeCharts();
    const COLOR = '#6250d6';
    const pct = (a, b) => (a && b ? (b - a) / a * 100 : null);

    function init(_ctx) {
      ctx = _ctx;
      const F = ctx.farms;
      const ds = [...new Set(F.map((f) => f.district).filter(Boolean))].sort(sortTh);
      const cs = Object.entries(countBy(F, 'commodity')).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
      document.getElementById('farm-d').innerHTML = '<option value="">ทุกอำเภอ</option>' + ds.map((d) => `<option>${D.esc(d)}</option>`).join('');
      document.getElementById('farm-c').innerHTML = '<option value="">ทุกสินค้า</option>' + cs.map((d) => `<option>${D.esc(d)}</option>`).join('');
      ['farm-q', 'farm-d', 'farm-c', 'farm-p'].forEach((id) => document.getElementById(id).addEventListener('input', table));
      document.getElementById('farm-table').addEventListener('click', (e) => { const b = e.target.closest('[data-farm-map]'); if (b) goMap('farm', b.dataset.farmMap); });
      document.getElementById('farm-to-map').onclick = () => goMap('farm');
      const cy = document.getElementById('farm-cy');
      cy.checked = false; // ค่าเริ่มต้น: ไม่แสดง
      cy.addEventListener('change', () => { document.getElementById('farm-cy-body').hidden = !cy.checked; if (cy.checked) costYield(); table(); });
      const withXY = F.filter((f) => f.lat !== null).length;
      document.getElementById('farm-src').textContent = `ที่มา: ระบบแปลงใหญ่ กรมส่งเสริมการเกษตร (ปี 2569) · ${F.length} กลุ่ม ใน ${ds.length} อำเภอ · มีพิกัด ${withXY} กลุ่ม (พิกัดจากบัญชีแปลงใหญ่ ปี 2566)`;
      inited = true;
    }

    function kpis() {
      const F = ctx.farms;
      const mem = F.reduce((a, f) => a + f.members, 0), area = F.reduce((a, f) => a + f.plot_area, 0);
      const noXY = F.filter((f) => f.lat === null).length;
      const top = Object.entries(countBy(F, 'commodity')).sort((a, b) => b[1] - a[1]);
      document.getElementById('farm-kpis').innerHTML = kpiHtml([
        ['h-purple', 'กลุ่มแปลงใหญ่ (กลุ่ม)', D.fmt(F.length), `ใน ${new Set(F.map((f) => f.district_code)).size} อำเภอ`],
        ['h-yellow', 'สมาชิกรวม (ราย)', D.fmt(mem), `เฉลี่ย ${D.fmt(F.length ? mem / F.length : 0, 1)} ราย/กลุ่ม`],
        ['h-salmon', 'พื้นที่แปลงใหญ่ (ไร่)', D.fmt(area), `${D.fmt(F.reduce((a, f) => a + f.plots, 0))} แปลง`],
        ['h-blue', 'สินค้าหลักอันดับ 1', D.esc(top[0] ? top[0][0] : '–'), top[1] ? `รองลงมา ${D.esc(top[1][0])} ${top[1][1]} กลุ่ม` : ''],
        ['h-pink', 'มาตรฐาน GAP / อินทรีย์', D.fmt(F.filter((f) => f.gap).length) + ' / ' + D.fmt(F.filter((f) => f.organic).length), noXY ? `📍 ยังไม่มีพิกัด ${noXY} กลุ่ม` : 'มีพิกัดครบ'],
      ]);
    }

    function charts() {
      const F = ctx.farms;
      // รายอำเภอ: แยกพืช/ปศุสัตว์-ประมง ตามกลุ่มสินค้า
      const byD = {};
      F.forEach((f) => { const k = f.district || 'ไม่ระบุ'; byD[k] = byD[k] || { n: 0, m: 0 }; byD[k].n++; byD[k].m += f.members; });
      const d = Object.entries(byD).sort((a, b) => b[1].n - a[1].n || b[1].m - a[1].m);
      draw('ch-farm-district', { type: 'bar', data: { labels: d.map((x) => x[0]), datasets: [{ label: 'กลุ่ม', data: d.map((x) => x[1].n), backgroundColor: COLOR, ...BAR }] }, options: opts('กลุ่ม') });
      // รายสินค้า: แสดง 8 อันดับแรก ที่เหลือรวมเป็น "อื่น ๆ"
      let c = Object.entries(countBy(F, 'commodity')).sort((a, b) => b[1] - a[1]);
      if (c.length > 9) c = c.slice(0, 8).concat([['อื่น ๆ (' + (c.length - 8) + ' ชนิด)', c.slice(8).reduce((a, x) => a + x[1], 0)]]);
      draw('ch-farm-commodity', { type: 'bar', data: { labels: c.map((x) => x[0]), datasets: [{ label: 'กลุ่ม', data: c.map((x) => x[1]), backgroundColor: '#1baf7a', ...BAR }] }, options: opts('กลุ่ม', { horizontal: true }) });
      const ys = countBy(F.filter((f) => f.year_start), 'year_start');
      const yk = Object.keys(ys).map(Number);
      const yl = yk.length ? Array.from({ length: Math.max(...yk) - Math.min(...yk) + 1 }, (_, i) => Math.min(...yk) + i) : [];
      draw('ch-farm-year', { type: 'bar', data: { labels: yl, datasets: [{ label: 'กลุ่มที่เริ่ม', data: yl.map((y) => ys[y] || 0), backgroundColor: '#eb6834', ...BAR }] }, options: opts('กลุ่ม', { horizontal: false }) });
    }

    // ต้นทุน/ผลผลิต ก่อน–หลัง (ข้อมูลรายงานตนเองของกลุ่ม) — เปิดดูเมื่อผู้ใช้เลือกเท่านั้น
    function costYield() {
      const F = ctx.farms.filter((f) => f.cost_before && f.cost_after && f.yield_before && f.yield_after);
      const exact = F.filter((f) => Math.abs(pct(f.cost_before, f.cost_after) + 20) < 0.05 && Math.abs(pct(f.yield_before, f.yield_after) - 20) < 0.05).length;
      document.getElementById('farm-cy-note').innerHTML = `⚠️ เป็นตัวเลขที่กลุ่มรายงานเองในระบบแปลงใหญ่ (${F.length} จาก ${ctx.farms.length} กลุ่มที่รายงานครบ) ` +
        `ในจำนวนนี้ <b>${exact} กลุ่ม</b> รายงานต้นทุนลดลง 20% และผลผลิตเพิ่มขึ้น 20% พอดี ซึ่งอาจเป็นค่าเป้าหมายมากกว่าผลที่วัดจริง ` +
        'ควรใช้เพื่อดูภาพรวมเท่านั้น ไม่ควรอ้างอิงเป็นผลสัมฤทธิ์รายกลุ่ม · ค่าที่แสดงคือค่ามัธยฐานของการเปลี่ยนแปลงรายกลุ่ม';
      const by = {};
      F.forEach((f) => { (by[f.commodity] = by[f.commodity] || []).push(f); });
      const med = (a) => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
      const rows = Object.entries(by).filter((x) => x[1].length >= 2).sort((a, b) => b[1].length - a[1].length)
        .map(([k, a]) => [k + ` (${a.length})`, med(a.map((f) => pct(f.cost_before, f.cost_after))), med(a.map((f) => pct(f.yield_before, f.yield_after)))]);
      const o = opts('%', { horizontal: true, legend: true });
      o.scales.x.beginAtZero = true; o.scales.x.ticks = { callback: (v) => v + '%' };
      draw('ch-farm-cy', { type: 'bar', data: { labels: rows.map((r) => r[0]), datasets: [
        { label: 'ต้นทุนเปลี่ยนแปลง', data: rows.map((r) => r[1]), backgroundColor: '#eb6834', ...BAR, borderSkipped: false },
        { label: 'ผลผลิต/ไร่เปลี่ยนแปลง', data: rows.map((r) => r[2]), backgroundColor: '#2a78d6', ...BAR, borderSkipped: false }] }, options: o });
    }

    function table() {
      const q = document.getElementById('farm-q').value.trim().toLowerCase(), dd = document.getElementById('farm-d').value,
        cc = document.getElementById('farm-c').value, pp = document.getElementById('farm-p').value;
      const cy = document.getElementById('farm-cy').checked;
      const rows = ctx.farms.filter((f) => (!dd || f.district === dd) && (!cc || f.commodity === cc) &&
        (!pp || (pp === '1') === (f.lat !== null)) && (!q || [f.name, f.tambon, f.commodity, f.district, f.group].join(' ').toLowerCase().includes(q)))
        .sort((a, b) => sortTh(a.district, b.district) || sortTh(a.commodity, b.commodity));
      const chg = (a, b) => { const p = pct(a, b); return p === null ? '–' : (p > 0 ? '+' : '') + D.fmt(p, 1) + '%'; };
      document.getElementById('farm-table').innerHTML = `<thead><tr><th>ชื่อกลุ่มแปลงใหญ่</th><th>อำเภอ</th><th>สินค้าหลัก</th><th class="hide-m">เริ่มปี</th><th>สมาชิก (ราย)</th><th class="hide-m">พื้นที่ (ไร่)</th>${cy ? '<th class="hide-m">ต้นทุน</th><th class="hide-m">ผลผลิต/ไร่</th>' : ''}<th></th></tr></thead><tbody>` +
        (rows.length ? rows.map((f) => `<tr><td>${D.esc(f.name)}</td><td>${D.esc(f.district)}</td><td>${D.esc(f.commodity)}</td>
          <td class="hide-m">${D.esc(f.year_start || '')}</td><td class="n">${D.fmt(f.members)}</td><td class="n hide-m">${D.fmt(f.plot_area, 2)}</td>
          ${cy ? `<td class="n hide-m">${chg(f.cost_before, f.cost_after)}</td><td class="n hide-m">${chg(f.yield_before, f.yield_after)}</td>` : ''}
          <td>${f.lat !== null ? `<button class="btn xs" data-farm-map="${D.esc(f.id)}">📍 แผนที่</button>` : '<span class="nocoord">ยังไม่มีพิกัด</span>'}</td></tr>`).join('')
          : `<tr><td colspan="${cy ? 9 : 7}" class="muted">ไม่พบรายการ</td></tr>`) + '</tbody>';
    }

    window.addEventListener('resize', () => { if (inited && document.getElementById('view-farm').classList.contains('active') && isMobile() !== lastMobile) render(); });
    function render() { lastMobile = isMobile(); kpis(); charts(); if (document.getElementById('farm-cy').checked) costYield(); table(); }
    return { init, render };
  })();

  // ---------------- ศพก. ----------------
  window.LcView = (function () {
    let ctx, inited = false, lastMobile = null;
    const draw = makeCharts();
    function init(_ctx) {
      ctx = _ctx;
      document.getElementById('lc-table').addEventListener('click', (e) => { const b = e.target.closest('[data-lc-map]'); if (b) goMap('lc', b.dataset.lcMap); });
      document.getElementById('lc-to-map').onclick = () => goMap('lc');
      document.getElementById('lc-src').textContent = 'ศพก. หลัก อำเภอละ 1 ศูนย์ และ ศพก. เครือข่าย (ศดปช. ศชข. แปลงใหญ่ ปราชญ์ชาวบ้าน และอื่น ๆ) · สำนักงานเกษตรจังหวัดกำแพงเพชร';
      inited = true;
    }
    function kpis() {
      const L = ctx.lc, net = ctx.lcnet.reduce((a, x) => a + x.count, 0);
      const com = Object.entries(countBy(L, 'commodity')).sort((a, b) => b[1] - a[1]);
      const topType = ctx.lctype.slice().sort((a, b) => b.count - a.count)[0];
      document.getElementById('lc-kpis').innerHTML = kpiHtml([
        ['h-purple', 'ศพก. หลัก (แห่ง)', D.fmt(L.length), `ครบ ${new Set(L.map((c) => c.district_code)).size} อำเภอ`],
        ['h-yellow', 'ศพก. เครือข่าย (แห่ง)', D.fmt(net), `${ctx.lctype.length} ประเภท`],
        ['h-salmon', 'สินค้าหลักของ ศพก. หลัก', com.map(([k, v]) => `${D.esc(k)} ${v}`).slice(0, 1).join(''), com.slice(1).map(([k, v]) => `${D.esc(k)} ${v}`).join(' · ')],
        ['h-blue', 'เครือข่ายประเภทมากที่สุด', D.esc(topType ? topType.type : '–'), topType ? `${D.fmt(topType.count)} แห่ง` : ''],
        ['h-pink', 'เกษตรกรเป้าหมาย (ราย)', D.fmt(L.reduce((a, c) => a + (+c.target_farmers || 0), 0)), `ข้อมูลปี 2566 · ${L.filter((c) => c.target_farmers).length} ศูนย์ที่ระบุ`],
      ]);
    }
    function charts() {
      const n = ctx.lcnet.slice().sort((a, b) => b.count - a.count);
      draw('ch-lc-district', { type: 'bar', data: { labels: n.map((x) => x.district), datasets: [{ label: 'ศพก. เครือข่าย', data: n.map((x) => x.count), backgroundColor: '#0f766e', ...BAR }] }, options: opts('แห่ง') });
      const t = ctx.lctype.slice().sort((a, b) => b.count - a.count);
      draw('ch-lc-type', { type: 'bar', data: { labels: t.map((x) => x.type), datasets: [{ label: 'ศพก. เครือข่าย', data: t.map((x) => x.count), backgroundColor: '#6250d6', ...BAR }] }, options: opts('แห่ง', { horizontal: true }) });
    }
    function table() {
      const net = {}; ctx.lcnet.forEach((x) => { net[x.district_code] = x.count; });
      const rows = ctx.lc.slice().sort((a, b) => sortTh(a.district, b.district));
      document.getElementById('lc-table').innerHTML = `<thead><tr><th>อำเภอ</th><th class="hide-m">ที่ตั้ง</th><th>สินค้าหลัก</th><th class="hide-m">จุดเด่นของศูนย์</th><th>เครือข่าย (แห่ง)</th><th></th></tr></thead><tbody>` +
        rows.map((c) => `<tr><td>${D.esc(c.district)}</td><td class="hide-m">ม.${D.esc(c.moo)} ต.${D.esc(c.tambon)}</td><td>${D.esc(c.commodity)}</td>
          <td class="hide-m small">${D.esc(String(c.highlight || '').split(';').map((x) => x.trim()).filter(Boolean).join(' · '))}</td>
          <td class="n">${D.fmt(net[c.district_code] ?? c.network)}</td>
          <td>${c.lat !== null ? `<button class="btn xs" data-lc-map="${D.esc(c.id)}">📍 แผนที่</button>` : '<span class="nocoord">ยังไม่มีพิกัด</span>'}</td></tr>`).join('') + '</tbody>';
    }
    window.addEventListener('resize', () => { if (inited && document.getElementById('view-lc').classList.contains('active') && isMobile() !== lastMobile) render(); });
    function render() { lastMobile = isMobile(); kpis(); charts(); table(); }
    return { init, render };
  })();
})();
