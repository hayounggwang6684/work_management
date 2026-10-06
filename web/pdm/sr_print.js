// 서비스레포트 출력 페이지 — 양식(GL2030 PDF)의 치수(mm)를 그대로 옮겼다.
//   표지(1p): 로고, 프레임, 제목, 헤더 표(9행), Summary of works(18줄), Remark
//   이어지는 Summary: 프레임 + 목록,   사진 페이지: 로고, 제목 띠, 2열×3행 사진 + 캡션
// 의존: dom.js(h), sr_fields.js(SR_ROWS), print_logic.js(PrintLogic), print_view.js(PrintView)
const SrPrint = (() => {
    const LINE_MM = 5.89;                          // 본문 줄 간격 (양식 16.7pt)
    const COL_MM = [38.5, 48.7, 38.9, 48.5];       // 헤더 표 열 폭 (라벨/값/라벨/값)
    const PHOTO = { w: 70.4, h: 53.2, colX: [24.8, 114.2], rowY: [40.8, 122.7, 204.6], captionDy: 63, captionH: 9.4 };
    const GOTHIC = "'Malgun Gothic', '맑은 고딕', sans-serif";

    const abs = (style, ...children) => h('div', { style: 'position:absolute;' + style }, ...children);

    const logo = layout => h('img', { src: layout.logo, style: 'position:absolute;left:10mm;top:8mm;width:103.9mm;height:19.3mm' });

    function footer(layout) {
        const f = `font-family:${GOTHIC};font-size:11.1pt;line-height:${LINE_MM}mm;`;
        return [
            abs(`left:10mm;top:277.3mm;${f}`, layout.company, h('br'), layout.address),
            abs(`left:0;right:0;top:283mm;text-align:center;${f}`, h('span', { 'data-page-no': '' })),
            abs(`right:10mm;top:277.3mm;text-align:left;${f}`, `TEL ${layout.tel}`, h('br'), `Fax ${layout.fax}`),
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

    // 직인: 사진 페이지 위에 겹쳐 찍는다 (출력 양식 설정에서 켜기/끄기, 위치/크기 조정)
    const seal = layout => (layout.seal.enabled
        ? [h('img', { src: layout.seal.image, style: `position:absolute;left:${layout.seal.x}mm;top:${layout.seal.y}mm;width:${layout.seal.w}mm;height:auto` })]
        : []);

    function photoPage(doc, layout, imageOf, { page, slots }) {
        const title = (doc.header.pageTitles || {})[page] || '';
        const cells = slots.flatMap((photo, i) => {
            if (!photo) return [];
            const x = PHOTO.colX[i % 2], y = PHOTO.rowY[Math.floor(i / 2)];
            return [
                abs(`left:${x}mm;top:${y}mm;width:${PHOTO.w}mm;height:${PHOTO.h}mm`,
                    h('img', { src: imageOf(photo.id) || '', style: `width:${PHOTO.w}mm;height:${PHOTO.h}mm;object-fit:${layout.photoFit}` })),
                abs(`left:${x}mm;top:${y + PHOTO.captionDy}mm;width:${PHOTO.w}mm;height:${PHOTO.captionH}mm;border:.25mm solid #333;` +
                    `text-align:center;line-height:${PHOTO.captionH - 0.5}mm;overflow:hidden;white-space:nowrap`, photo.caption || ''),
            ];
        });
        return h('section', { class: 'pdm-page' }, logo(layout),
            abs("left:24.9mm;top:26.6mm;width:159.9mm;height:9.6mm;background:#DAEEF3;border:3px solid #000;text-align:center;" +
                "line-height:9.1mm;overflow:hidden;white-space:nowrap;font-family:'Dotum','돋움','Malgun Gothic',sans-serif", title),
            ...cells, ...seal(layout), ...footer(layout));
    }

    async function build({ doc, photos, imageOf, layout }) {
        const [first, ...rest] = PrintLogic.splitSummary(doc.header.summary || []);
        return [
            coverPage(doc, layout, first),
            ...rest.map(lines => continuationPage(layout, lines)),
            ...PrintLogic.photoPages(photos).map(pg => photoPage(doc, layout, imageOf, pg)),
        ];
    }

    PrintView.register('service_report', build);
    return { build, PHOTO };
})();
