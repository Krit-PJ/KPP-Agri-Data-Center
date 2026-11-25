#!/usr/bin/env python3
"""สร้างไฟล์ Template (.xlsx) สำหรับนำเข้าข้อมูลทุกชุด → assets/templates/

ใช้: python3 tests/build_templates.py   (ต้องมี node + openpyxl)
- หัวคอลัมน์ตรงกับตัวอ่านไฟล์ของระบบ (importer.js / soil-parser.js / pest-parser.js / farm-parser.js / ตารางข้อมูล)
- มีรายการให้เลือก (อำเภอ ชนิดพืช ปี ระดับชั้น ใช่/ไม่ใช่) และชีต "คำอธิบาย"
- ช่องข้อมูลส่วนบุคคลมี 🔒 (ไม่เผยแพร่บนเว็บสาธารณะ)
- ชุดตารางข้อมูลทั่วไป (ศพก.) สร้างจาก schema ใน apps-script/Datasets.gs โดยตรง
tests/template.test.js ตรวจว่าทุก Template กรอกแล้วนำเข้าได้จริง
"""
import csv, json, os, subprocess
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.comments import Comment

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'templates')
os.makedirs(OUT, exist_ok=True)

DISTRICTS = [r['district'] for r in csv.DictReader(open(os.path.join(ROOT, 'data', 'districts.csv'), encoding='utf-8'))]
CROPS = ['ข้าวนาปี', 'ข้าวนาปรัง', 'ข้าวโพด รุ่น1', 'ข้าวโพด รุ่น2', 'มันสำปะหลัง', 'อ้อย', 'ปาล์มน้ำมัน', 'ยางพารา', 'กล้วยไข่']
YEARS = list(range(2556, 2576))
YESNO = ['ใช่', 'ไม่ใช่']

schema_js = r"""
const {createGas,seedFromCsv}=require('./tests/gas-mock');const vm=require('vm');
const g=createGas({gsDir:'apps-script',seed:seedFromCsv('data/agri_data.csv','data/districts.csv')});
process.stdout.write(vm.runInContext('JSON.stringify(dsSchema_({role:"super"}))', g.ctx));
"""
env = dict(os.environ, NODE_PATH=os.environ.get('NODE_PATH', '/home/claude/vendor/node_modules'))
SCHEMA = {d['name']: d for d in json.loads(subprocess.check_output(['node', '-e', schema_js], cwd=ROOT, env=env))}

GREEN = PatternFill('solid', fgColor='1A7F37'); GREEN_L = PatternFill('solid', fgColor='E6F4EA')
AMBER = PatternFill('solid', fgColor='B7791F'); AMBER_L = PatternFill('solid', fgColor='FFF4DC')
GRAY_L = PatternFill('solid', fgColor='F1F3F5')
WHITE_B = Font(name='Tahoma', bold=True, color='FFFFFF', size=11)
BOLD = Font(name='Tahoma', bold=True, size=11); BASE = Font(name='Tahoma', size=11); MUTED = Font(name='Tahoma', size=10, color='6B7682', italic=True)
THIN = Side(style='thin', color='C9D2D0'); BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
CENTER = Alignment(horizontal='center', vertical='center', wrap_text=True)


def lists_sheet(wb):
    """ชีตซ่อน "รายการ" สำหรับ dropdown"""
    ws = wb.create_sheet('รายการ')
    cols = {'districts': DISTRICTS, 'crops': CROPS, 'years': YEARS, 'yesno': YESNO, 'abc': ['A', 'B', 'C'], 'abcd': ['A', 'B', 'C', 'D'],
            'check': ['✓'], 'soiltype': ['หลัก', 'เครือข่าย']}
    refs = {}
    for i, (k, vals) in enumerate(cols.items(), 1):
        L = get_column_letter(i)
        ws.cell(1, i, k)
        for j, v in enumerate(vals, 2):
            ws.cell(j, i, v)
        refs[k] = f"'รายการ'!${L}$2:${L}${len(vals) + 1}"
    ws.sheet_state = 'hidden'
    return refs


