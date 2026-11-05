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

    // 서비스레포트 Summary / Remark 배치: Remark 는 항상 Summary 바로 뒤에 온다.
    //   Summary 가 첫 페이지 용량 이하면 → 첫 페이지의 정해진 자리(원본 양식)에 Remark.
    //   넘치면 → 첫 페이지에는 Remark 없이 Summary 만, 이어지는 페이지 마지막 Summary 줄 아래에 Remark (남은 줄이 모자라면 Remark 만 있는 새 페이지).
    // remarkLines: Remark 글의 줄 목록. 반환 {first: Summary 줄들, remarkOnFirst, rest: [{lines, remark: false|'after'|'top'}]}
    const REMARK_HEADING_LINES = 2;        // Remark 제목이 차지하는 줄 수 (앞 간격 포함)
    function planServiceReport(summaryLines, remarkLines, first = SR_FIRST_PAGE_LINES, next = SR_NEXT_PAGE_LINES) {
        if (summaryLines.length <= first) return { first: summaryLines, remarkOnFirst: true, rest: [] };
        const [head, ...tail] = splitSummary(summaryLines, first, next);
        const rest = tail.map(lines => ({ lines, remark: false }));
        const need = REMARK_HEADING_LINES + Math.max(1, remarkLines.length);
        const last = rest[rest.length - 1];
        if (next - last.lines.length >= need) last.remark = 'after';
        else rest.push({ lines: [], remark: 'top' });
        return { first: head, remarkOnFirst: false, rest };
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

    // 작업현황에는 엔진 제조사를 줄여 적는다 (CUM', CAT …). 서비스레포트/사진첩 출력에는 풀네임으로.
    // 약어 맵의 단일 원본은 서버의 templates/engine_names.json 이고, 화면은 pdm_get_layout 응답으로 받아 setEngineNames 로 넣는다.
    let engineNames = {};
    function setEngineNames(map) { engineNames = Object.fromEntries(Object.entries(map || {}).map(([k, v]) => [k.toUpperCase(), String(v)])); }
    function expandEngine(text) {
        const keys = Object.keys(engineNames);
        if (!keys.length) return String(text ?? '');
        const pattern = new RegExp('\\b(' + keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ")\\b['’.]?", 'gi');
        return String(text ?? '').replace(pattern, (_, abbr) => engineNames[abbr.toUpperCase()]);
    }

    // ── 소제목 구간(섹션) ──────────────────────────────────────────────────────
    // 제목이 입력된 페이지는 새 항목(구간)의 시작이고, 제목이 없는 페이지는 앞 구간의 이어지는 페이지다 (첫 페이지는 항상 구간 시작).
    // 한 구간에 사진을 더 넣거나 중간에 끼워도 뒤 구간의 사진이 밀려 들어가면 안 되므로, 화면은 구간의 끝 칸을 알아야 한다.
    const hasTitle = (pageTitles, page) => String((pageTitles || {})[page] || '').trim() !== '';

    // page 가 속한 구간 → {startPage, endPage}. endPage = 다음 구간의 첫 페이지 (마지막 구간이면 null = 끝까지)
    function sectionOf(pageTitles, page) {
        let startPage = page;
        while (startPage > 0 && !hasTitle(pageTitles, startPage)) startPage--;
        let endPage = page + 1;
        const lastTitled = Math.max(-1, ...Object.keys(pageTitles || {}).filter(k => /^\d+$/.test(k) && hasTitle(pageTitles, Number(k))).map(Number));
        while (endPage <= lastTitled && !hasTitle(pageTitles, endPage)) endPage++;
        return { startPage, endPage: endPage <= lastTitled ? endPage : null };
    }

    // 사진 한 장을 넣을 칸 계산 (화면 photo_grid.addFiles 가 쓴다 — DOM/서버 없이 테스트할 수 있게 순수 함수로 분리)
    //   occupied: 사진이 있는 칸 번호들, fromSlot: 빈 칸을 찾기 시작할 칸, sectionSlot: 사용자가 사진을 넣으려던 칸(어느 챕터인지 판단용)
    //   반환 {slot, extendAt}: extendAt 이 숫자면 그 칸(= 이 챕터의 끝) 앞에 빈 페이지를 먼저 끼워야 한다 (뒤 챕터가 한 페이지씩 밀림).
    //   마지막 챕터는 끝이 없어 extendAt 이 null 이다.
    function planPhotoAdd(occupied, fromSlot, sectionSlot, perPage, pageTitles) {
        const taken = occupied instanceof Set ? occupied : new Set(occupied);
        let slot = fromSlot;
        while (taken.has(slot)) slot++;
        const endPage = sectionOf(pageTitles, Math.floor(sectionSlot / perPage)).endPage;
        const end = endPage === null ? null : endPage * perPage;
        return end !== null && slot >= end ? { slot: end, extendAt: end } : { slot, extendAt: null };
    }

    // 사진이 있는 페이지 수(totalPages)까지를 챕터(소제목 구간)로 나눈다 → [{startPage, endPage(미포함)}]. 챕터 복사에서 복사할 범위를 고를 때 쓴다.
    function chaptersOf(pageTitles, totalPages) {
        const starts = [0, ...Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => i + 1).filter(p => hasTitle(pageTitles, p))];
        return totalPages > 0 ? starts.map((startPage, i) => ({ startPage, endPage: i + 1 < starts.length ? starts[i + 1] : totalPages })) : [];
    }

    // before 페이지 앞에 빈 페이지를 끼운 뒤의 제목 (before 이상 페이지의 제목이 한 페이지씩 뒤로). 새 객체.
    function shiftTitles(pageTitles, before) {
        return Object.fromEntries(Object.entries(pageTitles || {}).filter(([k]) => /^\d+$/.test(k)).map(([k, v]) => [String(Number(k) >= before ? Number(k) + 1 : Number(k)), v]));
    }

    // 부품사진첩 표지 INDEX 줄: 구간(소제목)마다 한 줄 "1. 쿨러 외 작업 사진 (8매)" — 이어지는 페이지의 사진은 앞 구간에 합산, 첫 구간에 제목이 없으면 '작업 사진'.
    // 표지에 들어가는 줄 수는 maxLines 까지이고, 넘치면 마지막 줄을 "… 외 N건" 으로 줄인다.
    function albumIndexLines(pages, pageTitles, maxLines = 6) {
        const sections = [];
        for (const pg of pages) {
            const count = pg.slots.filter(Boolean).length;
            if (hasTitle(pageTitles, pg.page) || !sections.length) sections.push({ title: String((pageTitles || {})[pg.page] || '').trim() || '작업 사진', count });
            else sections[sections.length - 1].count += count;
        }
        const lines = sections.map((s, i) => `${i + 1}. ${s.title} (${s.count}매)`);
        return lines.length > maxLines ? [...lines.slice(0, maxLines - 1), `… 외 ${lines.length - maxLines + 1}건`] : lines;
    }

    // 표지 INDEX: 직접 쓴 줄(header.indexLines)이 있으면 그대로, 없으면 챕터 제목으로 자동 생성
    function albumIndexFor(header, pages, maxLines = 6) {
        const typed = (header.indexLines || []).map(l => String(l).trim()).filter(Boolean);
        return typed.length ? typed.slice(0, maxLines) : albumIndexLines(pages, header.pageTitles, maxLines);
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

    return { SR_FIRST_PAGE_LINES, SR_NEXT_PAGE_LINES, PHOTOS_PER_PAGE, PHOTO_GEOMETRY, splitSummary, planServiceReport, REMARK_HEADING_LINES, photoPages, planPhotoAdd, setEngineNames, expandEngine, sectionOf, chaptersOf, shiftTitles, albumIndexLines, albumIndexFor, pageLabel, slotPosition };
})();

if (typeof module !== 'undefined') module.exports = PrintLogic;
