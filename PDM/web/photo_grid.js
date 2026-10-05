// 사진 그리드 — 한 페이지 2열×3행(6칸), 칸마다 캡션. 서비스레포트 사진 페이지의 화면 편집용.
// 입력: ① 파일 드래그앤드롭 ② 우클릭 메뉴 [입력] ③ 빈칸 더블클릭 → 모두 파일 선택/드롭 후 같은 경로로 저장.
// 우클릭 메뉴: 입력 / 수정 / 제거 / 새 항목. 사진 더블클릭 = 수정(photo_editor.js).
// 의존: dom.js(h, showContextMenu, showChoice, blobToDataURL), photo_editor.js, eel
const PhotoGrid = (() => {
    const PER_PAGE = 6;
    const UPLOAD_EDGE = 1600;   // 전송 전 긴 변 축소 (서버도 동일 상한으로 다시 처리)

    // 칸 밖에 파일을 떨어뜨리면 브라우저가 앱을 떠나 이미지를 열어버리므로 전역에서 막는다.
    for (const ev of ['dragover', 'drop']) {
        window.addEventListener(ev, e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
    }

    // 큰 사진은 전송 전에 줄인다 (EXIF 회전은 브라우저가 적용). 실패하면 원본을 그대로 보내 서버가 판정.
    async function toUploadData(file) {
        try {
            const bmp = await createImageBitmap(file);
            const scale = Math.min(1, UPLOAD_EDGE / Math.max(bmp.width, bmp.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(bmp.width * scale);
            canvas.height = Math.round(bmp.height * scale);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
            bmp.close();
            const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
            return blobToDataURL(blob);
        } catch (_) {
            return blobToDataURL(file);
        }
    }

    // options: {docId, pageTitles, onTouched(updatedAt)}
    function create(options) {
        const { docId, onTouched } = options;
        const pageTitles = { ...(options.pageTitles || {}) };
        const bySlot = new Map();       // slotIndex → {id, caption, thumb, ...}
        const thumbs = new Map();       // photoId → thumb data URI (캐시)
        const status = h('span', { class: 'text-sm text-slate-500' });
        const pagesEl = h('div', { class: 'space-y-6' });
        const root = h('div', {}, h('div', { class: 'mb-2 h-5' }, status), pagesEl);
        let busy = false;

        const say = msg => { status.textContent = msg; };
        const touched = r => { if (r.updatedAt && onTouched) onTouched(r.updatedAt); };

        async function reload() {
            const r = await eel.pdm_list_photos(docId, [...thumbs.keys()])();
            if (!r.success) { say('⚠ ' + r.message); return; }
            for (const p of r.photos) if (p.thumb) thumbs.set(p.id, p.thumb);
            bySlot.clear();
            for (const p of r.photos) bySlot.set(p.slotIndex, { ...p, thumb: thumbs.get(p.id) });
            render();
        }

        const lastSlot = () => Math.max(-1, ...bySlot.keys());
        const nextEmpty = from => { let i = from; while (bySlot.has(i)) i++; return i; };

        async function addFiles(startSlot, files) {
            const images = [...files].filter(f => f.type.startsWith('image/'));
            if (!images.length) { say('이미지 파일만 입력할 수 있습니다.'); return; }
            if (busy) return;
            busy = true;
            let ok = 0, last = '';
            try {
                let slot = startSlot;
                for (const file of images) {
                    slot = nextEmpty(slot);
                    say(`입력 중… ${ok + 1}/${images.length}`);
                    const r = await eel.pdm_add_photo(docId, slot, await toUploadData(file))();
                    if (r.success) { ok++; bySlot.set(slot, r.photo); thumbs.set(r.photo.id, r.photo.thumb); touched(r); }
                    else last = r.message;
                }
            } finally { busy = false; }
            say(last ? `⚠ ${ok}장 입력, 실패: ${last}` : `${ok}장 입력됨`);
            render();
        }

        function pickFiles(slot) {
            const input = h('input', { type: 'file', accept: 'image/*', multiple: true });
            input.addEventListener('change', () => addFiles(slot, input.files));
            input.click();
        }

        async function removeAt(slot) {
            const hasLater = lastSlot() > slot;
            const choice = await showChoice('사진 제거',
                hasLater ? '뒤에 있는 사진을 앞으로 당길까요, 빈칸으로 둘까요?' : '이 사진을 제거할까요?',
                hasLater
                    ? [{ label: '뒤 사진 당기기', value: 'pull', primary: true }, { label: '빈칸 유지', value: 'keep' }, { label: '취소', value: null }]
                    : [{ label: '제거', value: 'keep', primary: true }, { label: '취소', value: null }]);
            if (!choice) return;
            const r = await eel.pdm_remove_photo(docId, slot, choice === 'pull')();
            if (!r.success) { say('⚠ ' + r.message); return; }
            touched(r);
            await reload();
            say('제거됨');
        }

        async function insertBlank(slot) {
            const r = await eel.pdm_insert_blank_slot(docId, slot)();
            if (!r.success) { say('⚠ ' + r.message); return; }
            touched(r);
            await reload();
            say('빈 칸을 추가했습니다');
        }

        // 편집기에서 저장/복원하면 썸네일이 바뀌므로 캐시를 비우고 다시 불러온다.
        function editPhoto(photo) {
            PhotoEditor.open({
                docId, photo,
                onSaved: async r => { touched(r); thumbs.delete(photo.id); await reload(); say('사진을 수정했습니다'); },
            });
        }

        function menuFor(slot, e) {
            e.preventDefault();
            const photo = bySlot.get(slot);
            showContextMenu(e.clientX, e.clientY, [
                { label: '입력', disabled: !!photo, onClick: () => pickFiles(slot) },
                { label: '수정', disabled: !photo, onClick: () => editPhoto(photo) },
                { label: '제거', disabled: !photo, onClick: () => removeAt(slot) },
                { label: '새 항목', disabled: !photo && lastSlot() < slot, onClick: () => insertBlank(slot) },
            ]);
        }

        function slotEl(slot) {
            const photo = bySlot.get(slot);
            const frame = h('div', {
                class: 'aspect-[4/3] border-2 rounded flex items-center justify-center overflow-hidden bg-slate-50 select-none ' +
                       (photo ? 'border-slate-300' : 'border-dashed border-slate-300 text-slate-400 text-xs'),
                title: photo ? '더블클릭: 수정 · 우클릭: 수정/제거/새 항목' : '더블클릭 또는 파일을 끌어다 놓기 · 우클릭: 입력',
            }, photo
                ? h('img', { src: photo.thumb, class: 'max-w-full max-h-full object-contain', draggable: 'false' })
                : h('span', {}, '더블클릭 / 드래그 / 우클릭'));
            const caption = h('input', {
                class: 'mt-1 w-full border border-slate-300 rounded px-2 py-1 text-xs text-center disabled:bg-slate-100',
                placeholder: photo ? '캡션' : '', value: photo?.caption || '', disabled: !photo, maxlength: 200,
            });
            caption.addEventListener('change', async () => {
                const r = await eel.pdm_set_photo_caption(docId, photo.id, caption.value.trim())();
                if (r.success) { photo.caption = caption.value.trim(); touched(r); } else say('⚠ ' + r.message);
            });
            const cell = h('div', {}, frame, caption);
            cell.addEventListener('contextmenu', e => menuFor(slot, e));
            frame.addEventListener('dblclick', () => (photo ? editPhoto(photo) : pickFiles(slot)));
            frame.addEventListener('dragover', e => { e.preventDefault(); frame.classList.add('ring-2', 'ring-blue-500'); });
            frame.addEventListener('dragleave', () => frame.classList.remove('ring-2', 'ring-blue-500'));
            frame.addEventListener('drop', e => {
                e.preventDefault();
                frame.classList.remove('ring-2', 'ring-blue-500');
                addFiles(slot, e.dataTransfer.files);
            });
            return cell;
        }

        function pageEl(page) {
            const title = h('input', {
                class: 'w-full border border-slate-400 bg-sky-50 rounded px-2 py-1 text-sm text-center',
                placeholder: `페이지 ${page + 1} 제목 (예: NO.1 엔진 정비)`, value: pageTitles[page] || '',
            });
            title.addEventListener('input', () => { pageTitles[page] = title.value; });
            const cells = [];
            for (let i = 0; i < PER_PAGE; i++) cells.push(slotEl(page * PER_PAGE + i));
            return h('div', { class: 'border border-slate-200 rounded p-3' },
                h('div', { class: 'text-xs text-slate-400 mb-1' }, `사진 페이지 ${page + 1}`),
                title, h('div', { class: 'grid grid-cols-2 gap-3 mt-2' }, cells));
        }

        function render() {
            const pages = Math.floor((lastSlot() + 1) / PER_PAGE) + 1;   // 마지막 페이지가 가득 차면 새 페이지 하나 더
            pagesEl.replaceChildren(...Array.from({ length: pages }, (_, p) => pageEl(p)));
        }

        reload();
        return {
            el: root,
            // 비어 있지 않은 페이지 제목만 (header.pageTitles 로 저장)
            getPageTitles: () => Object.fromEntries(Object.entries(pageTitles).filter(([, v]) => v.trim())),
            reload,
        };
    }

    return { create };
})();
