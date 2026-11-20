// 불러오기 창 — 편집 중인 문서에 다른 주문의 같은 종류 문서 내용(사진 포함)을 가져온다.
//   주문 정보(선박·엔진·주문번호·고객사 등)는 가져오지 않고 현재 문서의 것을 유지한다. 서버가 처리한다 (pdm_import_document).
//   계약번호 / 선박 / 파일 이름으로 찾아서 고르고, 덮어쓰기 확인을 한 번 받는다.
// 의존: dom.js(h, DOC_LABEL, showChoice), eel
const ImportDialog = (() => {
    // options: {doc: 현재 문서, getUpdatedAt(): 현재 편집기의 최종 수정 시각, onDone(): 가져온 뒤 편집기를 다시 그린다}
    function open({ doc, getUpdatedAt, onDone }) {
        const label = DOC_LABEL[doc.docType] || '문서';
        const list = h('ul', { class: 'divide-y max-h-80 overflow-y-auto border rounded' });
        const msg = h('p', { class: 'text-sm text-slate-500 min-h-[1.25rem]' });
        const input = h('input', { class: 'flex-1 border rounded px-2 py-1 text-sm', placeholder: '계약번호 / 선박 / 파일 이름' });
        let seq = 0;

        const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
        const onKey = e => { if (e.key === 'Escape') close(); };

        async function search() {
            const mine = ++seq;
            msg.textContent = '찾는 중…';
            const r = await eel.pdm_search_import_sources(doc.docType, input.value.trim(), doc.id)();
            if (mine !== seq) return;
            if (!r.success) { msg.textContent = '⚠ ' + r.message; list.replaceChildren(); return; }
            msg.textContent = r.documents.length ? `${r.documents.length}건 (최근 수정 순, 최대 50건)` : '불러올 수 있는 문서가 없습니다.';
            list.replaceChildren(...r.documents.map(d => h('li', {},
                h('button', { class: 'w-full text-left px-3 py-2 hover:bg-sky-50 text-sm', onclick: () => pick(d) },
                    h('div', { class: 'font-medium' }, d.title || '(이름 없음)', d.isPrivate ? h('span', { class: 'ml-1 text-xs text-amber-700' }, '🔒 임시') : ''),
                    h('div', { class: 'text-xs text-slate-500' }, `${d.contractNumber} · ${d.shipName || ''} · ${d.updatedBy} · ${d.updatedAt.slice(0, 16)}`)))));
        }

        async function pick(source) {
            const ok = await showChoice(`${label} 불러오기`,
                `"${source.title || source.contractNumber}" (${source.contractNumber}) 의 내용을 가져옵니다. 현재 문서의 내용과 사진이 바뀌며(주문 정보는 그대로), 저장하지 않은 변경은 사라집니다.`,
                [{ label: '불러오기', value: true, primary: true }, { label: '취소', value: false }]);
            if (ok !== true) return;
            msg.textContent = '불러오는 중…';
            const r = await eel.pdm_import_document(doc.id, getUpdatedAt(), source.id)();
            if (!r.success) { msg.textContent = '⚠ ' + r.message + (r.conflict ? ' — 편집기를 다시 열어 주세요.' : ''); return; }
            close();
            onDone(r.copiedPhotos);
        }

        let timer;
        input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
        const overlay = h('div', { class: 'fixed inset-0 z-[65] bg-black/40 flex items-center justify-center', onmousedown: e => { if (e.target === overlay) close(); } },
            h('div', { class: 'bg-white rounded-lg shadow-xl p-5 w-[34rem] max-w-[95vw] space-y-3' },
                h('h3', { class: 'font-bold text-lg' }, `다른 주문의 ${label} 불러오기`),
                h('p', { class: 'text-xs text-slate-500' }, '내용과 사진을 가져오고 선박·엔진·주문번호 같은 주문 정보는 가져오지 않습니다.'),
                h('div', { class: 'flex gap-2' }, input),
                msg, list,
                h('div', { class: 'flex justify-end' }, h('button', { class: 'px-3 py-1.5 rounded bg-slate-200', onclick: close }, '닫기'))));
        document.addEventListener('keydown', onKey);
        document.body.append(overlay);
        input.focus();
        search();
    }

    return { open };
})();
