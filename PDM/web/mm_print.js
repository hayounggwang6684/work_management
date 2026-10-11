// 계측지 출력 페이지 — 양식(계측지.pdf)의 치수(mm)를 옮겼다. 표지(INDEX) + 선택한 양식마다 1페이지.
// 양식 정의(항목/표/규격)는 서버의 measurement_forms.json 이고, 여기서는 배치(좌표)만 가진다.
//   journalGrid: 크랭크핀/메인저널 계열 (규격표 + F/A×TB/PS 표 3개 + Remarks)
//   conrodGrid : 콘로드 빅엔드 (도면 + Torque/Original·STD·Limit + 실린더×D1~D4 격자)
// 의존: dom.js(h), mm_logic.js(MmLogic), mm_assets.js(PDM_MM_ASSETS), print_view.js(PrintView), eel
const MmPrint = (() => {
    const SERIF = "'Times New Roman', 'Batang', '바탕', serif";
    const GOTHIC = "'Dotum', '돋움', 'Malgun Gothic', sans-serif";
    const BORDER = '1px solid #000';      // Chrome 은 mm 가는 선을 px 로 내림하므로 px 로 지정

    // 양식별 배치 (mm). 크랭크핀 양식 기준값.
    const GEO = {
        journalGrid: {
            frame: [10.2, 35.9, 200.4, 269.4], titleTop: 22.4, gaugeY: 61.3, unitTextY: 63.6, remarksY: 252.5, footerY: 279.1,
            spec: { top: 68.3, x: [133.5, 150.8, 169.5, 192.8], rows: [10.2, 9.4, 9.4] },
            diagram: { x: 40, y: 66, w: 90 },
            tables: [{ top: 119.4, hdr: 9.3, row: 7.28 }, { top: 171.6, hdr: 9.3, row: 7.28 }, { top: 223.7, hdr: 8.3, row: 7.3 }],
            labelCols: [9.4, 19.7], x0: 17.2, dataX0: 46.3, dataX1: 188.3,
        },
        // 메인저널은 크랭크핀보다 헤더가 약 3mm 위, 행 간격이 6.8mm (원본 계측값)
        mainjournal: {
            frame: [8.8, 32.5, 201.5, 277.1], titleTop: 21.2, gaugeY: 56.6, unitTextY: 62.4, remarksY: 254.0, footerY: 279.1,
            spec: { top: 70.4, x: [133.5, 150.8, 169.5, 192.8], rows: [9.9, 9.4, 9.4] },
            diagram: { x: 25, y: 66, w: 105 },
            tables: [{ top: 116.3, hdr: 9.3, row: 6.8 }, { top: 172.2, hdr: 9.4, row: 6.8 }, { top: 221.7, hdr: 9.3, row: 6.8 }],
            labelCols: [11.0, 16.8], x0: 15.8, dataX0: 43.6, dataX1: 188.1,
        },
        conrodGrid: {
            frame: [11.4, 35.7, 199.0, 273.0], titleTop: 21.6, gaugeY: 60.4, unitTextY: 0, footerY: 280.4,
            diagram: { x: 15, y: 66, w: 170 },
            torqueY: 142.0, summary: { x: [129.8, 147.5, 173.9], top: 139.7, row: 6.8 },
            grid: { x0: 19.0, top: 165.3, labelW: 24.5, colW: 17.3, hdr: [7.1, 7.0], row: 7.28 },
        },
    };

    const abs = (style, ...children) => h('div', { style: 'position:absolute;' + style }, ...children);
    const mmStyle = (x, y, w, hgt) => `left:${x}mm;top:${y}mm;` + (w != null ? `width:${w}mm;` : '') + (hgt != null ? `height:${hgt}mm;` : '');
    const cellText = 'display:flex;align-items:center;justify-content:center;text-align:center;overflow:hidden;white-space:nowrap;';

    // 고정 크기 격자: cols/rows 는 mm 트랙, cells 는 {r,c,rs,cs,content,style}. 선은 셀 왼쪽/위 + 컨테이너 오른쪽/아래.
    function gridBox(x, y, cols, rows, cells) {
        const box = abs(`${mmStyle(x, y, cols.reduce((a, b) => a + b, 0), rows.reduce((a, b) => a + b, 0))}` +
            `display:grid;grid-template-columns:${cols.map(c => c + 'mm').join(' ')};grid-template-rows:${rows.map(r => r + 'mm').join(' ')};` +
            `border-right:${BORDER};border-bottom:${BORDER};font-size:9.9pt;font-family:${GOTHIC}`);
        for (const c of cells) {
            box.append(h('div', {
                style: `grid-row:${c.r + 1} / span ${c.rs || 1};grid-column:${c.c + 1} / span ${c.cs || 1};border-left:${BORDER};border-top:${BORDER};` +
                       `box-sizing:border-box;position:relative;${cellText}${c.style || ''}`,
            }, c.content ?? ''));
        }
        return box;
    }

    // 대각선 머리칸: 오른쪽 위 = 열 라벨, 왼쪽 아래 = Position
    function diagonalCell(topRight, bottomLeft) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%');
        svg.innerHTML = '<line x1="0" y1="0" x2="100%" y2="100%" stroke="#000" stroke-width="1"/>';
        const label = (txt, st) => h('div', { style: `position:absolute;white-space:pre;font-size:8.5pt;line-height:1.05;${st}` }, txt);
        return [svg, label(topRight, 'right:1.2mm;top:.6mm;text-align:right'), label(bottomLeft, 'left:1.2mm;bottom:.6mm')];
    }

    // ── 공통: 제목, 헤더 표, 계측기기, 푸터 ─────────────────────────────────
    function pageHeader(geo, form, header, inst) {
        const [x0, y0, x1, y1] = geo.frame;
        const W = x1 - x0, rowH = 8.05;
        const fr = v => +(v / 190.2 * W).toFixed(2);                    // 크랭크핀 기준 열 위치를 프레임 폭에 비례
        const cut = [46.3, 82.7, 115.5, 150.8, 169.5, 178.7, 192.4].map(v => v - 10.2);
        const seg = (a, b) => fr(b - a);
        const row = (top, cells) => gridBox(x0, top, cells.map(c => c.w), [rowH], cells.map((c, i) => ({ r: 0, c: i, content: c.t, style: c.style })));
        const lab = { style: `font-size:9.9pt;` };
        const phaseMark = which => (inst.phase === which ? '✓' : '');
        const marker = MmLogic.makerTypeFor(header, inst.label);       // 엔진 + 장 구분 라벨 (예: M/E FUSSO 91A PORT)
        const rows = [
            row(y0, [
                { w: seg(0, cut[0]), t: 'WORK NO' }, { w: seg(cut[0], cut[1]), t: header.workNo },
                { w: seg(cut[1], cut[2]), t: 'INSP. DATE' }, { w: seg(cut[2], cut[3]), t: header.inspDate },
                { w: seg(cut[3], cut[4]), t: 'BEFORE' }, { w: seg(cut[4], cut[5]), t: phaseMark('before') },
                { w: seg(cut[5], cut[6]), t: 'AFTER' }, { w: seg(cut[6], W), t: phaseMark('after') }]),
            row(y0 + rowH, [
                { w: seg(0, cut[0]), t: 'OWNER' }, { w: seg(cut[0], cut[1]), t: header.owner },
                { w: seg(cut[1], cut[2]), t: 'SHIP NAME' }, { w: seg(cut[2], cut[3]), t: header.shipName },
                { w: seg(cut[3], cut[5]), t: 'INSP. BY' }, { w: seg(cut[5], W), t: header.inspBy }]),
            row(y0 + rowH * 2, [
                { w: seg(0, cut[0]), t: 'MAKER/TYPE' }, { w: seg(cut[0], cut[3]), t: marker },
                { w: seg(cut[3], cut[5]), t: 'APPR. BY' }, { w: seg(cut[5], W), t: header.apprBy }]),
        ];
        return [
            abs(`left:0;right:0;top:${geo.titleTop}mm;text-align:center;font-size:14.8pt;text-decoration:underline;line-height:6mm;font-family:${GOTHIC}`, form.title),
            abs(`${mmStyle(x0, y0, W, y1 - y0)}border:1px solid #000;`),
            ...rows,
            abs(`left:14.9mm;top:${geo.gaugeY}mm;font-size:9.9pt;font-family:${GOTHIC};white-space:nowrap`, `계측기기 No. : ${inst.gaugeNo || ''}`),
        ];
    }

    const pageFooter = (geo, form) => [
        abs(`left:19.4mm;top:${geo.footerY}mm;font-size:10.8pt;font-family:${GOTHIC}`, form.code),
        abs(`right:19.4mm;top:${geo.footerY}mm;font-size:10.8pt;font-family:${GOTHIC}`, 'SUNJIN JONGHAP CO., LTD.'),
    ];

    const diagram = (geo, form) => h('img', {
        src: form.diagramImage || PDM_MM_ASSETS['diagram_' + form.diagram] || '',    // 사용자 정의 양식은 올린 도면, 내장 양식은 추출한 도면
        style: `position:absolute;left:${geo.diagram.x}mm;top:${geo.diagram.y}mm;width:${geo.diagram.w}mm`,
    });

    // ── journalGrid 페이지 ────────────────────────────────────────────────────
    function specTable(geo, form, inst) {
        const s = geo.spec, cols = s.x.slice(1).map((v, i) => v - s.x[i]);
        const cells = [
            { r: 0, c: 0, content: 'ITEM' }, { r: 0, c: 1, content: 'STANDARD' }, { r: 0, c: 2, content: 'LIMIT' },
            ...form.spec.flatMap((sp, i) => [
                { r: i + 1, c: 0, content: sp.label, style: 'font-size:5.9pt;white-space:pre;line-height:1.15' },
                { r: i + 1, c: 1, content: inst.spec[sp.id].standard, style: 'font-size:10.8pt' },
                { r: i + 1, c: 2, content: inst.spec[sp.id].limit, style: 'font-size:10.8pt' }]),
        ];
        return gridBox(s.x[0], s.top, cols, s.rows.slice(0, 1 + form.spec.length), cells);   // 규격 행이 1개인 양식도 지원
    }

    function dataTable(geo, form, table, t, inst) {
        const cols = [...(table.rows[0].length === 2 ? geo.labelCols : [geo.labelCols[0] + geo.labelCols[1]]),
                      ...Array(table.cols).fill((geo.dataX1 - geo.dataX0) / table.cols)];
        const lc = table.rows[0].length === 2 ? 2 : 1;
        const rows = [t.hdr, ...table.rows.map(() => t.row)];
        const data = inst.tables[table.id];
        const cells = [{ r: 0, c: 0, cs: lc, content: diagonalCell(table.colLabel, 'Position') },
                       ...Array.from({ length: table.cols }, (_, i) => ({ r: 0, c: lc + i, content: String(i + 1) }))];
        table.rows.forEach((labels, ri) => {
            if (lc === 2) {
                if (labels[1] === 'TB') cells.push({ r: ri + 1, c: 0, rs: 2, content: labels[0] });
                cells.push({ r: ri + 1, c: 1, content: labels[1] });
            } else cells.push({ r: ri + 1, c: 0, content: labels[0] });
            data[ri].forEach((v, ci) => cells.push({ r: ri + 1, c: lc + ci, content: v }));
        });
        const x = geo.x0;
        const unit = table.unit ? MmLogic.formatUnit(inst.unitBase[table.id], table.unit.op) : '';
        return [
            abs(`left:16.7mm;top:${t.top - 4.3}mm;font-size:9.9pt;font-family:${GOTHIC};white-space:nowrap`, '■ ' + table.title),
            ...(unit ? [abs(`right:${210 - geo.dataX1}mm;top:${t.top - 6}mm;font-size:9.8pt;font-family:${GOTHIC};white-space:pre`, unit)] : []),
            gridBox(x, t.top, cols, rows, cells),
        ];
    }

    function journalPage(form, inst, header) {
        const geo = GEO[form.id] || GEO.journalGrid;
        return h('section', { class: 'pdm-page', style: `font-family:${GOTHIC}` },
            ...pageHeader(geo, form, header, inst),
            abs(`right:15.6mm;top:${geo.unitTextY}mm;font-size:10.8pt;font-family:${GOTHIC}`, 'UNIT : mm'),
            diagram(geo, form), specTable(geo, form, inst),
            ...form.tables.flatMap((tb, i) => dataTable(geo, form, tb, geo.tables[i], inst)),
            abs(`left:16.7mm;top:${geo.remarksY}mm;width:170mm;font-size:9.9pt;font-family:${GOTHIC}`,
                h('div', {}, '■ Remarks :'),
                (() => { const r = h('div', { style: 'white-space:pre-wrap;line-height:4.6mm;max-height:13mm;overflow:hidden;padding-left:2mm' }, inst.remarks || ''); r.dataset.fit = `Remarks(${form.indexTitle})`; return r; })()),
            ...pageFooter(geo, form));
    }

    // ── conrodGrid 페이지 ─────────────────────────────────────────────────────
    function conrodPage(form, inst, header) {
        const geo = GEO.conrodGrid, g = geo.grid;
        const cols = [g.labelW, ...Array(8).fill(g.colW)];
        const rows = [...g.hdr, ...Array(form.rowCount).fill(g.row)];
        const cells = [{ r: 0, c: 0, rs: 2, content: diagonalCell('Position', 'Cyl. no') }];
        form.positions.forEach((pos, i) => cells.push({ r: 0, c: 1 + i * 2, cs: 2, content: pos }));
        form.positions.forEach((_, i) => form.subColumns.forEach((sc, j) => cells.push({ r: 1, c: 1 + i * 2 + j, content: sc })));
        inst.rowLabels.forEach((lbl, ri) => {
            cells.push({ r: 2 + ri, c: 0, content: lbl });
            inst.cells[ri].forEach((v, ci) => cells.push({ r: 2 + ri, c: 1 + ci, content: v }));
        });
        const sm = geo.summary, smCols = [sm.x[1] - sm.x[0], sm.x[2] - sm.x[1]];
        const smCells = [['Original', inst.original], ['STD', inst.std], ['Limit', inst.limit]]
            .flatMap(([label, v], i) => [{ r: i, c: 0, content: label }, { r: i, c: 1, content: v }]);
        return h('section', { class: 'pdm-page', style: `font-family:${GOTHIC}` },
            ...pageHeader(geo, form, header, inst),
            diagram(geo, form),
            abs(`left:19.9mm;top:${geo.torqueY}mm;font-size:9.9pt;font-family:${GOTHIC};white-space:pre`, `체결 Torque :  ${inst.torque || '        '}  kg-m`),
            gridBox(sm.x[0], sm.top, smCols, [sm.row, sm.row, sm.row], smCells),
            gridBox(g.x0, g.top, cols, rows, cells),
            ...pageFooter(geo, form));
    }

    // ── 표지 (INDEX) ──────────────────────────────────────────────────────────
    function coverPage(header, indexLines, layout) {
        const bar = y => abs(`${mmStyle(21.4, y, 167.2, 2.2)}background:#000`);
        const rule = (x0, x1, y) => abs(`left:${x0}mm;top:${y}mm;width:${x1 - x0}mm;border-top:.75pt solid #000`);
        const center = (top, size, txt, extra = '') => abs(`left:0;right:0;top:${top}mm;text-align:center;font-size:${size}pt;font-weight:bold;font-family:${SERIF};white-space:nowrap;${extra}`, txt);
        const img = (key, x, y, w, hgt) => h('img', { src: PDM_MM_ASSETS[key], style: `position:absolute;${mmStyle(x, y, w, hgt)}` });
        return h('section', { class: 'pdm-page' },
            bar(19.1), bar(281.5),
            center(45, 28, 'DETAIL REPORT OF', 'line-height:13mm'), center(59.5, 28, 'ENGINE MAINTENANCE', 'line-height:13mm'),
            rule(51.2, 159.7, 57.2), rule(51.2, 159.7, 58.3), rule(37.3, 165.5, 71.6), rule(37.3, 165.5, 72.6),
            abs(`${mmStyle(45.3, 91.4, 119.5, 28.8)}background:#DAEEF3`),
            center(93.5, 18, header.coverEngine, 'line-height:9mm'),
            center(106.5, 26, header.coverShip ? `" ${header.coverShip} "` : '', `font-family:'Batang','바탕',${SERIF};line-height:13mm`),
            abs(`left:46mm;top:146.5mm;font-size:14.1pt;font-weight:bold;font-family:${SERIF}`, 'INDEX'),
            ...indexLines.map((line, i) => abs(`left:46mm;top:${163 + i * 7.97}mm;font-size:12pt;font-weight:bold;font-family:${SERIF};white-space:nowrap`, line)),
            img('cover_logo', 20.5, 241.7, 24.4, 18.6),
            center(241.2, 18, 'SUNJIN  JONG HAP  CO.,  LTD.'),
            center(249.2, 14.1, layout.address.replace(/,\s*$/, '') + ','),
            abs(`left:64.6mm;top:256mm;font-size:14.1pt;font-weight:bold;font-family:${SERIF};white-space:nowrap`, 'Republic of Korea'),
            abs(`left:62mm;top:263mm;font-size:12pt;font-weight:bold;font-family:${SERIF};white-space:pre`, `Tel. ${layout.tel.replace(/\s/g, '-')}     Fax. ${layout.fax.replace(/\s/g, '-')}`),
            img('cover_cert', 161.9, 241.6, 26.6, 19.2));
    }

    async function build({ doc, layout }) {
        const tr = await eel.pdm_measurement_templates()();
        if (!tr.success) throw new Error(tr.message);
        const templates = tr.forms, byId = Object.fromEntries(templates.map(t => [t.id, t]));
        const header = doc.header;
        return [
            coverPage(header, MmLogic.indexLines(header.forms, templates), layout),
            ...header.forms.map(inst => (byId[inst.formId].layout === 'conrodGrid' ? conrodPage : journalPage)(byId[inst.formId], inst, header)),
        ];
    }

    // 양식 하나의 페이지 (양식 관리 미리보기용). 헤더는 견본 값.
    const SAMPLE_HEADER = { workNo: 'SH-2026-000-T', inspDate: '2026-01-01', owner: 'OWNER', shipName: 'SHIP NAME', inspBy: 'INSPECTOR', apprBy: 'APPROVER', makerType: 'M/E ENGINE' };
    const previewPage = (form, inst) => (form.layout === 'conrodGrid' ? conrodPage : journalPage)(form, inst, SAMPLE_HEADER);

    PrintView.register('measurement', build);
    return { build, previewPage, GEO };
})();
