// PDM 진입점.
//   본체: 레포트관리 탭을 처음 열 때  await PdmLoader.load(); PDM.mount(containerEl)  /  다시 열 때 PDM.show()
//   화면: 레포트관리(조회 버튼으로 기간별 주문 목록, 신규 = 판매용 주문) → 행 우클릭 메뉴 / 더블클릭 → 서비스레포트·계측지·부품사진첩 편집기
// 의존: dom.js(h, DOC_LABEL, showContextMenu), projects_view.js, order_dialog.js, sr_editor.js, mm_editor.js, album_editor.js, layout_editor.js, form_manager.js, standards_manager.js,
//       print_layout.js(PdmLayout), print_view.js(PrintView), eel
const PDM = (() => {
    let container;
    let atHome = false;      // 지금 화면이 레포트관리(홈)인가 — 탭을 다시 열 때 목록 갱신 여부 판단

    async function showHome() {
        atHome = true;
        const info = await eel.pdm_ping()();
        if (info.authError) { container.replaceChildren(h('p', { class: 'text-slate-500 p-4' }, info.message)); return; }
        const projects = ProjectsView.create({ onMenu: showOrderMenu, onOpen: openDefault, onNew: newStandaloneOrder });
        container.replaceChildren(
            h('div', { class: 'bg-white rounded-lg shadow p-4 mx-auto max-w-7xl space-y-3' },
                h('div', { class: 'flex items-baseline justify-between' },
                    h('h1', { class: 'text-xl font-bold' }, '레포트관리'),
                    h('div', { class: 'flex items-center gap-3 text-sm' },
                        h('span', { class: 'text-slate-500' }, '작성자: ' + (info.user || '-')),
                        h('button', { class: 'px-3 py-1 rounded bg-slate-100 hover:bg-slate-200', onclick: () => { atHome = false; LayoutEditor.render(container, showHome, info.canManage); } }, '⚙ 출력 양식 설정'),
                        h('button', { class: 'px-3 py-1 rounded bg-slate-100 hover:bg-slate-200', onclick: () => { atHome = false; FormManager.render(container, showHome, info.canManage); } }, '📋 양식 관리'),
                        h('button', { class: 'px-3 py-1 rounded bg-slate-100 hover:bg-slate-200', onclick: () => { atHome = false; StandardsManager.render(container, showHome, info.canManage); } }, '📐 계측 표준값'))),
                projects.el));
    }

    // ★ 우클릭 메뉴: PDM.showOrderMenu(x, y, 계약번호)
    // 서비스레포트 ▸ / 계측지 ▸ / 부품사진첩 ▸  각각 [＋ 새 문서 / 작성된 파일들…]
    // order: 목록 행(판매용이면 order.standalone — 수정/삭제 메뉴가 추가된다)
    async function showOrderMenu(x, y, contractNumber, order = null) {
        if (!contractNumber) return;
        const r = await eel.pdm_list_documents(contractNumber)();
        if (r.authError) { alert(r.message); return; }
        const docs = r.success ? r.documents : [];
        const group = type => {
            const mine = docs.filter(d => d.docType === type);
            return {
                label: DOC_LABEL[type],
                children: [
                    { label: '＋ 새 문서', onClick: () => createAndOpen(type, contractNumber) },
                    ...(mine.length ? [{ separator: true }] : []),
                    ...mine.map(d => ({
                        label: (d.title || '(이름 없음)') + (d.isPrivate ? '  🔒 임시' : ''),
                        title: `${d.updatedBy} · ${d.updatedAt.slice(0, 16)}`,
                        onClick: () => openEditor(d),
                    })),
                ],
            };
        };
        showContextMenu(x, y, [group('service_report'), group('measurement'), group('photo_album'),
            ...(order && order.standalone ? [{ separator: true }, { label: '판매 주문 수정…', onClick: () => editStandaloneOrder(order) },
                { label: '판매 주문 삭제…', onClick: () => deleteStandaloneOrder(order, docs.length) }] : [])]);
    }

    // 더블클릭: 작성된 서비스레포트가 있으면 가장 최근 것을 열고, 없으면 메뉴를 띄운다 (실수로 빈 문서가 생기지 않게).
    async function openDefault(contractNumber, x, y) {
        const r = await eel.pdm_list_documents(contractNumber, 'service_report')();
        if (r.success && r.documents.length) openEditor(r.documents[0]);
        else showOrderMenu(x, y, contractNumber);
    }

    async function createAndOpen(docType, contractNumber) {
        const r = await eel.pdm_create_document(docType, contractNumber)();
        if (r.success) openEditor(r.document);
        else alert(r.message);
    }

    const EDITORS = { service_report: () => SrEditor, measurement: () => MmEditor, photo_album: () => AlbumEditor };

    function openEditor(doc) {
        atHome = false;
        EDITORS[doc.docType]().render(container, doc.id, showHome);
    }

    // 판매용 주문 수정 (계약번호를 바꾸면 문서도 따라 옮겨진다) / 삭제 (문서·사진 포함, 되돌릴 수 없음)
    function editStandaloneOrder(order) {
        OrderDialog.open(async v => {
            const r = await eel.pdm_update_standalone_order(order.contractNumber, v.contractNumber, v.company, v.shipName, v.engineModel)();
            if (r.success) showHome();
            return r;
        }, { contractNumber: order.contractNumber, company: order.company, shipName: order.shipName, engineModel: order.engineModel });
    }

    async function deleteStandaloneOrder(order, docCount) {
        const detail = docCount ? `이 주문의 문서 ${docCount}건(사진 포함)이 함께 삭제되며 되돌릴 수 없습니다.` : '이 주문에는 작성된 문서가 없습니다.';
        if (await showChoice('판매 주문 삭제', `${order.contractNumber} (${order.shipName}) 판매 주문을 삭제할까요? ${detail}`,
            [{ label: '삭제', value: true, primary: true }, { label: '취소', value: false }]) !== true) return;
        const r = await eel.pdm_delete_standalone_order(order.contractNumber)();
        if (r.success) showHome(); else alert(r.message);
    }

    // 신규: 판매용 주문(작업현황에 공사가 없는 건)을 등록하고 표지 포함 부품사진첩을 연다
    function newStandaloneOrder() {
        OrderDialog.open(async v => {
            const r = await eel.pdm_create_standalone_order(v.contractNumber, v.company, v.shipName, v.engineModel)();
            if (r.success) { ProjectsView.markQueried(); openEditor(r.document); }
            return r;
        });
    }

    async function mount(el) {
        container = el;
        await PdmLayout.load();       // 공유 출력 양식 설정(사진 채움 방식 등)을 화면에도 반영
        await showHome();
        // ?print=<문서 id> : 편집 화면 없이 바로 출력 미리보기 (디버깅/헤드리스 PDF 출력 검증용)
        const printId = Number(new URLSearchParams(location.search).get('print'));
        if (printId) PrintView.open(printId);
    }

    // 탭을 다시 열 때: 목록을 최신(문서 건수 포함)으로 갱신한다. 편집 중이던 화면은 그대로 둔다.
    const show = () => (atHome ? showHome() : undefined);

    return { mount, show, showOrderMenu };
})();
