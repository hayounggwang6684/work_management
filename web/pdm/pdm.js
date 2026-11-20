// PDM 진입점.
//   본체: 문서관리 화면을 처음 열 때  await PdmLoader.load(); PDM.mount(containerEl, docType, navigate)  /  다시 열 때 PDM.show(docType)
//   흐름: 통합조회(기간별 주문 목록, 신규 = 판매용 주문)에서 주문을 고른다 (클릭 / 우클릭 / 더블클릭).
//         우클릭 메뉴에서 문서를 고르면 사이드바의 해당 종류 화면(서비스레포트·계측지·부품사진첩·세관서류·소견서)으로 옮겨 그 주문의 문서를 편집한다.
//         고른 주문이 없으면 종류 화면은 "주문을 선택해 주세요" 안내만 보여 준다.
// 의존: dom.js(h, DOC_LABEL, showContextMenu), projects_view.js, customs_view.js, order_dialog.js, sr_editor.js, mm_editor.js, album_editor.js, layout_editor.js, form_manager.js, standards_manager.js,
//       print_layout.js(PdmLayout), print_view.js(PrintView), eel
const PDM = (() => {
    const TYPE_LABEL = { ...DOC_LABEL, customs: '세관서류', opinion: '소견서' };
    let container;
    let navigate = null;     // 본체가 주는 화면 이동 함수 navigate(docType|null) — null = 통합조회. 없으면(단독 실행) 이 모듈이 직접 전환한다
    let filter = null;       // 지금 화면: null = 통합조회, 그 외 사이드바 종류 (service_report / measurement / photo_album / customs / opinion)
    let selected = null;     // 고른 주문(통합조회 목록의 행). 종류 화면은 이 주문의 문서를 다룬다
    let pending = null;      // 우클릭 메뉴에서 고른 동작 {type, create:true} | {type, doc:{id, docType}} — 종류 화면이 열릴 때 한 번 실행
    let mode = 'home';       // 'home' 통합조회 | 'page' 종류 화면(안내/목록) | 'customs' 세관서류 | 'editor' 편집/설정 화면 (저장하지 않은 내용이 있을 수 있음)

    const goTo = type => (navigate ? navigate(type) : show(type));
    const goList = () => goTo(null);
    function goToType(type, action = null) { pending = action ? { type, ...action } : null; goTo(type); }
    const render = () => (filter === null ? showHome() : showTypePage());

    // ── 통합조회 ─────────────────────────────────────────────────────────
    async function showHome() {
        mode = 'home';
        pending = null;
        EditorBar.clearActive();
        const info = await eel.pdm_ping()();
        if (info.authError) { container.replaceChildren(h('p', { class: 'text-slate-500 p-4' }, info.message)); return; }
        const projects = ProjectsView.create({ onMenu: showOrderMenu, onOpen: openDefault, onNew: newStandaloneOrder, onSelect: p => { selected = p; }, selected });
        const manage = screen => () => { mode = 'editor'; screen.render(container, showHome, info.canManage); };
        container.replaceChildren(
            h('div', { class: 'bg-white rounded-lg shadow p-4 w-full space-y-3' },
                h('div', { class: 'flex items-baseline justify-between' },
                    h('h1', { class: 'text-xl font-bold' }, '통합조회'),
                    h('div', { class: 'flex items-center gap-3 text-sm' },
                        h('span', { class: 'text-slate-500' }, '작성자: ' + (info.user || '-')),
                        h('button', { class: 'px-3 py-1 rounded bg-slate-100 hover:bg-slate-200', onclick: manage(LayoutEditor) }, '⚙ 출력 양식 설정'),
                        h('button', { class: 'px-3 py-1 rounded bg-slate-100 hover:bg-slate-200', onclick: manage(FormManager) }, '📋 양식 관리'),
                        h('button', { class: 'px-3 py-1 rounded bg-slate-100 hover:bg-slate-200', onclick: manage(StandardsManager) }, '📐 계측 표준값'))),
                projects.el));
    }

    // ★ 우클릭 메뉴: 서비스레포트 ▸ / 계측지 ▸ / 부품사진첩 ▸ 각각 [＋ 새 문서 / 작성된 파일들…], 세관서류, 소견서.
    //   고르면 그 종류의 사이드바 화면으로 옮겨 편집한다. order: 목록 행 (판매용이면 order.standalone — 수정/삭제 메뉴가 추가된다)
    async function showOrderMenu(x, y, contractNumber, order = null) {
        if (!contractNumber) return;
        if (order) selected = order;
        const r = await eel.pdm_list_documents(contractNumber)();
        if (r.authError) { alert(r.message); return; }
        const docs = r.success ? r.documents : [];
        const group = type => {
            const mine = docs.filter(d => d.docType === type);
            return {
                label: DOC_LABEL[type],
                children: [
                    { label: '＋ 새 문서', onClick: () => goToType(type, { create: true }) },
                    ...(mine.length ? [{ separator: true }] : []),
                    ...mine.map(d => ({
                        label: (d.title || '(이름 없음)') + (d.isPrivate ? '  🔒 임시' : ''),
                        title: `${d.updatedBy} · ${d.updatedAt.slice(0, 16)}`,
                        onClick: () => goToType(type, { doc: { id: d.id, docType: d.docType } }),
                    })),
                ],
            };
        };
        showContextMenu(x, y, [group('service_report'), group('measurement'), group('photo_album'),
            { separator: true }, { label: '세관서류', onClick: () => goToType('customs') }, { label: '소견서', onClick: () => goToType('opinion') },
            ...(order && order.standalone ? [{ separator: true }, { label: '판매 주문 수정…', onClick: () => editStandaloneOrder(order) },
                { label: '판매 주문 삭제…', onClick: () => deleteStandaloneOrder(order, docs.length) }] : [])]);
    }

    // 더블클릭: 서비스레포트 화면으로 — 작성된 것이 있으면 가장 최근 것을 바로 연다.
    async function openDefault(contractNumber) {
        const r = await eel.pdm_list_documents(contractNumber, 'service_report')();
        goToType('service_report', r.success && r.documents.length ? { doc: { id: r.documents[0].id, docType: 'service_report' } } : null);
    }

    // ── 사이드바 종류 화면 (고른 주문 기준) ───────────────────────────────
    const card = (...children) => h('div', { class: 'bg-white rounded-lg shadow p-4 w-full max-w-4xl space-y-3' }, ...children);

    function orderHeader(title) {
        return h('div', { class: 'flex items-center justify-between' },
            h('div', {},
                h('h1', { class: 'text-xl font-bold' }, title),
                h('p', { class: 'text-sm text-slate-600' }, [selected.contractNumber, selected.shipName, selected.company].filter(Boolean).join(' · '))),
            h('button', { class: 'px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm', onclick: goList }, '← 통합조회'));
    }

    async function showTypePage() {
        EditorBar.clearActive();
        const action = pending && pending.type === filter ? pending : null;
        pending = null;
        mode = 'page';
        if (!selected) {
            container.replaceChildren(h('div', { class: 'bg-white rounded-lg shadow p-10 text-center space-y-3 w-full max-w-4xl' },
                h('h1', { class: 'text-xl font-bold' }, TYPE_LABEL[filter]),
                h('p', { class: 'text-slate-600' }, '통합조회에서 주문을 선택해 주세요.'),
                h('button', { class: 'px-4 py-2 rounded bg-blue-600 text-white', onclick: goList }, '통합조회로 이동')));
            return;
        }
        if (filter === 'customs' || filter === 'opinion') {        // PDF 를 올려 보관하는 화면 (소견서는 엑셀에서 작성해 PDF 로 올린다)
            mode = 'customs';
            CustomsView.render(container, selected, goList, filter === 'opinion' ? CustomsView.OPINION : CustomsView.CUSTOMS);
            return;
        }
        if (action && action.create) return createAndOpen(filter, selected.contractNumber);
        if (action && action.doc) return openEditor(action.doc);
        return showDocList();
    }

    async function showDocList() {
        const contract = selected.contractNumber;
        const r = await eel.pdm_list_documents(contract, filter)();
        if (r.authError) { container.replaceChildren(h('p', { class: 'text-slate-500 p-4' }, r.message)); return; }
        const docs = r.success ? r.documents : [];
        const msg = h('p', { class: 'text-sm text-slate-500 min-h-[1.25rem]' });
        const say = (text, bad = false) => { msg.textContent = text; msg.className = 'text-sm min-h-[1.25rem] ' + (bad ? 'text-red-600' : 'text-slate-500'); };
        const upload = () => PdfUpload.pick({ docType: filter, contractNumber: contract, say, onCreated: openEditor });
        container.replaceChildren(card(
            orderHeader(TYPE_LABEL[filter]),
            h('div', { class: 'flex justify-end gap-2' },
                h('button', { class: 'px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm', title: '이 앱에서 만든 PDF 를 읽어 새 문서로 만듭니다', onclick: upload }, '📤 PDF 업로드'),
                h('button', { class: 'px-3 py-1 rounded bg-blue-600 text-white text-sm', onclick: () => createAndOpen(filter, contract) }, '＋ 새 문서')),
            msg,
            docs.length
                ? h('ul', { class: 'divide-y' }, docs.map(d => h('li', { class: 'flex items-center gap-3 py-2 text-sm' },
                    h('span', { class: 'flex-1 font-medium break-all' }, (d.title || '(이름 없음)') + (d.isPrivate ? '  🔒 임시' : '')),
                    h('span', { class: 'text-xs text-slate-500' }, `${d.updatedBy} · ${d.updatedAt.slice(0, 16)}`),
                    h('button', { class: 'px-3 py-1 rounded bg-slate-100 hover:bg-slate-200', onclick: () => openEditor(d) }, '열기'))))
                : h('p', { class: 'text-sm text-slate-400 py-6 text-center' }, '작성된 문서가 없습니다. [＋ 새 문서]로 시작하세요.')));
    }

    async function createAndOpen(docType, contractNumber) {
        const r = await eel.pdm_create_document(docType, contractNumber)();
        if (r.success) openEditor(r.document);
        else { alert(r.message); render(); }
    }

    const EDITORS = { service_report: () => SrEditor, measurement: () => MmEditor, photo_album: () => AlbumEditor };

    function openEditor(doc) {
        mode = 'editor';
        EDITORS[doc.docType]().render(container, doc.id, render);        // 돌아오면 지금 화면(종류 화면 또는 통합조회)을 다시 그린다
    }

    // 판매용 주문 수정 (계약번호를 바꾸면 문서도 따라 옮겨진다) / 삭제 (문서·사진 포함, 되돌릴 수 없음)
    const forget = order => { if (selected && selected.contractNumber === order.contractNumber) selected = null; };

    function editStandaloneOrder(order) {
        OrderDialog.open(async v => {
            const r = await eel.pdm_update_standalone_order(order.contractNumber, v.contractNumber, v.company, v.shipName, v.engineModel)();
            if (r.success) { forget(order); showHome(); }
            return r;
        }, { contractNumber: order.contractNumber, company: order.company, shipName: order.shipName, engineModel: order.engineModel });
    }

    async function deleteStandaloneOrder(order, docCount) {
        const detail = docCount ? `이 주문의 문서 ${docCount}건(사진 포함)이 함께 삭제되며 되돌릴 수 없습니다.` : '이 주문에는 작성된 문서가 없습니다.';
        if (await showChoice('판매 주문 삭제', `${order.contractNumber} (${order.shipName}) 판매 주문을 삭제할까요? ${detail}`,
            [{ label: '삭제', value: true, primary: true }, { label: '취소', value: false }]) !== true) return;
        const r = await eel.pdm_delete_standalone_order(order.contractNumber)();
        if (r.success) { forget(order); showHome(); } else alert(r.message);
    }

    // 신규: 판매용 주문(작업현황에 공사가 없는 건)을 등록하고 표지 포함 부품사진첩을 연다
    function newStandaloneOrder() {
        OrderDialog.open(async v => {
            const r = await eel.pdm_create_standalone_order(v.contractNumber, v.company, v.shipName, v.engineModel)();
            if (r.success) { ProjectsView.markQueried(); openEditor(r.document); }
            return r;
        });
    }

    async function mount(el, docType = null, navigateFn = null) {
        container = el;
        filter = docType;
        navigate = navigateFn;
        await PdmLayout.load();       // 공유 출력 양식 설정(사진 채움 방식 등)을 화면에도 반영
        await render();
        // ?print=<문서 id> : 편집 화면 없이 바로 출력 미리보기 (디버깅/헤드리스 PDF 출력 검증용)
        const printId = Number(new URLSearchParams(location.search).get('print'));
        if (printId) PrintView.open(printId);
    }

    // 화면을 다시 열 때(사이드바 클릭): 해당 화면을 최신으로 그린다. 편집 중이던 화면은 같은 화면을 다시 눌렀을 때만 그대로 둔다.
    // 다른 종류로 옮기면 편집 중이어도 닫힌다 — 본체가 미리 확인을 받는다 (pdmConfirmFilterChange)
    function show(docType = null) {
        const changed = docType !== filter;
        filter = docType;
        if (mode === 'editor' && !changed && !pending) return undefined;
        return render();
    }
    const isEditing = () => mode === 'editor';
    const currentFilter = () => filter;

    // 관리자 설정 허브 (본체 관리자 페이지의 '레포트 설정' 탭): 출력 양식 설정 / 양식 관리 / 계측 표준값. 일반 화면(홈)과 별개로 동작한다.
    async function mountAdmin(el) {
        const info = await eel.pdm_ping()();
        if (info.authError) { el.replaceChildren(h('p', { class: 'text-slate-500 p-4' }, info.message)); return; }
        const hub = () => {
            const open = (screen) => () => screen.render(el, hub, info.canManage);
            const card = (title, text, onclick) => h('button', { class: 'text-left bg-white rounded-lg shadow p-4 hover:bg-sky-50 w-72', onclick },
                h('div', { class: 'font-bold' }, title), h('div', { class: 'text-xs text-slate-500 mt-1' }, text));
            el.replaceChildren(h('div', { class: 'bg-white rounded-lg shadow-md p-6 space-y-4' },
                h('h2', { class: 'text-xl font-bold' }, '레포트 설정'),
                h('p', { class: 'text-sm text-slate-500' }, '서비스레포트 · 계측지 · 부품사진첩에 공통으로 적용되는 설정입니다 (관리자 전용).'),
                h('div', { class: 'flex flex-wrap gap-4' },
                    card('⚙ 출력 양식 설정', '로고, 회사 정보, 직인, 사진 채움 방식', open(LayoutEditor)),
                    card('📋 양식 관리', '계측 양식 추가/수정/복제, 미리보기', open(FormManager)),
                    card('📐 계측 표준값', '엔진별 표준값 목록 · 엑셀 가져오기', open(StandardsManager)))));
        };
        hub();
    }

    // 본체 상단 💾 저장 버튼: 열려 있는 문서를 저장 → {ok, message}
    const saveCurrent = () => EditorBar.saveActive();

    return { mount, mountAdmin, show, isEditing, currentFilter, showOrderMenu, saveCurrent };
})();
