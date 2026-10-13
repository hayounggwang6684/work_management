// 부품사진첩 편집기 — 서비스레포트의 사진 부분만 + (판매용이면) 표지 정보.
//   표지 포함: 판매용 주문은 처음부터 켜져 있고, 공사와 연계된 주문은 꺼져 있다 (언제든 바꿀 수 있다).
//   표지 INDEX 는 사진 페이지 제목과 장 수로 자동으로 만들어진다 — 페이지 제목을 입력하세요.
// 의존: dom.js(h), editor_bar.js(EditorBar), photo_grid.js(PhotoGrid), eel
const AlbumEditor = (() => {
    const INPUT = 'w-full px-2 py-1 border border-slate-300 rounded text-sm bg-white';
    const FIELDS = [['계약번호', 'orderNo', { readonly: true }], ['선사(업체)', 'customer', {}], ['선박', 'vesselName', {}]];

    const labeled = (text, control, cls = '') => h('label', { class: 'text-xs text-slate-500 ' + cls }, text, control);

    async function render(container, docId, onBack) {
        const res = await eel.pdm_get_document(docId)();
        if (!res.success) { container.replaceChildren(h('p', { class: 'text-red-600' }, res.message)); return; }
        const doc = res.document;
        const header = structuredClone(doc.header);       // 편집 작업 복사본 (저장 전까지 서버와 분리)

        const input = (key, { readonly } = {}) => {
            const i = h('input', { class: INPUT + (readonly ? ' bg-slate-100' : ''), value: header[key] || '', readonly: !!readonly });
            i.addEventListener('input', () => { header[key] = i.value.trim(); });
            return i;
        };
        const engine = h('textarea', { class: INPUT, rows: 2, maxlength: 200, title: '표지 박스에 나오는 엔진 (줄바꿈 가능, 예: NO.1 G/E CATERPILLAR 3412)' }, header.model || '');
        engine.addEventListener('input', () => { header.model = engine.value.replace(/\s+$/, ''); });

        const cover = h('input', { type: 'checkbox', checked: header.withCover === true });
        cover.addEventListener('change', () => { header.withCover = cover.checked; });

        // 한 장에 들어가는 사진 수 6장(세로) / 4장(가로) — 서비스레포트와 같은 방식. 바꾸면 사진은 그대로, 페이지 묶음만 달라진다.
        let perPage = header.photosPerPage === 4 ? 4 : 6;
        let grid;
        const photosBox = h('div', { class: 'mt-6' });
        const mountGrid = pageTitles => {
            grid = PhotoGrid.create({ docId: doc.id, pageTitles, perPage, onTouched: ts => bar.touch(ts) });
            const select = h('select', { class: 'ml-3 border border-slate-300 rounded px-2 py-0.5 text-sm bg-white font-normal', title: '한 페이지에 나오는 사진 장수' },
                h('option', { value: '6', selected: perPage === 6 }, '6장 (세로)'), h('option', { value: '4', selected: perPage === 4 }, '4장 (가로)'));
            select.addEventListener('change', () => { perPage = Number(select.value); mountGrid(grid.getPageTitles()); });
            const newPage = h('button', { class: 'ml-2 px-2 py-0.5 rounded border border-slate-300 bg-white hover:bg-slate-100 text-sm font-normal', title: '앞 페이지를 다 채우지 않고 다음 사진 페이지를 시작합니다', onclick: () => grid.addPage() }, '＋ 새 페이지');
            photosBox.replaceChildren(h('h3', { class: 'font-bold text-lg mb-1' }, '■ Photos', select, newPage),
                h('p', { class: 'text-xs text-slate-400 mb-1' }, '페이지 제목은 사진 위 제목 띠와 표지 INDEX 에 쓰입니다 (제목을 비우면 띠가 나오지 않고, INDEX 에는 "작업 사진"으로 나옵니다).'), grid.el);
        };
        mountGrid(header.pageTitles);

        const root = h('div', { class: 'bg-white rounded-lg shadow p-6 max-w-3xl mx-auto space-y-4' },
            h('h2', { class: 'text-2xl font-bold text-center' }, '부품사진첩'),
            h('div', { class: 'grid grid-cols-3 gap-3' }, ...FIELDS.map(([label, key, opts]) => labeled(label, input(key, opts)))),
            h('div', { class: 'border rounded p-3 space-y-3 bg-slate-50' },
                h('label', { class: 'text-sm font-bold' }, cover, ' 표지 포함 ', h('span', { class: 'font-normal text-xs text-slate-500' }, '(판매용은 켜고, 공사와 연계된 경우는 보통 끕니다)')),
                h('div', { class: 'grid grid-cols-2 gap-3' },
                    labeled('엔진 (표지)', engine, 'col-span-2'),
                    labeled('작업 장소 (표지)', input('location')), labeled('작업 일자 (표지)', input('workDate')))),
            photosBox);

        const bar = EditorBar.create({
            doc, onBack,
            getHeader: () => ({ ...header, pageTitles: grid.getPageTitles(), photosPerPage: perPage }),
        });
        container.replaceChildren(bar.el, root);
    }

    return { render };
})();