def add_list(ws, ref, rng, prompt=None):
    dv = DataValidation(type='list', formula1=ref, allow_blank=True, showErrorMessage=True,
                        errorTitle='ค่าไม่อยู่ในรายการ', error='กรุณาเลือกจากรายการ')
    if prompt:
        dv.promptTitle, dv.prompt, dv.showInputMessage = 'คำแนะนำ', prompt, True
    ws.add_data_validation(dv)
    dv.add(rng)


def add_number(ws, rng, whole=False, lo=0):
    dv = DataValidation(type='whole' if whole else 'decimal', operator='greaterThanOrEqual', formula1=str(lo), allow_blank=True,
                        showErrorMessage=True, errorTitle='ต้องเป็นตัวเลข', error=f'กรุณากรอกตัวเลขตั้งแต่ {lo} ขึ้นไป (ไม่ต้องใส่หน่วย)')
    ws.add_data_validation(dv)
    dv.add(rng)


def head_cell(ws, r, c, text, pii=False, width=None):
    cell = ws.cell(r, c, text)
    cell.font, cell.fill, cell.alignment, cell.border = WHITE_B, (AMBER if pii else GREEN), CENTER, BOX
    if width:
        ws.column_dimensions[get_column_letter(c)].width = width
    return cell


def body(ws, r0, r1, c0, c1, pii_cols=()):
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            cell = ws.cell(r, c)
            cell.border, cell.font = BOX, BASE
            if c in pii_cols:
                cell.fill = AMBER_L


def guide(wb, title, intro, rows):
    """ชีตคำอธิบาย: คอลัมน์ | ต้องกรอก | คำอธิบาย/ตัวอย่าง"""
    ws = wb.create_sheet('คำอธิบาย')
    ws['A1'] = title; ws['A1'].font = Font(name='Tahoma', bold=True, size=14, color='1A7F37')
    for i, t in enumerate(intro, 2):
        ws.cell(i, 1, t).font = BASE
    r = len(intro) + 3
    for c, h in enumerate(['คอลัมน์', 'ต้องกรอก', 'คำอธิบาย / ตัวอย่าง'], 1):
        head_cell(ws, r, c, h)
    for i, (col, req, desc) in enumerate(rows, r + 1):
        ws.cell(i, 1, col).font = BOLD
        ws.cell(i, 2, req).font = BASE
        ws.cell(i, 3, desc).font = BASE
        ws.cell(i, 3).alignment = Alignment(wrap_text=True, vertical='top')
        for c in range(1, 4):
            ws.cell(i, c).border = BOX
            if col.startswith('🔒'):
                ws.cell(i, c).fill = AMBER_L
    ws.column_dimensions['A'].width = 30; ws.column_dimensions['B'].width = 12; ws.column_dimensions['C'].width = 90
    return ws


COMMON_INTRO = ['• ห้ามแก้ไขชื่อหัวคอลัมน์ (ระบบใช้ชื่อหัวคอลัมน์ในการอ่านไฟล์) · เพิ่มแถวได้ไม่จำกัด',
                '• ช่องสีเหลืองที่มี 🔒 = ข้อมูลส่วนบุคคล (PDPA) ผู้ดูแลระบบเห็นเท่านั้น ไม่แสดงบนเว็บสาธารณะ',
                '• นำเข้า: หน้าผู้ดูแลระบบ → แท็บ "📤 นำเข้าข้อมูล" → เลือกชุดข้อมูล → เลือกไฟล์ → ตรวจตัวอย่าง → ยืนยัน (ระบบสำรองข้อมูลเดิมก่อนนำเข้าทุกครั้ง)']
COORD_NOTE = 'กรอกเป็นองศาทศนิยม (เช่น ละติจูด 16.4827 ลองจิจูด 99.5226) หรือ UTM โซน 47N (เช่น X 563165 Y 1821539) ระบบแปลงและตรวจว่าตกในอำเภอที่ระบุให้อัตโนมัติ'


def save(wb, name):
    wb.properties.creator = 'KPP Agri Data Center'
    wb.save(os.path.join(OUT, name))
    print('  ✓', name)


