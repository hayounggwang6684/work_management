// 서비스레포트 편집기 — 종이 양식 모양의 폼 + 사진 그리드 + 인쇄 진입. 의존: sr_fields.js(SR_ROWS), editor_bar.js, photo_grid.js
const SrEditor = (() => {
    const READONLY = new Set(['orderNo']);

    function field(doc, key) {
        const input = h('input', {
            class: 'w-full px-2 py-1 border border-slate-300 rounded text-center ' +
                   (READONLY.has(key) ? 'bg-slate-100' : 'bg-white'),
            'data-key': key, value: doc.header[key] || '', readonly: READONLY.has(key),
        });
        return input;
    }

    function headerTable(doc) {
        const tbody = h('tbody');
        for (const row of SR_ROWS) {
            const tr = h('tr');
            for (const [label, key] of row) {
                tr.append(h('th', { class: 'bg-slate-50 border border-slate-400 px-2 py-1 w-36 font-normal' }, label));
                tr.append(h('td', { class: 'border border-slate-400 p-1', colspan: row.length === 1 ? 3 : 1 }, field(doc, key)));
            }
            tbody.append(tr);
        }
        return h('table', { class: 'w-full border-collapse text-sm' }, tbody);
    }

    function textBlock(title, key, doc, rows) {
        return h('div', { class: 'mt-6' },
            h('h3', { class: 'font-bold text-lg mb-1' }, '■ ' + title),
            h('textarea', { class: 'w-full border border-slate-300 rounded p-2 text-sm', rows, 'data-key': key },
                key === 'summary' ? (doc.header.summary || []).join('\n') : (doc.header[key] || '')));
    }

    function collect(root, doc) {
        const header = { ...doc.header };
        root.querySelectorAll('input[data-key]').forEach(i => { header[i.dataset.key] = i.value.trim(); });
        header.summary = root.querySelector('textarea[data-key=summary]').value
            .split('\n').map(s => s.replace(/\s+$/, '')).filter(s => s.trim());   // 앞 공백(들여쓰기)은 유지
        header.remark = root.querySelector('textarea[data-key=remark]').value;
        return header;
    }

    async function render(container, docId, onBack) {
        const res = await eel.pdm_get_document(docId)();
        if (!res.success) { container.replaceChildren(h('p', { class: 'text-red-600' }, res.message)); return; }
        const doc = res.document;
        const sugg = (await eel.pdm_summary_suggestions(doc.header.model)()).items || [];

        // 사진 변경은 즉시 서버에 저장되며 문서의 최종 수정 시각이 바뀌므로, 바에 알려 본문 저장 충돌을 막는다.
        const grid = PhotoGrid.create({ docId: doc.id, pageTitles: doc.header.pageTitles, onTouched: ts => bar.touch(ts) });
        const root = h('div', { class: 'bg-white rounded-lg shadow p-6 max-w-3xl mx-auto' },
            h('h2', { class: 'text-3xl font-serif font-bold text-center mb-4' }, 'Service report'),
            headerTable(doc),
            textBlock('Summary of works (한 줄에 한 항목)', 'summary', doc, 10),
            sugg.length ? h('div', { class: 'mt-1 text-xs text-slate-500' }, '이 엔진 자주 쓴 항목: ',
                sugg.slice(0, 8).map(t => h('button', {
                    class: 'mr-1 mb-1 px-2 py-0.5 bg-slate-100 hover:bg-blue-100 rounded border',
                    onclick: () => {
                        const ta = root.querySelector('textarea[data-key=summary]');
                        ta.value = ta.value.trim() ? ta.value.trimEnd() + '\n' + t : t;
                    },
                }, t))) : null,
            textBlock('Remark', 'remark', doc, 4),
            h('div', { class: 'mt-8' },
                h('h3', { class: 'font-bold text-lg mb-1' }, '■ Photos'),
                grid.el));

        const bar = EditorBar.create({
            doc, onBack,
            getHeader: () => ({ ...collect(root, bar.current()), pageTitles: grid.getPageTitles() }),
        });
        container.replaceChildren(bar.el, root);
    }

    return { render };
})();
