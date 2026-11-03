# การแปลงโมเดล Power BI (DAX) มาเป็น JavaScript

รายงาน Power BI ต้นฉบับมี 9 หน้า หน้าละ 1 ชนิดพืช ทุกหน้าใช้โครงเดียวกัน:

| ส่วนใน Power BI | ส่วนในเว็บนี้ |
|---|---|
| Card 4 ใบ (เนื้อที่เพาะปลูก / เนื้อที่เก็บเกี่ยว / ผลผลิต / ผลผลิตเฉลี่ย) | `#kpis` ใน `dashboard.js → kpis()` |
| Slicer ปีเพาะปลูก (ปุ่มตาราง 2558–2565) | `#dash-years` เลือกได้หลายปี |
| Line chart เนื้อที่เพาะปลูกแยกอำเภอ × ปี | `#ch-planted` |
| Clustered column ผลผลิตแยกอำเภอ × ปี | `#ch-production` |
| Donut เนื้อที่เพาะปลูกรายชนิดพืช | `#ch-share` |
| Table รายปี + ไอคอนลูกศร (conditional formatting) | `#year-table` |
| Card ชื่อหน้า "สถานการณ์การเพาะปลูก …" | `#title-card` |
| (ไม่มีใน Power BI) แผนที่ choropleth รายอำเภอ | หน้า Smart Map `map.js` |

## โมเดลข้อมูล (Star schema)

- **fact** = ชีต `data` (มาจากชีต "รายละเอียดรวม" + "1-8 อ้อย" + "1-9 กล้วยไข่")
  `year, crop, district_code, district, planted, harvested, production, yield_planted, yield_harvested`
- **dim อำเภอ** = ชีต `districts` (รหัส, ชื่อไทย/อังกฤษ, พิกัด, พื้นที่) เชื่อมกับ fact ด้วย `district_code`
- **dim ปี / dim พืช** = ค่าที่ไม่ซ้ำใน fact (ชีต "dimension" เดิม)

## Measures

```DAX
เนื้อที่เพาะปลูก   = SUM ( fact[planted] )
เนื้อที่เก็บเกี่ยว = SUM ( fact[harvested] )
ผลผลิต            = SUM ( fact[production] )
ผลผลิตเฉลี่ย      = DIVIDE ( [ผลผลิต], [เนื้อที่เก็บเกี่ยว] ) * 1000      -- ตัน/ไร่ → กก./ไร่

เปลี่ยนแปลงเนื้อที่ปลูก % =
VAR y    = SELECTEDVALUE ( fact[year] )
VAR prev = CALCULATE ( [เนื้อที่เพาะปลูก], fact[year] = y - 1 )
RETURN DIVIDE ( [เนื้อที่เพาะปลูก] - prev, prev )

สัดส่วนพืช % = DIVIDE ( [เนื้อที่เพาะปลูก], CALCULATE ( [เนื้อที่เพาะปลูก], ALL ( fact[crop] ) ) )
```

```js
// assets/js/data.js
M.planted    = rows => sum(rows, 'planted')
M.yield      = rows => sum(rows,'production') / sum(rows,'harvested') * 1000
filter(rows, { crop, years, year, district_code })   // ≈ CALCULATE filter context
yoy(rows, metric, base, year)                        // ≈ measure YoY ข้างบน
```

## ผลการตรวจเทียบ (ข้าวนาปี ปี 2564 + 2565)

| ตัวชี้วัด | Power BI | เว็บนี้ |
|---|---|---|
| เนื้อที่เพาะปลูก (ไร่) | 2,511,369 | 2,511,369 |
| เนื้อที่เก็บเกี่ยว (ไร่) | 2,498,828 | 2,498,828 |
| ผลผลิต (ตัน) | 1,519,480 | 1,519,480 |
| ผลผลิตเฉลี่ย (กก./ไร่) | 609 | 608 |
| ตาราง ปี 2565: เปลี่ยนแปลงเนื้อที่ปลูก / ผลผลิต | ▲1.62 / ▲5.14 | ▲1.62 / ▲5.14 |

ผลผลิตเฉลี่ยต่างกัน 1 กก./ไร่ เพราะ Power BI น่าจะเฉลี่ยค่าของแต่ละปีที่ปัดเศษแล้ว ((599+618)/2 = 608.5 → 609)
ส่วนเว็บนี้ถ่วงน้ำหนักด้วยเนื้อที่เก็บเกี่ยวรวม (1,519,480 ÷ 2,498,828 × 1000 = 608.1)
ค่ารายปีในตารางตรงกันทุกค่า