# ---------------------------------------------------------------- พืชเศรษฐกิจ
def crops():
    wb = Workbook(); ws = wb.active; ws.title = 'กรอกข้อมูล'
    refs = lists_sheet(wb)
    ws['A1'], ws['A2'] = 'ชนิดพืช', 'ปี พ.ศ.'
    for c in ('A1', 'A2'):
        ws[c].font, ws[c].fill, ws[c].border = WHITE_B, GREEN, BOX
    for c in ('B1', 'B2'):
        ws[c].fill, ws[c].border, ws[c].font = GREEN_L, BOX, BOLD
    add_list(ws, refs['crops'], 'B1', 'เลือกชนิดพืช')
    add_list(ws, refs['years'], 'B2', 'เลือกปีเพาะปลูก')
    ws['C1'] = '◀ เลือกจากรายการ'; ws['C2'] = '◀ เลือกจากรายการ'
    ws['A3'] = 'หนึ่งชีตต่อหนึ่งชนิดพืชและหนึ่งปี · คัดลอกชีตนี้เพื่อกรอกชุดอื่นในไฟล์เดียวกันได้'
    for c in ('C1', 'C2', 'A3'):
        ws[c].font = MUTED
    heads = ['อำเภอ', 'เนื้อที่เพาะปลูก (ไร่)', 'เนื้อที่เก็บเกี่ยว (ไร่)', 'ผลผลิต (ตัน)', 'หมายเหตุ']
    for c, h in enumerate(heads, 1):
        head_cell(ws, 5, c, h, width=[24, 22, 22, 18, 30][c - 1])
    for i, d in enumerate(DISTRICTS, 6):
        ws.cell(i, 1, d)
        for c in (2, 3, 4):
            ws.cell(i, c).number_format = '#,##0.00'
    last = 5 + len(DISTRICTS)
    body(ws, 6, last, 1, 5)
    for r in range(6, last + 1):
        ws.cell(r, 1).fill = GRAY_L
    add_number(ws, f'B6:D{last}')
    ws.freeze_panes = 'B6'
    guide(wb, 'Template สถิติพืชเศรษฐกิจรายอำเภอ', COMMON_INTRO + [
        '• เลือกชนิดพืชที่ช่อง B1 และปี พ.ศ. ที่ช่อง B2 แล้วกรอกตัวเลขของทั้ง 11 อำเภอ (อำเภอที่ไม่มีการปลูกเว้นว่างหรือใส่ 0)',
        '• ผลผลิตต่อไร่ ระบบคำนวณให้อัตโนมัติ (ผลผลิต ตัน × 1,000 ÷ เนื้อที่) · ข้อมูลปี/พืช/อำเภอที่มีอยู่แล้วจะถูกแก้ไขเป็นค่าใหม่',
        '• ชนิดพืชใหม่ที่ไม่อยู่ในรายการ ต้องให้ Super Admin เป็นผู้นำเข้า'], [
        ('ชนิดพืช (B1)', 'ต้องกรอก', 'เลือกจากรายการ: ' + ', '.join(CROPS)),
        ('ปี พ.ศ. (B2)', 'ต้องกรอก', 'ปีเพาะปลูก เช่น 2568'),
        ('อำเภอ', 'มีให้แล้ว', 'ชื่ออำเภอ 11 อำเภอ ห้ามแก้ไข'),
        ('เนื้อที่เพาะปลูก (ไร่)', 'ต้องกรอก', 'ตัวเลข ไม่ต้องใส่หน่วยหรือเครื่องหมายจุลภาค เช่น 125430.5'),
        ('เนื้อที่เก็บเกี่ยว (ไร่)', 'ต้องกรอก', 'ตัวเลข · ไม่ควรมากกว่าเนื้อที่เพาะปลูก (ระบบจะเตือน)'),
        ('ผลผลิต (ตัน)', 'ต้องกรอก', 'ตัวเลขหน่วยตัน (ถ้าข้อมูลเป็นกิโลกรัม ให้หาร 1,000 ก่อน)'),
        ('หมายเหตุ', '-', 'ไม่นำเข้าระบบ ใช้บันทึกของผู้กรอก')])
    save(wb, 'template_crops.xlsx')


