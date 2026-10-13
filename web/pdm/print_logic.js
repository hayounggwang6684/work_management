// 출력 페이지 구성의 순수 로직 (DOM 없음 — node 로 테스트: node --test PDM/tests/)
const PrintLogic = (() => {
    const SR_FIRST_PAGE_LINES = 18;   // 서비스레포트 1페이지 Summary 용량 (양식 기준 줄 간격 5.9mm)
    const SR_NEXT_PAGE_LINES = 38;    // 이어지는 페이지 용량
    const PHOTOS_PER_PAGE = 6;        // 2열 × 3행 (photo_grid.js 의 PER_PAGE 와 같아야 한다)

    // Summary 줄 → 페이지별 묶음. 항상 첫 페이지(빈 배열 가능)는 있다.
    function splitSummary(lines, first = SR_FIRST_PAGE_LINES, next = SR_NEXT_PAGE_LINES) {
        const chunks = [lines.slice(0, first)];
        for (let i = first; i < lines.length; i += next) chunks.push(lines.slice(i, i + next));
        return chunks;
    }

    // 사진 → 사진이 있는 페이지만 [{page, slots:[photo|undefined × perPage]}]. 빈칸은 비워 둔 채 위치 유지.
    function photoPages(photos, perPage = PHOTOS_PER_PAGE) {
        const pages = new Map();
        for (const p of photos) {
            const page = Math.floor(p.slotIndex / perPage);
            if (!pages.has(page)) pages.set(page, new Array(perPage).fill(undefined));
            pages.get(page)[p.slotIndex % perPage] = p;
        }
        return [...pages.keys()].sort((a, b) => a - b).map(page => ({ page, slots: pages.get(page) }));
    }

    // 부품사진첩 표지 INDEX 줄: "1. 쿨러 외 작업 사진 (2매)" — 사진이 있는 페이지마다 한 줄 (제목이 없으면 '작업 사진').
    // 표지에 들어가는 줄 수는 maxLines 까지이고, 넘치면 마지막 줄을 "… 외 N건" 으로 줄인다.
    function albumIndexLines(pages, pageTitles, maxLines = 6) {
        const lines = pages.map((pg, i) => `${i + 1}. ${String((pageTitles || {})[pg.page] || '').trim() || '작업 사진'} (${pg.slots.filter(Boolean).length}매)`);
        return lines.length > maxLines ? [...lines.slice(0, maxLines - 1), `… 외 ${lines.length - maxLines + 1}건`] : lines;
    }

    const pageLabel = (n, total) => `${n} / ${total}`;

    // 사진 페이지 배치 (mm). 키 = 한 장에 들어가는 사진 수.
    //   6장: 세로 A4, 2열×3행 (원본 양식 GL2030 치수)
    //   4장: 가로 A4, 2열×2행 — 사진칸은 편집기 자르기 비율(4:3)과 같다
    // photo = 사진칸 크기, cols/rows = 칸 왼쪽 위 좌표, captionDy = 사진 위쪽에서 캡션 박스까지 거리, footerTop = 푸터 시작 y
    const PHOTO_GEOMETRY = {
        6: {
            landscape: false, page: { w: 210, h: 297 }, photo: { w: 70.4, h: 53.2 },
            cols: [24.8, 114.2], rows: [40.8, 122.7, 204.6], captionDy: 63, captionH: 9.4,
            band: { x: 24.9, y: 26.6, w: 159.9, h: 9.6 }, footerTop: 277.3,
        },
        4: {
            landscape: true, page: { w: 297, h: 210 }, photo: { w: 80, h: 60 },
            cols: [53.5, 163.5], rows: [40, 114], captionDy: 62, captionH: 9.4,
            band: { x: 53.5, y: 26.6, w: 190, h: 9.6 }, footerTop: 190.3,
        },
    };

    // 칸 번호(페이지 안, 0부터) → 칸 왼쪽 위 좌표(mm). 왼→오, 위→아래.
    function slotPosition(perPage, index) {
        const g = PHOTO_GEOMETRY[perPage];
        return { x: g.cols[index % 2], y: g.rows[Math.floor(index / 2)] };
    }

    return { SR_FIRST_PAGE_LINES, SR_NEXT_PAGE_LINES, PHOTOS_PER_PAGE, PHOTO_GEOMETRY, splitSummary, photoPages, albumIndexLines, pageLabel, slotPosition };
})();

if (typeof module !== 'undefined') module.exports = PrintLogic;
