// 계측지 편집기 — 공통 헤더 + 계측 항목 선택(양식마다 안 함/1장/2장…) + 선택한 양식별 입력 격자.
// 같은 엔진의 1호기·2호기처럼 표지는 하나이고 계측 장만 여러 장일 때, 양식별 장 수를 정하고 장마다 구분 라벨(예: PORT, 1호기)을 쓴다.
// 양식 구조는 서버의 항목 정의(pdm_measurement_templates)로 그려지므로 정의에 양식을 추가하면 선택 목록에 나타난다.
// 편집 중인 값은 이 화면의 작업 복사본(header)에 쌓이고, [저장] 때 서버가 검증·정규화해 저장한다.
// 의존: dom.js(h, showChoice), mm_logic.js(MmLogic), editor_bar.js(EditorBar), eel
const MmEditor = (() => {
    const HEADER_FIELDS = [
        ['WORK NO', 'workNo'], ['INSP. DATE', 'inspDate', 'date'], ['OWNER', 'owner'], ['SHIP NAME', 'shipName'],
        ['INSP. BY', 'inspBy'], ['APPR. BY', 'apprBy'], ['MAKER/TYPE (엔진)', 'makerType'],
        ['표지 · 엔진', 'coverEngine'], ['표지 · 선박명', 'coverShip'],
    ];
    const PHASES = [['', '선택 안 함'], ['before', 'BEFORE'], ['after', 'AFTER']];
    const INPUT = 'w-full text-center border border-slate-300 rounded px-1 py-0.5 text-sm bg-white';

    const lines = s => String(s).replace(/\n/g, ' ');
    const hasData = inst => !!(inst.gaugeNo || inst.remarks || [].concat(...Object.values(inst.tables || {}), inst.cells || []).some(r => r.some(Boolean)));

    const MAX_UI_PAGES = 4;       // 선택 목록에 보여 주는 장 수 상한 (서버 상한은 measurement.MAX_PER_FORM)
    const LABEL_SUGGESTIONS = ['PORT', 'STBD', '1호기', '2호기'];
    let radioSeq = 0;             // 장마다 BEFORE/AFTER 라디오 그룹 이름이 겹치지 않게

    // ── 입력 격자 ────────────────────────────────────────────────────────────
    // grid 모델(2차원 문자열 배열)을 input 격자로. Enter/↑↓ 이동, 엑셀 붙여넣기 지원. get/set 으로 모델과 연결.
    function inputGrid({ get, set, rowHeads, colHeads, cornerLabel, editableRowHeads }) {
        const inputs = [];
        const sync = () => get().forEach((row, r) => row.forEach((v, c) => { inputs[r][c].value = v; }));
        const focusCell = (r, c) => { const el = inputs[r]?.[c]; if (el) { el.focus(); el.select(); } };

        const body = get().map((row, r) => {
            inputs[r] = [];
            const cells = row.map((v, c) => {
                const input = h('input', { class: INPUT, value: v, 'data-r': r, 'data-c': c, maxlength: 12, inputmode: 'decimal' });
                input.addEventListener('input', () => { const g = get(); g[r][c] = input.value.trim(); });
                input.addEventListener('keydown', e => {
                    if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); focusCell(r + 1, c); }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); focusCell(r - 1, c); }
                });
                input.addEventListener('paste', e => {
                    const text = e.clipboardData?.getData('text') || '';
                    if (!/[\t\n]/.test(text.trim())) return;       // 한 칸 값은 기본 붙여넣기
                    e.preventDefault();
                    set(MmLogic.applyPaste(get(), r, c, text));
                    sync();
                });
                inputs[r][c] = input;
                return h('td', { class: 'p-0.5' }, input);
            });
            return h('tr', {}, ...rowHeads(r), ...cells);
        });
        const head = h('tr', {}, h('th', { class: 'text-xs font-normal text-slate-500 px-1 text-left whitespace-pre', colspan: rowHeads(0).length }, cornerLabel),
            ...colHeads.map(t => h('th', { class: 'text-xs font-normal text-slate-500' }, t)));
        return { el: h('table', { class: 'w-full table-fixed border-collapse' }, h('thead', {}, head), h('tbody', {}, ...body)), sync };
    }

    const labelCell = text => h('td', { class: 'w-10 text-center text-sm text-slate-600 bg-slate-50 border' }, text);

    // ── 양식 카드 ────────────────────────────────────────────────────────────
    const field = (label, value, onInput, { cls = '', ...attrs } = {}) => h('label', { class: 'text-xs text-slate-500 ' + cls },
        label, (() => { const i = h('input', { class: INPUT + ' text-sm', value, ...attrs }); i.addEventListener('input', () => onInput(i.value.trim())); return i; })());

    function commonRow(inst) {
        const group = `phase-${++radioSeq}`;
        return h('div', { class: 'flex flex-wrap items-end gap-4' },
            h('div', { class: 'text-sm' }, '구분: ', ...PHASES.map(([val, text]) => h('label', { class: 'mr-3' },
                (() => { const r = h('input', { type: 'radio', name: group, checked: inst.phase === val }); r.addEventListener('change', () => { inst.phase = val; }); return r; })(),
                ' ' + text))),
            field('계측기기 No.', inst.gaugeNo, v => { inst.gaugeNo = v; }, { cls: 'w-48' }));
    }

    function journalBody(form, inst) {
        const parts = [];
        parts.push(h('div', { class: 'grid grid-cols-[auto_1fr_1fr] items-center gap-x-3 gap-y-1 w-96 text-sm' },
            h('span', {}), h('span', { class: 'text-xs text-slate-500 text-center' }, 'STANDARD'), h('span', { class: 'text-xs text-slate-500 text-center' }, 'LIMIT'),
            ...form.spec.flatMap(sp => [h('span', { class: 'text-xs' }, lines(sp.label)),
                field('', inst.spec[sp.id].standard, v => { inst.spec[sp.id].standard = v; }),
                field('', inst.spec[sp.id].limit, v => { inst.spec[sp.id].limit = v; })])));
        for (const table of form.tables) {
            const rows = table.rows;
            const grid = inputGrid({
                get: () => inst.tables[table.id], set: g => { inst.tables[table.id] = g; },
                rowHeads: r => (rows[r].length === 2
                    ? [...(rows[r][1] === 'TB' ? [Object.assign(labelCell(rows[r][0]), { rowSpan: 2 })] : []), labelCell(rows[r][1])]
                    : [labelCell(rows[r][0])]),
                colHeads: Array.from({ length: table.cols }, (_, i) => String(i + 1)), cornerLabel: lines(table.colLabel),
            });
            // 클리어런스 표: 같은 양식에 외경(outer)·안지름(inner) 표가 있어야 자동 계산할 수 있다
            const ids = MmLogic.roleIds(form);
            const calcable = table.role === 'clearance' && ids.outer && ids.inner;
            const clearanceBtn = table.role === 'clearance' ? [h('button', {
                class: 'ml-3 px-2 py-0.5 text-xs rounded bg-amber-100 hover:bg-amber-200 border border-amber-300 disabled:opacity-40',
                disabled: !calcable,
                title: calcable
                    ? '(안지름 기준 + C/100) − (외경 기준 − C/100) 를 TB/PS 방향별로 구해 큰 값을 채웁니다. 외경·안지름 기준값이 모두 있어야 계산됩니다.'
                    : '이 양식에는 외경/안지름 표가 없어 자동 계산할 수 없습니다.',
                onclick: () => {
                    const calc = MmLogic.calcClearance(inst.tables, inst.unitBase, ids);
                    inst.tables[table.id] = calc.map(row => Array.from({ length: table.cols }, (_, c) => row[c] ?? ''));
                    grid.sync();
                },
            }, '자동 계산')] : [];
            parts.push(h('div', {},
                h('div', { class: 'flex items-center gap-3 mb-1' }, h('span', { class: 'font-bold text-sm' }, '■ ' + table.title),
                    ...(table.unit ? [h('span', { class: 'text-xs text-slate-500 flex items-center gap-1' }, 'Unit : (',
                        (() => { const i = h('input', { class: INPUT + ' !w-20', value: inst.unitBase[table.id], placeholder: '기준값' }); i.addEventListener('input', () => { inst.unitBase[table.id] = i.value.trim(); }); return i; })(),
                        `) ${table.unit.op} C/100 mm`)] : []), ...clearanceBtn),
                grid.el));
        }
        parts.push(h('label', { class: 'block text-sm font-bold' }, '■ Remarks',
            (() => { const t = h('textarea', { class: 'w-full border border-slate-300 rounded p-2 text-sm font-normal', rows: 2, maxlength: 2000 }, inst.remarks); t.addEventListener('input', () => { inst.remarks = t.value; }); return t; })()));
        return parts;
    }

    function conrodBody(form, inst) {
        const grid = inputGrid({
            get: () => inst.cells, set: g => { inst.cells = g; },
            rowHeads: r => [h('td', { class: 'w-14 p-0.5' }, (() => { const i = h('input', { class: INPUT, value: inst.rowLabels[r], maxlength: 12, title: '실린더 번호 (수정 가능)' }); i.addEventListener('input', () => { inst.rowLabels[r] = i.value.trim(); }); return i; })())],
            colHeads: form.positions.flatMap(p => form.subColumns.map(s => `${p} ${s}`)), cornerLabel: 'Cyl. no  \\  Position',
        });
        return [
            h('div', { class: 'flex flex-wrap items-end gap-4' },
                field('체결 Torque (kg-m)', inst.torque, v => { inst.torque = v; }, { cls: 'w-40' }),
                field('Original', inst.original, v => { inst.original = v; }, { cls: 'w-28' }),
                field('STD', inst.std, v => { inst.std = v; }, { cls: 'w-28' }),
                field('Limit', inst.limit, v => { inst.limit = v; }, { cls: 'w-28' })),
            grid.el,
            h('p', { class: 'text-xs text-slate-400' }, '엑셀에서 복사한 범위를 첫 칸에 붙여넣으면 한 번에 채워집니다. Enter/↑↓ 로 같은 열 위아래 이동.'),
        ];
    }

    // nth = 같은 양식 안에서의 몇 번째 장 (0부터)
    function formCard(form, inst, index, nth) {
        const label = h('input', {
            class: INPUT + ' !w-44 !text-left', value: inst.label || '', maxlength: 20, list: 'pdmLabelSuggest',
            placeholder: '장 구분 (예: PORT, 1호기)', title: '표지 목차와 MAKER/TYPE 에 표시됩니다',
        });
        label.addEventListener('input', () => { inst.label = label.value.trim(); });
        return h('section', { class: 'bg-white rounded-lg shadow p-4 space-y-3', 'data-form': `${inst.formId}:${nth}` },
            h('div', { class: 'flex items-center gap-3' }, h('h3', { class: 'font-bold' }, `${index + 1}. ${form.indexTitle}`), label),
            commonRow(inst),
            ...(form.layout === 'conrodGrid' ? conrodBody(form, inst) : journalBody(form, inst)));
    }

    // ── 화면 ────────────────────────────────────────────────────────────────
    async function render(container, docId, onBack) {
        const [res, tpl] = await Promise.all([eel.pdm_get_document(docId)(), eel.pdm_measurement_templates()()]);
        if (!res.success || !tpl.success) { container.replaceChildren(h('p', { class: 'text-red-600' }, res.message || tpl.message)); return; }
        const templates = tpl.forms, byId = Object.fromEntries(templates.map(t => [t.id, t]));
        const header = structuredClone(res.document.header);        // 편집 작업 복사본 (저장 전까지 서버와 분리)
        const bar = EditorBar.create({ doc: res.document, onBack, getHeader: () => header, maxWidthClass: 'max-w-5xl' });
        const formsEl = h('div', { class: 'space-y-4' });
        const selectorEl = h('div', { class: 'space-y-1' });

        const renderForms = () => {
            header.forms = MmLogic.sortForms(header.forms, templates);
            const seen = {};
            formsEl.replaceChildren(...(header.forms.length
                ? header.forms.map((inst, i) => formCard(byId[inst.formId], inst, i, (seen[inst.formId] = (seen[inst.formId] ?? -1) + 1)))
                : [h('p', { class: 'text-sm text-slate-500 text-center py-8' }, '위에서 계측할 항목의 장 수를 선택하세요.')]));
        };

        // 양식 하나의 장 수를 바꾼다. 늘릴 때는 서버에서 기본 입력 구조를 받아 오고,
        // 줄일 때 값이 들어 있는 장이 사라지면 확인한다 (취소하면 선택을 되돌림).
        async function setCount(form, count, select) {
            const have = MmLogic.countOf(header.forms, form.id);
            if (count < have) {
                const dropped = MmLogic.droppedBy(header.forms, form.id, count);
                if (dropped.some(hasData) && await showChoice('장 줄이기',
                    `${form.indexTitle} ${dropped.length}장에 입력한 값이 사라집니다. 줄일까요?`,
                    [{ label: '줄이기', value: true, primary: true }, { label: '취소', value: false }]) !== true) { select.value = String(have); return; }
            }
            const fresh = [];
            for (let i = have; i < count; i++) {
                const r = await eel.pdm_new_measurement_form(form.id)();
                if (!r.success) { select.value = String(have); alert(r.message); return; }
                fresh.push(r.form);
            }
            header.forms = MmLogic.withPageCount(header.forms, form.id, count, i => fresh[i - have]);
            renderForms();
        }

        selectorEl.replaceChildren(...templates.map(form => {
            const current = MmLogic.countOf(header.forms, form.id);
            const select = h('select', { class: 'border border-slate-300 rounded px-2 py-1 text-sm bg-white' },
                ...Array.from({ length: Math.max(MAX_UI_PAGES, current) + 1 }, (_, n) =>
                    h('option', { value: String(n), selected: n === current }, n === 0 ? '안 함' : `${n}장`)));
            select.addEventListener('change', () => setCount(form, Number(select.value), select));
            return h('div', { class: 'flex items-center gap-4 text-sm' }, h('span', { class: 'w-44 font-medium' }, form.label), select);
        }));

        const headerGrid = h('div', { class: 'grid grid-cols-3 gap-3' }, ...HEADER_FIELDS.map(([label, key, type]) =>
            field(label, header[key] || '', v => { header[key] = v; }, type ? { type } : {})));

        container.replaceChildren(bar.el, h('div', { class: 'max-w-5xl mx-auto space-y-4' },
            h('div', { class: 'bg-white rounded-lg shadow p-4 space-y-3' },
                h('h2', { class: 'font-bold' }, '계측지 공통 정보 (작업현황에서 자동 입력)'), headerGrid),
            h('div', { class: 'bg-white rounded-lg shadow p-4 space-y-2' }, h('h2', { class: 'font-bold' }, '계측 항목 선택 (같은 엔진이 여러 대면 장 수를 늘리세요)'), selectorEl),
            formsEl,
            h('datalist', { id: 'pdmLabelSuggest' }, ...LABEL_SUGGESTIONS.map(v => h('option', { value: v })))));
        renderForms();
    }

    return { render };
})();
