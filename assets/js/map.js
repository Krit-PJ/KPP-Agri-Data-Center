// ===== Smart Map: Leaflet choropleth รายอำเภอ =====
window.SmartMap = (function () {
  const C = window.APP_CONFIG;
  const D = window.AgriData;
  let map, layer, base, labels = [], ctx, state, sparkChart;
  const SOIL_COLOR = { 'หลัก': '#eb6834', 'เครือข่าย': '#2a78d6' };

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
    map.attributionControl.setPrefix('© 2569 Dr. Kitti PhoJuang · <a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    setBase('light');
    layer = L.geoJSON(ctx.geo, { style, onEachFeature }).addTo(map);
    map.createPane('points').style.zIndex = 660; // เหนือชั้นอำเภอ (400) และป้ายชื่ออำเภอ (650) ใต้ป๊อปอัป (700)
    const cnt = (list) => { const n = list.length, p = list.filter((o) => o.lat !== null).length; return n ? (p === n ? `(${n})` : `(${p}/${n} มีพิกัด)`) : '(ไม่มีข้อมูล)'; };
    document.getElementById('soil-count').textContent = cnt(ctx.soil);
    document.getElementById('farm-count').textContent = cnt(ctx.farms);
    document.getElementById('lc-count').textContent = cnt(ctx.lc);
    ['soil', 'farm', 'lc'].forEach((k) => { document.getElementById('lgs-' + k).innerHTML = legendShape(k); });
    ['crop', 'soil', 'farm', 'lc'].forEach((k) => document.getElementById('tg-' + k).addEventListener('change', (e) => {
      state.layers[k] = e.target.checked; syncToggles();
      if (k === 'crop' && !state.layers.crop) closeInfo();
      renderPoints(); render(); if (window.App) App.writeHash();
    }));
    syncToggles();
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
    if (!state.layers.crop) return { fillColor: '#f4f6f8', fillOpacity: 0.35, color: '#3f4a56', weight: 1.4 };
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
      if (!state.layers.crop) return `<b>${f.properties.name}</b>`;
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

  function pointLegend() {
    const parts = [];
    if (state.layers.soil) parts.push(`<span>${shapeSvg.circle(12, SOIL_COLOR['หลัก'])} ศดปช. หลัก</span><span>${shapeSvg.circle(12, SOIL_COLOR['เครือข่าย'])} ศดปช. เครือข่าย</span>`);
    if (state.layers.farm) parts.push(`<span>${shapeSvg.diamond(12, FARM_COLOR)} กลุ่มแปลงใหญ่</span>`);
    if (state.layers.lc) parts.push(`<span>${shapeSvg.house(13, LC_COLOR)} ศพก. หลัก</span>`);
    return parts.length ? `<div class="pt-lg">${parts.join('')}</div>` : '';
  }

  function render() {
    renderControls();
    rng = range();
    layer.setStyle(style);
    const m = D.METRICS[state.metric];
    const on = state.layers.crop;
    const names = [on ? null : 'ชั้นข้อมูลจุด', state.layers.soil && 'ศดปช.', state.layers.farm && 'แปลงใหญ่', state.layers.lc && 'ศพก.'].filter(Boolean);
    document.getElementById('map-title').innerHTML = on ? `${CropIcons.svg(state.crop, 20)} ${D.esc(state.crop)} · ปี ${state.year} · ${m.label}`
      : '📍 ' + (names.length > 1 ? names.slice(1).join(' · ') : 'ขอบเขตอำเภอ');
    document.getElementById('legend').innerHTML = (on ? `
      <div class="lg-title">${m.label} (${m.unit})</div>
      <div class="bar" style="background:linear-gradient(90deg,${RAMP.join(',')})"></div>
      <div class="ends"><span>${D.fmt(isFinite(rng[0]) ? rng[0] : 0)}</span><span>${D.fmt(rng[1])}</span></div>
      <div class="ends nodata"><span><i></i> ไม่มีการปลูก</span></div>` : '') + pointLegend();
    document.getElementById('legend').classList.toggle('empty', !on && !pointLegend());
    document.getElementById('map-kpis').classList.toggle('hidden', !on);
    document.getElementById('cropbar').classList.toggle('dim', !on && document.body.dataset.view === 'map');
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

  /** เมื่อปิดชั้นสถิติพืช: คลิกอำเภอแสดงจำนวนศูนย์/กลุ่มในอำเภอ */
  function openDistrictSummary(code) {
    const d = ctx.districts.find((x) => x.district_code === code);
    const n = (list) => list.filter((o) => o.district_code === code);
    const soil = n(ctx.soil), farms = n(ctx.farms), lc = n(ctx.lc), net = ctx.lcnet.find((x) => x.district_code === code);
    const top = Object.entries(farms.reduce((a, f) => { a[f.commodity] = (a[f.commodity] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 3);
    openSheet(`<h4>อ.${D.esc(d.district)}</h4><div class="sub">${D.esc(d.district_en)} · ศูนย์และกลุ่มเกษตรกร</div>
      <dl><dt>${shapeSvg.circle(12, SOIL_COLOR['หลัก'])} ศดปช.</dt><dd>${soil.length} ศูนย์ · สมาชิก ${D.fmt(soil.reduce((a, c) => a + c.members, 0))} ราย</dd>
      <dt>${shapeSvg.diamond(12, FARM_COLOR)} กลุ่มแปลงใหญ่</dt><dd>${farms.length} กลุ่ม · สมาชิก ${D.fmt(farms.reduce((a, f) => a + f.members, 0))} ราย</dd>
      ${top.length ? `<dt>สินค้าหลักของแปลงใหญ่</dt><dd>${top.map(([c, v]) => D.esc(c) + ' ' + v).join(', ')}</dd>` : ''}
      <dt>${shapeSvg.house(13, LC_COLOR)} ศพก. หลัก</dt><dd>${lc.length ? D.esc(lc[0].commodity) : '–'}</dd>
      <dt>ศพก. เครือข่าย</dt><dd>${net ? D.fmt(net.count) + ' แห่ง' : '–'}</dd></dl>`);
  }

  function openInfo(code) {
    if (!state.layers.crop) { openDistrictSummary(code); return; }
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

  // ---------- ชั้นข้อมูลจุด: ศดปช. (วงกลม) · กลุ่มแปลงใหญ่ (ข้าวหลามตัด) · ศพก. (รูปบ้าน) ----------
  // วางใน pane "points" ที่อยู่เหนือชั้นอำเภอเสมอ จึงคลิกได้แม้เมาส์ผ่านขอบอำเภอ
  const PT = {
    soil: { label: 'ศดปช.', list: () => ctx.soil },
    farm: { label: 'กลุ่มแปลงใหญ่', list: () => ctx.farms },
    lc: { label: 'ศพก. หลัก', list: () => ctx.lc },
  };
  const FARM_COLOR = '#6250d6', LC_COLOR = '#0f766e';
  const shapeSvg = {
    circle: (sz, fill, dashed) => `<svg width="${sz}" height="${sz}" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.6" fill="${fill}" stroke="#fff" stroke-width="2.2"${dashed ? ' stroke-dasharray="3 2"' : ''}/></svg>`,
    diamond: (sz, fill) => `<svg width="${sz}" height="${sz}" viewBox="0 0 20 20"><path d="M10 1.2 18.8 10 10 18.8 1.2 10Z" fill="${fill}" stroke="#fff" stroke-width="2"/></svg>`,
    house: (sz, fill) => `<svg width="${sz}" height="${sz}" viewBox="0 0 22 22"><path d="M11 1.5 21 10h-2.6v10.5H3.6V10H1Z" fill="${fill}" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><rect x="8.6" y="13" width="4.8" height="7.5" fill="#fff" opacity=".9"/></svg>`,
  };
  const legendShape = (k) => k === 'soil' ? shapeSvg.circle(12, SOIL_COLOR['หลัก']) + shapeSvg.circle(12, SOIL_COLOR['เครือข่าย'])
    : k === 'farm' ? shapeSvg.diamond(13, FARM_COLOR) : shapeSvg.house(15, LC_COLOR);
  function iconFor(kind, o) {
    let sz, html;
    if (kind === 'soil') { sz = Math.round(Math.max(13, Math.min(26, Math.sqrt(o.members) * 2.4))); html = shapeSvg.circle(sz, SOIL_COLOR[o.type] || '#6b7682', !o.verified); }
    else if (kind === 'farm') { sz = 17; html = shapeSvg.diamond(sz, FARM_COLOR); }
    else { sz = 25; html = shapeSvg.house(sz, LC_COLOR); }
    const box = Math.max(sz, 26); // พื้นที่แตะอย่างน้อย 26px
    return L.divIcon({ className: 'pt-ic pt-' + kind, html: `<span class="pt-hit" style="width:${box}px;height:${box}px">${html}</span>`, iconSize: [box, box], iconAnchor: [box / 2, box / 2], popupAnchor: [0, -sz / 2] });
  }
  const row = (k, v) => (v || v === 0 ? `<dt>${k}</dt><dd>${D.esc(v)}</dd>` : '');
  function soilPopup(c) {
    const cls = c.type === 'หลัก' ? 'main' : 'net';
    return `<div class="soil-pop"><div class="pop-kind">${shapeSvg.circle(12, SOIL_COLOR[c.type] || '#6b7682')} ศูนย์จัดการดินปุ๋ยชุมชน</div><h4>${D.esc(c.name)}</h4>${c.type ? `<span class="tag ${cls}">ศูนย์${D.esc(c.type)}</span>` : ''}
      <dl>${row('อำเภอ', c.district)}${row('ที่ตั้ง', c.location)}${row('สมาชิก', D.fmt(c.members) + ' ราย')}${row('เริ่มดำเนินการ', c.year_start)}
      ${row('ระดับ', c.level)}${row('พืชหลัก', c.crops)}${row('สินค้า/บริการ', c.products)}${row('โครงการ OSS', c.oss ? (c.oss + (c.oss_status ? ' · ' + c.oss_status : '')) : '')}</dl>
      ${!c.verified ? `<div class="warn">⚠️ พิกัดรอตรวจสอบ: ${D.esc(c.note)}</div>` : ''}</div>`;
  }
  function farmPopup(f) {
    const std = [f.gap ? 'GAP' : '', f.organic ? 'อินทรีย์' : ''].filter(Boolean).join(', ');
    return `<div class="soil-pop"><div class="pop-kind">${shapeSvg.diamond(12, FARM_COLOR)} กลุ่มแปลงใหญ่</div><h4>${D.esc(f.name)}</h4>
      <span class="tag farm">${D.esc(f.commodity)}</span>${f.year_start ? ` <span class="tag">เริ่มปี ${D.esc(f.year_start)}</span>` : ''}
      <dl>${row('อำเภอ', f.district)}${row('ตำบล / หมู่', [f.tambon, f.moo ? 'ม.' + f.moo : ''].filter(Boolean).join(' '))}
      ${row('สมาชิก', D.fmt(f.members) + ' ราย')}${row('พื้นที่แปลงใหญ่', D.fmt(f.plot_area, 2) + ' ไร่ · ' + D.fmt(f.plots) + ' แปลง')}
      ${row('รวมกลุ่มแบบ', f.grouping)}${row('มาตรฐาน', std)}${row('ตลาด', f.market_after)}</dl>
      ${f.coord_note && /ตกในอำเภอ/.test(f.coord_note) ? `<div class="warn">⚠️ ${D.esc(f.coord_note.split('; ').pop())}</div>` : ''}</div>`;
  }
  function lcPopup(c) {
    const hl = String(c.highlight || '').split(';').map((x) => x.trim()).filter(Boolean);
    return `<div class="soil-pop"><div class="pop-kind">${shapeSvg.house(13, LC_COLOR)} ศูนย์เรียนรู้การเพิ่มประสิทธิภาพการผลิตสินค้าเกษตร</div><h4>${D.esc(c.name)}</h4>
      <span class="tag lc">${D.esc(c.commodity)}</span>
      <dl>${row('ที่ตั้ง', ['ม.' + c.moo, 'ต.' + c.tambon, 'อ.' + c.district].join(' '))}${row('ศพก. เครือข่าย', c.network ? D.fmt(c.network) + ' แห่ง' : '')}
      ${row('พื้นที่เป้าหมาย', c.target_area ? D.fmt(c.target_area) + ' ไร่' : '')}${row('เกษตรกรเป้าหมาย', c.target_farmers ? D.fmt(c.target_farmers) + ' ราย' : '')}</dl>
      ${hl.length ? `<div class="pop-hl"><b>จุดเด่นของศูนย์</b><ul>${hl.map((h) => `<li>${D.esc(h)}</li>`).join('')}</ul></div>` : ''}</div>`;
  }
  const POPUP = { soil: soilPopup, farm: farmPopup, lc: lcPopup };
  const ptLayers = {};
  function renderPoints() {
    if (!map) return;
    Object.keys(PT).forEach((kind) => {
      if (!ptLayers[kind]) ptLayers[kind] = L.layerGroup();
      const g = ptLayers[kind];
      g.clearLayers();
      if (!state.layers[kind]) { map.removeLayer(g); return; }
      PT[kind].list().filter((o) => o.lat !== null && o.lng !== null).forEach((o) => {
        const m = L.marker([o.lat, o.lng], { icon: iconFor(kind, o), pane: 'points', riseOnHover: true, keyboard: true, title: o.name, alt: PT[kind].label + ' ' + o.name });
        if (isMobile()) m.on('click', () => openSheet(POPUP[kind](o)));
        else { m.bindPopup(POPUP[kind](o), { maxWidth: 320, autoPanPaddingTopLeft: L.point(10, 90), autoPanPaddingBottomRight: L.point(10, 110) });
          m.bindTooltip(D.esc(o.name), { direction: 'top', offset: [0, -8] }); }
        m.ptId = o.id;
        g.addLayer(m);
      });
      g.addTo(map);
    });
  }
  const isMobile = () => window.innerWidth < 760;
  // มือถือ: แสดงรายละเอียดในแผงล่าง (bottom sheet) แทนป๊อปอัปที่ถูกปุ่มลอยบัง
  function openSheet(html) {
    document.getElementById('layer-panel').classList.remove('open');
    state.openDistrict = null;
    const el = document.getElementById('info-card');
    el.innerHTML = `<div class="grab"></div><button class="x" onclick="SmartMap.closeInfo()" aria-label="ปิด">✕</button>${html}`;
    el.classList.add('open');
  }
  function focusPoint(kind, id) {
    state.layers[kind] = true;
    syncToggles();
    renderPoints(); render();
    const o = PT[kind].list().find((x) => x.id === id);
    if (!o || o.lat === null) return;
    map.setView([o.lat, o.lng], 12);
    if (isMobile()) { openSheet(POPUP[kind](o)); return; }
    ptLayers[kind].eachLayer((m) => { if (m.ptId === id) m.openPopup(); });
  }
  function syncToggles() {
    document.getElementById('tg-crop').checked = state.layers.crop;
    Object.keys(PT).forEach((k) => { document.getElementById('tg-' + k).checked = !!state.layers[k]; });
    document.getElementById('layer-panel').classList.toggle('crop-off', !state.layers.crop);
  }

  return { init, render: () => { syncToggles(); render(); renderPoints(); }, closeInfo, invalidate, focusPoint, focusSoil: (id) => focusPoint('soil', id), legendShape };
})();
