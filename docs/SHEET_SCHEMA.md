# โครงสร้าง Google Sheet

| ชีต | สร้างโดย | คอลัมน์ |
|---|---|---|
| `data` | เดิม (แหล่งข้อมูลหลัก) | year, crop, district_code, district, planted, harvested, production, yield_planted, yield_harvested |
| `districts` | เดิม | district_code, district, district_en, lat, lng, area_sqkm |
| `พืช_<ชื่อพืช>` ×9 | setupSystem / ทุกการนำเข้า | `=QUERY(data!A:I, … where B = '<พืช>')` อ่านอย่างเดียว |
| `admins` | setupSystem | Username, Name, Role, Status, Pass_Hash, Salt, Created_At, Created_By, Last_Login, Updated_At, Telephone |
| `admin_log` | setupSystem | Time, Username, Name, Role, Action, Detail |
| `import_log` | setupSystem | Import_ID, Time, Username, Name, File, Rows, Inserted, Updated, Unchanged, Backup_Sheet, Status, Note |
| `_bak_IMP…` | ทุกการนำเข้า (ซ่อน, เก็บ 10 ชุดล่าสุด) | สำเนาชีต data ก่อนนำเข้า |
| `download_requests` | setupSystem | Request_ID, Time, Name, Position, Agency, Email, Phone, Purpose_Type, Purpose_Detail, Crops, Year_From, Year_To, Status, Decided_By, Decided_At, Note, Token_Hash, Token_Expires, Download_Count, Last_Download |
| `visit_stats` | setupSystem | Date, Visits, Visitors, Updated_At |
| `soil_centers` | setupSystem (ข้อมูลตั้งต้น 31 ศูนย์) | Center_ID, Name, District_Code, District, Location, Lat, Lng, Type, Level, Members, Year_Start, Fund, Crops, Network, Organic, Products, OSS, OSS_Status, **Chair, Chair_Phone (ไม่ส่งออกสาธารณะ)**, Note, Verified, Updated_At, Updated_By |
| `_bak_SOIL…` | ทุกการนำเข้า ศดปช. (ซ่อน, เก็บ 5 ชุด) | สำเนาชีต soil_centers |
| `large_farms` | setupSystem v2.2 (ข้อมูลตั้งต้น 107 กลุ่ม) | id, name, year_start, group, commodity, commodity2, moo, tambon, district, district_code, members, member_area, plot_farmers, plots, plot_area, cost_before, cost_after, yield_before, yield_after, gap, organic, grouping, market_before, market_after, lat, lng, coord_note, **manager, manager_position, manager_phone, chair, chair_phone (ไม่ส่งออกสาธารณะ)**, Updated_At, Updated_By |
| `pest_centers` | setupSystem v2.4 (ศจช. 36 ศูนย์) | id, name, full_name, year_start, level, level_year, members, moo, tambon, district, district_code, lat, lng, utm_x, utm_y, coord_note, crop, area_farm, area_risk, area_gap, area_normal, other, bio, **chair, chair_phone (ไม่ส่งออกสาธารณะ)**, Updated_At, Updated_By |
| `lc_centers` | setupSystem v2.2 (ศพก. หลัก 11 แห่ง) | id, name, district, district_code, moo, tambon, commodity, lat, lng, utm_x, utm_y, target_area, target_farmers, highlight, network, coord_note, **farmer, farmer_phone, officer, officer_phone (ไม่ส่งออกสาธารณะ)**, Updated_At, Updated_By |
| `lc_network` | setupSystem v2.2 | district_code, district, count, Updated_At, Updated_By |
| `lc_types` | setupSystem v2.2 | type, count, Updated_At, Updated_By |
| `_bak_<ชีต>_…` | ทุกการนำเข้าผ่านตารางข้อมูล (ซ่อน, เก็บ 5 ชุด/ชีต) | สำเนาชีตก่อนนำเข้า |

ระบบอ่าน/เขียนตามชื่อหัวคอลัมน์ (ย้ายลำดับคอลัมน์หรือเพิ่มคอลัมน์ของตนเองได้ ระบบจะคงค่าคอลัมน์ที่ไม่รู้จักไว้)
ช่องที่เป็นข้อมูลส่วนบุคคลกำหนดใน `apps-script/Datasets.gs` (`pii: true`) — API สาธารณะส่งเฉพาะช่องที่อนุญาตเท่านั้น
| `admin_requests` | setupSystem | Request_ID, Time, Phone, Name, Position, Agency, Email, Reason, Pass_Hash, Salt (ลบเมื่อพิจารณาแล้ว), Status, Decided_By, Decided_At, Note |
| `links` | setupSystem (มี 2 ลิงก์เริ่มต้น) | Link_ID, Title, URL, Description, Icon, Order, Active, Updated_At, Updated_By |

คีย์ของข้อมูลคือ **ปี + พืช + รหัสอำเภอ** การนำเข้าซ้ำคีย์เดิมจะแก้ไขค่า ไม่สร้างแถวซ้ำ
แก้ข้อมูลในชีต `data` ด้วยมือได้ (หน้าเว็บอัปเดตภายใน 10 นาที หรือทันทีหลังการนำเข้าครั้งถัดไป)
