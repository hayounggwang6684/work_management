// 부품사진첩 출력 — (표지) + 서비스레포트와 같은 사진 페이지.
//   표지는 header.withCover 일 때만: 제목, 선박/엔진 박스, INDEX(사진 페이지 제목 + 장 수), 작업 장소/일자, 회사 정보.
//   공사와 연계된 문서는 표지 없이 사진 페이지만 나온다.
//   배치(mm)는 원본 '사진첩 커버.xlsx' 의 행 높이를 옮긴 것이고, 위/아래 띠와 회사 정보는 계측지 표지와 같다 (MmPrint.coverFrame).
// 의존: dom.js(h), mm_print.js(MmPrint), sr_print.js(SrPrint.photoPage), print_logic.js(PrintLogic), print_view.js(PrintView)
const AlbumPrint = (() => {
    const GULIM = "'Gulim', '굴림', 'Malgun Gothic', sans-serif";

    function coverPage(doc, layout, indexLines) {
        const { abs, center, mmStyle, SERIF } = MmPrint;
        const hd = doc.header;
        const info = (top, label, value) => [
            abs(`left:46mm;top:${top}mm;font-size:12pt;font-weight:bold;font-family:${GULIM};white-space:nowrap`, label),
            abs(`left:72mm;top:${top - 1}mm;font-size:14pt;font-weight:bold;font-family:${GULIM};white-space:nowrap`, value || ''),
        ];
        return h('section', { class: 'pdm-page' },
            ...MmPrint.coverFrame(layout),
            center(47, 24, '엔진 작업 사진첩', `font-family:${GULIM};line-height:10mm`),
            abs(`${mmStyle(45.3, 89.4, 119.5, 34.7)}background:#DAEEF3`),
            center(91, 26, hd.vesselName, `font-family:${GULIM};line-height:11mm`),
            abs(`left:45.3mm;width:119.5mm;top:106.5mm;text-align:center;font-size:20pt;font-weight:bold;font-family:${GULIM};line-height:8.4mm;white-space:pre-line`, hd.model || ''),
            abs(`left:46mm;top:148mm;font-size:14pt;font-weight:bold;font-family:${SERIF}`, 'INDEX'),
            ...indexLines.map((line, i) => abs(`left:46mm;top:${164 + i * 7.94}mm;font-size:12pt;font-weight:bold;font-family:${SERIF};white-space:nowrap`, line)),
            ...info(212, '작업 장소 : ', hd.location), ...info(220, '작업 일자 : ', hd.workDate));
    }

    async function build({ doc, photos, imageOf, layout }) {
        const perPage = doc.header.photosPerPage === 4 ? 4 : 6;
        const pages = PrintLogic.photoPages(photos, perPage);
        const photoPages = pages.map(pg => SrPrint.photoPage(doc, layout, imageOf, pg, perPage));
        return doc.header.withCover
            ? [coverPage(doc, layout, PrintLogic.albumIndexLines(pages, doc.header.pageTitles)), ...photoPages]
            : photoPages;
    }

    PrintView.register('photo_album', build);
    return { build };
})();
