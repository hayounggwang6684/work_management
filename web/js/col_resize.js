// 일일 작업 표(주간/야간) 머리글 경계선을 끌어서 열 너비를 조정한다.
//   - 경계선(머리글 오른쪽 끝)을 끌면 그 열 너비가 바뀌고, 표 전체 너비가 따라 늘어난다 (넘치면 가로 스크롤).
//   - 경계선을 더블클릭하면 그 표의 너비를 처음 상태로 되돌린다.
//   - 조정한 너비는 이 PC 에 기억한다 (localStorage — 설정 파일·DB 와 무관).
(() => {
    const MIN_WIDTH = 40;
    const TARGETS = ['dayWorkSection', 'nightWorkSection'];
    const storageKey = id => 'colWidths:' + id;

    const readSaved = id => {
        try {
            const widths = JSON.parse(localStorage.getItem(storageKey(id)) || 'null');
            return Array.isArray(widths) ? widths : null;
        } catch (e) { return null; }
    };
    const writeSaved = (id, widths) => {
        try {
            if (widths) localStorage.setItem(storageKey(id), JSON.stringify(widths));
            else localStorage.removeItem(storageKey(id));
        } catch (e) { /* 저장 못 해도 이번 창에서는 그대로 쓴다 */ }
    };

    function injectStyle() {
        if (document.getElementById('colResizeStyle')) return;
        const style = document.createElement('style');
        style.id = 'colResizeStyle';
        style.textContent = '.col-resize-handle{position:absolute;top:0;right:-3px;width:7px;height:100%;cursor:col-resize;user-select:none;touch-action:none;z-index:2}'
            + '.col-resize-handle:hover,.col-resize-handle.active{background:rgba(37,99,235,.35)}';
        document.head.appendChild(style);
    }

    function applyWidths(table, headers, widths) {
        table.style.tableLayout = 'fixed';
        headers.forEach((th, i) => { th.style.width = widths[i] + 'px'; });
        table.style.width = widths.reduce((a, b) => a + b, 0) + 'px';
    }

    function reset(table, headers) {
        table.style.tableLayout = '';
        table.style.width = '';
        headers.forEach(th => { th.style.width = ''; });
    }

    function setup(sectionId) {
        const section = document.getElementById(sectionId);
        const table = section && section.querySelector('table');
        const headRow = table && table.querySelector('thead tr');
        if (!headRow) return;
        const headers = [...headRow.children];

        const currentWidths = () => headers.map(th => Math.round(th.getBoundingClientRect().width));
        const saved = readSaved(sectionId);
        if (saved && saved.length === headers.length) applyWidths(table, headers, saved);

        headers.forEach((th, index) => {
            th.style.position = 'relative';
            const handle = document.createElement('span');
            handle.className = 'col-resize-handle';
            handle.title = '끌어서 너비 조정 · 더블클릭하면 원래대로';
            th.appendChild(handle);

            handle.addEventListener('pointerdown', e => {
                e.preventDefault();
                const widths = currentWidths();                       // 끌기 시작 시점의 실제 너비로 모두 고정한다
                applyWidths(table, headers, widths);
                const startX = e.clientX;
                const startWidth = widths[index];
                handle.setPointerCapture(e.pointerId);
                handle.classList.add('active');

                const onMove = ev => {
                    widths[index] = Math.max(MIN_WIDTH, Math.round(startWidth + ev.clientX - startX));
                    applyWidths(table, headers, widths);
                };
                const onUp = () => {
                    handle.classList.remove('active');
                    handle.removeEventListener('pointermove', onMove);
                    handle.removeEventListener('pointerup', onUp);
                    handle.removeEventListener('pointercancel', onUp);
                    writeSaved(sectionId, widths);
                };
                handle.addEventListener('pointermove', onMove);
                handle.addEventListener('pointerup', onUp);
                handle.addEventListener('pointercancel', onUp);
            });

            handle.addEventListener('dblclick', () => { reset(table, headers); writeSaved(sectionId, null); });
        });
    }

    function init() {
        injectStyle();
        TARGETS.forEach(setup);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
