// ===== Smart Map: Leaflet choropleth รายอำเภอ =====
window.SmartMap = (function () {
  const C = window.APP_CONFIG;
  const D = window.AgriData;
  let map, layer, base, labels = [], ctx, state, sparkChart;

  const RAMP = ['#e6f4ea', '#a8dbb7', '#5fb87c', '#258a47', '#0e4d22']; // sequential: เขียวเดียว อ่อน→เข้ม
  const BASEMAPS = {
    light: { label: '🗺️ Light', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', attr: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors', maxZoom: 16 },
    osm: { label: '🛣️ OSM', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attr: '© OpenStreetMap contributors' },
    sat: { label: '🛰️ ดาวเทียม', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: 'Tiles © Esri' },
    none: { label: '⬜ ไม่มี', url: null },
  };
  const METRIC_ICON = { planted: '🌱', harvested: '🌾', production: '⚖️', yield: '📈' };

  const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  function colorAt(t) {
    t = Math.max(0, Math.min(1, t));
    const seg = t * (RAMP.length - 1), i = Math.min(Math.floor(seg), RAMP.length - 2), f = seg - i;
    const a = hex2rgb(RAMP[i]), b = hex2rgb(RAMP[i + 1]);
    return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
  }

  function init(_ctx, _state) {
    ctx = _ctx; state = _state;
    map = L.map('map', { zoomControl: true, attributionControl: true, zoomSnap: 0.25 }).setView(C.CENTER, C.ZOOM);
    setBase('light');
    layer = L.geoJSON(ctx.geo, { style, onEachFeature }).addTo(map);
    resetView();

    // controls
    document.getElementById('btn-reset').onclick = () => { resetView(); closeInfo(); };
    document.getElementById('btn-layer').onclick = () => { closeInfo(); document.getElementById('layer-panel').classList.toggle('open'); };
    document.getElementById('close-panel').onclick = () => document.getElementById('layer-panel').classList.remove('open');
    const dl = document.getElementById('district-list');
    dl.innerHTML = ctx.districts.map((d) => `<option value="${d.district}">`).join('');
    document.getElementById('search').addEventListener('change', (e) => {
      const v = e.target.value.trim();
      layer.eachLayer((l) => { if (l.feature.properties.name.includes(v) && v) { map.fitBounds(l.getBounds(), { padding: [80, 80] }); openInfo(l.feature.properties.code); } });
    });
    document.getElementById('basemaps').innerHTML = Object.entries(BASEMAPS)
      .map(([k, b]) => `<button class="chip ${k === 'light' ? 'on' : ''}" data-base="${k}">${b.label}</button>`).join('');
    document.getElementById('basemaps').onclick = (e) => {
      const k = e.target.dataset.base; if (!k) return;
      setBase(k);
      document.querySelectorAll('[data-base]').forEach((b) => b.classList.toggle('on', b.dataset.base === k));
    };
    document.getElementById('src-badge').innerHTML = ctx.source === 'api'
      ? '🟢 แหล่งข้อมูล: <b>Google Sheets</b> ผ่านระบบหลังบ้าน (อัปเดตสด)'
      : '🟠 แหล่งข้อมูล: ไฟล์สำรองใน repo (ยังไม่ได้เชื่อมระบบหลังบ้าน)';
  }

  function setBase(k) {
    if (base) map.removeLayer(base);
    base = null;
    const b = BASEMAPS[k];
    if (b.url) base = L.tileLayer(b.url, { attribution: b.attr, maxZoom: b.maxZoom || 18 }).addTo(map).bringToBack();
  }
  function resetView() { const m = window.innerWidth < 760; map.fitBounds(layer.getBounds(), m ? { paddingTopLeft: [10, 90], paddingBottomRight: [10, 80] } : { paddingTopLeft: [40, 70], paddingBottomRight: [40, 100] }); }

  function valueOf(code) {
    return D.METRICS[state.metric].fn(D.filter(ctx.rows, { crop: state.crop, year: state.year, district_code: code }));
  }
  function range() {
    const vals = ctx.districts.map((d) => valueOf(d.district_code)).filter((v) => v > 0);
    return [Math.min(...vals, Infinity), Math.max(...vals, 0)];
  }
  let rng = [0, 1];
  function style(f) {
    const v = valueOf(f.properties.code);
    const t = rng[1] > rng[0] ? (v - rng[0]) / (rng[1] - rng[0]) : 1;
    return { fillColor: v > 0 ? colorAt(t) : '#e9ecef', fillOpacity: 0.88, color: '#3f4a56', weight: 1.6 };
  }
  function onEachFeature(f, l) {
    l.on({
      mouseover: (e) => { e.target.setStyle({ weight: 3, color: '#111' }); e.target.bringToFront(); },
      mouseout: (e) => layer.resetStyle(e.target),
      click: () => openInfo(f.properties.code),
    });
    l.bindTooltip(() => {
      const m = D.METRICS[state.metric];
      return `<b>${f.properties.name}</b><br>${m.label}: ${D.fmt(valueOf(f.properties.code))} ${m.unit}`;
    }, { sticky: true });
    const lbl = L.tooltip({ permanent: true, direction: 'center', className: 'dlabel', interactive: false })
      .setContent(f.properties.name).setLatLng(l.getBounds().getCenter());
    const d = ctx.districts.find((x) => x.district_code === f.properties.code);
    if (d) lbl.setLatLng([+d.lat, +d.lng]);
    labels.push(lbl.addTo(map));
  }

  function renderControls() {
    const years = [...new Set(D.filter(ctx.rows, { crop: state.crop }).map((r) => r.year))].sort();
    if (!years.includes(state.year)) state.year = years[years.length - 1];
    document.getElementById('map-years').innerHTML = years
      .map((y) => `<button class="${y === state.year ? 'on' : ''}" data-year="${y}">${y}</button>`).join('');
    document.getElementById('map-metrics').innerHTML = Object.entries(D.METRICS)
      .map(([k, m]) => `<button class="metric ${k === state.metric ? 'on' : ''}" data-metric="${k}">${METRIC_ICON[k]} ${m.label}<small>${m.unit}</small></button>`).join('');
  }

  function render() {
    renderControls();
    rng = range();
    layer.setStyle(style);
    const m = D.METRICS[state.metric];
    document.getElementById('map-title').innerHTML = `${CropIcons.svg(state.crop, 20)} ${D.esc(state.crop)} · ปี ${state.year} · ${m.label}`;
    document.getElementById('legend').innerHTML = `
      <div class="lg-title">${m.label} (${m.unit})</div>
      <div class="bar" style="background:linear-gradient(90deg,${RAMP.join(',')})"></div>
      <div class="ends"><span>${D.fmt(isFinite(rng[0]) ? rng[0] : 0)}</span><span>${D.fmt(rng[1])}</span></div>
      <div class="ends nodata"><span><i></i> ไม่มีการปลูก</span></div>`;
    const base = D.filter(ctx.rows, { crop: state.crop, year: state.year });
    const k = [
      ['🌱', D.M.planted(base), 'เนื้อที่เพาะปลูก (ไร่)'],
      ['🌾', D.M.harvested(base), 'เนื้อที่เก็บเกี่ยว (ไร่)'],
      ['⚖️', D.M.production(base), 'ผลผลิต (ตัน)'],
      ['📈', D.M.yield(base), 'ผลผลิตเฉลี่ย (กก./ไร่)'],
    ];
    document.getElementById('map-kpis').innerHTML = k.map(([ic, v, l]) =>
      `<div class="k"><span class="ic">${ic}</span><div><b>${D.fmt(v)}</b><small>${l}</small></div></div>`).join('');
    if (state.openDistrict) openInfo(state.openDistrict);
  }

  function openInfo(code) {
    state.openDistrict = code;
    document.getElementById('layer-panel').classList.remove('open');
    const d = ctx.districts.find((x) => x.district_code === code);
    const rs = D.filter(ctx.rows, { crop: state.crop, year: state.year, district_code: code });
    const all = ctx.districts.map((x) => ({ c: x.district_code, v: valueOf(x.district_code) })).sort((a, b) => b.v - a.v);
    const rank = all.findIndex((x) => x.c === code) + 1;
    const yy = D.yoy(ctx.rows, state.metric, { crop: state.crop, district_code: code }, state.year);
    const el = document.getElementById('info-card');
    el.innerHTML = `<button class="x" onclick="SmartMap.closeInfo()">✕</button>
      <div class="grab"></div><h4>${CropIcons.svg(state.crop, 26)} อ.${d.district}</h4><div class="sub">${d.district_en} · ${state.crop} ปี ${state.year}</div>
      <dl>
        <dt>เนื้อที่เพาะปลูก</dt><dd>${D.fmt(D.M.planted(rs))} ไร่</dd>
        <dt>เนื้อที่เก็บเกี่ยว</dt><dd>${D.fmt(D.M.harvested(rs))} ไร่</dd>
        <dt>ผลผลิต</dt><dd>${D.fmt(D.M.production(rs))} ตัน</dd>
        <dt>ผลผลิตเฉลี่ย</dt><dd>${D.fmt(D.M.yield(rs))} กก./ไร่</dd>
        <dt>${D.METRICS[state.metric].label} เทียบปีก่อน</dt><dd>${yy === null ? '–' : (Math.abs(yy) < 0.0005 ? '▬ ' : yy > 0 ? '▲ ' : '▼ ') + D.fmt(yy * 100, 2) + '%'}</dd>
      </dl>
      <span class="rank">อันดับ ${rank} จาก ${all.length} อำเภอ</span>
      <div class="sub" style="margin-top:10px">แนวโน้ม${D.METRICS[state.metric].label}รายปี</div>
      <div class="spark"><canvas id="spark"></canvas></div>`;
    el.classList.add('open');
    const years = [...new Set(D.filter(ctx.rows, { crop: state.crop }).map((r) => r.year))].sort();
    const vals = years.map((y) => D.METRICS[state.metric].fn(D.filter(ctx.rows, { crop: state.crop, year: y, district_code: code })));
    if (sparkChart) sparkChart.destroy();
    sparkChart = new Chart(document.getElementById('spark'), {
      type: 'line',
      data: { labels: years, datasets: [{ data: vals, borderColor: '#1a7f37', backgroundColor: 'rgba(26,127,55,.12)', fill: true, borderWidth: 2, pointRadius: years.map((y) => y === state.year ? 5 : 2), pointBackgroundColor: '#1a7f37', tension: .3 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => D.fmt(c.parsed.y) + ' ' + D.METRICS[state.metric].unit } } },
        scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: { grid: { color: '#eef1f4' }, ticks: { font: { size: 10 }, callback: (v) => D.fmtShort(v) } } } },
    });
  }
  function closeInfo() { state.openDistrict = null; document.getElementById('info-card').classList.remove('open'); }
  let fitted = false;
  function invalidate(refit) {
    if (!map) return;
    setTimeout(() => { map.invalidateSize(); if (!fitted || refit) { resetView(); fitted = true; } }, 60);
  }

  return { init, render, closeInfo, invalidate };
})();
