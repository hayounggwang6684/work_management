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

    const pageLabel = (n, total) => `${n} / ${total}`;

    return { SR_FIRST_PAGE_LINES, SR_NEXT_PAGE_LINES, PHOTOS_PER_PAGE, splitSummary, photoPages, pageLabel };
})();

if (typeof module !== 'undefined') module.exports = PrintLogic;
