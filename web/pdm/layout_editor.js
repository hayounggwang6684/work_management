// 출력 양식 설정 화면 — 로고, 회사 정보, 제목 문구, 사진 채움 방식, 직인(표시/이미지/위치).
// 저장하면 서버(DB)에 공유 저장되어 모든 사용자의 출력에 반영된다. 변경은 관리자만 (canManage).
// 직인 위치는 사진 페이지 축소 미리보기에서 끌어 조정하거나 숫자(mm)로 입력한다.
// 의존: dom.js(h, blobToDataURL), print_layout.js(PdmLayout), sr_print.js(SrPrint.PHOTO), eel
const LayoutEditor = (() => {
    const PAGE_W = 210, PAGE_H = 297, PREVIEW_PX = 300;
    const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
    const INPUT = 'w-full border border-slate-300 rounded px-2 py-1 text-sm bg-white disabled:bg-slate-100';

    const card = (title, ...children) => h('section', { class: 'bg-white rounded-lg shadow p-4 space-y-3' },
        h('h2', { class: 'font-bold' }, title), ...children);

    function pickImage(onPick, onError) {
        const input = h('input', { type: 'file', accept: 'image/*' });
        input.addEventListener('change', async () => {
            const file = input.files[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) { onError('이미지 파일만 선택할 수 있습니다.'); return; }
            if (file.size > MAX_IMAGE_BYTES) { onError('이미지가 너무 큽니다 (최대 3MB).'); return; }
            onPick(await blobToDataURL(file));
        });
        input.click();
    }

    async function render(container, onBack, canManage) {
        const raw = await PdmLayout.load();
        if (!raw) { container.replaceChildren(h('p', { class: 'text-red-600' }, '출력 양식 설정을 불러오지 못했습니다.')); return; }
        const state = structuredClone(raw);                          // 편집 작업 복사본 (이미지는 null = 내장 기본)
        const status = h('span', { class: 'text-sm text-slate-500' });
        const lock = !canManage;

        const text = (label, key, cls = '') => h('label', { class: 'text-xs text-slate-500 ' + cls }, label,
            (() => { const i = h('input', { class: INPUT, value: state[key], disabled: lock }); i.addEventListener('input', () => { state[key] = i.value; }); return i; })());

        // ── 로고 ────────────────────────────────────────────────────────────
        const logoImg = h('img', { class: 'h-14 border bg-white p-1', alt: '로고' });
        const paintLogo = () => { logoImg.src = state.logo || PdmLayout.defaults.logo; };

        // ── 직인 + 위치 미리보기 ─────────────────────────────────────────────
        const k = PREVIEW_PX / PAGE_W;                                // px per mm
        const sealImg = h('img', { class: 'absolute select-none', draggable: 'false', style: 'cursor:move;touch-action:none' });
        const sealThumb = h('img', { class: 'h-20 border bg-white p-1', alt: '직인' });
        const numInputs = {};
        const sealUrl = () => state.seal.image || PdmLayout.defaults.seal;
        const sealHeightMm = () => (sealImg.naturalWidth ? state.seal.w * sealImg.naturalHeight / sealImg.naturalWidth : state.seal.w);

        const paintSeal = () => {
            sealImg.src = sealUrl(); sealThumb.src = sealUrl();
            sealImg.style.left = state.seal.x * k + 'px'; sealImg.style.top = state.seal.y * k + 'px';
            sealImg.style.width = state.seal.w * k + 'px';
            sealImg.style.opacity = state.seal.enabled ? '1' : '.35';
            for (const key of ['x', 'y', 'w']) numInputs[key].value = state.seal[key];
        };
        for (const key of ['x', 'y', 'w']) {
            numInputs[key] = h('input', { type: 'number', step: '0.5', class: INPUT, value: state.seal[key], disabled: lock });
            numInputs[key].addEventListener('input', () => { const v = Number(numInputs[key].value); if (Number.isFinite(v)) { state.seal[key] = v; paintSeal(); } });
        }
        sealImg.addEventListener('load', paintSeal);
        sealImg.addEventListener('pointerdown', e => {
            if (lock) return;
            sealImg.setPointerCapture(e.pointerId);
            const start = { px: e.clientX, py: e.clientY, x: state.seal.x, y: state.seal.y };
            const move = ev => {
                const x = start.x + (ev.clientX - start.px) / k, y = start.y + (ev.clientY - start.py) / k;
                state.seal.x = +Math.min(PAGE_W - state.seal.w, Math.max(0, x)).toFixed(1);
                state.seal.y = +Math.min(PAGE_H - sealHeightMm(), Math.max(0, y)).toFixed(1);
                paintSeal();
            };
            const up = () => { sealImg.removeEventListener('pointermove', move); sealImg.removeEventListener('pointerup', up); };
            sealImg.addEventListener('pointermove', move);
            sealImg.addEventListener('pointerup', up);
        });

        const P = SrPrint.PHOTO;
        const mock = h('div', { class: 'relative bg-white border border-slate-400 shrink-0', style: `width:${PREVIEW_PX}px;height:${PAGE_H * k}px;overflow:hidden` },
            h('div', { class: 'absolute bg-sky-100 border border-slate-500', style: `left:${24.9 * k}px;top:${26.6 * k}px;width:${159.9 * k}px;height:${9.6 * k}px` }),
            ...[0, 1, 2].flatMap(r => [0, 1].map(c => h('div', { class: 'absolute bg-slate-200', style: `left:${P.colX[c] * k}px;top:${P.rowY[r] * k}px;width:${P.w * k}px;height:${P.h * k}px` }))),
            sealImg);

        const enabled = h('input', { type: 'checkbox', checked: state.seal.enabled, disabled: lock });
        enabled.addEventListener('change', () => { state.seal.enabled = enabled.checked; paintSeal(); });

        const imageButtons = (onPick, onReset) => lock ? [] : [
            h('button', { class: 'px-3 py-1 rounded bg-slate-200 text-sm', onclick: () => pickImage(onPick, m => { status.textContent = '⚠ ' + m; }) }, '이미지 선택'),
            h('button', { class: 'px-3 py-1 rounded bg-slate-100 text-sm', onclick: onReset }, '기본값으로')];

        const fit = (value, label) => h('label', { class: 'mr-4 text-sm' },
            (() => { const r = h('input', { type: 'radio', name: 'photoFit', checked: state.photoFit === value, disabled: lock }); r.addEventListener('change', () => { state.photoFit = value; }); return r; })(),
            ' ' + label);

        const save = async () => {
            status.textContent = '저장 중…';
            const r = await PdmLayout.save(state);
            status.textContent = r.success ? '저장됨 ' + new Date().toLocaleTimeString() : '⚠ ' + r.message;
        };

        container.replaceChildren(
            h('div', { class: 'max-w-3xl mx-auto mb-3 flex items-center gap-3' },
                h('button', { class: 'px-3 py-1 rounded bg-slate-200', onclick: onBack }, '← 돌아가기'),
                h('h1', { class: 'font-bold text-lg' }, '출력 양식 설정'),
                ...(lock ? [h('span', { class: 'text-sm text-amber-600' }, '관리자만 변경할 수 있습니다 (보기 전용)')]
                         : [h('button', { class: 'px-4 py-1 rounded bg-blue-600 text-white', onclick: save }, '저장')]),
                status),
            h('div', { class: 'max-w-3xl mx-auto space-y-4' },
                card('회사 정보 / 제목', h('div', { class: 'grid grid-cols-2 gap-3' },
                    text('회사명 (푸터)', 'company'), text('서비스레포트 제목', 'srTitle'),
                    text('주소 (푸터)', 'address', 'col-span-2'), text('TEL', 'tel'), text('FAX', 'fax'))),
                card('사진', h('div', {}, fit('cover', '칸 채우기 (원본 양식과 동일 — 가장자리는 잘림)'), fit('contain', '전체 보이기 (여백 포함)'))),
                card('로고', h('div', { class: 'flex items-center gap-3' }, logoImg,
                    ...imageButtons(img => { state.logo = img; paintLogo(); }, () => { state.logo = null; paintLogo(); }))),
                card('직인 (서비스레포트 사진 페이지)',
                    h('label', { class: 'text-sm' }, enabled, ' 사진 페이지에 직인 표시'),
                    h('div', { class: 'flex gap-6' },
                        h('div', { class: 'space-y-3' },
                            h('div', { class: 'flex items-center gap-3' }, sealThumb,
                                ...imageButtons(img => { state.seal.image = img; paintSeal(); }, () => { state.seal.image = null; paintSeal(); })),
                            h('div', { class: 'grid grid-cols-3 gap-2 w-64' },
                                ...[['X (mm)', 'x'], ['Y (mm)', 'y'], ['폭 (mm)', 'w']].map(([l, key]) => h('label', { class: 'text-xs text-slate-500' }, l, numInputs[key]))),
                            h('p', { class: 'text-xs text-slate-400' }, '오른쪽 미리보기에서 직인을 끌어 위치를 정할 수 있습니다. 투명 배경 PNG를 권장합니다.')),
                        mock))));
        paintLogo(); paintSeal();
    }

    return { render };
})();