# ---------------------------------------------------------------- ศดปช.
def soil():
    wb = Workbook(); ws = wb.active; ws.title = 'กรอกข้อมูล'
    refs = lists_sheet(wb)
    cols = [('ที่', 6, False, None), ('อำเภอ', 18, False, None), ('ชื่อ ศดปช.', 34, False, None), ('ที่ตั้ง (หมู่ ตำบล)', 26, False, None),
            ('พิกัด', 14, False, ('lat / UTM X', 'long / UTM Y')), ('ประเภท', 12, False, ('ศูนย์หลัก', 'ศูนย์เครือข่าย')),
            ('ระดับ (A–D)', 10, False, None), ('ปีที่เริ่มดำเนินการ', 14, False, None), ('จำนวนสมาชิก (ราย)', 14, False, None),
            ('เงินทุน (บาท)', 14, False, None), ('พืชหลัก', 20, False, None), ('🔒 ประธาน', 22, True, None), ('🔒 เบอร์โทรประธาน', 16, True, None),
            ('ผลิตปุ๋ยอินทรีย์', 18, False, None), ('สินค้าและบริการ', 26, False, None)]
    c = 1; pos = {}
    for name, w, pii, sub in cols:
        if sub:
            head_cell(ws, 1, c, name, pii); ws.merge_cells(start_row=1, start_column=c, end_row=1, end_column=c + 1)
            for k, s in enumerate(sub):
                head_cell(ws, 2, c + k, s, pii, w)
            pos[name] = c; c += 2
        else:
            head_cell(ws, 1, c, name, pii, w); head_cell(ws, 2, c, '', pii)
            ws.merge_cells(start_row=1, start_column=c, end_row=2, end_column=c)
            pos[name] = c; c += 1
    last_c = c - 1; last_r = 202
    pii_cols = [pos['🔒 ประธาน'], pos['🔒 เบอร์โทรประธาน']]
    body(ws, 3, last_r, 1, last_c, pii_cols)
    L = lambda k, off=0: get_column_letter(pos[k] + off)
    add_list(ws, refs['districts'], f"{L('อำเภอ')}3:{L('อำเภอ')}{last_r}")
    add_list(ws, refs['check'], f"{L('ประเภท')}3:{L('ประเภท', 1)}{last_r}", 'ใส่ ✓ ในช่องประเภทของศูนย์ (เลือกช่องเดียว)')
    add_list(ws, refs['abcd'], f"{L('ระดับ (A–D)')}3:{L('ระดับ (A–D)')}{last_r}")
    add_number(ws, f"{L('จำนวนสมาชิก (ราย)')}3:{L('จำนวนสมาชิก (ราย)')}{last_r}", whole=True)
    add_number(ws, f"{L('เงินทุน (บาท)')}3:{L('เงินทุน (บาท)')}{last_r}")
    add_number(ws, f"{L('ปีที่เริ่มดำเนินการ')}3:{L('ปีที่เริ่มดำเนินการ')}{last_r}", whole=True, lo=2500)
    ws.freeze_panes = 'D3'
    guide(wb, 'Template ทำเนียบศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.)', COMMON_INTRO + [
        '• การนำเข้าแทนที่ข้อมูล ศดปช. ทั้งชุด (ระบบคงชื่อ/เบอร์ประธานเดิมของศูนย์ที่ชื่อและอำเภอตรงกัน ถ้าไฟล์ใหม่เว้นว่าง)'], [
        ('ที่', '-', 'ลำดับ'), ('อำเภอ', 'ควรกรอก', 'เลือกจากรายการ (ถ้าเว้นว่าง ระบบหาอำเภอจากพิกัด)'),
        ('ชื่อ ศดปช.', 'ต้องกรอก', 'ต้องขึ้นต้นด้วย "ศดปช." หรือ "ศูนย์" เช่น ศดปช.ตำบลนครชุม'),
        ('ที่ตั้ง (หมู่ ตำบล)', '-', 'เช่น ม.3 ต.นครชุม'),
        ('พิกัด: lat / UTM X และ long / UTM Y', 'ควรกรอก', COORD_NOTE),
        ('ประเภท: ศูนย์หลัก / ศูนย์เครือข่าย', 'ต้องกรอก', 'ใส่ ✓ ในช่องใดช่องหนึ่ง'),
        ('ระดับ (A–D)', '-', 'เลือก A B C หรือ D'), ('ปีที่เริ่มดำเนินการ', '-', 'ปี พ.ศ. เช่น 2560'),
        ('จำนวนสมาชิก (ราย)', 'ควรกรอก', 'จำนวนเต็ม'), ('เงินทุน (บาท)', '-', 'ตัวเลข'),
        ('พืชหลัก', '-', 'เช่น ข้าว, อ้อย'), ('🔒 ประธาน', '-', 'ชื่อ-สกุลประธานศูนย์ (ข้อมูลส่วนบุคคล)'),
        ('🔒 เบอร์โทรประธาน', '-', 'ข้อมูลส่วนบุคคล'), ('ผลิตปุ๋ยอินทรีย์', '-', 'ชนิด/ปริมาณ หรือเว้นว่าง'),
        ('สินค้าและบริการ', '-', 'เช่น ปุ๋ยผสมใช้เอง, ตรวจวิเคราะห์ดิน')])
    save(wb, 'template_soil.xlsx')


