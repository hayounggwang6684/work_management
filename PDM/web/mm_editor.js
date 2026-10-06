// 계측지 편집기 — 공통 헤더 + 계측 항목 선택(양식 × PORT/STBD) + 선택한 양식별 입력 격자.
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

    // 선택 순서 대신 정의 순서(양식 → 구분)로 항상 정렬해 표지 INDEX 순서를 일정하게 한다.
    const sortForms = (forms, templates) => {
        const order = Object.fromEntries(templates.map((t, i) => [t.id, i]));
        return [...forms].sort((a, b) => order[a.formId] - order[b.formId]
            || templates.find(t => t.id === a.formId).sides.indexOf(a.side) - templates.find(t => t.id === b.formId).sides.indexOf(b.side));
    };

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
        return h('div', { class: 'flex flex-wrap items-end gap-4' },
            h('div', { class: 'text-sm' }, '구분: ', ...PHASES.map(([val, text]) => h('label', { class: 'mr-3' },
                (() => { const r = h('input', { type: 'radio', name: `phase-${inst.formId}-${inst.side}`, checked: inst.phase === val }); r.addEventListener('change', () => { inst.phase = val; }); return r; })(),
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

    function formCard(form, inst, index) {
        return h('section', { class: 'bg-white rounded-lg shadow p-4 space-y-3', 'data-form': `${inst.formId}:${inst.side}` },
            h('h3', { class: 'font-bold' }, `${index + 1}. ${form.indexTitle}(${inst.side})`),
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
            header.forms = sortForms(header.forms, templates);
            formsEl.replaceChildren(...(header.forms.length
                ? header.forms.map((inst, i) => formCard(byId[inst.formId], inst, i))
                : [h('p', { class: 'text-sm text-slate-500 text-center py-8' }, '위에서 계측할 항목을 선택하세요.')]));
        };

        async function toggle(form, side, on, checkbox) {
            const idx = header.forms.findIndex(f => f.formId === form.id && f.side === side);
            if (on && idx < 0) {
                const r = await eel.pdm_new_measurement_form(form.id, side)();
                if (!r.success) { checkbox.checked = false; alert(r.message); return; }
                header.forms.push(r.form);
            } else if (!on && idx >= 0) {
                if (hasData(header.forms[idx]) && await showChoice('항목 제거', `${form.indexTitle}(${side})에 입력한 값이 모두 사라집니다. 제거할까요?`,
                    [{ label: '제거', value: true, primary: true }, { label: '취소', value: false }]) !== true) { checkbox.checked = true; return; }
                header.forms.splice(idx, 1);
            }
            renderForms();
        }

        selectorEl.replaceChildren(...templates.map(form => h('div', { class: 'flex items-center gap-4 text-sm' },
            h('span', { class: 'w-44 font-medium' }, form.label),
            ...form.sides.map(side => h('label', {}, (() => {
                const cb = h('input', { type: 'checkbox', checked: header.forms.some(f => f.formId === form.id && f.side === side) });
                cb.addEventListener('change', () => toggle(form, side, cb.checked, cb));
                return cb;
            })(), ' ' + side)))));

        const headerGrid = h('div', { class: 'grid grid-cols-3 gap-3' }, ...HEADER_FIELDS.map(([label, key, type]) =>
            field(label, header[key] || '', v => { header[key] = v; }, type ? { type } : {})));

        container.replaceChildren(bar.el, h('div', { class: 'max-w-5xl mx-auto space-y-4' },
            h('div', { class: 'bg-white rounded-lg shadow p-4 space-y-3' },
                h('h2', { class: 'font-bold' }, '계측지 공통 정보 (작업현황에서 자동 입력)'), headerGrid),
            h('div', { class: 'bg-white rounded-lg shadow p-4 space-y-2' }, h('h2', { class: 'font-bold' }, '계측 항목 선택'), selectorEl),
            formsEl));
        renderForms();
    }

    return { render };
})();
