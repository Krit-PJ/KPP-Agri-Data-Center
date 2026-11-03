// ===== ชุดไอคอนพืช (SVG สร้างเอง ใช้ได้เหมือนกันทุกอุปกรณ์) =====
// ข้าว/ข้าวโพดใช้ตัวเดียวกัน แต่มีป้ายมุมขวาบนบอกฤดู/รุ่น: นาปี = หยดฝน, นาปรัง = ดวงอาทิตย์, ข้าวโพด = 1/2
window.CropIcons = (function () {
  const G = '#2f8f46', GD = '#1d6b33', Y = '#f2b705', YD = '#c98a00', B = '#8a5a2b', BD = '#6b4220';

  const rice = `
    <path d="M13 45 C15 32 19 20 31 8" fill="none" stroke="${G}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M14 40 C7 36 5 30 6 24 C10 29 13 33 14 40Z" fill="${G}"/>
    <path d="M15 33 C22 31 26 27 28 21 C22 24 18 27 15 33Z" fill="${GD}" opacity=".85"/>
    ${[[16.5, 30, -35], [18.6, 24.5, -38], [21.3, 19.4, -42], [24.6, 14.7, -48], [28.4, 10.6, -52]].map(([x, y, a]) =>
      `<ellipse cx="${x - 3.6}" cy="${y + 0.6}" rx="2.1" ry="3.6" transform="rotate(${a} ${x - 3.6} ${y + 0.6})" fill="${Y}" stroke="${YD}" stroke-width=".6"/>
       <ellipse cx="${x + 2.8}" cy="${y + 2.6}" rx="2.1" ry="3.6" transform="rotate(${a + 80} ${x + 2.8} ${y + 2.6})" fill="${Y}" stroke="${YD}" stroke-width=".6"/>`).join('')}
    <ellipse cx="32.2" cy="6.9" rx="2" ry="3.4" transform="rotate(40 32.2 6.9)" fill="${Y}" stroke="${YD}" stroke-width=".6"/>`;

  const corn = `
    <path d="M24 46 C13 40 9 28 12 15 C15 27 19 35 24 46Z" fill="${G}"/>
    <path d="M24 46 C35 40 39 28 36 15 C33 27 29 35 24 46Z" fill="${GD}"/>
    <ellipse cx="24" cy="21" rx="7.2" ry="14" fill="${Y}" stroke="${YD}" stroke-width="1"/>
    ${[11, 15, 19, 23, 27, 31].map((y) => `<path d="M17.3 ${y} Q24 ${y + 1.6} 30.7 ${y}" fill="none" stroke="${YD}" stroke-width=".7" opacity=".7"/>`).join('')}
    <path d="M24 7.2 V35" stroke="${YD}" stroke-width=".7" opacity=".6"/><path d="M20 8.6 Q19 21 20.6 34" fill="none" stroke="${YD}" stroke-width=".6" opacity=".5"/>
    <path d="M28 8.6 Q29 21 27.4 34" fill="none" stroke="${YD}" stroke-width=".6" opacity=".5"/>
    <path d="M24 46 C20 38 17 34 15 30 C19 33 22 37 24 46Z" fill="${GD}" opacity=".7"/>`;

  const badge = (inner, bg) => `<circle cx="38.5" cy="9.5" r="8" fill="${bg}" stroke="#fff" stroke-width="2"/>${inner}`;
  const rain = badge('<path d="M38.5 4.6 C41 8 42.2 10 42.2 11.5 a3.7 3.7 0 0 1 -7.4 0 C34.8 10 36 8 38.5 4.6Z" fill="#fff"/>', '#2a78d6');
  const sun = badge(`<circle cx="38.5" cy="9.5" r="2.9" fill="#fff"/>${[0, 45, 90, 135, 180, 225, 270, 315].map((a) =>
    `<line x1="38.5" y1="4.2" x2="38.5" y2="5.4" stroke="#fff" stroke-width="1.4" stroke-linecap="round" transform="rotate(${a} 38.5 9.5)"/>`).join('')}`, '#eb6834');
  const num = (n) => badge(`<text x="38.5" y="13.4" text-anchor="middle" font-size="11" font-weight="700" font-family="Prompt,Arial" fill="#fff">${n}</text>`, '#6250d6');

  const cassava = `
    ${[-62, -32, 0, 32, 62].map((a) => `<path d="M24 20 C21 14 21 8 24 3 C27 8 27 14 24 20Z" fill="${a % 2 ? GD : G}" transform="rotate(${a} 24 21)"/>`).join('')}
    <path d="M24 20 V25" stroke="${BD}" stroke-width="2"/>
    <path d="M22 24 C14 28 9 36 8 44 C14 41 20 34 23 26Z" fill="${B}" stroke="${BD}" stroke-width=".8"/>
    <path d="M26 24 C34 28 39 36 40 44 C34 41 28 34 25 26Z" fill="${B}" stroke="${BD}" stroke-width=".8"/>
    <path d="M22.5 25 C21 32 21.5 39 24 46 C26.5 39 27 32 25.5 25Z" fill="#a8703a" stroke="${BD}" stroke-width=".8"/>
    <path d="M13 33 l2 1 M33 33 l2 -1 M23 34 h2 M23.2 40 h1.8" stroke="${BD}" stroke-width=".8"/>`;

  const sugarcane = `
    ${[[12.5, 12], [21.5, 6], [30.5, 14]].map(([x, top]) => `
      <rect x="${x}" y="${top}" width="5.6" height="${46 - top}" rx="2.4" fill="#7cb342" stroke="#4f7d1f" stroke-width=".8"/>
      ${[0, 1, 2, 3, 4, 5].map((i) => top + 6 + i * 6.5).filter((y) => y < 45).map((y) => `<path d="M${x} ${y} h5.6" stroke="#4f7d1f" stroke-width="1.3"/>`).join('')}`).join('')}
    <path d="M24 7 C17 3 10 5 5 11 C12 8 18 8 24 9Z" fill="${G}"/>
    <path d="M24 7 C31 2 38 3 44 8 C37 7 30 8 24 9Z" fill="${GD}"/>
    <path d="M33 15 C38 12 42 13 45 17 C40 16 36 16 33 17Z" fill="${G}"/>`;

  const palm = `
    <path d="M21.5 22 L20 46 H28 L26.5 22Z" fill="${B}"/>
    ${[27, 32, 37, 42].map((y) => `<path d="M20.6 ${y} l3.4 -3 l3.4 3" fill="none" stroke="${BD}" stroke-width="1"/>`).join('')}
    ${[[-78, G], [-40, GD], [0, G], [40, GD], [78, G], [-115, GD], [115, GD]].map(([a, c]) =>
      `<path d="M24 20 C26 13 26 7 24 1 C22 7 22 13 24 20Z" fill="${c}" transform="rotate(${a} 24 20)"/>`).join('')}
    <g>${[[21, 22], [24, 23.5], [27, 22], [22.5, 25.5], [25.5, 25.5]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.1" fill="#e2582f" stroke="#a63a1a" stroke-width=".6"/>`).join('')}</g>`;

  const rubber = `
    <circle cx="20" cy="11" r="9" fill="${G}"/><circle cx="29" cy="9" r="7" fill="${GD}"/><circle cx="13" cy="15" r="5.5" fill="${GD}"/>
    <path d="M17 17 C18 26 16 36 14 46 H26 C24 36 23 26 24 17Z" fill="${B}"/>
    <path d="M15.6 30 L24.4 25.5 M15.2 34 L24.6 29.5" stroke="#f3e9d8" stroke-width="1.4"/>
    <path d="M24.4 29.5 C27 30 28 31 28.5 33" fill="none" stroke="#f3e9d8" stroke-width="1.2"/>
    <path d="M28.5 33.5 C30 36 30.6 37 30.6 38 a2 2 0 0 1 -4 0 C26.6 37 27.2 36 28.5 33.5Z" fill="#fff" stroke="#c9c2b4" stroke-width=".6"/>
    <path d="M25 40 H36 L34.5 45.5 H26.5Z" fill="#9aa5b1" stroke="#6b7682" stroke-width=".8"/>`;

  const banana = `<g transform="translate(5 2) scale(.92)">
    <path d="M30 4 C31 7 31 9 30 11" stroke="${GD}" stroke-width="3" stroke-linecap="round" fill="none"/>
    ${[[-6, '#e9ab00'], [16, '#f6c90e'], [38, '#f2b705'], [58, '#f6c90e']].map(([a, c]) => `
      <path d="M29 12 C21 14 15 22 15 33 C15 38 17 41 19 42 C19 32 23 22 31 16Z" fill="${c}" stroke="${YD}" stroke-width=".9" transform="rotate(${a} 30 12)"/>
      <circle cx="19" cy="42" r="1.2" fill="#5d4b1f" transform="rotate(${a} 30 12)"/>`).join('')}</g>`;

  const DEF = {
    'ข้าวนาปี': rice + rain,
    'ข้าวนาปรัง': rice + sun,
    'ข้าวโพด รุ่น1': corn + num(1),
    'ข้าวโพด รุ่น2': corn + num(2),
    'มันสำปะหลัง': cassava,
    'อ้อย': sugarcane,
    'ปาล์มน้ำมัน': palm,
    'ยางพารา': rubber,
    'กล้วยไข่': banana,
  };
  const generic = `<path d="M24 44 V20" stroke="${GD}" stroke-width="2.4"/><path d="M24 24 C14 22 10 14 12 6 C20 8 24 14 24 24Z" fill="${G}"/><path d="M24 30 C32 28 37 22 36 14 C29 15 24 21 24 30Z" fill="${GD}"/>`;

  function svg(crop, size) {
    const s = size || 32;
    return `<svg class="crop-ico" viewBox="0 0 48 48" width="${s}" height="${s}" aria-hidden="true">${DEF[crop] || generic}</svg>`;
  }
  return { svg, has: (c) => !!DEF[c] };
})();