# ---------------------------------------------------------------- ศจช. (รูปแบบเดียวกับทำเนียบจากระบบ ศจช.)
def pest(level_year=2569):
    wb = Workbook(); ws = wb.active; ws.title = 'กรอกข้อมูล'
    refs = lists_sheet(wb)
    h2 = ['#', 'ชื่อศูนย์จัดการศัตรูพืชชุมชน', 'ปีที่จัดตั้ง', 'ระดับชั้น', 'จำนวนสมาชิก', level_year, 'หมู่', 'ตำบล', 'อำเภอ', 'จังหวัด',
          'X', 'Y', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'พืชหลัก', 'พื้นที่', 'พื้นที่เสี่ยง', 'พื้นที่ผลิตสินค้า', 'พื้นที่ปกติ/', 'สถานะอื่นๆ', 'การผลิตชีวภัณฑ์']
    h3 = {17: 'แปลงใหญ่', 18: 'ต่อการระบาด', 19: 'คุณภาพ (GAP)', 20: 'ทั่วไป'}
    top = {6: ('ระดับชั้นตามปีงบประมาณ', 6, 6), 7: ('ที่ตั้งศูนย์', 7, 10), 11: ('พิกัดที่ตั้งศูนย์ (UTM 47N หรือ lat/long)', 11, 12),
           13: ('🔒 ประธานศูนย์ (ข้อมูลส่วนบุคคล)', 13, 15), 17: ('พื้นที่ตั้งของ ศจช.', 17, 20)}
    widths = [5, 40, 11, 9, 11, 11, 7, 16, 18, 13, 11, 11, 10, 14, 16, 18, 11, 13, 13, 11, 30, 30]
    pii = {13, 14, 15}
    for c, h in enumerate(h2, 1):
        head_cell(ws, 1, c, '', c in pii); head_cell(ws, 2, c, h, c in pii, widths[c - 1]); head_cell(ws, 3, c, h3.get(c, ''), c in pii)
    for c, (t, a, b) in top.items():
        ws.cell(1, a, t)
        if b > a:
            ws.merge_cells(start_row=1, start_column=a, end_row=1, end_column=b)
    last_r = 203
    body(ws, 4, last_r, 1, len(h2), pii)
    add_list(ws, refs['districts'], f'I4:I{last_r}')
    add_list(ws, refs['abc'], f'D4:D{last_r}'); add_list(ws, refs['abc'], f'F4:F{last_r}', f'ระดับชั้นของปีงบประมาณ {level_year}')
    add_list(ws, refs['yesno'], f'Q4:T{last_r}')
    add_number(ws, f'E4:E{last_r}', whole=True); add_number(ws, f'C4:C{last_r}', whole=True, lo=2500)
    ws.freeze_panes = 'C4'
    guide(wb, 'Template ทำเนียบศูนย์จัดการศัตรูพืชชุมชน (ศจช.)', COMMON_INTRO + [
        f'• รูปแบบเดียวกับไฟล์ส่งออกจากระบบ ศจช. นำไฟล์จากระบบมาใช้ได้โดยตรง · ช่อง F2 คือปีงบประมาณของระดับชั้น (ตอนนี้ {level_year}) แก้เป็นปีที่ต้องการได้',
        '• สถานะอื่นๆ / การผลิตชีวภัณฑ์ หลายรายการให้คั่นด้วย ; (เช่น วิสาหกิจชุมชน; ศูนย์ข้าวชุมชน) หรือกรอกแถวถัดไปโดยเว้นชื่อศูนย์ว่างไว้',
        '• การนำเข้าแทนที่ข้อมูล ศจช. ทั้งชุด (ศูนย์ที่ชื่อเต็มตรงกันใช้รหัสเดิม)'], [
        ('ชื่อศูนย์จัดการศัตรูพืชชุมชน', 'ต้องกรอก', 'เช่น ศูนย์จัดการศัตรูพืชชุมชนบ้านหนองโดนใต้ (ระบบย่อเป็น "ศจช. บ้านหนองโดนใต้")'),
        ('ปีที่จัดตั้ง', '-', 'ปี พ.ศ.'), ('ระดับชั้น / ระดับชั้นตามปีงบประมาณ', 'ควรกรอก', 'A B หรือ C (ระบบใช้ค่าในคอลัมน์ปีงบประมาณเป็นหลัก)'),
        ('จำนวนสมาชิก', 'ควรกรอก', 'จำนวนเต็ม'), ('หมู่ / ตำบล / อำเภอ', 'ต้องกรอกอำเภอ', 'อำเภอเลือกจากรายการ'),
        ('จังหวัด', '-', 'เว้นว่างหรือ กำแพงเพชร (แถวจังหวัดอื่นระบบข้าม)'),
        ('X / Y', 'ควรกรอก', COORD_NOTE),
        ('🔒 คำนำหน้า / ชื่อ / นามสกุล', '-', 'ประธานศูนย์ (ข้อมูลส่วนบุคคล)'), ('พืชหลัก', '-', 'เช่น ข้าวเจ้า'),
        ('พื้นที่แปลงใหญ่ / เสี่ยงต่อการระบาด / ผลิตสินค้าคุณภาพ (GAP) / ปกติทั่วไป', '-', 'เลือก ใช่ หรือ ไม่ใช่'),
        ('สถานะอื่นๆ', '-', 'เช่น ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.); วิสาหกิจชุมชน'), ('การผลิตชีวภัณฑ์', '-', 'เช่น เชื้อราไตรโคเดอร์มาพร้อมใช้')])
    save(wb, 'template_pest.xlsx')


