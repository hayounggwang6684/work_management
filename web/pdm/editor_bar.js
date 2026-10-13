// 편집기 공용 상단 바 — [← 목록] 파일 이름 [임시 저장] [저장] [인쇄 / PDF] [엑셀] 상태 · 최종 수정.
// 새 문서는 작성자 전용 '임시' 문서로 시작한다: [임시 저장]은 계속 작성자에게만 보이게 저장하고, [저장]하면 다른 사용자에게도 공개된다.
// 이미 공개된 문서에는 [임시 저장]이 없고 [저장]만 있다. 인쇄/엑셀은 지금 상태(임시면 임시로)를 저장한 뒤 실행한다.
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

        // asDraft: 임시 저장 (작성자 전용 유지). 아니면 일반 저장 — 임시 문서였다면 이때 공개된다.
        async function save(asDraft = false) {
            const header = getHeader();
            const title = titleInput.value.trim() || current.title;
            const r = await eel.pdm_save_document(current.id, current.updatedAt, title, header, asDraft)();
            if (r.success) {
                current = { ...current, title, header, updatedAt: r.updatedAt, isPrivate: r.isPrivate };
                titleInput.value = title;
                status.textContent = (asDraft && r.isPrivate ? '임시 저장됨 (작성자만 볼 수 있음) ' : '저장됨 ') + new Date().toLocaleTimeString();
                paintPrivacy();
                return true;
            }
            status.textContent = r.conflict ? '⚠ ' + r.message + ' — 새로고침 후 다시 시도하세요' : '⚠ ' + r.message;
            return false;
        }

        // 인쇄는 DB 에 저장된 내용을 쓰므로 먼저 저장한다 (충돌 등으로 저장 실패하면 인쇄하지 않음).
        const persist = () => save(!!current.isPrivate);        // 임시 문서는 임시로, 공개 문서는 그대로 저장
        const print = async () => { if (await persist()) PrintView.open(current.id); };

        // 엑셀(.xlsx)로 내보내기 — 저장된 내용을 쓰므로 먼저 저장한다. 브라우저 다운로드로 파일을 받는다.
        const toExcel = async () => {
            if (!await persist()) return;
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

        const draftBtn = h('button', { class: 'px-3 py-1 rounded bg-amber-500 text-white', title: '다른 사용자에게는 보이지 않게 작성자만 볼 수 있도록 저장합니다', onclick: () => save(true) }, '임시 저장');
        const saveBtn = h('button', { class: 'px-4 py-1 rounded bg-blue-600 text-white', onclick: () => save(false) }, '저장');
        const badge = h('span', { class: 'px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-xs whitespace-nowrap', title: '[저장]을 누르면 다른 사용자에게도 공개됩니다' }, '🔒 임시 (작성자만)');
        const paintPrivacy = () => {
            draftBtn.classList.toggle('hidden', !current.isPrivate);
            badge.classList.toggle('hidden', !current.isPrivate);
            saveBtn.textContent = current.isPrivate ? '저장 (공개)' : '저장';
            saveBtn.title = current.isPrivate ? '저장하면 다른 사용자에게도 보입니다' : '';
        };

        const el = h('div', { class: `${maxWidthClass} mx-auto mb-3 flex items-center gap-3` },
            h('button', { class: 'px-3 py-1 rounded bg-slate-200', onclick: onBack }, '← 목록'),
            titleInput,
            badge, draftBtn, saveBtn,
            h('button', { class: 'px-4 py-1 rounded bg-emerald-600 text-white', onclick: print }, '인쇄 / PDF'),
            h('button', { class: 'px-4 py-1 rounded bg-green-800 text-white', title: '엑셀(.xlsx) 파일로 받기', onclick: toExcel }, '엑셀'),
            status,
            h('span', { class: 'ml-auto text-xs text-slate-400' }, `최종 수정: ${doc.updatedBy || '-'} · ${doc.updatedAt}`));

        paintPrivacy();
        return { el, save, current: () => current, touch: ts => { current = { ...current, updatedAt: ts }; } };
    }

    return { create };
})();
