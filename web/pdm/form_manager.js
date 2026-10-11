// 양식 관리 — 계측 양식을 화면에서 추가/수정/삭제/복제. 내장 양식은 읽기 전용(복제해서 수정).
// 만들 수 있는 형태: 크랭크핀형 격자 (규격표 1~2행 + F/A × TB/PS 또는 F/A 표 1~3개 + Remarks).
// 서버가 정의를 검증/정규화하므로 여기서는 입력만 모아 보낸다. 출력 미리보기는 저장하지 않고 초안으로 확인한다.
// 의존: dom.js(h, showChoice, blobToDataURL), mm_print.js(MmPrint), print_view.js(PrintView), mm_assets.js, eel
const FormManager = (() => {
    const INPUT = 'w-full border border-slate-300 rounded px-2 py-1 text-sm bg-white';
    const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
    const ROLES = [['plain', '일반'], ['outer', '외경 (기준 − C/100)'], ['inner', '안지름 (기준 + C/100)'], ['clearance', '클리어런스 (자동 계산 대상)']];
    const ROLE_ROWS = { outer: 'FA_TBPS', inner: 'FA_TBPS', clearance: 'FA' };       // 역할이 정하는 행 구성

    const blankTable = (role, op = '') => ({ title: '', colLabel: 'No.', cols: 8, rowsKind: ROLE_ROWS[role] || 'FA_TBPS', role, unitBase: '', unitOp: op });
    const blankDraft = () => ({
        label: '', title: '', indexTitle: '', code: '', diagramImage: null,
        spec: [{ label: '', standard: '', limit: '' }, { label: '', standard: '', limit: '' }],
        tables: [blankTable('outer', '-'), blankTable('inner', '+'), blankTable('clearance')],
    });

    // 저장된 양식 → 편집 초안. 복제면 내장 도면(JS 자산)도 이미지로 옮긴다.
    const draftFromForm = form => ({
        label: form.label, title: form.title, indexTitle: form.indexTitle, code: form.code || '',
        diagramImage: form.diagramImage || (form.diagram ? PDM_MM_ASSETS['diagram_' + form.diagram] || null : null),
        spec: form.spec.map(s => ({ label: s.label, standard: s.standard, limit: s.limit })),
        tables: form.tables.map(t => ({
            title: t.title, colLabel: t.colLabel, cols: t.cols, rowsKind: t.rows[0].length === 2 ? 'FA_TBPS' : 'FA',
            role: t.role || 'plain', unitBase: t.unit ? t.unit.base : '', unitOp: t.unit ? t.unit.op : '',
        })),
    });

    const field = (label, el, cls = '') => h('label', { class: 'block text-xs text-slate-500 ' + cls }, label, el);
    const bound = (obj, key, extra = {}) => {
        const i = h('input', { class: INPUT, value: obj[key] ?? '', ...extra });
        i.addEventListener('input', () => { obj[key] = i.value; });
        return i;
    };
    const boundArea = (obj, key, rows = 2) => {
        const t = h('textarea', { class: INPUT, rows }, obj[key] ?? '');
        t.addEventListener('input', () => { obj[key] = t.value; });
        return t;
    };

    // ── 목록 ────────────────────────────────────────────────────────────────
    async function renderList(container, onBack, canManage, notice = '') {
        const tpl = await eel.pdm_measurement_templates()();
        if (!tpl.success) { container.replaceChildren(h('p', { class: 'text-red-600' }, tpl.message)); return; }
        const status = h('span', { class: 'text-sm text-slate-500' }, notice);
        const again = msg => renderList(container, onBack, canManage, msg);

        const previewForm = async form => {
            const r = await eel.pdm_new_measurement_form(form.id)();
            if (!r.success) { status.textContent = '⚠ ' + r.message; return; }
            PrintView.preview(form.title, async () => [MmPrint.previewPage(form, r.form)]);
        };
        const remove = async form => {
            const ok = await showChoice('양식 삭제', `"${form.label}" 양식을 삭제할까요?`, [{ label: '삭제', value: true, primary: true }, { label: '취소', value: false }]);
            if (ok !== true) return;
            const r = await eel.pdm_delete_form_def(form.id)();
            again(r.success ? '삭제했습니다.' : '⚠ ' + r.message);
        };
        const btn = (label, onclick) => h('button', { class: 'px-2 py-0.5 rounded bg-slate-200 text-xs mr-1', onclick }, label);

        const rows = tpl.forms.map(form => h('tr', { class: 'border-t' },
            h('td', { class: 'px-2 py-2 font-medium' }, form.label),
            h('td', { class: 'px-2 text-xs ' + (form.builtin ? 'text-slate-500' : 'text-emerald-700') }, form.builtin ? '🔒 내장' : '사용자 정의'),
            h('td', { class: 'px-2 text-sm text-slate-600' }, form.layout === 'conrodGrid' ? '격자 1개' : `표 ${form.tables.length}개`),
            h('td', { class: 'px-2 text-right whitespace-nowrap' },
                btn('미리보기', () => previewForm(form)),
                ...(canManage ? [btn('복제', () => renderEditor(container, onBack, canManage, draftFromForm({ ...form, label: form.label + ' (복사)' }), null)),
                    ...(form.builtin ? [] : [btn('수정', () => renderEditor(container, onBack, canManage, draftFromForm(form), form.id)), btn('삭제', () => remove(form))])] : []))));

        container.replaceChildren(
            h('div', { class: 'max-w-4xl mx-auto mb-3 flex items-center gap-3' },
                h('button', { class: 'px-3 py-1 rounded bg-slate-200', onclick: onBack }, '← 돌아가기'),
                h('h1', { class: 'font-bold text-lg' }, '양식 관리 (계측 양식)'),
                ...(canManage ? [h('button', { class: 'px-4 py-1 rounded bg-emerald-600 text-white', onclick: () => renderEditor(container, onBack, canManage, blankDraft(), null) }, '＋ 새 양식')]
                              : [h('span', { class: 'text-sm text-amber-600' }, '관리자만 변경할 수 있습니다 (보기 전용)')]),
                status),
            h('div', { class: 'max-w-4xl mx-auto bg-white rounded-lg shadow p-4' },
                h('table', { class: 'w-full text-left' }, h('thead', {}, h('tr', { class: 'text-xs text-slate-500' },
                    ...['이름', '종류', '구성', ''].map(t => h('th', { class: 'px-2 pb-1 font-normal' }, t)))), h('tbody', {}, ...rows)),
                h('p', { class: 'text-xs text-slate-400 mt-3' }, '내장 양식은 수정할 수 없고 [복제]해서 고칩니다. 새 양식은 크랭크핀형(규격표 + F/A × TB/PS 표) 형태로 만들 수 있고, 만든 즉시 계측지의 "계측 항목 선택"에 나타납니다.')));
    }

    // ── 편집기 ──────────────────────────────────────────────────────────────
    function renderEditor(container, onBack, canManage, draft, formId) {
        while (draft.spec.length < 2) draft.spec.push({ label: '', standard: '', limit: '' });     // 규격 행은 항상 2칸을 보여 주고, 비운 행은 저장 때 제외
        const status = h('span', { class: 'text-sm text-slate-500' });

        const toDefinition = () => ({
            ...draft,
            tables: draft.tables.map(t => ({ ...t, cols: Number(t.cols), unitOp: t.useUnit === false ? '' : t.unitOp })),
            spec: draft.spec.filter(s => s.label.trim()),
        });

        const diagramImg = h('img', { class: 'max-h-24 border bg-white' });
        const paintDiagram = () => { diagramImg.src = draft.diagramImage || ''; diagramImg.style.display = draft.diagramImage ? 'block' : 'none'; };
        const pickDiagram = () => {
            const input = h('input', { type: 'file', accept: 'image/*' });
            input.addEventListener('change', async () => {
                const f = input.files[0];
                if (!f) return;
                if (!f.type.startsWith('image/') || f.size > MAX_IMAGE_BYTES) { status.textContent = '⚠ 3MB 이하의 이미지 파일을 선택하세요.'; return; }
                draft.diagramImage = await blobToDataURL(f);
                paintDiagram();
            });
            input.click();
        };

        const tableCards = h('div', { class: 'space-y-3' });
        const paintTables = () => tableCards.replaceChildren(...draft.tables.map((t, i) => tableCard(t, i)));
        function tableCard(t, i) {
            const roleSel = h('select', { class: INPUT }, ...ROLES.map(([v, l]) => h('option', { value: v, selected: t.role === v }, l)));
            const kindSel = h('select', { class: INPUT, disabled: !!ROLE_ROWS[t.role] },
                h('option', { value: 'FA_TBPS', selected: t.rowsKind === 'FA_TBPS' }, 'F/A × TB/PS (4행)'), h('option', { value: 'FA', selected: t.rowsKind === 'FA' }, 'F/A (2행)'));
            roleSel.addEventListener('change', () => { t.role = roleSel.value; if (ROLE_ROWS[t.role]) t.rowsKind = ROLE_ROWS[t.role]; paintTables(); });
            kindSel.addEventListener('change', () => { t.rowsKind = kindSel.value; });
            const useUnit = h('input', { type: 'checkbox', checked: t.unitOp === '+' || t.unitOp === '-' });
            const opSel = h('select', { class: INPUT + ' !w-16' }, h('option', { value: '-', selected: t.unitOp !== '+' }, '−'), h('option', { value: '+', selected: t.unitOp === '+' }, '+'));
            useUnit.addEventListener('change', () => { t.useUnit = useUnit.checked; t.unitOp = useUnit.checked ? opSel.value : ''; });
            opSel.addEventListener('change', () => { if (useUnit.checked) t.unitOp = opSel.value; });
            return h('div', { class: 'border rounded p-3 space-y-2' },
                h('div', { class: 'flex items-center justify-between' }, h('span', { class: 'text-sm font-bold' }, `표 ${i + 1}`),
                    ...(draft.tables.length > 1 ? [h('button', { class: 'text-xs text-red-600', onclick: () => { draft.tables.splice(i, 1); paintTables(); } }, '이 표 삭제')] : [])),
                h('div', { class: 'grid grid-cols-3 gap-2' },
                    field('표 제목', bound(t, 'title'), 'col-span-2'), field('열 수 (1~8)', bound(t, 'cols', { type: 'number', min: 1, max: 8 })),
                    field('종류', roleSel), field('행 구성', kindSel), field('왼쪽 위 칸 글자', boundArea(t, 'colLabel'))),
                h('div', { class: 'flex items-center gap-2 text-sm' }, h('label', {}, useUnit, ' 단위 표시  Unit : ( '), bound(t, 'unitBase', { placeholder: '기준값', class: INPUT + ' !w-24' }), ' )', opSel, ' C/100 mm'));
        }

        const specRows = h('div', { class: 'space-y-2' });
        const paintSpec = () => specRows.replaceChildren(...draft.spec.map((s, i) => h('div', { class: 'grid grid-cols-[1fr_6rem_6rem] gap-2 items-end' },
            field(i === 0 ? '규격 이름 (첫째: 기준 치수)' : '규격 이름 (둘째: 클리어런스 등)', boundArea(s, 'label')), field('STANDARD', bound(s, 'standard')), field('LIMIT', bound(s, 'limit')))));

        const preview = async () => {
            const r = await eel.pdm_preview_form_def(toDefinition())();
            if (!r.success) { status.textContent = '⚠ ' + r.message; return; }
            status.textContent = '';
            PrintView.preview(r.form.title, async () => [MmPrint.previewPage(r.form, r.instance)]);
        };
        const save = async () => {
            const r = await eel.pdm_save_form_def(toDefinition(), formId)();
            if (r.success) renderList(container, onBack, canManage, `"${r.form.label}" 저장됨`); else status.textContent = '⚠ ' + r.message;
        };

        container.replaceChildren(
            h('div', { class: 'max-w-4xl mx-auto mb-3 flex items-center gap-3' },
                h('button', { class: 'px-3 py-1 rounded bg-slate-200', onclick: () => renderList(container, onBack, canManage) }, '← 목록'),
                h('h1', { class: 'font-bold text-lg' }, formId ? '양식 수정' : '새 양식'),
                h('button', { class: 'px-3 py-1 rounded bg-slate-200', onclick: preview }, '출력 미리보기'),
                h('button', { class: 'px-4 py-1 rounded bg-blue-600 text-white', onclick: save }, '저장'), status),
            h('div', { class: 'max-w-4xl mx-auto space-y-4' },
                h('section', { class: 'bg-white rounded-lg shadow p-4 space-y-3' }, h('h2', { class: 'font-bold' }, '기본 정보'),
                    h('div', { class: 'grid grid-cols-2 gap-3' },
                        field('이름 (선택 목록에 표시)', bound(draft, 'label')), field('양식 번호 (출력 왼쪽 아래)', bound(draft, 'code')),
                        field('출력 제목 (예: RECORD OF … )', bound(draft, 'title'), 'col-span-2'),
                        field('표지 목차 제목 (비우면 출력 제목)', bound(draft, 'indexTitle'), 'col-span-2')),
                    h('p', { class: 'text-xs text-slate-400' }, '장 수와 장 구분(PORT, 1호기 등)은 계측지에서 문서마다 정합니다.')),
                h('section', { class: 'bg-white rounded-lg shadow p-4 space-y-3' }, h('h2', { class: 'font-bold' }, '규격표 (ITEM / STANDARD / LIMIT)'), specRows,
                    h('p', { class: 'text-xs text-slate-400' }, '이름을 비운 행은 사용하지 않습니다.')),
                h('section', { class: 'bg-white rounded-lg shadow p-4 space-y-3' }, h('h2', { class: 'font-bold' }, '도면 이미지 (선택)'),
                    h('div', { class: 'flex items-center gap-3' }, diagramImg,
                        h('button', { class: 'px-3 py-1 rounded bg-slate-200 text-sm', onclick: pickDiagram }, '이미지 선택'),
                        h('button', { class: 'px-3 py-1 rounded bg-slate-100 text-sm', onclick: () => { draft.diagramImage = null; paintDiagram(); } }, '제거'))),
                h('section', { class: 'bg-white rounded-lg shadow p-4 space-y-3' },
                    h('div', { class: 'flex items-center justify-between' }, h('h2', { class: 'font-bold' }, '입력 표 (최대 3개)'),
                        h('button', { class: 'px-2 py-1 rounded bg-slate-200 text-sm', onclick: () => { if (draft.tables.length < 3) { draft.tables.push(blankTable('plain')); paintTables(); } } }, '＋ 표 추가')),
                    tableCards,
                    h('p', { class: 'text-xs text-slate-400' }, '이미 작성된 문서에도 새 구성이 적용됩니다. 열이나 행이 줄어든 칸의 값은 해당 문서를 다시 저장할 때 사라집니다.'))));
        paintTables(); paintSpec(); paintDiagram();
    }

    return { render: renderList };
})();