# ---------------------------------------------------------------- กลุ่มแปลงใหญ่ (หัวคอลัมน์ตามไฟล์ส่งออกระบบแปลงใหญ่ + พิกัด)
def farm():
    wb = Workbook(); ws = wb.active; ws.title = 'กรอกข้อมูล'
    refs = lists_sheet(wb)
    cols = [('รหัส', 10, '', False), ('ประเภทแปลงใหญ่', 16, 'ปีที่เริ่ม เช่น แปลงใหญ่ปี 2567', False), ('กลุ่มสินค้า', 14, '', False),
            ('สินค้าหลัก', 18, '', False), ('สินค้ารอง', 14, '', False), ('ชื่อแปลงใหญ่', 46, '', False), ('หมู่ที่', 8, '', False),
            ('ตำบล', 16, '', False), ('อำเภอ', 18, '', False), ('จังหวัด', 12, '', False),
            ('ชื่อผู้จัดการ', 14, '🔒 ผู้จัดการแปลง', True), ('นามสกุลผู้จัดการ', 16, '', True), ('ตำแหน่ง', 18, '', True), ('โทรศัพท์', 14, '', True),
            ('ชื่อประธาน', 14, '🔒 ประธานกลุ่ม', True), ('นามสกุลประธาน', 16, '', True), ('โทรศัพท์', 14, '', True),
            ('เกษตรกร', 10, 'สมาชิก', False), ('พื้นที่(ไร่)', 12, '', False),
            ('เกษตรกร', 10, 'ในแปลงใหญ่', False), ('แปลง', 9, '', False), ('พื้นที่(ไร่)', 12, '', False),
            ('ต้นทุนก่อน', 11, 'บาท/ไร่', False), ('ต้นทุนหลัง', 11, '', False), ('ผลผลิตก่อน', 11, 'กก./ไร่', False), ('ผลผลิตหลัง', 11, '', False),
            ('GAP', 9, 'ได้รับมาตรฐาน', False), ('อินทรีย์', 9, '', False), ('รวมกลุ่ม', 18, '', False),
            ('รูปแบบตลาดก่อน', 18, '', False), ('รูปแบบตลาดหลัง', 18, '', False),
            ('ละติจูด หรือ UTM X', 14, 'พิกัดที่ตั้ง (ไม่บังคับ)', False), ('ลองจิจูด หรือ UTM Y', 14, '', False)]
    pii = set()
    for c, (h, w, note, p) in enumerate(cols, 1):
        cell = ws.cell(1, c, note); cell.font = Font(name='Tahoma', bold=True, size=10, color='8A5A00' if p else '1A7F37')
        head_cell(ws, 2, c, h, p, w)
        if p:
            pii.add(c)
    last_r = 301
    body(ws, 3, last_r, 1, len(cols), pii)
    col = {h: i for i, (h, *_rest) in reversed(list(enumerate(cols, 1)))}
    L = lambda h: get_column_letter(col[h])
    add_list(ws, refs['districts'], f"{L('อำเภอ')}3:{L('อำเภอ')}{last_r}")
    add_list(ws, refs['yesno'], f"{L('GAP')}3:{L('อินทรีย์')}{last_r}")
    add_number(ws, f"{get_column_letter(18)}3:{get_column_letter(26)}{last_r}")
    ws.freeze_panes = 'G3'
    guide(wb, 'Template กลุ่มแปลงใหญ่', COMMON_INTRO + [
        '• หัวคอลัมน์ตรงกับไฟล์ส่งออกจากระบบแปลงใหญ่ (กรมส่งเสริมการเกษตร) นำไฟล์จากระบบมาใช้ได้โดยตรง · ระบบใช้เฉพาะแถวของจังหวัดกำแพงเพชร',
        '• การนำเข้าแทนที่ข้อมูลทั้งชุด กลุ่มที่รหัสตรงกันคงพิกัดเดิมไว้ ถ้าไฟล์ใหม่เว้นพิกัดว่าง',
        '• แถว 1 เป็นคำอธิบายกลุ่มคอลัมน์ (ระบบไม่อ่าน) แถว 2 เป็นหัวคอลัมน์'], [
        ('รหัส', '-', 'รหัสแปลงใหญ่จากระบบ (เว้นว่างสำหรับกลุ่มใหม่)'), ('ประเภทแปลงใหญ่', '-', 'ข้อความที่มีปี พ.ศ. ที่เริ่ม เช่น แปลงใหญ่ปี 2567'),
        ('สินค้าหลัก', 'ต้องกรอก', 'เช่น ข้าว, มันสำปะหลัง'), ('ชื่อแปลงใหญ่', 'ต้องกรอก', 'ชื่อกลุ่มเต็ม'),
        ('หมู่ที่ / ตำบล / อำเภอ', 'ต้องกรอกอำเภอ', 'อำเภอเลือกจากรายการ'),
        ('🔒 ผู้จัดการ / ประธาน (ชื่อ นามสกุล ตำแหน่ง โทรศัพท์)', '-', 'ข้อมูลส่วนบุคคล ไม่แสดงบนเว็บสาธารณะ'),
        ('สมาชิก: เกษตรกร / พื้นที่(ไร่)', 'ควรกรอก', 'จำนวนสมาชิกทั้งหมด และพื้นที่ของสมาชิก'),
        ('ในแปลงใหญ่: เกษตรกร / แปลง / พื้นที่(ไร่)', 'ควรกรอก', 'จำนวนที่อยู่ในแปลงใหญ่'),
        ('ต้นทุน / ผลผลิต ก่อน–หลัง', '-', 'บาท/ไร่ และ กก./ไร่'), ('GAP / อินทรีย์', '-', 'เลือก ใช่ หรือ ไม่ใช่'),
        ('ละติจูด หรือ UTM X / ลองจิจูด หรือ UTM Y', '-', COORD_NOTE)])
    save(wb, 'template_farm.xlsx')


