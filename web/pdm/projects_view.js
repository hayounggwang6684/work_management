// 공사현황 — 설정한 기간 안에 작업이 있는 주문(공사)을 한 줄씩 보여 주는 목록. PDM 의 진입점.
//   행 우클릭: 서비스레포트/계측지 메뉴 (새 문서 + 작성된 파일),  행 더블클릭: 서비스레포트 열기(없으면 메뉴)
// 기간/검색/정렬/필터는 브라우저(localStorage)에 기억한다 — 쓸 수 없는 환경이면 기본값으로 동작.
// 의존: dom.js(h), projects_logic.js(ProjectsLogic), eel
const ProjectsView = (() => {
    const STORAGE_KEY = 'pdmProjectsFilter';
    const PRESETS = [['thisMonth', '이번 달'], ['lastMonth', '지난 달'], ['last3Months', '최근 3개월'], ['thisYear', '올해']];
    const COLUMNS = [
        ['contractNumber', '계약번호', 'w-36 font-mono'], ['shipName', '선박', 'w-36'], ['company', '업체', ''],
        ['engineModel', '엔진', 'w-36'], ['lastDate', '작업 기간', 'w-44'], ['daysInRange', '작업일', 'w-16 text-right'],
        ['serviceReport', '서비스레포트', 'w-24 text-center'], ['measurement', '계측지', 'w-20 text-center'],
    ];

    const load = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) { return null; } };
    const save = state => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* 저장 불가 환경 */ } };

    // options: {onMenu(x, y, contractNumber), onOpen(contractNumber, x, y)}
    function create({ onMenu, onOpen }) {
        const state = { ...ProjectsLogic.presetRange('thisMonth'), query: '', onlyUnwritten: false, sortKey: 'lastDate', sortDir: 'desc', ...(load() || {}) };
        let projects = [];
        const info = h('span', { class: 'text-sm text-slate-500' });
        const body = h('tbody');
        const headRow = h('tr');

        const startInput = h('input', { type: 'date', class: 'border rounded px-2 py-1 text-sm', value: state.start });
        const endInput = h('input', { type: 'date', class: 'border rounded px-2 py-1 text-sm', value: state.end });
        const queryInput = h('input', { class: 'border rounded px-2 py-1 text-sm w-56', placeholder: '계약번호 / 선박 / 업체', value: state.query });
        const unwritten = h('input', { type: 'checkbox', checked: state.onlyUnwritten });

        const badge = n => h('span', { class: n ? 'px-2 rounded-full bg-emerald-100 text-emerald-700 text-xs' : 'text-slate-300' }, n ? String(n) : '—');

        function paintHead() {
            headRow.replaceChildren(...COLUMNS.map(([key, label, cls]) => h('th', {
                class: `px-2 py-1 text-xs font-normal text-slate-500 cursor-pointer select-none hover:text-slate-800 ${cls}`,
                onclick: () => { state.sortDir = state.sortKey === key && state.sortDir === 'asc' ? 'desc' : 'asc'; state.sortKey = key; save(state); paint(); },
            }, label + (state.sortKey === key ? (state.sortDir === 'asc' ? ' ▲' : ' ▼') : ''))));
        }

        function paint() {
            paintHead();
            const rows = ProjectsLogic.sortProjects(ProjectsLogic.filterUnwritten(projects, state.onlyUnwritten), state.sortKey, state.sortDir);
            info.textContent = `${rows.length}건` + (rows.length !== projects.length ? ` (전체 ${projects.length}건 중)` : '');
            body.replaceChildren(...(rows.length ? rows.map(row) : [h('tr', {}, h('td', { colspan: COLUMNS.length, class: 'text-center text-sm text-slate-400 py-8' }, '이 기간에 작업한 공사가 없습니다.'))]));
        }

        function row(p) {
            const tr = h('tr', { class: 'border-t hover:bg-sky-50 cursor-context-menu text-sm', title: '우클릭: 서비스레포트 / 계측지 · 더블클릭: 서비스레포트 열기' },
                h('td', { class: 'px-2 py-1.5 font-mono' }, p.contractNumber),
                h('td', { class: 'px-2' }, p.shipName), h('td', { class: 'px-2 truncate max-w-0' }, p.company), h('td', { class: 'px-2' }, p.engineModel),
                h('td', { class: 'px-2 text-slate-600' }, ProjectsLogic.periodText(p.firstDate, p.lastDate)),
                h('td', { class: 'px-2 text-right text-slate-600' }, String(p.daysInRange)),
                h('td', { class: 'px-2 text-center' }, badge(p.docs.serviceReport)), h('td', { class: 'px-2 text-center' }, badge(p.docs.measurement)));
            tr.addEventListener('contextmenu', e => { e.preventDefault(); onMenu(e.clientX, e.clientY, p.contractNumber); });
            tr.addEventListener('dblclick', e => onOpen(p.contractNumber, e.clientX, e.clientY));
            return tr;
        }

        let requestSeq = 0;      // 느린 이전 응답이 최신 결과를 덮어쓰지 않도록 가장 마지막 요청만 반영
        async function refresh() {
            state.start = startInput.value; state.end = endInput.value; state.query = queryInput.value.trim(); state.onlyUnwritten = unwritten.checked;
            save(state);
            info.textContent = '불러오는 중…';
            const mine = ++requestSeq;
            let r;
            try {
                r = await eel.pdm_list_projects(state.start, state.end, state.query)();
            } catch (e) {
                r = { success: false, message: '서버와 통신하지 못했습니다.' };
            }
            if (mine !== requestSeq) return;
            if (!r.success) { projects = []; paint(); info.textContent = '⚠ ' + r.message; return; }
            projects = r.projects;
            paint();
        }

        const preset = name => { const r = ProjectsLogic.presetRange(name); startInput.value = r.start; endInput.value = r.end; refresh(); };
        let timer;
        queryInput.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refresh, 300); });
        for (const el of [startInput, endInput]) el.addEventListener('change', refresh);
        unwritten.addEventListener('change', () => { state.onlyUnwritten = unwritten.checked; save(state); paint(); });

        const el = h('div', { class: 'space-y-3' },
            h('div', { class: 'flex flex-wrap items-center gap-2' },
                ...PRESETS.map(([name, label]) => h('button', { class: 'px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm', onclick: () => preset(name) }, label)),
                startInput, '~', endInput, queryInput,
                h('label', { class: 'text-sm ml-2' }, unwritten, ' 서비스레포트 미작성만'), info),
            h('table', { class: 'w-full table-fixed text-left' }, h('thead', {}, headRow), body));
        refresh();
        return { el, refresh };
    }

    return { create };
})();
