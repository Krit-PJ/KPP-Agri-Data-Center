// ===== แผนที่จุดที่ตั้งในหน้า "ศูนย์และกลุ่ม" (ศดปช. / แปลงใหญ่ / ศพก.) =====
// สร้างเมื่อเปิดแท็บนั้นครั้งแรกเท่านั้น · กรองตามตาราง · คลิกจุด ↔ เน้นแถวในตาราง
window.HubMap = (function () {
  const D = window.AgriData, P = window.Points;
  const BASE = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
  const isMobile = () => window.innerWidth < 760;

  /**
   * @param el      id ของกล่องแผนที่
   * @param opt     { ctx, kind: 'soil'|'farm'|'lc', onSelect(id), legend: html, shade: { [district_code]: number } (ไม่บังคับ) }
   */
  function create(el, opt) {
    const ctx = opt.ctx, kind = opt.kind;
    const map = L.map(el, { zoomSnap: 0.25, scrollWheelZoom: false, attributionControl: true });
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    L.tileLayer(BASE, { attribution: 'Tiles © Esri', maxZoom: 16 }).addTo(map);
    // แตะสองครั้ง/คลิกเพื่อเปิดการซูมด้วยล้อเมาส์ ป้องกันหน้าเลื่อนแล้วแผนที่ซูมเอง
    map.on('focus click', () => map.scrollWheelZoom.enable());
    map.on('blur', () => map.scrollWheelZoom.disable());

    const shade = opt.shade || null;
    const max = shade ? Math.max(...Object.values(shade), 1) : 1;
    const fill = (code) => {
      if (!shade) return '#f6f8fa';
      const t = (shade[code] || 0) / max;
      return `rgba(15,118,110,${(0.08 + t * 0.5).toFixed(2)})`;
    };
    const districts = L.geoJSON(ctx.geo, {
      style: (f) => ({ fillColor: fill(f.properties.code), fillOpacity: 1, color: '#6b7682', weight: 1.1 }),
      onEachFeature: (f, l) => {
        const d = ctx.districts.find((x) => x.district_code === f.properties.code);
        const extra = shade ? `<br>ศพก. เครือข่าย ${D.fmt(shade[f.properties.code] || 0)} แห่ง` : '';
        l.bindTooltip(`<b>${D.esc(f.properties.name)}</b>${extra}`, { sticky: true });
        if (d) L.tooltip({ permanent: true, direction: 'center', className: 'dlabel sm', interactive: false }).setContent(D.esc(d.district)).setLatLng([+d.lat, +d.lng]).addTo(map);
      },
    }).addTo(map);
    map.createPane('points').style.zIndex = 660;
    const fit = () => map.fitBounds(districts.getBounds(), { padding: isMobile() ? [8, 8] : [16, 16] });
    fit();
    setTimeout(() => { map.invalidateSize(); fit(); }, 150); // หลังการ์ดยืดตามความสูงของกราฟข้างเคียง

    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = () => { const d = L.DomUtil.create('div', 'hub-legend'); d.innerHTML = opt.legend || ''; return d; };
    legend.addTo(map);
    const reset = L.control({ position: 'topleft' });
    reset.onAdd = () => { const b = L.DomUtil.create('button', 'hub-reset'); b.type = 'button'; b.title = 'มุมมองทั้งจังหวัด'; b.textContent = '⟲'; L.DomEvent.on(b, 'click', (e) => { L.DomEvent.stop(e); map.closePopup(); fit(); }); return b; };
    reset.addTo(map);

    const group = L.layerGroup().addTo(map);
    const markers = {};
    let activeId = null;
    function setPoints(list) {
      group.clearLayers();
      Object.keys(markers).forEach((k) => delete markers[k]);
      list.filter((o) => o.lat !== null && o.lng !== null).forEach((o) => {
        const m = L.marker([o.lat, o.lng], { icon: P.icon(kind, o, o.id === activeId), pane: 'points', riseOnHover: true, title: o.name, alt: o.name });
        m.bindPopup(P.popup[kind](o), { maxWidth: isMobile() ? 250 : 300, autoPanPadding: L.point(12, 12) });
        if (!isMobile()) m.bindTooltip(D.esc(o.name), { direction: 'top', offset: [0, -8] });
        m.on('click', () => { setActive(o.id); m.openPopup(); if (opt.onSelect) opt.onSelect(o.id); });
        m.ptObj = o;
        markers[o.id] = m;
        group.addLayer(m);
      });
      return Object.keys(markers).length;
    }
    function setActive(id) {
      const prev = markers[activeId];
      activeId = id;
      if (prev) prev.setIcon(P.icon(kind, prev.ptObj, false));
      const m = markers[id];
      if (m) m.setIcon(P.icon(kind, m.ptObj, true));
    }
    function focus(id) {
      const m = markers[id];
      if (!m) return false;
      setActive(id);
      map.setView(m.getLatLng(), Math.max(map.getZoom(), 11.5));
      setTimeout(() => m.openPopup(), 250);
      return true;
    }
    return { map, setPoints, focus, setActive, invalidate: () => setTimeout(() => map.invalidateSize(), 60), fit };
  }

  // แผนที่ + การเชื่อมโยงกับตาราง ใช้ร่วมกันทั้ง 3 หน้า
  function attach(o) {
    let hm = null;
    const api = {
      /** เรียกเมื่อหน้าแสดงผล: สร้างแผนที่ครั้งแรก แล้วใส่จุดตามรายการที่กรอง */
      show(list) {
        if (!hm) hm = create(o.el, o);
        else hm.invalidate();
        const n = hm.setPoints(list);
        if (o.count) document.getElementById(o.count).innerHTML = o.countText(n, list);
      },
      /** ปุ่ม 📍 ในตาราง: เลื่อนจอขึ้นไปที่แผนที่ แล้วเปิดจุด */
      focus(id) {
        if (!hm) return;
        const card = document.getElementById(o.el).closest('.card');
        card.scrollIntoView({ behavior: 'smooth', block: isMobile() ? 'start' : 'center' });
        setTimeout(() => hm.focus(id), 350);
      },
      setActive: (id) => hm && hm.setActive(id),
      invalidate: () => hm && hm.invalidate(),
    };
    return api;
  }

  /** เน้นแถวในตารางเมื่อคลิกจุด */
  function highlightRow(tableId, attr, id) {
    const t = document.getElementById(tableId);
    t.querySelectorAll('tr.row-on').forEach((r) => r.classList.remove('row-on'));
    const b = t.querySelector(`[${attr}="${CSS.escape(id)}"]`);
    if (!b) return;
    const tr = b.closest('tr');
    tr.classList.add('row-on');
    const wrap = tr.closest('.tbl-wrap');
    if (wrap) wrap.scrollTop = tr.offsetTop - wrap.clientHeight / 2;
  }

  return { create, attach, highlightRow };
})();