# ---------------------------------------------------------------- ชุดตารางข้อมูลทั่วไป (จาก schema)
SKIP = {'district_code', 'coord_note'}
def generic(name, filename, title, extra_intro, rows_hint=100):
    d = SCHEMA[name]
    wb = Workbook(); ws = wb.active; ws.title = 'กรอกข้อมูล'
    refs = lists_sheet(wb)
    fields = [f for f in d['fields'] if f['key'] not in SKIP]
    last_r = rows_hint + 1
    for c, f in enumerate(fields, 1):
        label = ('🔒 ' if f['pii'] else '') + f['label']
        w = 40 if f['type'] == 'long' else 30 if f['key'] in ('name', 'full_name') else 16
        cell = head_cell(ws, 1, c, label, f['pii'], w)
        if f['required']:
            cell.value = label + ' *'
        L = get_column_letter(c); rng = f'{L}2:{L}{last_r}'
        if f['key'] == 'district':
            add_list(ws, refs['districts'], rng)
        elif f['type'] == 'bool':
            add_list(ws, refs['yesno'], rng)
        elif f['options']:
            add_list(ws, refs['abc'] if f['options'] == ['A', 'B', 'C'] else refs['soiltype'], rng)
        elif f['type'] in ('int', 'num'):
            add_number(ws, rng, whole=f['type'] == 'int', lo=0)
    body(ws, 2, last_r, 1, len(fields), [i for i, f in enumerate(fields, 1) if f['pii']])
    ws.freeze_panes = 'B2'
    desc = {'id': 'เว้นว่างสำหรับรายการใหม่ (รายการเดิมใส่รหัสเดิม เพื่อคงประวัติและข้อมูลส่วนบุคคล)', 'lat': COORD_NOTE, 'lng': 'ดูละติจูด',
            'utm_x': 'ใช้แทนละติจูด/ลองจิจูดได้ (UTM โซน 47N)', 'utm_y': 'ดู UTM X', 'district': 'เลือกจากรายการ (ระบบเติมรหัสอำเภอให้)'}
    tname = {'text': 'ข้อความ', 'long': 'ข้อความยาว', 'int': 'จำนวนเต็ม', 'num': 'ตัวเลข', 'bool': 'ใช่ / ไม่ใช่', 'lat': 'ตัวเลขทศนิยม',
             'lng': 'ตัวเลขทศนิยม', 'code': 'รหัส', 'phone': 'เบอร์โทร', 'year': 'ปี พ.ศ.', 'select': 'เลือกจากรายการ'}
    guide(wb, title, COMMON_INTRO + extra_intro, [(('🔒 ' if f['pii'] else '') + f['label'], 'ต้องกรอก' if f['required'] else '-',
                                                  desc.get(f['key'], tname.get(f['type'], ''))) for f in fields])
    save(wb, filename)


