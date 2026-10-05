// 서비스레포트 첫 장 편집기 — 종이 양식 모양의 폼. 사진 페이지는 3단계에서 추가.
const SrEditor = (() => {
    // [라벨, 헤더 키, 폭(열 수)] — 2열 구조 한 줄씩. 양식(GL2030)의 표 순서와 동일.
    const ROWS = [
        [['Name of vessel', 'vesselName'], ['IMO No.', 'imoNo']],
        [['Engine Type', 'engineType'], ['S/N', 'serialNo']],
        [['Model', 'model'], ['Date', 'date']],
        [['Order No.', 'orderNo'], ['Reported by', 'reportedBy']],
        [['Customer', 'customer']],
        [['Requested by', 'requestedBy']],
        [['Location', 'location']],
        [['Period', 'period']],
        [['Subject', 'subject']],
    ];
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
        for (const row of ROWS) {
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
            .split('\n').map(s => s.trim()).filter(Boolean);
        header.remark = root.querySelector('textarea[data-key=remark]').value;
        return header;
    }

    async function render(container, docId, onBack) {
        const res = await eel.pdm_get_document(docId)();
        if (!res.success) { container.replaceChildren(h('p', { class: 'text-red-600' }, res.message)); return; }
        let doc = res.document;
        const sugg = (await eel.pdm_summary_suggestions(doc.header.model)()).items || [];

        const status = h('span', { class: 'text-sm text-slate-500' });
        // 사진 변경은 즉시 서버에 저장되며, 문서의 최종 수정 시각이 바뀌므로 본문 저장 시 충돌이 나지 않게 동기화한다.
        const grid = PhotoGrid.create({
            docId: doc.id, pageTitles: doc.header.pageTitles,
            onTouched: ts => { doc = { ...doc, updatedAt: ts }; },
        });
        const root =h('div', { class: 'bg-white rounded-lg shadow p-6 max-w-3xl mx-auto' },
            h('h2', { class: 'text-3xl font-serif font-bold text-center mb-4' }, 'Service report'),
            headerTable(doc),
            textBlock('Summary of works (한 줄에 한 항목)', 'summary', doc, 10),
            sugg.length ? h('div', { class: 'mt-1 text-xs text-slate-500' }, '이 엔진 자주 쓴 항목: ',
                sugg.slice(0, 8).map(t => h('button', {
                    class: 'mr-1 mb-1 px-2 py-0.5 bg-slate-100 hover:bg-blue-100 rounded border',
                    onclick: () => {
                        const ta = root.querySelector('textarea[data-key=summary]');
                        ta.value = (ta.value.trimEnd() + '\n' + t).trim();
                    },
                }, t))) : null,
            textBlock('Remark', 'remark', doc, 4),
            h('div', { class: 'mt-8' },
                h('h3', { class: 'font-bold text-lg mb-1' }, '■ Photos'),
                grid.el));

        const save = async () => {
            const header = { ...collect(root, doc), pageTitles: grid.getPageTitles() };
            const title = titleInput.value.trim() || doc.title;
            const r = await eel.pdm_save_document(doc.id, doc.updatedAt, title, header)();
            if (r.success) {
                doc = { ...doc, title, header, updatedAt: r.updatedAt };
                titleInput.value = title;
                status.textContent = '저장됨 ' + new Date().toLocaleTimeString();
            } else {
                status.textContent = r.conflict ? '⚠ ' + r.message + ' — 새로고침 후 다시 시도하세요' : '⚠ ' + r.message;
            }
        };
        const titleInput = h('input', {
            class: 'flex-1 min-w-0 px-2 py-1 border border-slate-300 rounded bg-white',
            value: doc.title, title: '파일 이름',
        });
        const bar = h('div', { class: 'max-w-3xl mx-auto mb-3 flex items-center gap-3' },
            h('button', { class: 'px-3 py-1 rounded bg-slate-200', onclick: onBack }, '← 목록'),
            titleInput,
            h('button', { class: 'px-4 py-1 rounded bg-blue-600 text-white', onclick: save }, '저장'),
            status,
            h('span', { class: 'ml-auto text-xs text-slate-400' },
                `최종 수정: ${doc.updatedBy || '-'} · ${doc.updatedAt}`));
        container.replaceChildren(bar, root);
    }

    return { render };
})();
