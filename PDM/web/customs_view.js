// 세관서류 / 소견서 화면 — 공사 하나의 PDF 를 올리고, 보고(인쇄)·다운로드·삭제한다.
//   세관서류 = 승선신고서 / 적재 / 하선 / 선용품 적재.  소견서 = 엑셀에서 작성해 PDF 로 올리고, 올릴 때 국문/영문을 고른다.
//   PDF 는 서버(pdm.db 와 같은 폴더의 customs\<연도>\<계약번호>)에 저장된다. 승선신고서는 올릴 때 PDF 에서 만료일을 읽어 채운다 (고칠 수 있다).
//   삭제는 올린 사람과 관리자만 (서버가 판정 — 버튼은 canDelete 인 것만 보인다).
// 의존: dom.js(h, showChoice, blobToDataURL), eel
const CustomsView = (() => {
    const CUSTOMS = { title: '세관서류', kinds: [['boarding', '승선신고서'], ['loading', '적재'], ['unloading', '하선'], ['ship_supplies', '선용품 적재']] };
    const OPINION = { title: '소견서', kinds: [['opinion', '소견서']] };
    const MAX_BYTES = 30 * 1024 * 1024;
    const BTN = 'px-2 py-1 rounded text-xs bg-slate-100 hover:bg-slate-200 whitespace-nowrap';

    const sizeText = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB');
    const base64Of = async file => (await blobToDataURL(file)).split(',')[1] || '';
    const toBlob = b64 => { const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new Blob([bytes], { type: 'application/pdf' }); };

    // 만료일 확인 창: PDF 에서 읽은 날짜가 미리 들어 있고, 고치거나 비워서 저장할 수 있다. 취소하면 null.
    function askExpiry(fileName, info) {
        return new Promise(resolve => {
            const input = h('input', { type: 'date', class: 'border rounded px-2 py-1 w-full', value: info.expiryDate || '' });
            const done = v => { overlay.remove(); resolve(v); };
            const overlay = h('div', { class: 'fixed inset-0 z-[70] bg-black/40 flex items-center justify-center', onmousedown: e => { if (e.target === overlay) done(null); } },
                h('div', { class: 'bg-white rounded-lg shadow-xl p-5 w-96 space-y-3' },
                    h('h3', { class: 'font-bold text-lg' }, '승선신고서 만료일'),
                    h('p', { class: 'text-xs text-slate-500 break-all' }, fileName),
                    h('p', { class: 'text-sm ' + (info.expiryDate ? 'text-emerald-700' : 'text-amber-700') },
                        info.expiryDate ? 'PDF 의 승선기간에서 만료일을 읽었습니다. 맞는지 확인해 주세요.' : 'PDF 에서 만료일을 읽지 못했습니다. 직접 입력해 주세요. (비워 두고 저장할 수도 있습니다)'),
                    input,
                    h('div', { class: 'flex justify-end gap-2' },
                        h('button', { class: 'px-3 py-1.5 rounded bg-slate-200', onclick: () => done(null) }, '취소'),
                        h('button', { class: 'px-3 py-1.5 rounded bg-blue-600 text-white', onclick: () => done(input.value) }, '저장'))));
            document.body.append(overlay);
            input.focus();
        });
    }

    // 화면 종류: CustomsView.CUSTOMS(기본) / CustomsView.OPINION
    async function render(container, project, onBack, kindSet = CUSTOMS) {
        const KINDS = kindSet.kinds;
        const body = h('div', { class: 'space-y-4' });
        const msg = h('p', { class: 'text-sm text-slate-500' });
        const fileInput = h('input', { type: 'file', accept: 'application/pdf,.pdf', class: 'hidden' });
        let pendingKind = null;

        const say = (text, bad = false) => { msg.textContent = text; msg.className = 'text-sm ' + (bad ? 'text-red-600' : 'text-slate-500'); };

        async function reload() {
            const r = await eel.pdm_customs_list(project.contractNumber)();
            if (!r.success) { say(r.message, true); return; }
            paint(r.files);
        }

        async function upload(kind, file) {
            if (!/\.pdf$/i.test(file.name)) { say('PDF 파일(.pdf)만 올릴 수 있습니다.', true); return; }
            if (file.size > MAX_BYTES) { say('파일이 너무 큽니다 (최대 30MB).', true); return; }
            say('파일을 확인하는 중…');
            const data = await base64Of(file);
            let expiry = '';
            if (kind === 'boarding') {
                const checked = await eel.pdm_customs_inspect(kind, data)();
                if (!checked.success) { say(checked.message, true); return; }
                const answer = await askExpiry(file.name, checked.info);
                if (answer === null) { say(''); return; }
                expiry = answer;
            }
            let lang = '';
            if (kind === 'opinion') {
                lang = await showChoice('소견서 언어', `${file.name} — 국문 / 영문 중 어느 버전인가요?`, [{ label: '국문', value: 'ko', primary: true }, { label: '영문', value: 'en' }, { label: '취소', value: null }]);
                if (!lang) { say(''); return; }
            }
            const r = await eel.pdm_customs_upload(project.contractNumber, kind, file.name, data, expiry, '', lang)();
            if (!r.success) { say(r.message, true); return; }
            say(`${file.name} 을(를) 올렸습니다.`);
            await reload();
        }

        async function fetchBlob(f) {
            const r = await eel.pdm_customs_get_file(f.id)();
            if (!r.success) { say(r.message, true); return null; }
            return toBlob(r.data);
        }

        async function view(f) {
            const blob = await fetchBlob(f);
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');                       // 브라우저 PDF 뷰어: 여기서 인쇄/다운로드도 가능
            setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
        }

        async function download(f) {
            const blob = await fetchBlob(f);
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = h('a', { href: url, download: f.fileName });
            document.body.append(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
        }

        async function remove(f) {
            if (await showChoice('세관서류 삭제', `"${f.fileName}" 을(를) 삭제할까요? 되돌릴 수 없습니다.`, [{ label: '삭제', value: true, primary: true }, { label: '취소', value: false }]) !== true) return;
            const r = await eel.pdm_customs_delete(f.id)();
            if (!r.success) { say(r.message, true); return; }
            say('삭제했습니다.');
            await reload();
        }

        const fileRow = f => h('li', { class: 'flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 border-t text-sm' },
            h('span', { class: 'font-medium break-all' }, f.fileName),
            ...(f.langLabel ? [h('span', { class: 'px-1.5 rounded text-xs bg-violet-100 text-violet-700' }, f.langLabel)] : []),
            ...(f.kind === 'boarding' ? [h('span', { class: 'px-1.5 rounded text-xs ' + (f.expiryDate ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-400') }, f.expiryDate ? '만료 ' + f.expiryDate : '만료일 없음')] : []),
            h('span', { class: 'text-xs text-slate-500' }, `${f.uploadedBy} · ${f.uploadedAt.slice(0, 16)} · ${sizeText(f.size)}`),
            h('span', { class: 'flex gap-1 ml-auto' },
                h('button', { class: BTN, title: '새 창에서 열기 (인쇄·다운로드 가능)', onclick: () => view(f) }, '보기·인쇄'),
                h('button', { class: BTN, onclick: () => download(f) }, '다운로드'),
                ...(f.canDelete ? [h('button', { class: BTN + ' text-red-600', onclick: () => remove(f) }, '삭제')] : [])));

        function paint(files) {
            body.replaceChildren(...KINDS.map(([kind, label]) => {
                const mine = files.filter(f => f.kind === kind);
                return h('section', { class: 'border rounded-lg p-3' },
                    h('div', { class: 'flex items-center justify-between mb-1' },
                        h('h3', { class: 'font-semibold' }, label, h('span', { class: 'ml-2 text-xs font-normal text-slate-400' }, mine.length ? `${mine.length}건` : '없음')),
                        h('button', { class: 'px-3 py-1 rounded text-sm bg-blue-600 text-white hover:bg-blue-700', onclick: () => { pendingKind = kind; fileInput.click(); } }, '＋ PDF 올리기')),
                    mine.length ? h('ul', {}, mine.map(fileRow)) : h('p', { class: 'text-xs text-slate-400 py-1' }, '올린 파일이 없습니다.'));
            }));
        }

        fileInput.addEventListener('change', async () => {
            const file = fileInput.files[0];
            fileInput.value = '';
            if (file && pendingKind) await upload(pendingKind, file).catch(e => say('올리지 못했습니다: ' + (e && e.message ? e.message : e), true));
        });

        container.replaceChildren(h('div', { class: 'bg-white rounded-lg shadow p-4 w-full max-w-4xl space-y-3' },
            h('div', { class: 'flex items-center justify-between' },
                h('div', {},
                    h('h1', { class: 'text-xl font-bold' }, kindSet.title),
                    h('p', { class: 'text-sm text-slate-600' }, `${project.contractNumber} · ${project.shipName || ''} · ${project.company || ''}`)),
                h('button', { class: 'px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm', onclick: onBack }, '← 목록')),
            msg, body, fileInput));
        await reload();
    }

    return { render, CUSTOMS, OPINION };
})();
