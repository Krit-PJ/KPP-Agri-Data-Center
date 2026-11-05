// ===== จุดที่ตั้ง ศดปช. / กลุ่มแปลงใหญ่ / ศพก.: รูปทรง สี ไอคอน และป๊อปอัป (ใช้ร่วมกันทุกแผนที่) =====
window.Points = (function () {
  const D = window.AgriData;
  // สีประจำแต่ละชั้นข้อมูล (ใช้ทั้งจุดบนแผนที่และแถบเมนู)
  const COLOR = { soilMain: '#eb6834', soilNet: '#2a78d6', farm: '#6250d6', lc: '#0f766e', pest: '#b0306a' };
  // ศจช. ระดับชั้น A/B/C: สีเดียวกัน เข้ม → อ่อน (A = เข้มแข็งที่สุด)
  const PEST_LEVEL = { A: '#7d1f4b', B: '#b0306a', C: '#dd7aa6' };
  const SOIL_COLOR = { 'หลัก': COLOR.soilMain, 'เครือข่าย': COLOR.soilNet };
  const shape = {
    circle: (sz, fill, dashed) => `<svg width="${sz}" height="${sz}" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.6" fill="${fill}" stroke="#fff" stroke-width="2.2"${dashed ? ' stroke-dasharray="3 2"' : ''}/></svg>`,
    diamond: (sz, fill) => `<svg width="${sz}" height="${sz}" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.2 18.8 10 10 18.8 1.2 10Z" fill="${fill}" stroke="#fff" stroke-width="2"/></svg>`,
    triangle: (sz, fill) => `<svg width="${sz}" height="${sz}" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.6 18.9 17.6H1.1Z" fill="${fill}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>`,
    house: (sz, fill) => `<svg width="${sz}" height="${sz}" viewBox="0 0 22 22" aria-hidden="true"><path d="M11 1.5 21 10h-2.6v10.5H3.6V10H1Z" fill="${fill}" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><rect x="8.6" y="13" width="4.8" height="7.5" fill="#fff" opacity=".9"/></svg>`,
  };
  function icon(kind, o, active) {
    let sz, html;
    if (kind === 'soil') { sz = Math.round(Math.max(13, Math.min(26, Math.sqrt(o.members) * 2.4))); html = shape.circle(sz, SOIL_COLOR[o.type] || '#6b7682', !o.verified); }
    else if (kind === 'farm') { sz = 17; html = shape.diamond(sz, COLOR.farm); }
    else if (kind === 'pest') { sz = 20; html = shape.triangle(sz, PEST_LEVEL[o.level] || COLOR.pest); }
    else { sz = 25; html = shape.house(sz, COLOR.lc); }
    const box = Math.max(sz, 26); // พื้นที่แตะอย่างน้อย 26px
    return L.divIcon({ className: 'pt-ic pt-' + kind + (active ? ' pt-active' : ''), html: `<span class="pt-hit" style="width:${box}px;height:${box}px">${html}</span>`,
      iconSize: [box, box], iconAnchor: [box / 2, box / 2], popupAnchor: [0, -sz / 2] });
  }
  const row = (k, v) => (v || v === 0 ? `<dt>${k}</dt><dd>${D.esc(v)}</dd>` : '');
  function soil(c) {
    const cls = c.type === 'หลัก' ? 'main' : 'net';
    return `<div class="soil-pop"><div class="pop-kind">${shape.circle(12, SOIL_COLOR[c.type] || '#6b7682')} ศูนย์จัดการดินปุ๋ยชุมชน</div><h4>${D.esc(c.name)}</h4>${c.type ? `<span class="tag ${cls}">ศูนย์${D.esc(c.type)}</span>` : ''}
      <dl>${row('อำเภอ', c.district)}${row('ที่ตั้ง', c.location)}${row('สมาชิก', D.fmt(c.members) + ' ราย')}${row('เริ่มดำเนินการ', c.year_start)}
      ${row('ระดับ', c.level)}${row('พืชหลัก', c.crops)}${row('สินค้า/บริการ', c.products)}${row('โครงการ OSS', c.oss ? (c.oss + (c.oss_status ? ' · ' + c.oss_status : '')) : '')}</dl>
      ${!c.verified ? `<div class="warn">⚠️ พิกัดรอตรวจสอบ: ${D.esc(c.note)}</div>` : ''}</div>`;
  }
  function farm(f) {
    const std = [f.gap ? 'GAP' : '', f.organic ? 'อินทรีย์' : ''].filter(Boolean).join(', ');
    return `<div class="soil-pop"><div class="pop-kind">${shape.diamond(12, COLOR.farm)} กลุ่มแปลงใหญ่</div><h4>${D.esc(f.name)}</h4>
      <span class="tag farm">${D.esc(f.commodity)}</span>${f.year_start ? ` <span class="tag">เริ่มปี ${D.esc(f.year_start)}</span>` : ''}
      <dl>${row('อำเภอ', f.district)}${row('ตำบล / หมู่', [f.tambon, f.moo ? 'ม.' + f.moo : ''].filter(Boolean).join(' '))}
      ${row('สมาชิก', D.fmt(f.members) + ' ราย')}${row('พื้นที่แปลงใหญ่', D.fmt(f.plot_area, 2) + ' ไร่ · ' + D.fmt(f.plots) + ' แปลง')}
      ${row('รวมกลุ่มแบบ', f.grouping)}${row('มาตรฐาน', std)}${row('ตลาด', f.market_after)}</dl>
      ${f.coord_note && /ตกในอำเภอ/.test(f.coord_note) ? `<div class="warn">⚠️ ${D.esc(f.coord_note.split('; ').pop())}</div>` : ''}</div>`;
  }
  function lc(c) {
    const hl = String(c.highlight || '').split(';').map((x) => x.trim()).filter(Boolean);
    return `<div class="soil-pop"><div class="pop-kind">${shape.house(13, COLOR.lc)} ศูนย์เรียนรู้การเพิ่มประสิทธิภาพการผลิตสินค้าเกษตร</div><h4>${D.esc(c.name)}</h4>
      <span class="tag lc">${D.esc(c.commodity)}</span>
      <dl>${row('ที่ตั้ง', ['ม.' + c.moo, 'ต.' + c.tambon, 'อ.' + c.district].join(' '))}${row('ศพก. เครือข่าย', c.network ? D.fmt(c.network) + ' แห่ง' : '')}
      ${row('พื้นที่เป้าหมาย', c.target_area ? D.fmt(c.target_area) + ' ไร่' : '')}${row('เกษตรกรเป้าหมาย', c.target_farmers ? D.fmt(c.target_farmers) + ' ราย' : '')}</dl>
      ${hl.length ? `<div class="pop-hl"><b>จุดเด่นของศูนย์</b><ul>${hl.map((h) => `<li>${D.esc(h)}</li>`).join('')}</ul></div>` : ''}</div>`;
  }
  function pest(c) {
    const areas = [c.area_farm && 'แปลงใหญ่', c.area_risk && 'เสี่ยงต่อการระบาด', c.area_gap && 'ผลิตสินค้าคุณภาพ (GAP)', c.area_normal && 'ปกติ/ทั่วไป'].filter(Boolean).join(', ');
    const list = (v) => String(v || '').split(';').map((x) => x.trim()).filter(Boolean);
    const bio = list(c.bio), other = list(c.other);
    return `<div class="soil-pop"><div class="pop-kind">${shape.triangle(12, COLOR.pest)} ศูนย์จัดการศัตรูพืชชุมชน</div><h4>${D.esc(c.name)}</h4>
      ${c.level ? `<span class="tag pest lv-${D.esc(c.level)}">ระดับ ${D.esc(c.level)}${c.level_year ? ' (ปี ' + D.esc(c.level_year) + ')' : ''}</span>` : ''}
      <dl>${row('ที่ตั้ง', [c.moo ? 'ม.' + c.moo : '', c.tambon ? 'ต.' + c.tambon : '', 'อ.' + c.district].filter(Boolean).join(' '))}${row('สมาชิก', D.fmt(c.members) + ' ราย')}
      ${row('จัดตั้งปี', c.year_start)}${row('พืชหลัก', c.crop)}${row('พื้นที่', areas)}${row('สถานะอื่น', other.join(', '))}</dl>
      ${bio.length ? `<div class="pop-hl"><b>ผลิตชีวภัณฑ์</b><ul>${bio.map((h) => `<li>${D.esc(h)}</li>`).join('')}</ul></div>` : ''}
      ${c.coord_note && /ตกในอำเภอ|ไม่ถูกต้อง/.test(c.coord_note) ? `<div class="warn">⚠️ ${D.esc(c.coord_note.split('; ').pop())}</div>` : ''}</div>`;
  }
  return { COLOR, SOIL_COLOR, PEST_LEVEL, shape, icon, popup: { soil, farm, lc, pest } };
})();