if __name__ == '__main__':
    print('สร้าง Template →', os.path.relpath(OUT, ROOT))
    crops(); soil(); pest(); farm()
    generic('lc', 'template_lc.xlsx', 'Template ศพก. หลัก', ['• การนำเข้าแทนที่ข้อมูล ศพก. หลักทั้งชุด'], 30)
    generic('lcnet', 'template_lcnet.xlsx', 'Template ศพก. เครือข่าย รายอำเภอ', ['• หนึ่งแถวต่อหนึ่งอำเภอ · การนำเข้าแทนที่ข้อมูลทั้งชุด'], 20)
    generic('lctype', 'template_lctype.xlsx', 'Template ศพก. เครือข่าย รายประเภท', ['• หนึ่งแถวต่อหนึ่งประเภท · การนำเข้าแทนที่ข้อมูลทั้งชุด'], 40)
    # ค่าตัวอย่างของอำเภอในชุด ศพก. เครือข่าย: เติมชื่อ 11 อำเภอให้
    from openpyxl import load_workbook
    p = os.path.join(OUT, 'template_lcnet.xlsx'); wb = load_workbook(p); ws = wb['กรอกข้อมูล']
    dcol = [c.column for c in ws[1] if str(c.value).startswith('อำเภอ')][0]
    for i, d in enumerate(DISTRICTS, 2):
        ws.cell(i, dcol, d)
    wb.save(p)
