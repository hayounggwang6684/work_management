// 계측 표준값 화면 — 엔진별 표준값 목록 보기/수정/추가/삭제, 엑셀(표준 시트) 붙여넣기 가져오기.
// 표준값은 계측지에 양식을 넣을 때 엔진 모델에 맞춰 규격/기준값으로 자동 입력된다 (서버가 엔진명으로 찾는다).
// 목록은 누구나 볼 수 있고, 변경은 관리자만 (canManage). 저장하면 서버(DB)에 공유 저장된다.
// 의존: dom.js(h, showChoice), eel
const StandardsManager = (() => {
    const INPUT = 'w-full border border-slate-300 rounded px-2 py-1 text-sm bg-white disabled:bg-slate-100';
    // 목록에 보여 줄 열 (나머지 칸은 편집 화면에서)
    const COLUMNS = [['crankpin_std', '크랭크핀', 'STD'], ['crankpin_limit', '', 'LIMIT'], ['main_std', '메인저널', 'STD'], ['main_limit', '', 'LIMIT'],
        ['liner_std', '라이너', 'STD'], ['liner_limit', '', 'LIMIT'], ['piston_std', '피스톤', 'STD'], ['conrod_original', '콘로드', 'Original'], ['conrod_std', '', 'STD']];

    const matches = (row, q) => !q || `${row.maker} ${row.model}`.toUpperCase().includes(q.toUpperCase());

    async function render(container, onBack, canManage) {
        const res = await eel.pdm_list_standards()();
        if (!res.success) { container.replaceChildren(h('p', { class: 'text-red-600' }, res.message)); return; }
        let rows = res.rows;
        const groups = [...new Set(res.fields.map(f => f.group))];
        const status = h('span', { class: 'text-sm text-slate-500' });
        const listBox = h('div'), editBox = h('div');
        let query = '';

        const paintList = () => {
            const shown = rows.filter(r => matches(r, query));
            listBox.replaceChildren(h('div', { class: 'overflow-auto max-h-[60vh] border rounded' }, h('table', { class: 'w-full text-sm border-collapse' },
                h('thead', { class: 'sticky top-0 bg-slate-100' }, h('tr', {},
                    h('th', { class: 'px-2 py-1 text-left' }, '제조사'), h('th', { class: 'px-2 py-1 text-left' }, '모델'),
                    ...COLUMNS.map(([, group, label]) => h('th', { class: 'px-2 py-1 text-center text-xs font-normal text-slate-600', title: group }, group ? `${group} ${label}` : label)))),
                h('tbody', {}, ...shown.map(r => {
                    const tr = h('tr', { class: 'border-t hover:bg-sky-50 cursor-pointer' },
                        h('td', { class: 'px-2 py-1' }, r.maker), h('td', { class: 'px-2 py-1 font-medium' }, r.model),
                        ...COLUMNS.map(([key]) => h('td', { class: 'px-2 py-1 text-center whitespace-nowrap' }, r.data[key] || '')));
                    tr.addEventListener('click', () => openEdit(r));
                    return tr;
                })))), h('p', { class: 'text-xs text-slate-500 mt-1' }, `${shown.length} / ${rows.length}개 엔진 — 행을 누르면 모든 값을 보고 고칠 수 있습니다.`));
        };

        function openEdit(row) {
            const draft = structuredClone(row || { id: null, maker: '', model: '', data: {} });
            const inputs = {};
            const input = (value, onInput) => {
                const i = h('input', { class: INPUT, value, disabled: !canManage, maxlength: 60 });
                i.addEventListener('input', () => onInput(i.value));
                return i;
            };
            const sections = groups.filter(g => g !== '엔진').map(group => h('fieldset', { class: 'border rounded p-3' },
                h('legend', { class: 'px-1 text-sm font-bold' }, group),
                h('div', { class: 'grid grid-cols-4 gap-2' }, ...res.fields.filter(f => f.group === group).map(f =>
                    h('label', { class: 'text-xs text-slate-500' }, f.label, inputs[f.key] = input(draft.data[f.key] || '', v => { draft.data[f.key] = v.trim(); }))))));
            const save = async () => {
                const r = await eel.pdm_save_standard({ maker: draft.maker, model: draft.model, data: draft.data }, draft.id)();
                if (!r.success) { status.textContent = '⚠ ' + r.message; return; }
                rows = draft.id ? rows.map(x => (x.id === draft.id ? r.row : x)) : [...rows, r.row];
                rows.sort((a, b) => `${a.maker} ${a.model}`.localeCompare(`${b.maker} ${b.model}`));
                status.textContent = '저장됨 ' + new Date().toLocaleTimeString();
                editBox.replaceChildren(); paintList();
            };
            const remove = async () => {
                if (await showChoice('표준값 삭제', `${draft.maker} ${draft.model} 표준값을 삭제할까요?`, [{ label: '삭제', value: true, primary: true }, { label: '취소', value: false }]) !== true) return;
                const r = await eel.pdm_delete_standard(draft.id)();
                if (!r.success) { status.textContent = '⚠ ' + r.message; return; }
                rows = rows.filter(x => x.id !== draft.id);
                editBox.replaceChildren(); paintList();
            };
            editBox.replaceChildren(h('section', { class: 'bg-white rounded-lg shadow p-4 space-y-3 border-2 border-sky-300' },
                h('div', { class: 'flex items-end gap-3' },
                    h('label', { class: 'text-xs text-slate-500 w-56' }, '제조사', input(draft.maker, v => { draft.maker = v.trim(); })),
                    h('label', { class: 'text-xs text-slate-500 w-56' }, '엔진 모델', input(draft.model, v => { draft.model = v.trim(); })),
                    ...(canManage ? [h('button', { class: 'px-4 py-1 rounded bg-blue-600 text-white', onclick: save }, '저장'),
                        ...(draft.id ? [h('button', { class: 'px-3 py-1 rounded bg-red-100 text-red-700', onclick: remove }, '삭제')] : [])] : []),
                    h('button', { class: 'px-3 py-1 rounded bg-slate-200', onclick: () => editBox.replaceChildren() }, '닫기')),
                h('p', { class: 'text-xs text-slate-400' }, '값은 현장 표기 그대로 적습니다 (예: ±0.1, 65lb+90˚). 계측지에는 칸(12자)에 들어가는 값만 자동 입력되고, 숫자가 아닌 기준값/토크는 안내로만 알려 줍니다.'),
                ...sections));
            editBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        async function openImport() {
            const area = h('textarea', { class: 'w-full h-48 border border-slate-300 rounded p-2 text-xs font-mono', placeholder: '엑셀 "표준" 시트에서 (엔진모델 열 A부터 AP까지) 행들을 복사해 붙여넣으세요. 머리글 줄은 자동으로 건너뜁니다.' });
            const run = h('button', { class: 'px-4 py-1 rounded bg-blue-600 text-white' }, '가져오기');
            const msg = h('span', { class: 'text-sm text-slate-500' });
            run.addEventListener('click', async () => {
                const r = await eel.pdm_import_standards(area.value)();
                if (!r.success) { msg.textContent = '⚠ ' + r.message; return; }
                msg.textContent = `추가 ${r.added}개, 갱신 ${r.updated}개`;
                rows = (await eel.pdm_list_standards()()).rows; paintList();
            });
            editBox.replaceChildren(h('section', { class: 'bg-white rounded-lg shadow p-4 space-y-2 border-2 border-sky-300' },
                h('h2', { class: 'font-bold' }, '엑셀에서 가져오기'),
                h('p', { class: 'text-xs text-slate-500' }, '제조사+모델이 같은 엔진은 붙여넣은 칸만 갱신하고, 없는 엔진은 추가합니다. 붙여넣지 않은 칸은 그대로 둡니다.'),
                area, h('div', { class: 'flex items-center gap-3' }, run, h('button', { class: 'px-3 py-1 rounded bg-slate-200', onclick: () => editBox.replaceChildren() }, '닫기'), msg)));
        }

        const search = h('input', { class: INPUT + ' !w-64', placeholder: '제조사/모델 검색' });
        search.addEventListener('input', () => { query = search.value.trim(); paintList(); });

        container.replaceChildren(
            h('div', { class: 'max-w-7xl mx-auto mb-3 flex items-center gap-3' },
                h('button', { class: 'px-3 py-1 rounded bg-slate-200', onclick: onBack }, '← 돌아가기'),
                h('h1', { class: 'font-bold text-lg' }, '계측 표준값'),
                ...(canManage ? [] : [h('span', { class: 'text-sm text-amber-600' }, '관리자만 변경할 수 있습니다 (보기 전용)')]), status),
            h('div', { class: 'max-w-7xl mx-auto space-y-3' },
                h('div', { class: 'bg-white rounded-lg shadow p-4 space-y-3' },
                    h('div', { class: 'flex items-center gap-3' }, search,
                        ...(canManage ? [h('button', { class: 'px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm', onclick: () => openEdit(null) }, '＋ 새 엔진'),
                            h('button', { class: 'px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm', onclick: openImport }, '엑셀에서 가져오기')] : [])),
                    listBox),
                editBox));
        paintList();
    }

    return { render };
})();
