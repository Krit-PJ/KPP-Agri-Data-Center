// ===== แดชบอร์ด ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.) =====
window.SoilView = (function () {
  const D = window.AgriData;
  const COLOR = { 'หลัก': '#eb6834', 'เครือข่าย': '#2a78d6' };
  let ctx, charts = {}, inited = false;
  const isMobile = () => window.innerWidth < 760;

  function init(_ctx) {
    ctx = _ctx;
    const ds = [...new Set(ctx.soil.map((c) => c.district).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
    document.getElementById('soil-d').innerHTML = '<option value="">ทุกอำเภอ</option>' + ds.map((d) => `<option>${D.esc(d)}</option>`).join('');
    ['soil-q', 'soil-d', 'soil-t'].forEach((id) => document.getElementById(id).addEventListener('input', table));
    document.getElementById('soil-table').addEventListener('click', (e) => {
      const b = e.target.closest('[data-soil-map]'); if (!b) return;
      App.go('map'); setTimeout(() => SmartMap.focusSoil(b.dataset.soilMap), 120);
    });
    document.getElementById('soil-to-map').onclick = () => { App.state.soil = true; App.go('map'); };
    document.getElementById('soil-src').textContent = 'ที่มา: ทำเนียบ ศดปช. ปี 2569 สำนักงานเกษตรจังหวัดกำแพงเพชร · ' + ctx.soil.length + ' ศูนย์ ใน ' + ds.length + ' อำเภอ';
    inited = true;
  }

  function kpis() {
    const s = ctx.soil, main = s.filter((c) => c.type === 'หลัก'), net = s.filter((c) => c.type === 'เครือข่าย');
    const mem = s.reduce((a, c) => a + c.members, 0);
    const pend = s.filter((c) => !c.verified).length;
    const items = [
      ['h-purple', 'ศดปช. ทั้งหมด (ศูนย์)', D.fmt(s.length), `ใน ${new Set(s.map((c) => c.district_code)).size} อำเภอ`],
      ['h-yellow', 'สมาชิกรวม (ราย)', D.fmt(mem), `เฉลี่ย ${D.fmt(s.length ? mem / s.length : 0, 1)} ราย/ศูนย์`],
      ['h-salmon', 'ศูนย์หลัก', D.fmt(main.length), `สมาชิก ${D.fmt(main.reduce((a, c) => a + c.members, 0))} ราย`],
      ['h-blue', 'ศูนย์เครือข่าย', D.fmt(net.length), `สมาชิก ${D.fmt(net.reduce((a, c) => a + c.members, 0))} ราย`],
      ['h-pink', 'ได้รับโครงการ OSS', D.fmt(s.filter((c) => c.oss).length), pend ? `⚠️ พิกัดรอตรวจสอบ ${pend} ศูนย์` : 'พิกัดตรวจสอบครบ'],
    ];
    document.getElementById('soil-kpis').innerHTML = items.map(([c, l, v, d]) => `<div class="kpi"><div class="h ${c}">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join('');
  }

  function byDistrict() {
    const m = {};
    ctx.soil.forEach((c) => { const k = c.district || 'ไม่ระบุ'; m[k] = m[k] || { main: 0, net: 0, members: 0 }; m[k][c.type === 'หลัก' ? 'main' : 'net']++; m[k].members += c.members; });
    return Object.entries(m).sort((a, b) => (b[1].main + b[1].net) - (a[1].main + a[1].net) || b[1].members - a[1].members);
  }

  function draw(id, cfg) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart(document.getElementById(id), cfg); }
  const opts = (stacked, unit) => {
    const m = isMobile();
    const cat = { stacked, grid: { display: false }, ticks: { autoSkip: false, font: { size: m ? 11 : 10 }, ...(m ? {} : { maxRotation: 50, minRotation: 40 }) } };
    const val = { stacked, beginAtZero: true, grid: { color: '#eef1f4' }, border: { display: false }, ticks: { precision: 0 } };
    return { maintainAspectRatio: false, indexAxis: m ? 'y' : 'x', interaction: { mode: 'index', intersect: false, axis: m ? 'y' : 'x' },
      plugins: { legend: { display: stacked, position: 'top', align: 'start', labels: { usePointStyle: true, boxWidth: 8 } },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${D.fmt(m ? c.parsed.x : c.parsed.y)} ${unit}` } } },
      scales: m ? { y: cat, x: val } : { x: cat, y: val } };
  };

  function chartsAll() {
    const d = byDistrict();
    const bar = { borderRadius: 4, borderSkipped: 'start', borderColor: '#fff', borderWidth: 1 };
    draw('ch-soil-district', { type: 'bar', data: { labels: d.map((x) => x[0]), datasets: [
      { label: 'ศูนย์หลัก', data: d.map((x) => x[1].main), backgroundColor: COLOR['หลัก'], ...bar },
      { label: 'ศูนย์เครือข่าย', data: d.map((x) => x[1].net), backgroundColor: COLOR['เครือข่าย'], ...bar }] }, options: opts(true, 'ศูนย์') });
    const dm = d.slice().sort((a, b) => b[1].members - a[1].members);
    draw('ch-soil-members', { type: 'bar', data: { labels: dm.map((x) => x[0]), datasets: [{ label: 'สมาชิก', data: dm.map((x) => x[1].members), backgroundColor: '#1baf7a', ...bar }] }, options: opts(false, 'ราย') });
    const ys = {}; ctx.soil.forEach((c) => { if (c.year_start) ys[c.year_start] = (ys[c.year_start] || 0) + 1; });
    const yk = Object.keys(ys).map(Number);
    const yl = yk.length ? Array.from({ length: Math.max(...yk) - Math.min(...yk) + 1 }, (_, i) => Math.min(...yk) + i) : []; // ต่อเนื่องทุกปี ไม่ข้ามปีที่เป็น 0
    const o = opts(false, 'ศูนย์'); o.indexAxis = 'x'; o.scales = { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#eef1f4' } } };
    draw('ch-soil-year', { type: 'bar', data: { labels: yl, datasets: [{ label: 'ศูนย์ที่เริ่ม', data: yl.map((y) => ys[y] || 0), backgroundColor: '#6250d6', ...bar }] }, options: o });
  }

  function table() {
    const q = document.getElementById('soil-q').value.trim().toLowerCase(), dd = document.getElementById('soil-d').value, tt = document.getElementById('soil-t').value;
    const rows = ctx.soil.filter((c) => (!dd || c.district === dd) && (!tt || c.type === tt) &&
      (!q || [c.name, c.location, c.crops, c.district, c.products].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => a.district.localeCompare(b.district, 'th') || (a.type === 'หลัก' ? -1 : 1));
    document.getElementById('soil-table').innerHTML = `<thead><tr><th>ชื่อ ศดปช.</th><th>อำเภอ</th><th class="hide-m">ที่ตั้ง</th><th>ประเภท</th><th>สมาชิก (ราย)</th><th class="hide-m">เริ่ม</th><th class="hide-m">พืชหลัก</th><th></th></tr></thead><tbody>` +
      (rows.length ? rows.map((c) => `<tr><td>${D.esc(c.name)}${c.verified ? '' : ' <span class="chk-flag" title="' + D.esc(c.note) + '">⚠️ พิกัดรอตรวจ</span>'}</td><td>${D.esc(c.district)}</td>
        <td class="hide-m">${D.esc(c.location)}</td><td><span class="badge-type ${c.type === 'หลัก' ? 'main' : 'net'}">${D.esc(c.type || '-')}</span></td>
        <td class="n">${D.fmt(c.members)}</td><td class="hide-m">${D.esc(c.year_start || '')}</td><td class="hide-m">${D.esc(c.crops || '-')}</td>
        <td>${c.lat !== null ? `<button class="btn xs" data-soil-map="${D.esc(c.id)}">📍 แผนที่</button>` : ''}</td></tr>`).join('')
        : '<tr><td colspan="8" class="muted">ไม่พบรายการ</td></tr>') + '</tbody>';
  }

  let lastMobile = null;
  window.addEventListener('resize', () => { if (inited && document.getElementById('view-soil').classList.contains('active') && isMobile() !== lastMobile) render(); });
  function render() { lastMobile = isMobile(); kpis(); chartsAll(); table(); }
  return { init, render };
})();
