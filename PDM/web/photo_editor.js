// 사진 편집기 — 회전(90°) + 자르기 + 크기 조정 + 그리기(기본 빨강). 전체 화면 모달.
// 모든 편집은 "작업 목록(ops)"에 쌓이고 되돌리기(Ctrl+Z)로 하나씩 취소된다.
//   · 획(stroke): 원본 이미지 기준 0~1 좌표로 보관 → 자르기/크기를 바꿔도 그림 위치가 유지된다.
//   · 자르기(crop): 원본 기준 사각형. 마지막 crop 이 현재 보이는 영역이며, 이 안에서 다시 자를 수도 있다.
//   · 회전(rotate): 작업 좌표는 늘 '회전 전' 원본 기준이고, 화면에 그릴 때만 돌려서 보여 준다 (포인터는 되돌려 계산) — 자르기/그림 위치가 회전과 상관없이 유지된다.
// 저장하면 현재 보이는 영역이 합쳐진 이미지로 교체되고, 최초 편집 시 서버가 원본을 보존한다 ([원본 복원] 가능).
// 의존: dom.js(h, showChoice, blobToDataURL), eel
const PhotoEditor = (() => {
    const DEFAULT_COLOR = '#ff0000';
    const DEFAULT_WIDTH = 5;            // 긴 변 1000px 기준 굵기. 실제 굵기는 출력 크기에 비례
    const SIZE_PRESETS = [1200, 800, 600];
    const MIN_SHAPE = 0.005;            // 이보다 작게 끌면 도형 취소 (클릭 실수)
    const MIN_CROP = 0.03;              // 보이는 영역 대비 이보다 작은 자르기는 취소
    const FULL = { x: 0, y: 0, w: 1, h: 1 };
    const FRAME_ASPECT = 4 / 3;         // 출력 사진칸 비율 (70.4 × 53.2mm)

    const TOOLS = [['pen', '펜'], ['rect', '사각형'], ['ellipse', '원'], ['arrow', '화살표'], ['crop', '자르기']];

    // ── 순수 함수 ────────────────────────────────────────────────────────────
    const currentCrop = ops => [...ops].reverse().find(o => o.type === 'crop')?.rect || FULL;

    // 회전: ops 의 {type:'rotate', d:+1(오른쪽 90°) | -1(왼쪽 90°)} 합계 → 0..3 (시계 방향 90° 횟수)
    const rotation = ops => ((ops.reduce((n, o) => n + (o.type === 'rotate' ? o.d : 0), 0) % 4) + 4) % 4;
    // 회전 전 화면 좌표(0~1) → 회전 후 화면 좌표 / 그 반대 (포인터 입력을 회전 전 좌표로 되돌릴 때)
    const rotatePoint = (rot, [x, y]) => [[x, y], [1 - y, x], [1 - x, 1 - y], [y, 1 - x]][rot];
    const unrotatePoint = (rot, [u, v]) => [[u, v], [v, 1 - u], [1 - u, 1 - v], [1 - v, u]][rot];

    // 보이는 영역(crop) 기준 0~1 좌표 ↔ 원본 기준 0~1 좌표
    const viewToAbs = (crop, p) => [crop.x + p[0] * crop.w, crop.y + p[1] * crop.h];
    const absToView = (crop, p) => [(p[0] - crop.x) / crop.w, (p[1] - crop.y) / crop.h];

    // 비율 고정: a 를 기준점으로 가로(dx)를 유지하고 세로를 aspect(가로/세로, 픽셀 기준)에 맞춘다.
    // viewAspect = 보이는 영역의 픽셀 가로/세로. 세로 여유가 모자라면 가로도 함께 줄여 비율을 지킨다.
    function lockAspect(a, b, aspect, viewAspect) {
        const sx = b[0] >= a[0] ? 1 : -1, sy = b[1] >= a[1] ? 1 : -1;
        let w = Math.abs(b[0] - a[0]);
        let hgt = w * viewAspect / aspect;
        const room = sy > 0 ? 1 - a[1] : a[1];
        if (hgt > room) { hgt = room; w = hgt * aspect / viewAspect; }
        return [a[0] + sx * w, a[1] + sy * hgt];
    }

    // 보이는 영역 안에서 a→b 로 끈 사각형 → 원본 기준 crop 사각형 (너무 작으면 null)
    function cropFromDrag(crop, a, b) {
        const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
        const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
        if (x1 - x0 < MIN_CROP || y1 - y0 < MIN_CROP) return null;
        const [ax, ay] = viewToAbs(crop, [x0, y0]);
        return { x: ax, y: ay, w: (x1 - x0) * crop.w, h: (y1 - y0) * crop.h };
    }

    // ── 그리기 ──────────────────────────────────────────────────────────────
    function drawStroke(ctx, s, crop, W, H) {
        const px = p => { const v = absToView(crop, p); return [v[0] * W, v[1] * H]; };
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

    // 자르기 미리보기: 선택 영역 밖을 어둡게, 영역은 점선 테두리
    function drawCropPreview(ctx, a, b, W, H) {
        const x0 = Math.min(a[0], b[0]) * W, x1 = Math.max(a[0], b[0]) * W;
        const y0 = Math.min(a[1], b[1]) * H, y1 = Math.max(a[1], b[1]) * H;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, W, y0);
        ctx.fillRect(0, y1, W, H - y1);
        ctx.fillRect(0, y0, x0, y1 - y0);
        ctx.fillRect(x1, y0, W - x1, y1 - y0);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(2, Math.max(W, H) / 400);
        ctx.setLineDash([ctx.lineWidth * 4, ctx.lineWidth * 3]);
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        ctx.setLineDash([]);
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
        const NW = img.naturalWidth, NH = img.naturalHeight;

        const state = { ops: [], preview: null, tool: 'pen', color: DEFAULT_COLOR, width: DEFAULT_WIDTH,
                        longEdge: Math.max(NW, NH), cropKey: JSON.stringify(FULL), cropAspect: FRAME_ASPECT };
        const canvas = h('canvas', { class: 'bg-white shadow-lg max-w-full max-h-full', style: 'touch-action:none;cursor:crosshair' });
        const ctx = canvas.getContext('2d');
        const sizeInfo = h('span', { class: 'text-xs text-slate-300' });
        const sizeSel = h('select', { class: 'text-sm rounded px-2 py-1 text-slate-900', title: '크기 조정 (긴 변 px)' });

        const crop = () => currentCrop(state.ops);
        const croppedLong = () => Math.round(Math.max(NW * crop().w, NH * crop().h));
        const dims = () => {
            const c = crop();
            const k = state.longEdge / Math.max(NW * c.w, NH * c.h);
            return [Math.max(1, Math.round(NW * c.w * k)), Math.max(1, Math.round(NH * c.h * k))];
        };

        // 그림/자르기는 회전 전 그림(work)에 그리고, 화면(canvas)에는 그것을 돌려서 보여 준다 — 저장 이미지도 이 canvas 라 회전이 반영된다.
        const work = document.createElement('canvas');
        const wctx = work.getContext('2d');
        const redraw = () => {
            const c = crop();
            const [W, H] = dims();
            work.width = W; work.height = H;
            wctx.drawImage(img, c.x * NW, c.y * NH, c.w * NW, c.h * NH, 0, 0, W, H);
            for (const o of state.ops) if (o.type !== 'crop' && o.type !== 'rotate') drawStroke(wctx, o, c, W, H);
            if (state.preview) drawCropPreview(wctx, state.preview.a, state.preview.b, W, H);
            const rot = rotation(state.ops);
            canvas.width = rot % 2 ? H : W; canvas.height = rot % 2 ? W : H;
            ctx.save();
            if (rot === 1) { ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2); }
            else if (rot === 2) { ctx.translate(canvas.width, canvas.height); ctx.rotate(Math.PI); }
            else if (rot === 3) { ctx.translate(0, canvas.height); ctx.rotate(-Math.PI / 2); }
            ctx.drawImage(work, 0, 0);
            ctx.restore();
            sizeInfo.textContent = `${canvas.width} × ${canvas.height}px`;
        };

        // 보이는 영역이 바뀌면 크기 선택지를 새 영역 기준으로 다시 만든다 (원본 = 자른 영역의 원래 크기)
        const syncSizeOptions = () => {
            const key = JSON.stringify(crop());
            if (key === state.cropKey) return;
            state.cropKey = key;
            const long = croppedLong();
            state.longEdge = long;
            sizeSel.replaceChildren(h('option', { value: long }, `원본 (${long}px)`),
                ...SIZE_PRESETS.filter(v => v < long).map(v => h('option', { value: v }, `${v}px`)));
        };
        const changed = () => { syncSizeOptions(); redraw(); };
        sizeSel.addEventListener('change', () => { state.longEdge = Number(sizeSel.value); redraw(); });
        state.cropKey = '';      // 첫 syncSizeOptions 가 선택지를 채우도록
        syncSizeOptions();

        // 포인터 → 보이는 영역 기준 0~1
        const viewPoint = e => {
            const rc = canvas.getBoundingClientRect();
            return unrotatePoint(rotation(state.ops), [Math.min(1, Math.max(0, (e.clientX - rc.left) / rc.width)),
                                                       Math.min(1, Math.max(0, (e.clientY - rc.top) / rc.height))]);
        };

        // 비율 고정이면 끄는 끝점을 보정한다 (보이는 영역의 픽셀 비율 기준)
        const constrainCrop = (a, v) => {
            if (!state.cropAspect) return v;
            const c = crop();
            const aspect = rotation(state.ops) % 2 ? 1 / state.cropAspect : state.cropAspect;      // 사진칸 비율은 돌린 뒤 모양 기준
            return lockAspect(a, v, aspect, (NW * c.w) / (NH * c.h));
        };

        let active = null;      // 진행 중인 획 (ops 에 이미 들어 있음)
        canvas.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            canvas.setPointerCapture(e.pointerId);
            const v = viewPoint(e);
            if (state.tool === 'crop') {
                state.preview = { a: v, b: v };
            } else {
                const p = viewToAbs(crop(), v);
                active = { type: state.tool, color: state.color, width: state.width, a: p, b: p, points: [p] };
                state.ops.push(active);
            }
            redraw();
        });
        canvas.addEventListener('pointermove', e => {
            if (!state.preview && !active) return;
            const v = viewPoint(e);
            if (state.preview) state.preview.b = constrainCrop(state.preview.a, v);
            else if (active.type === 'pen') active.points.push(viewToAbs(crop(), v));
            else active.b = viewToAbs(crop(), v);
            redraw();
        });
        const finish = () => {
            if (state.preview) {
                const rect = cropFromDrag(crop(), state.preview.a, state.preview.b);
                state.preview = null;
                if (rect) state.ops.push({ type: 'crop', rect });
            } else if (active) {
                if (active.type !== 'pen' && Math.hypot(active.b[0] - active.a[0], active.b[1] - active.a[1]) < MIN_SHAPE) state.ops.pop();
                active = null;
            }
            changed();
        };
        canvas.addEventListener('pointerup', finish);
        canvas.addEventListener('pointercancel', finish);

        // ── 도구 막대 ─────────────────────────────────────────────────────
        const toolBtns = TOOLS.map(([id, label]) => h('button', {
            class: 'px-3 py-1 rounded text-sm', 'data-tool': id,
            onclick: () => { state.tool = id; paintTools(); },
        }, label));
        const paintTools = () => {
            toolBtns.forEach(b => {
                b.className = 'px-3 py-1 rounded text-sm ' + (b.dataset.tool === state.tool ? 'bg-blue-600 text-white' : 'bg-slate-600 text-slate-100');
            });
            canvas.style.cursor = 'crosshair';
        };
        const color = h('input', { type: 'color', value: state.color, title: '색', class: 'w-9 h-8 bg-transparent' });
        color.addEventListener('input', () => { state.color = color.value; });
        const width = h('input', { type: 'range', min: 2, max: 24, value: state.width, title: '굵기' });
        width.addEventListener('input', () => { state.width = Number(width.value); });

        const aspectSel = h('select', { class: 'text-sm rounded px-2 py-1 text-slate-900', title: '자르기 비율' },
            h('option', { value: String(FRAME_ASPECT) }, '자르기 4:3 (사진칸)'), h('option', { value: '' }, '자르기 자유'));
        aspectSel.addEventListener('change', () => { state.cropAspect = aspectSel.value ? Number(aspectSel.value) : null; });

        const undo = () => { state.ops.pop(); changed(); };
        const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
        const rotate = d => { state.ops.push({ type: 'rotate', d }); changed(); };
        const dirty = () => state.ops.length > 0 || state.longEdge !== croppedLong();
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
        const btn = (label, onclick, cls = 'bg-slate-600') => h('button', { class: `px-3 py-1 rounded text-sm ${cls}`, onclick }, label);

        const toolbar = h('div', { class: 'flex flex-wrap items-center gap-3 px-4 py-2 bg-slate-800 text-slate-100' },
            h('div', { class: 'flex gap-1' }, toolBtns), color, h('span', { class: 'text-xs' }, '굵기'), width,
            aspectSel, h('span', { class: 'text-xs ml-2' }, '크기'), sizeSel, sizeInfo,
            h('div', { class: 'ml-auto flex flex-wrap gap-2' },
                btn('↺ 왼쪽 회전', () => rotate(-1)), btn('↻ 오른쪽 회전', () => rotate(1)),
                btn('되돌리기', undo),
                btn('자르기 해제', () => { state.ops = state.ops.filter(o => o.type !== 'crop'); changed(); }),
                btn('그림 지우기', () => { state.ops = state.ops.filter(o => o.type === 'crop' || o.type === 'rotate'); changed(); }),
                ...(photo.edited ? [btn('원본 복원', restore, 'bg-amber-600')] : []),
                btn('취소', cancel), saveBtn));
        const overlay = h('div', { class: 'fixed inset-0 z-[60] bg-slate-900 flex flex-col' },
            toolbar, h('div', { class: 'flex-1 min-h-0 flex items-center justify-center p-4' }, canvas));
        document.body.append(overlay);
        document.addEventListener('keydown', onKey);
        paintTools();
        redraw();
    }

    return { open, lockAspect, cropFromDrag, currentCrop, rotation, rotatePoint, unrotatePoint };
})();

if (typeof module !== 'undefined') module.exports = PhotoEditor;
