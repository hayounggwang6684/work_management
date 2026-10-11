// 출력 미리보기/인쇄 셸 — 문서 종류별 렌더러(register)가 만든 A4 페이지를 쌓아 보여 주고, 인쇄(PDF 저장 포함)한다.
// 인쇄는 브라우저 인쇄 창을 쓰므로 "PDF로 저장"과 시스템 프린터 선택이 모두 된다. 파일 이름은 문서 이름.
// 렌더러: async ({doc, photos, imageOf(id), layout}) => [페이지 element…]
//   페이지 안의 [data-page-no] 요소에는 "n / N" 이 채워지고, [data-fit="이름"] 요소가 넘치면 경고가 표시된다.
// 의존: dom.js(h), print_logic.js(PrintLogic), print_layout.js(PDM_LAYOUT, PdmLayout), eel
const PrintView = (() => {
    const PHOTO_EDGE = 1100;      // 인쇄용 사진 긴 변 (69mm 폭에 약 400dpi)
    const FETCH_CONCURRENCY = 4;
    const renderers = {};

    const CSS = `
    @page { size: A4; margin: 0; }
    @page landscape { size: A4 landscape; margin: 0; }
    #pdmPrint { position: fixed; inset: 0; z-index: 80; background: #64748b; overflow: auto; }
    #pdmPrint .pp-bar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 12px;
        padding: 8px 16px; background: #1e293b; color: #fff; font: 14px 'Malgun Gothic', sans-serif; }
    #pdmPrint .pp-bar button { padding: 4px 14px; border-radius: 4px; background: #475569; color: #fff; }
    #pdmPrint .pp-bar button.primary { background: #2563eb; }
    #pdmPrint .pp-bar button:disabled { opacity: .5; cursor: default; }
    #pdmPrint .pp-warn { color: #fbbf24; font-size: 13px; }
    #pdmPrint .pp-pages { padding: 16px 0; }
    .pdm-page { position: relative; width: 210mm; height: 297mm; margin: 0 auto 12px; background: #fff; overflow: hidden;
        box-shadow: 0 2px 10px rgba(0,0,0,.4); box-sizing: border-box; color: #000;
        font-family: 'Times New Roman', 'Batang', '바탕', serif; font-size: 11.1pt; }
    .pdm-page.pdm-landscape { width: 297mm; height: 210mm; page: landscape; }      /* 가로 용지로 인쇄되는 페이지 */
    .pdm-page * { box-sizing: border-box; }
    .pdm-page img { display: block; max-width: none; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @media print {
        body > *:not(#pdmPrint) { display: none !important; }
        html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
        #pdmPrint { position: static; overflow: visible; background: none; }
        #pdmPrint .pp-bar { display: none; }
        #pdmPrint .pp-pages { padding: 0; }
        .pdm-page { margin: 0; box-shadow: none; break-after: page; page-break-after: always; }
        .pdm-page:last-child { break-after: auto; page-break-after: auto; }
    }`;

    function injectStyle() {
        if (document.getElementById('pdmPrintStyle')) return;
        document.head.append(h('style', { id: 'pdmPrintStyle' }, CSS));
    }

    const register = (docType, renderer) => { renderers[docType] = renderer; };

    // id → 인쇄용 data URI. 동시 FETCH_CONCURRENCY 개씩 가져오며 진행 상황을 알린다.
    async function fetchImages(photos, onProgress) {
        const images = new Map();
        let next = 0, done = 0;
        const worker = async () => {
            while (next < photos.length) {
                const p = photos[next++];
                const r = await eel.pdm_get_photo(p.id, PHOTO_EDGE)();
                if (r.success) images.set(p.id, r.image);
                onProgress(++done, photos.length);
            }
        };
        await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, photos.length) }, worker));
        return images;
    }

    function numberPages(pages) {
        pages.forEach((page, i) => {
            page.querySelectorAll('[data-page-no]').forEach(el => { el.textContent = PrintLogic.pageLabel(i + 1, pages.length); });
        });
    }

    const overflowing = pagesEl => [...pagesEl.querySelectorAll('[data-fit]')]
        .filter(el => el.scrollHeight > el.clientHeight + 1).map(el => el.dataset.fit);

    function printNow(title) {
        const prev = document.title;
        document.title = title;       // 브라우저 "PDF로 저장" 기본 파일 이름
        window.addEventListener('afterprint', () => { document.title = prev; }, { once: true });
        window.print();
    }

    // 미리보기 셸: build(setStatus) → 페이지 element 배열. 문서 출력과 양식 미리보기가 함께 쓴다.
    async function present(printTitle, build) {
        injectStyle();
        document.getElementById('pdmPrint')?.remove();
        const status = h('span', {}, '준비 중…');
        const printBtn = h('button', { class: 'primary', disabled: true, onclick: () => printNow(printTitle || 'PDM') }, '인쇄 / PDF 저장');
        const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
        const onKey = e => { if (e.key === 'Escape' && !document.getElementById('pdmChoice')) close(); };
        const pagesEl = h('div', { class: 'pp-pages' });
        const overlay = h('div', { id: 'pdmPrint' },
            h('div', { class: 'pp-bar' }, h('button', { onclick: close }, '← 돌아가기'), printBtn, status),
            pagesEl);
        document.body.append(overlay);
        document.addEventListener('keydown', onKey);

        const pages = await build(msg => { status.textContent = msg; });
        pagesEl.replaceChildren(...pages);
        numberPages(pages);
        await Promise.all([...pagesEl.querySelectorAll('img')].map(img => img.decode().catch(() => {})));

        const warn = overflowing(pagesEl);
        status.replaceChildren(`${pages.length}페이지`,
            ...(warn.length ? [h('span', { class: 'pp-warn' }, `  ⚠ 내용이 길어 일부가 잘립니다: ${[...new Set(warn)].join(', ')}`)] : []));
        printBtn.disabled = false;
        overlay.dataset.ready = '1';    // 렌더 완료 신호 (자동 검증/헤드리스 출력용)
    }

    async function open(docId) {
        const res = await eel.pdm_get_document(docId)();
        if (!res.success) { alert(res.message); return; }
        const doc = res.document;
        const renderer = renderers[doc.docType];
        if (!renderer) { alert('이 문서 종류의 출력은 아직 지원되지 않습니다.'); return; }
        await present(doc.title, async setStatus => {
            await PdmLayout.load();           // 다른 사용자가 바꾼 출력 양식 설정 반영
            const pr = await eel.pdm_list_photos(docId)();
            const photos = pr.success ? pr.photos : [];
            const images = await fetchImages(photos, (n, total) => setStatus(`사진 불러오는 중… ${n}/${total}`));
            return renderer({ doc, photos, imageOf: id => images.get(id), layout: PDM_LAYOUT });
        });
    }

    // 문서 없이 페이지 몇 장만 미리보기 (양식 관리 등). buildPages: async () => [page element…]
    const preview = (title, buildPages) => present(title, () => buildPages());

    return { register, open, preview };
})();
