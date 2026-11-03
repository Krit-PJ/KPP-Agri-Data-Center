// ===== ตั้งค่าระบบ =====
window.APP_CONFIG = {
  // URL ของ Apps Script Web App (ลงท้าย /exec) — ได้จากขั้นตอน Deploy ใน docs/DEPLOY.md
  // เว้นว่าง = ใช้ไฟล์สำรองใน data/ (ระบบขอข้อมูล ตัวนับ และ Admin จะยังใช้ไม่ได้)
  API_URL: 'https://script.google.com/macros/s/AKfycbwsyOOx91roPMyrD2p3aNzlfgXz1m6lqHT7vGMMqqPUNEC96mxemSpPxLdULZRvgxdQvQ/exec',

  SITE_NAME: 'ศูนย์ข้อมูลการเกษตรจังหวัดกำแพงเพชร',
  SITE_NAME_EN: 'KPP Agri Data Center',
  LOGO_DOAE: 'assets/img/logo-doae.png',
  LOGO_PROVINCE: 'assets/img/seal-kpp.png',

  FALLBACK_DATA: 'data/agri_data.csv',
  FALLBACK_DISTRICTS: 'data/districts.csv',
  GEOJSON: 'data/kpp_districts.json',
  PROVINCE: 'จังหวัดกำแพงเพชร',
  CENTER: [16.35, 99.6],
  ZOOM: 9,
  // ลำดับพืช (พืชใหม่จากฐานข้อมูลจะต่อท้ายอัตโนมัติ)
  CROPS: ['ข้าวนาปี', 'ข้าวนาปรัง', 'ข้าวโพด รุ่น1', 'ข้าวโพด รุ่น2', 'มันสำปะหลัง', 'อ้อย', 'ปาล์มน้ำมัน', 'ยางพารา', 'กล้วยไข่'],
  // ลิงก์สำรอง (เมื่อยังไม่เชื่อม backend) — ลิงก์จริงจัดการโดย Super Admin
  DEFAULT_LINKS: [
    { title: 'Agri-Risk Map Burning', url: 'https://krit-pj.github.io/TH-Agri-Risk-Maps-Burning/', description: 'ระบบเฝ้าระวังความเสี่ยงการเผาในพื้นที่เกษตร', icon: '🔥' },
    { title: 'Green Gain Hub Kamphaeng Phet', url: 'https://krit-pj.github.io/Green_Gain_Hub-KPP/', description: 'ศูนย์กลางข้อมูลเกษตรสีเขียว จังหวัดกำแพงเพชร', icon: '🌿' }
  ],
  PURPOSE_TYPES: ['วิจัย/วิชาการ', 'วางแผนนโยบาย/งานราชการ', 'การศึกษา', 'ธุรกิจ/การลงทุน', 'สื่อมวลชน', 'อื่น ๆ'],
};
