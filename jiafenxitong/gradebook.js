/* 教学班成绩登分册：把网页里的分数填进学校《学生成绩登分册》模板。
 *
 * 模板结构（来自 教学班成绩登记表.xls，A4 横向打印）：
 *   A 学号  B 姓名  C 班级
 *   D..N 作业及课堂表现记录（11 个日期列）  O 成绩
 *   P 考勤（%）  Q 平时成绩合计  R 考试成绩（%）  S 总评成绩
 *   末尾：成绩总结（应考/缺考/四个分数段）
 * 日期列写满 11 个就另起一张同款表（同名加 -1、-2），学生不动。
 *
 * 口径（与「本学期总分」页一致）：
 *   每列 = 该次课的课堂项目完成率（小组项目净分 + 个人项目得分）÷（5 + 5×命名项目数）
 *   O 作业成绩 = 本学期项目完成率（含值日），P 考勤 = 考勤得分÷9，Q 平时成绩合计 = 平时分
 *   R 考试成绩 = 实际期末，S 总评 = 平时×40% + 期末×60%
 * 这个文件不碰任何数据，只读 state 算出来的行，生成预览 / 打印页 / Excel。
 */
(function (global) {
  'use strict';

  var DATE_COLS = 11;      // 模板 D..N
  var COLS = 19;           // A..S
  var PER_PAGE = 30;       // 打印时每页学生数（A4 横向，一行 4.8mm）
  var FONT = '宋体';
  /* 模板列宽，单位 1/256 字符（xlrd 从原文件读出） */
  var WIDTH = [5000, 3000, 5000].concat(new Array(DATE_COLS).fill(1500)).concat([2000, 3400, 2300, 2500, 2500]);
  var WIDTH_SUM = WIDTH.reduce(function (a, b) { return a + b; }, 0);

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function r1(n) { return Math.round((n + Number.EPSILON) * 10) / 10; }
  /** 分数显示：整数不带小数点，其余保留一位 */
  function num(n) {
    if (n == null || n === '' || !isFinite(n)) return '';
    var v = r1(n);
    return v % 1 === 0 ? String(v) : v.toFixed(1);
  }
  /** 2026-10-15 → 10-15（模板日期列只有 5 个字符宽） */
  function md(date) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(date || ''));
    if (!m) return '';
    return (m[2].length < 2 ? '0' + m[2] : m[2]) + '-' + (m[3].length < 2 ? '0' + m[3] : m[3]);
  }
  function assessment() { return global.JFDT_ASSESSMENT; }

  /* ---------- 单个数字的计算 ---------- */

  /** 该次课的项目完成率（%）；没有记分记录或没有分组的返回空 */
  function lessonPercent(lesson, m) {
    var A = assessment();
    if (!A || !m.gno) return '';
    var recorded = Object.keys(lesson.scores || {}).length || Object.keys(lesson.leaderScores || {}).length;
    if (!recorded) return '';
    var sc = (lesson.scores || {})[String(m.gno)] || {};
    var groupPart = Math.min(5, (Number(sc.group) || 0) + (sc.first ? 1 : 0));
    var phone = Number(sc.phone) || 0;
    var personalLoss = Number((sc.personal || {})[String(m.memberIndex)]) || 0;
    var net = Math.max(0, groupPart - phone - personalLoss);
    var values = ((lesson.leaderScores || {})[String(m.gno)] || {}).members || {};
    var mine = values[m.key];
    var earned = 0, max = 5;
    A.projectNames(lesson).forEach(function (name, i) {
      if (!String(name || '').trim()) return;
      max += 5;
      var v = mine && mine[i];
      if (v == null) return;
      earned += Math.max(0, Math.min(5, Number(v) || 0));
    });
    return num(Math.max(0, Math.min(100, (net + earned) / max * 100)));
  }

  /** 一名学生在一张表上的整行数据 */
  function studentRow(cls, m, dates) {
    return {
      sid: String(m.sid || m.no || ''),
      name: m.name,
      className: cls.name,
      cells: dates.map(function (l) { return lessonPercent(l, m); }),
      hw: m.task && m.task.maximum ? num(m.task.rate * 100) : '',
      att: m.attendanceMaximum ? num(m.attendanceRate * 100) : '',
      regular: m.totalMaximum ? num(m.regular) : '',
      exam: m.exam === '' || m.exam == null ? '' : num(m.exam),
      total: m.final == null ? '' : num(m.final)
    };
  }

  /** 学号升序；学号相同的按姓名 */
  function bySid(a, b) {
    var x = String(a.sid || ''), y = String(b.sid || '');
    if (x && y && x !== y) return x.localeCompare(y, undefined, { numeric: true });
    if (x && !y) return -1;
    if (!x && y) return 1;
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
  }

  function sheetName(base, index, count) {
    var name = base + (count > 1 ? '-' + (index + 1) : '');
    return name.replace(/[:\\\/\?\*\[\]]/g, ' ').slice(0, 31);
  }

  /* ---------- 组表：一个班 → 若干张同款表 ---------- */

  /**
   * input = { cls, lessons, students, meta:{semester, course, teacher} }
   * 返回 [{ name, title, info, dates:[{label,id}], rows:[studentRow], stats:{...} }]
   */
  function buildClass(input) {
    var cls = input.cls, meta = input.meta || {};
    var lessons = (input.lessons || []).slice().sort(function (a, b) {
      var da = String(a.date || ''), db = String(b.date || '');
      if (da !== db) return da < db ? -1 : 1;
      return (a.seq || 0) - (b.seq || 0);
    });
    var students = (input.students || []).slice().sort(bySid);
    var chunks = [];
    for (var i = 0; i < Math.max(1, Math.ceil(lessons.length / DATE_COLS)); i++) {
      chunks.push(lessons.slice(i * DATE_COLS, (i + 1) * DATE_COLS));
    }
    return chunks.map(function (dates, index) {
      var rows = students.map(function (m) { return studentRow(cls, m, dates); });
      return {
        name: sheetName(cls.name, index, chunks.length),
        sheetIndex: index,
        sheetCount: chunks.length,
        title: '广州华夏职业学院学生成绩登分册',
        info: '开课学期:' + (meta.semester || '') + ' 课程:' + (meta.course || '') +
          ' 教师:' + (meta.teacher || '') + ' 班级' + cls.name,
        dates: dates.map(function (l) { return { label: md(l.date) || ('第' + l.seq + '次'), id: l.id, date: l.date }; }),
        rows: rows,
        stats: stats(rows)
      };
    });
  }

  /** 成绩总结：应考 / 缺考 / 五个分数段（按总评成绩）
   *  考试没录全时只填应考人数，其余留空——免得把「还没考」写成「缺考」。 */
  function stats(rows) {
    var s = { total: rows.length, absent: 0, bands: [0, 0, 0, 0, 0], complete: rows.length > 0 };
    rows.forEach(function (r) {
      if (r.total === '') { s.absent++; s.complete = false; return; }
      var v = Number(r.total);
      if (v >= 90) s.bands[0]++;
      else if (v >= 80) s.bands[1]++;
      else if (v >= 70) s.bands[2]++;
      else if (v >= 60) s.bands[3]++;
      else s.bands[4]++;
    });
    return s;
  }

  /* ---------- 预览 / 打印的 HTML ---------- */

  function headerHtml(sheet) {
    var cols = sheet.dates.map(function (d) { return '<th>' + esc(d.label) + '</th>'; }).join('') +
      new Array(Math.max(0, DATE_COLS - sheet.dates.length)).fill('<th></th>').join('');
    return '<thead>' +
      '<tr>' +
      '<th rowspan="3" class="gb-c0">学号</th><th rowspan="3" class="gb-c1">姓名</th><th rowspan="3" class="gb-c2">班级</th>' +
      '<th colspan="' + (DATE_COLS + 3) + '">平时成绩（&nbsp;&nbsp;&nbsp;%）</th>' +
      '<th rowspan="3" class="gb-c17">考试成绩（&nbsp;&nbsp;%）</th><th rowspan="3" class="gb-c18">总评成绩</th>' +
      '</tr>' +
      '<tr>' +
      '<th colspan="' + (DATE_COLS + 1) + '">作业及课堂表现记录（根据需要自行增列）（&nbsp;&nbsp;%）</th>' +
      '<th rowspan="2" class="gb-c15">考勤（&nbsp;&nbsp;%）</th><th rowspan="2" class="gb-c16">平时成绩合计</th>' +
      '</tr>' +
      '<tr>' + cols + '<th class="gb-c14">成绩</th><th class="gb-c15b">成绩</th></tr>' +
      '</thead>';
  }

  function colgroup() {
    return '<colgroup><col class="gb-c0"><col class="gb-c1"><col class="gb-c2">' +
      new Array(DATE_COLS).fill('<col class="gb-cd">').join('') +
      '<col class="gb-c14"><col class="gb-c15"><col class="gb-c16"><col class="gb-c17"><col class="gb-c18"></colgroup>';
  }

  function tableHtml(sheet, students) {
    var body = students.map(function (r) {
      return '<tr>' +
        '<td class="gb-c0">' + esc(r.sid) + '</td>' +
        '<td class="gb-c1">' + esc(r.name) + '</td>' +
        '<td class="gb-c2">' + esc(r.className) + '</td>' +
        r.cells.map(function (v) { return '<td class="gb-cd">' + esc(v) + '</td>'; }).join('') +
        new Array(Math.max(0, DATE_COLS - r.cells.length)).fill('<td class="gb-cd"></td>').join('') +
        '<td class="gb-c14">' + esc(r.hw) + '</td>' +
        '<td class="gb-c15">' + esc(r.att) + '</td>' +
        '<td class="gb-c16">' + esc(r.regular) + '</td>' +
        '<td class="gb-c17">' + esc(r.exam) + '</td>' +
        '<td class="gb-c18">' + esc(r.total) + '</td>' +
        '</tr>';
    }).join('');
    var s = sheet.stats;
    var rest = s.complete ? null : '';
    var footer = '<tfoot>' +
      '<tr class="gb-sum-title"><td colspan="' + COLS + '">成绩总结</td></tr>' +
      '<tr class="gb-sum-head">' +
      '<td>应考人数</td><td>缺考人数</td><td>100-90分</td><td colspan="4">89-80分</td>' +
      '<td colspan="4">79-70分</td><td colspan="4">69-60分</td><td colspan="4">59分及其以下</td></tr>' +
      '<tr class="gb-sum-body">' +
      '<td>' + s.total + '</td><td>' + (rest === null ? s.absent : rest) + '</td>' +
      '<td>' + (rest === null ? s.bands[0] : rest) + '</td><td colspan="4">' + (rest === null ? s.bands[1] : rest) + '</td>' +
      '<td colspan="4">' + (rest === null ? s.bands[2] : rest) + '</td><td colspan="4">' + (rest === null ? s.bands[3] : rest) + '</td>' +
      '<td colspan="4">' + (rest === null ? s.bands[4] : rest) + '</td></tr>' +
      '</tfoot>';
    return '<table class="gb-table">' + colgroup() + headerHtml(sheet) + '<tbody>' + body + '</tbody>' + footer + '</table>';
  }

  function pageHtml(sheet, students) {
    return '<section class="gb-page">' +
      '<div class="gb-title">' + esc(sheet.title) + '</div>' +
      '<div class="gb-info">' + esc(sheet.info) + '</div>' +
      tableHtml(sheet, students) +
      '</section>';
  }

  /** 预览 / 打印共用的分页：每页 PER_PAGE 人，表头每页重复 */
  function paginate(sheet) {
    var pages = [];
    for (var i = 0; i < sheet.rows.length; i += PER_PAGE) pages.push(sheet.rows.slice(i, i + PER_PAGE));
    return pages.length ? pages : [[]];
  }

  function pagesHtml(sheets) {
    return sheets.map(function (sheet) {
      return paginate(sheet).map(function (part) { return pageHtml(sheet, part); }).join('');
    }).join('');
  }

  /* ---------- Excel ---------- */

  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="3">' +
    ['16', '10', '11'].map(function (size) {
      return '<font><sz val="' + size + '"/><name val="' + FONT + '"/><charset val="134"/></font>';
    }).join('') +
    '</fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right>' +
    '<top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  var PAGE_SETUP = '<printOptions horizontalCentered="1"/>' +
    '<pageMargins left="0.2" right="0.2" top="0.25" bottom="0.25" header="0.1" footer="0.1"/>' +
    '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>';

  function blank(n) { var a = []; for (var i = 0; i < n; i++) a.push(' '); return a; }

  /** 一张表的二维数组（行 0..2 表头，学生行，末尾成绩总结） */
  function aoa(sheet) {
    var out = [];
    var line;
    out.push([sheet.title].concat(blank(COLS - 1)));
    out.push([sheet.info].concat(blank(COLS - 1)));
    line = blank(COLS); line[0] = '学号'; line[1] = '姓名'; line[2] = '班级'; line[3] = '平时成绩（   %）'; out.push(line);
    line = blank(COLS); line[3] = '作业及课堂表现记录（根据需要自行增列）（  %）'; line[15] = '考勤（  %）'; line[16] = '平时成绩合计'; out.push(line);
    line = blank(COLS);
    sheet.dates.forEach(function (d, i) { line[3 + i] = d.label; });
    line[14] = '成绩'; line[15] = '成绩'; out.push(line);
    sheet.rows.forEach(function (r) {
      var row = blank(COLS);
      row[0] = r.sid; row[1] = r.name; row[2] = r.className;
      r.cells.forEach(function (v, i) { if (v !== '') row[3 + i] = Number(v); });
      if (r.hw !== '') row[14] = Number(r.hw);
      if (r.att !== '') row[15] = Number(r.att);
      if (r.regular !== '') row[16] = Number(r.regular);
      if (r.exam !== '') row[17] = Number(r.exam);
      if (r.total !== '') row[18] = Number(r.total);
      out.push(row);
    });
    var f = out.length;
    out.push(['成绩总结'].concat(blank(COLS - 1)));
    line = blank(COLS);
    line[0] = '应考人数'; line[1] = '缺考人数'; line[2] = '100-90分'; line[3] = '89-80分';
    line[7] = '79-70分'; line[11] = '69-60分'; line[15] = '59分及其以下';
    out.push(line);
    line = blank(COLS);
    line[0] = sheet.stats.total;
    if (sheet.stats.complete) {
      line[1] = sheet.stats.absent; line[2] = sheet.stats.bands[0];
      line[3] = sheet.stats.bands[1]; line[7] = sheet.stats.bands[2];
      line[11] = sheet.stats.bands[3]; line[15] = sheet.stats.bands[4];
    }
    out.push(line);
    return { rows: out, footerAt: f };
  }

  function mergesFor(count, f) {
    var m = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: COLS - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: COLS - 1 } },
      { s: { r: 2, c: 0 }, e: { r: 4, c: 0 } },
      { s: { r: 2, c: 1 }, e: { r: 4, c: 1 } },
      { s: { r: 2, c: 2 }, e: { r: 4, c: 2 } },
      { s: { r: 2, c: 3 }, e: { r: 2, c: 16 } },
      { s: { r: 3, c: 3 }, e: { r: 3, c: 14 } },
      { s: { r: 3, c: 16 }, e: { r: 4, c: 16 } },
      { s: { r: 2, c: 17 }, e: { r: 4, c: 17 } },
      { s: { r: 2, c: 18 }, e: { r: 4, c: 18 } },
      { s: { r: f, c: 0 }, e: { r: f, c: COLS - 1 } }
    ];
    [3, 7, 11, 15].forEach(function (c) {
      m.push({ s: { r: f + 1, c: c }, e: { r: f + 1, c: c + 3 } });
      m.push({ s: { r: f + 2, c: c }, e: { r: f + 2, c: c + 3 } });
    });
    return m;
  }

  /** 生成 xlsx（ArrayBuffer）：一张表一个 sheet，样式完全照模板 */
  function workbook(sheets) {
    var X = global.XLSX;
    if (!X) throw new Error('缺少 Excel 组件');
    var wb = X.utils.book_new(), meta = [];
    sheets.forEach(function (sheet) {
      var built = aoa(sheet), ws = X.utils.aoa_to_sheet(built.rows);
      ws['!merges'] = mergesFor(built.rows.length, built.footerAt);
      /* SheetJS 写列宽时会多算约 0.83 个字符的边距，这里减掉才和学校模板一致 */
      ws['!cols'] = WIDTH.map(function (w) { return { wch: Math.max(2, Math.round((w / 256 - 0.83) * 100) / 100) }; });
      ws['!rows'] = built.rows.map(function (_, i) { return { hpt: i < 2 ? 22 : 21 }; });
      X.utils.book_append_sheet(wb, ws, sheet.name);
      meta.push({ footerAt: built.footerAt });
    });
    var buf = X.write(wb, { bookType: 'xlsx', type: 'array' });
    var zip = X.CFB.read(new Uint8Array(buf), { type: 'array' });
    var enc = new TextEncoder(), dec = new TextDecoder();
    function entry(path) {
      var i = zip.FullPaths.findIndex(function (p) { return p.endsWith('/' + path); });
      if (i < 0) throw new Error('Excel 结构不完整：' + path);
      return zip.FileIndex[i];
    }
    function set(path, text) { var e = entry(path); e.content = enc.encode(text); e.size = e.content.length; }
    function get(path) { return dec.decode(entry(path).content); }

    set('xl/styles.xml', STYLES);
    meta.forEach(function (info, i) {
      var path = 'xl/worksheets/sheet' + (i + 1) + '.xml', xml = get(path);
      xml = xml.replace(/<c\b([^>]*?)(\/?)>/g, function (all, attrs, close) {
        var m = /r="[A-Z]+(\d+)"/.exec(attrs);
        if (!m) return all;
        var row = Number(m[1]);
        var style = row === 1 ? 0 : row === 2 ? 1 : row === info.footerAt + 1 ? 3 : 2;
        return '<c' + attrs.replace(/\ss="\d+"/, '') + ' s="' + style + '"' + close + '>';
      });
      xml = xml.replace(/<printOptions\b[^>]*\/>|<pageMargins\b[^>]*\/>|<pageSetup\b[^>]*\/>/g, '')
        .replace(/<\/sheetData>/, '</sheetData>' + PAGE_SETUP)
        .replace(/(<worksheet[^>]*>)/, '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
      set(path, xml);
    });
    return X.CFB.write(zip, { type: 'array', fileType: 'zip', compression: true });
  }

  /* ---------- 打印 ---------- */

  var PRINT_CSS = '@page{size:A4 landscape;margin:7mm}' +
    'html,body{margin:0;padding:0;background:#fff}' +
    'body{font:11pt/1.15 "宋体",SimSun,serif;color:#000}' +
    '.gb-page{width:283mm;height:196mm;box-sizing:border-box;overflow:hidden;break-after:page;page-break-after:always;' +
    'display:flex;flex-direction:column;align-items:center;padding:0}' +
    '.gb-page:last-child{break-after:auto;page-break-after:auto}' +
    '.gb-title{font-size:16pt;line-height:1.25;text-align:center;margin:0 0 1.5mm}' +
    '.gb-info{font-size:10pt;line-height:1.4;text-align:center;margin:0 0 1.5mm}' +
    'table.gb-table{width:100%;border-collapse:collapse;table-layout:fixed}' +
    'table.gb-table th,table.gb-table td{border:1px solid #000;text-align:center;vertical-align:middle;' +
    'padding:0;font-weight:normal;overflow:hidden;white-space:nowrap;font-size:7.6pt;line-height:1.15}' +
    'table.gb-table thead th{white-space:normal;font-size:7.2pt}' +
    'table.gb-table thead th.gb-c16{font-size:6.8pt}' +
    'table.gb-table tbody td{height:4.7mm}' +
    'table.gb-table tfoot td{height:6mm}' +
    'table.gb-table .gb-c0{width:11.85%}table.gb-table .gb-c1{width:7.11%}table.gb-table .gb-c2{width:11.85%}' +
    'table.gb-table .gb-cd{width:3.555%}table.gb-table .gb-c14{width:4.74%}table.gb-table .gb-c15{width:8.06%}' +
    'table.gb-table .gb-c16{width:5.45%}table.gb-table .gb-c17{width:5.92%}table.gb-table .gb-c18{width:5.92%}';

  function printDoc(sheets) {
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>成绩登分册</title>' +
      '<style>' + PRINT_CSS + '</style></head><body>' + pagesHtml(sheets) + '</body></html>';
  }

  function printSheets(sheets) {
    if (!sheets.length) return;
    var doc = printDoc(sheets);
    var old = document.getElementById('gbPrintFrame');
    if (old) old.remove();
    var frame = document.createElement('iframe');
    frame.id = 'gbPrintFrame';
    frame.title = '成绩登分册打印';
    frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;top:0;border:0';
    frame.onload = function () {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } finally { setTimeout(function () { frame.remove(); }, 60000); }
    };
    frame.srcdoc = doc;
    document.body.appendChild(frame);
  }

  /** 浏览器里下载 */
  function download(sheets, filename) {
    var buf = workbook(sheets);
    var url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  }

  function render(root, sheets) {
    root.innerHTML = sheets.length
      ? '<div class="gb-stage-inner">' + pagesHtml(sheets) + '</div>'
      : '<p class="note">这个班还没有课次，先在「上课记分」页新开一课。</p>';
    fit(root);
    return root;
  }

  /** 预览按容器宽度整体缩放（zoom 会同时缩高度，比分页 transform 稳） */
  function fit(root) {
    var inner = root.querySelector('.gb-stage-inner');
    if (!inner) return 1;
    var page = inner.querySelector('.gb-page');
    if (!page) return 1;
    inner.style.zoom = 1;
    var pageW = page.offsetWidth || 1070;
    var avail = (root.clientWidth || 0) - 2;
    var scale = avail > 200 ? Math.min(1, avail / pageW) : 1;
    inner.style.zoom = String(Math.max(0.45, Math.round(scale * 1000) / 1000));
    return scale;
  }

  global.JFDT_GRADEBOOK = {
    DATE_COLS: DATE_COLS, PER_PAGE: PER_PAGE, WIDTH: WIDTH, WIDTH_SUM: WIDTH_SUM,
    buildClass: buildClass, stats: stats, studentRow: studentRow, lessonPercent: lessonPercent,
    sheetName: sheetName, workbook: workbook, aoa: aoa, md: md, num: num,
    pagesHtml: pagesHtml, printDoc: printDoc, render: render, fit: fit, print: printSheets, download: download
  };
})(typeof window === 'undefined' ? globalThis : window);
