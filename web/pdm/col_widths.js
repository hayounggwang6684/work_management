// 표 머리글 경계선을 끌어 열 너비를 조정한다 (통합조회 목록).
//   경계선(머리글 오른쪽 끝)을 끌면 그 열 너비가 바뀌고 표 전체 너비가 따라 늘어난다 (넘치면 가로 스크롤). 더블클릭하면 원래대로.
//   조정한 너비는 이 PC 에 기억한다 (localStorage). 머리글을 다시 그릴 때마다 decorate() 를 부른다.
// 의존: dom.js(h)
const ColWidths = (() => {
    const MIN_WIDTH = 40;
    const STYLE_ID = 'pdmColResizeStyle';

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;
        document.head.append(h('style', { id: STYLE_ID }, '.pdm-col-handle{position:absolute;top:0;right:-3px;width:7px;height:100%;cursor:col-resize;user-select:none;touch-action:none;z-index:2}'
            + '.pdm-col-handle:hover,.pdm-col-handle.active{background:rgba(37,99,235,.35)}'));
    }

    const readSaved = key => { try { const w = JSON.parse(localStorage.getItem(key) || 'null'); return Array.isArray(w) ? w : null; } catch (_) { return null; } };
    const writeSaved = (key, widths) => {
        try { if (widths) localStorage.setItem(key, JSON.stringify(widths)); else localStorage.removeItem(key); } catch (_) { /* 저장 못 해도 이번 화면에서는 그대로 쓴다 */ }
    };

    const apply = (table, headers, widths) => {
        table.style.tableLayout = 'fixed';
        headers.forEach((th, i) => { th.style.width = widths[i] + 'px'; });
        table.style.width = widths.reduce((a, b) => a + b, 0) + 'px';
    };
    const reset = (table, headers) => {
        table.style.tableLayout = '';
        table.style.width = '';
        headers.forEach(th => { th.style.width = ''; });
    };

    // table: <table>, key: localStorage 키. 반환: decorate(headRow) — 머리글 행에 저장된 너비와 끌기 손잡이를 붙인다.
    function create(table, key) {
        injectStyle();
        return function decorate(headRow) {
            const headers = [...headRow.children];
            const saved = readSaved(key);
            if (saved && saved.length === headers.length) apply(table, headers, saved);
            else reset(table, headers);

            headers.forEach((th, index) => {
                th.style.position = 'relative';
                const handle = h('span', { class: 'pdm-col-handle', title: '끌어서 너비 조정 · 더블클릭하면 원래대로' });
                handle.addEventListener('click', e => e.stopPropagation());                     // 정렬 클릭으로 번지지 않게
                handle.addEventListener('dblclick', e => { e.stopPropagation(); reset(table, headers); writeSaved(key, null); });
                handle.addEventListener('pointerdown', e => {
                    e.preventDefault();
                    const widths = headers.map(t => Math.round(t.getBoundingClientRect().width));     // 끌기 시작 시점의 실제 너비로 모두 고정
                    apply(table, headers, widths);
                    const startX = e.clientX, startWidth = widths[index];
                    handle.setPointerCapture(e.pointerId);
                    handle.classList.add('active');
                    const onMove = ev => { widths[index] = Math.max(MIN_WIDTH, Math.round(startWidth + ev.clientX - startX)); apply(table, headers, widths); };
                    const onUp = () => {
                        handle.classList.remove('active');
                        handle.removeEventListener('pointermove', onMove);
                        handle.removeEventListener('pointerup', onUp);
                        handle.removeEventListener('pointercancel', onUp);
                        writeSaved(key, widths);
                    };
                    handle.addEventListener('pointermove', onMove);
                    handle.addEventListener('pointerup', onUp);
                    handle.addEventListener('pointercancel', onUp);
                });
                th.append(handle);
            });
        };
    }

    return { create };
})();
