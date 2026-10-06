// PDM 진입점. 통합 시: PDM.mount(container) 1회 + 작업목록 행 우클릭에서 PDM.showOrderMenu(x, y, 계약번호) 호출.
// 의존: dom.js(h, DOC_LABEL, showContextMenu), sr_editor.js(SrEditor), mm_editor.js(MmEditor), layout_editor.js, form_manager.js, print_layout.js(PdmLayout), eel
const PDM = (() => {
    let container;

    async function showHome() {
        const info = await eel.pdm_ping()();
        const results = h('div', { class: 'mt-3 space-y-1' });
        const docs = h('div', { class: 'mt-6' });

        const search = async () => {
            const q = input.value.trim();
            if (!q) { results.replaceChildren(); return; }
            const r = await eel.pdm_search_orders(q)();
            const orders = r.orders || [];
            results.replaceChildren(...(orders.length
                ? orders.map(orderRow)
                : [h('p', { class: 'text-sm text-slate-500' }, '검색 결과 없음')]));
        };
        const input = h('input', {
            class: 'flex-1 border border-slate-300 rounded px-3 py-2',
            placeholder: '계약번호 / 선박명 / 업체명 검색 (예: SH-2026-057-T, GL2030)',
            onkeydown: e => { if (e.key === 'Enter') search(); },
        });

        container.replaceChildren(
            h('div', { class: 'bg-white rounded-lg shadow p-4 max-w-4xl mx-auto' },
                h('div', { class: 'flex items-baseline justify-between' },
                    h('h1', { class: 'text-xl font-bold' }, 'PDM — 문서 관리'),
                    h('span', { class: 'text-sm text-slate-500' }, '작성자: ' + (info.user || '-'))),
                h('div', { class: 'flex gap-2 mt-2 text-sm' },
                    h('button', { class: 'px-3 py-1 rounded bg-slate-100 hover:bg-slate-200', onclick: () => LayoutEditor.render(container, showHome, info.canManage) }, '⚙ 출력 양식 설정'),
                    h('button', { class: 'px-3 py-1 rounded bg-slate-100 hover:bg-slate-200', onclick: () => FormManager.render(container, showHome, info.canManage) }, '📋 양식 관리')),
                h('div', { class: 'flex gap-2 mt-3' }, input,
                    h('button', { class: 'px-4 py-2 bg-blue-600 text-white rounded', onclick: search }, '검색')),
                results, docs));
        loadDocs(docs);
    }

    // 개발용 작업목록 대역 — 본체 작업목록 행과 같은 방식(우클릭)으로 메뉴를 띄운다.
    function orderRow(o) {
        const row = h('div', { class: 'flex items-center gap-3 border rounded px-3 py-2 text-sm cursor-context-menu' },
            h('span', { class: 'font-mono w-36' }, o.contractNumber),
            h('span', { class: 'w-40 truncate' }, o.shipName),
            h('span', { class: 'flex-1 truncate text-slate-500' }, `${o.company} · ${o.engineModel}`),
            h('span', { class: 'text-xs text-slate-400' }, '우클릭 ▸'));
        row.addEventListener('contextmenu', e => {
            e.preventDefault();
            showOrderMenu(e.clientX, e.clientY, o.contractNumber);
        });
        return row;
    }

    // ★ 외부 진입점: 작업목록 행 우클릭 → PDM.showOrderMenu(x, y, 계약번호)
    // 메뉴: 서비스레포트 ▸ [＋ 새 문서 / 작성된 파일들…], 계측지 ▸ [＋ 새 문서 / 작성된 파일들…]
    async function showOrderMenu(x, y, contractNumber) {
        if (!contractNumber) return;
        const r = await eel.pdm_list_documents(contractNumber)();
        const docs = r.success ? r.documents : [];
        const group = type => {
            const mine = docs.filter(d => d.docType === type);
            return {
                label: DOC_LABEL[type],
                children: [
                    { label: '＋ 새 문서', onClick: () => createAndOpen(type, contractNumber) },
                    ...(mine.length ? [{ separator: true }] : []),
                    ...mine.map(d => ({
                        label: d.title || '(이름 없음)',
                        title: `${d.updatedBy} · ${d.updatedAt.slice(0, 16)}`,
                        onClick: () => openEditor(d),
                    })),
                ],
            };
        };
        showContextMenu(x, y, [group('service_report'), group('measurement')]);
    }

    async function createAndOpen(docType, contractNumber) {
        const r = await eel.pdm_create_document(docType, contractNumber)();
        if (r.success) openEditor(r.document);
        else alert(r.message);
    }

    async function loadDocs(target) {
        const r = await eel.pdm_list_documents()();
        const list = r.documents || [];
        target.replaceChildren(
            h('h2', { class: 'font-bold mb-2' }, `작성된 문서 (${list.length})`),
            ...list.map(d => h('div', {
                class: 'flex items-center gap-3 border-b px-2 py-2 text-sm cursor-pointer hover:bg-slate-50',
                ondblclick: () => openEditor(d),
            },
                h('span', { class: 'w-28' }, DOC_LABEL[d.docType] || d.docType),
                h('span', { class: 'flex-1' }, d.title),
                h('span', { class: 'text-slate-500' }, `${d.updatedBy} · ${d.updatedAt.slice(0, 16)}`),
                h('button', { class: 'px-2 py-0.5 bg-slate-200 rounded', onclick: () => openEditor(d) }, '열기'))),
            ...(list.length ? [h('p', { class: 'text-xs text-slate-400 mt-1' }, '더블클릭 또는 [열기]')] : []));
    }

    function openEditor(doc) {
        (doc.docType === 'service_report' ? SrEditor : MmEditor).render(container, doc.id, showHome);
    }

    async function mount(el) {
        container = el;
        await PdmLayout.load();       // 공유 출력 양식 설정(사진 채움 방식 등)을 화면에도 반영
        await showHome();
        // ?print=<문서 id> : 편집 화면 없이 바로 출력 미리보기 (디버깅/헤드리스 PDF 출력 검증용)
        const printId = Number(new URLSearchParams(location.search).get('print'));
        if (printId) PrintView.open(printId);
    }
    return { mount, showOrderMenu };
})();

window.addEventListener('load', () => PDM.mount(document.getElementById('pdmRoot')));
