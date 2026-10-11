// 서비스레포트 출력 페이지 — 양식(GL2030 PDF)의 치수(mm)를 그대로 옮겼다.
//   표지(1p): 로고, 프레임, 제목, 헤더 표(9행), Summary of works(18줄), Remark
//   이어지는 Summary: 프레임 + 목록,   사진 페이지: 로고, 제목 띠(제목이 있을 때만), 사진 + 캡션
//   사진 페이지 배치는 한 장에 6장(세로 2×3) / 4장(가로 2×2) — print_logic.js 의 PHOTO_GEOMETRY
// 의존: dom.js(h), sr_fields.js(SR_ROWS), print_logic.js(PrintLogic), print_view.js(PrintView)
const SrPrint = (() => {
    const LINE_MM = 5.89;                          // 본문 줄 간격 (양식 16.7pt)
    const COL_MM = [38.5, 48.7, 38.9, 48.5];       // 헤더 표 열 폭 (라벨/값/라벨/값)
    const GOTHIC = "'Malgun Gothic', '맑은 고딕', sans-serif";

    const abs = (style, ...children) => h('div', { style: 'position:absolute;' + style }, ...children);

    const logo = layout => h('img', { src: layout.logo, style: 'position:absolute;left:10mm;top:8mm;width:103.9mm;height:19.3mm' });

    // top = 푸터 첫 줄 y (세로 페이지 277.3mm, 가로 페이지는 짧아서 더 위)
    function footer(layout, top = 277.3) {
        const f = `font-family:${GOTHIC};font-size:11.1pt;line-height:${LINE_MM}mm;`;
        return [
            abs(`left:10mm;top:${top}mm;${f}`, layout.company, h('br'), layout.address),
            abs(`left:0;right:0;top:${top + 5.7}mm;text-align:center;${f}`, h('span', { 'data-page-no': '' })),
            abs(`right:10mm;top:${top}mm;text-align:left;${f}`, `TEL ${layout.tel}`, h('br'), `Fax ${layout.fax}`),
        ];
    }

    // 테두리는 px 로 지정 — Chrome 은 mm 가는 선을 정수 px 로 내림해 얇아진다 (3px ≈ 0.8mm)
    const frame = () => abs('left:16.86mm;top:27.85mm;width:175.94mm;height:248.1mm;border:3px solid #000');

    const heading = (text, top) => abs(`left:27.8mm;top:${top}mm;font-size:16pt;font-weight:bold;line-height:6.2mm;white-space:nowrap`,
        h('span', { style: "font-family:'Batang','바탕',serif;font-weight:normal" }, '■ '), text);

    // 줄 목록 (앞 공백 유지: 하위 항목 들여쓰기). 넘치면 print_view 가 [data-fit] 로 경고한다.
    function withFit(lines, top, heightMm, fitName) {
        const box = abs(`left:31.7mm;top:${top}mm;width:156mm;height:${heightMm}mm;overflow:hidden`,
            ...lines.map(t => h('div', {
                style: `min-height:${LINE_MM}mm;line-height:${LINE_MM}mm;white-space:pre-wrap;overflow-wrap:anywhere`,
            }, t)));
        box.dataset.fit = fitName;
        return box;
    }

    function headerTable(header) {
        const cell = (extra, ...c) => h('td', {
            style: 'height:5.59mm;line-height:5.59mm;padding:0 1mm;border-top:.3mm solid #000;text-align:center;overflow:hidden;white-space:nowrap;' + extra,
        }, ...c);
        const rows = SR_ROWS.map((row, ri) => {
            const bottom = ri === SR_ROWS.length - 1 ? 'border-bottom:.3mm solid #000;' : '';   // 표 맨 아래 선
            return h('tr', {}, ...row.flatMap(([label, key], ci) => [
                cell((ci > 0 ? 'border-left:.3mm solid #000;' : '') + bottom, label),
                Object.assign(cell('border-left:.3mm solid #000;' + bottom, header[key] || ''), row.length === 1 ? { colSpan: 3 } : {}),
            ]));
        });
        return abs('left:17.53mm;top:45.67mm;width:174.6mm',
            h('table', { style: 'border-collapse:collapse;table-layout:fixed;width:174.6mm' },
                h('colgroup', {}, ...COL_MM.map(w => h('col', { style: `width:${w}mm` }))),
                h('tbody', {}, ...rows)));
    }

    function coverPage(doc, layout, summaryLines) {
        const hd = doc.header;
        return h('section', { class: 'pdm-page' },
            logo(layout), frame(),
            abs('left:0;right:0;top:30mm;text-align:center;font-size:36pt;font-weight:bold;line-height:14mm', layout.srTitle),
            headerTable(hd),
            heading('Summary of works', 109.5),
            withFit(summaryLines, 116.3, PrintLogic.SR_FIRST_PAGE_LINES * LINE_MM, 'Summary of works'),
            heading('Remark', 227.4),
            withFit((hd.remark || '').split('\n'), 235, 38, 'Remark'),
            ...footer(layout));
    }

    const continuationPage = (layout, lines) => h('section', { class: 'pdm-page' },
        logo(layout), frame(),
        heading('Summary of works (continued)', 30),
        withFit(lines, 38, PrintLogic.SR_NEXT_PAGE_LINES * LINE_MM, 'Summary of works'),
        ...footer(layout));

    // 직인: 사진 페이지 위에 겹쳐 찍는다 (출력 양식 설정에서 켜기/끄기, 위치/크기 조정).
    // 위치는 세로 A4 기준 값이므로 가로 페이지에서는 같은 자리(가운데 아래)에 오도록 페이지 크기 차이만큼 옮긴다.
    const seal = (layout, g) => {
        if (!layout.seal.enabled) return [];
        const x = layout.seal.x + (g.page.w - 210) / 2, y = layout.seal.y + (g.page.h - 297);
        return [h('img', { src: layout.seal.image, style: `position:absolute;left:${x}mm;top:${y}mm;width:${layout.seal.w}mm;height:auto` })];
    };

    function photoPage(doc, layout, imageOf, { page, slots }, perPage) {
        const g = PrintLogic.PHOTO_GEOMETRY[perPage];
        const title = ((doc.header.pageTitles || {})[page] || '').trim();
        const cells = slots.flatMap((photo, i) => {
            if (!photo) return [];
            const { x, y } = PrintLogic.slotPosition(perPage, i);
            return [
                abs(`left:${x}mm;top:${y}mm;width:${g.photo.w}mm;height:${g.photo.h}mm`,
                    h('img', { src: imageOf(photo.id) || '', style: `width:${g.photo.w}mm;height:${g.photo.h}mm;object-fit:${layout.photoFit}` })),
                abs(`left:${x}mm;top:${y + g.captionDy}mm;width:${g.photo.w}mm;height:${g.captionH}mm;border:.25mm solid #333;` +
                    `text-align:center;line-height:${g.captionH - 0.5}mm;overflow:hidden;white-space:nowrap`, photo.caption || ''),
            ];
        });
        // 제목을 입력하지 않았으면 제목 띠(색 박스)를 아예 그리지 않는다
        const band = title ? [abs(`left:${g.band.x}mm;top:${g.band.y}mm;width:${g.band.w}mm;height:${g.band.h}mm;background:#DAEEF3;border:3px solid #000;text-align:center;` +
            "line-height:9.1mm;overflow:hidden;white-space:nowrap;font-family:'Dotum','돋움','Malgun Gothic',sans-serif", title)] : [];
        return h('section', { class: 'pdm-page' + (g.landscape ? ' pdm-landscape' : '') }, logo(layout),
            ...band, ...cells, ...seal(layout, g), ...footer(layout, g.footerTop));
    }

    async function build({ doc, photos, imageOf, layout }) {
        const [first, ...rest] = PrintLogic.splitSummary(doc.header.summary || []);
        const perPage = doc.header.photosPerPage === 4 ? 4 : 6;
        return [
            coverPage(doc, layout, first),
            ...rest.map(lines => continuationPage(layout, lines)),
            ...PrintLogic.photoPages(photos, perPage).map(pg => photoPage(doc, layout, imageOf, pg, perPage)),
        ];
    }

    PrintView.register('service_report', build);
    return { build };
})();
