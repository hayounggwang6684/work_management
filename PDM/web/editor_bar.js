// 편집기 공용 상단 바 — [← 목록] 파일 이름 [저장] [인쇄 / PDF] 상태 · 최종 수정.
// 문서(id, updatedAt, title…)는 이 바가 들고 있고, 저장/인쇄는 getHeader() 가 주는 헤더로 한다.
// 사진처럼 본문 저장과 별개로 서버에 반영되는 변경은 touch(ts) 로 알려 낙관적 잠금 충돌을 막는다.
// 의존: dom.js(h), print_view.js(PrintView), eel
const EditorBar = (() => {
    // options: {doc, onBack, getHeader() → header, maxWidthClass}
    function create({ doc, onBack, getHeader, maxWidthClass = 'max-w-3xl' }) {
        let current = doc;
        const status = h('span', { class: 'text-sm text-slate-500' });
        const titleInput = h('input', {
            class: 'flex-1 min-w-0 px-2 py-1 border border-slate-300 rounded bg-white',
            value: doc.title, title: '파일 이름',
        });

        async function save() {
            const header = getHeader();
            const title = titleInput.value.trim() || current.title;
            const r = await eel.pdm_save_document(current.id, current.updatedAt, title, header)();
            if (r.success) {
                current = { ...current, title, header, updatedAt: r.updatedAt };
                titleInput.value = title;
                status.textContent = '저장됨 ' + new Date().toLocaleTimeString();
                return true;
            }
            status.textContent = r.conflict ? '⚠ ' + r.message + ' — 새로고침 후 다시 시도하세요' : '⚠ ' + r.message;
            return false;
        }

        // 인쇄는 DB 에 저장된 내용을 쓰므로 먼저 저장한다 (충돌 등으로 저장 실패하면 인쇄하지 않음).
        const print = async () => { if (await save()) PrintView.open(current.id); };

        // 엑셀(.xlsx)로 내보내기 — 저장된 내용을 쓰므로 먼저 저장한다. 브라우저 다운로드로 파일을 받는다.
        const toExcel = async () => {
            if (!await save()) return;
            status.textContent = '엑셀 만드는 중…';
            let r;
            try { r = await eel.pdm_export_excel(current.id)(); } catch (e) { r = { success: false, message: '서버와 통신하지 못했습니다.' }; }
            if (!r.success) { status.textContent = '⚠ ' + r.message; return; }
            const bytes = Uint8Array.from(atob(r.data), c => c.charCodeAt(0));
            const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
            const link = h('a', { href: url, download: r.filename });
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
            status.textContent = '엑셀 파일을 받았습니다: ' + r.filename;
        };

        const el = h('div', { class: `${maxWidthClass} mx-auto mb-3 flex items-center gap-3` },
            h('button', { class: 'px-3 py-1 rounded bg-slate-200', onclick: onBack }, '← 목록'),
            titleInput,
            h('button', { class: 'px-4 py-1 rounded bg-blue-600 text-white', onclick: save }, '저장'),
            h('button', { class: 'px-4 py-1 rounded bg-emerald-600 text-white', onclick: print }, '인쇄 / PDF'),
            h('button', { class: 'px-4 py-1 rounded bg-green-800 text-white', title: '엑셀(.xlsx) 파일로 받기', onclick: toExcel }, '엑셀'),
            status,
            h('span', { class: 'ml-auto text-xs text-slate-400' }, `최종 수정: ${doc.updatedBy || '-'} · ${doc.updatedAt}`));

        return { el, save, current: () => current, touch: ts => { current = { ...current, updatedAt: ts }; } };
    }

    return { create };
})();
