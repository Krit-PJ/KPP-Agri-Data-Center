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
| `links` | setupSystem (มี 2 ลิงก์เริ่มต้น) | Link_ID, Title, URL, Description, Icon, Order, Active, Updated_At, Updated_By |

คีย์ของข้อมูลคือ **ปี + พืช + รหัสอำเภอ** การนำเข้าซ้ำคีย์เดิมจะแก้ไขค่า ไม่สร้างแถวซ้ำ
แก้ข้อมูลในชีต `data` ด้วยมือได้ (หน้าเว็บอัปเดตภายใน 10 นาที หรือทันทีหลังการนำเข้าครั้งถัดไป)
