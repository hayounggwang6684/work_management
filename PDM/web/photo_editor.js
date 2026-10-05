// 사진 편집기 — 크기 조정 + 그리기(기본 빨강). 전체 화면 모달.
// 그리기 도구: 펜/사각형/원/화살표. 획은 0~1 정규화 좌표로 보관해 크기를 바꿔도 위치가 유지된다.
// 저장하면 그림이 합쳐진 이미지로 교체되고, 최초 편집 시 서버가 원본을 보존한다 ([원본 복원] 가능).
// 의존: dom.js(h, showChoice, blobToDataURL), eel
const PhotoEditor = (() => {
    const DEFAULT_COLOR = '#ff0000';
    const DEFAULT_WIDTH = 5;            // 긴 변 1000px 기준 굵기. 실제 굵기는 출력 크기에 비례
    const SIZE_PRESETS = [1200, 800, 600];
    const MIN_SHAPE = 0.005;            // 이보다 작게 끌면 도형 취소 (클릭 실수)

    const TOOLS = [['pen', '펜'], ['rect', '사각형'], ['ellipse', '원'], ['arrow', '화살표']];

    // ── 그리기 (순수 렌더링: ctx, 획, 캔버스 크기) ────────────────────────────
    function drawStroke(ctx, s, W, H) {
        const px = p => [p[0] * W, p[1] * H];
        ctx.strokeStyle = s.color;
        ctx.fillStyle = s.color;
        ctx.lineWidth = s.width * Math.max(W, H) / 1000;
        ctx.lineCap = ctx.lineJoin = 'round';
        const [x1, y1] = px(s.a);
        const [x2, y2] = px(s.b || s.a);
        ctx.beginPath();
        if (s.type === 'pen') {
            const pts = s.points.map(px);
            ctx.moveTo(...pts[0]);
            if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);   // 점 찍기
            for (const p of pts.slice(1)) ctx.lineTo(...p);
            ctx.stroke();
        } else if (s.type === 'rect') {
            ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        } else if (s.type === 'ellipse') {
            ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
            ctx.stroke();
        } else if (s.type === 'arrow') {
            const head = Math.max(12, ctx.lineWidth * 4);
            const ang = Math.atan2(y2 - y1, x2 - x1);
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x2, y2);
            for (const d of [-0.45, 0.45]) ctx.lineTo(x2 - head * Math.cos(ang + d), y2 - head * Math.sin(ang + d));
            ctx.closePath();
            ctx.fill();
        }
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'));
            img.src = src;
        });
    }

    // options: {docId, photo, onSaved(result)}
    async function open({ docId, photo, onSaved }) {
        const r = await eel.pdm_get_photo(photo.id)();
        if (!r.success) { alert(r.message); return; }
        const img = await loadImage(r.image);
        const naturalLong = Math.max(img.naturalWidth, img.naturalHeight);

        const state = { strokes: [], tool: 'pen', color: DEFAULT_COLOR, width: DEFAULT_WIDTH,
                        longEdge: naturalLong, drawing: null };
        const canvas = h('canvas', { class: 'bg-white shadow-lg max-w-full max-h-full', style: 'touch-action:none;cursor:crosshair' });
        const ctx = canvas.getContext('2d');
        const sizeInfo = h('span', { class: 'text-xs text-slate-300' });

        const dims = () => {
            const k = state.longEdge / naturalLong;
            return [Math.round(img.naturalWidth * k), Math.round(img.naturalHeight * k)];
        };
        const redraw = () => {
            const [W, H] = dims();
            canvas.width = W; canvas.height = H;
            ctx.drawImage(img, 0, 0, W, H);
            for (const s of state.strokes) drawStroke(ctx, s, W, H);
            sizeInfo.textContent = `${W} × ${H}px`;
        };
        const norm = e => {
            const rc = canvas.getBoundingClientRect();
            return [Math.min(1, Math.max(0, (e.clientX - rc.left) / rc.width)),
                    Math.min(1, Math.max(0, (e.clientY - rc.top) / rc.height))];
        };

        canvas.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            canvas.setPointerCapture(e.pointerId);
            const p = norm(e);
            const s = { type: state.tool, color: state.color, width: state.width, a: p, b: p, points: [p] };
            state.drawing = s;
            state.strokes.push(s);
            redraw();
        });
        canvas.addEventListener('pointermove', e => {
            const s = state.drawing;
            if (!s) return;
            const p = norm(e);
            if (s.type === 'pen') s.points.push(p); else s.b = p;
            redraw();
        });
        const finish = () => {
            const s = state.drawing;
            state.drawing = null;
            if (s && s.type !== 'pen' && Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) < MIN_SHAPE) state.strokes.pop();
            redraw();
        };
        canvas.addEventListener('pointerup', finish);
        canvas.addEventListener('pointercancel', finish);

        // ── 도구 막대 ─────────────────────────────────────────────────────
        const toolBtns = TOOLS.map(([id, label]) => h('button', {
            class: 'px-3 py-1 rounded text-sm', 'data-tool': id,
            onclick: () => { state.tool = id; paintTools(); },
        }, label));
        const paintTools = () => toolBtns.forEach(b => {
            b.className = 'px-3 py-1 rounded text-sm ' + (b.dataset.tool === state.tool ? 'bg-blue-600 text-white' : 'bg-slate-600 text-slate-100');
        });
        const color = h('input', { type: 'color', value: state.color, title: '색', class: 'w-9 h-8 bg-transparent' });
        color.addEventListener('input', () => { state.color = color.value; });
        const width = h('input', { type: 'range', min: 2, max: 24, value: state.width, title: '굵기' });
        width.addEventListener('input', () => { state.width = Number(width.value); });
        const sizeSel = h('select', { class: 'text-sm rounded px-2 py-1 text-slate-900', title: '크기 조정 (긴 변 px)' },
            h('option', { value: naturalLong }, `원본 (${naturalLong}px)`),
            ...SIZE_PRESETS.filter(v => v < naturalLong).map(v => h('option', { value: v }, `${v}px`)));
        sizeSel.addEventListener('change', () => { state.longEdge = Number(sizeSel.value); redraw(); });

        const undo = () => { state.strokes.pop(); redraw(); };
        const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
        const dirty = () => state.strokes.length > 0 || state.longEdge !== naturalLong;
        const cancel = async () => {
            if (dirty() && await showChoice('편집 취소', '변경한 내용이 저장되지 않습니다. 닫을까요?',
                [{ label: '닫기', value: true, primary: true }, { label: '계속 편집', value: false }]) !== true) return;
            close();
        };
        const onKey = e => {
            if (e.key === 'Escape') { if (!document.getElementById('pdmChoice')) cancel(); }   // 대화상자가 열려 있으면 그쪽이 Esc 처리
            else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
        };

        const save = async () => {
            if (!dirty()) { close(); return; }
            saveBtn.disabled = true;
            const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
            const res = await eel.pdm_update_photo(docId, photo.id, await blobToDataURL(blob))();
            if (!res.success) { saveBtn.disabled = false; alert(res.message); return; }
            close();
            if (onSaved) await onSaved(res);
        };
        const restore = async () => {
            const ok = await showChoice('원본 복원', '편집한 내용을 모두 버리고 처음 입력한 사진으로 되돌릴까요?',
                [{ label: '원본으로 복원', value: true, primary: true }, { label: '취소', value: false }]);
            if (ok !== true) return;
            const res = await eel.pdm_restore_photo_original(docId, photo.id)();
            if (!res.success) { alert(res.message); return; }
            close();
            if (onSaved) await onSaved(res);
        };
        const saveBtn = h('button', { class: 'px-4 py-1 rounded bg-blue-600 text-white', onclick: save }, '저장');

        const toolbar = h('div', { class: 'flex flex-wrap items-center gap-3 px-4 py-2 bg-slate-800 text-slate-100' },
            h('div', { class: 'flex gap-1' }, toolBtns), color, h('span', { class: 'text-xs' }, '굵기'), width,
            h('span', { class: 'text-xs ml-2' }, '크기'), sizeSel, sizeInfo,
            h('div', { class: 'ml-auto flex gap-2' },
                h('button', { class: 'px-3 py-1 rounded bg-slate-600 text-sm', onclick: undo }, '되돌리기'),
                h('button', { class: 'px-3 py-1 rounded bg-slate-600 text-sm', onclick: () => { state.strokes = []; redraw(); } }, '그림 지우기'),
                ...(photo.edited ? [h('button', { class: 'px-3 py-1 rounded bg-amber-600 text-sm', onclick: restore }, '원본 복원')] : []),
                h('button', { class: 'px-3 py-1 rounded bg-slate-600 text-sm', onclick: cancel }, '취소'),
                saveBtn));
        const overlay = h('div', { class: 'fixed inset-0 z-[60] bg-slate-900 flex flex-col' },
            toolbar, h('div', { class: 'flex-1 min-h-0 flex items-center justify-center p-4' }, canvas));
        document.body.append(overlay);
        document.addEventListener('keydown', onKey);
        paintTools();
        redraw();
    }

    return { open };
})();
