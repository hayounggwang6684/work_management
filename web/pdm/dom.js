// 작은 DOM 헬퍼 — 사용자 입력은 항상 textContent/value 로만 넣는다 (innerHTML 금지).
function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (v !== false && v != null) el.setAttribute(k, v);
    }
    el.append(...children.flat().filter(c => c != null));
    return el;
}

const DOC_LABEL = { service_report: '서비스레포트', measurement: '계측지', photo_album: '부품사진첩' };

// 우클릭 메뉴 — items: [{label, disabled, title, onClick, children, separator}].
// children 이 있으면 마우스를 올릴 때 옆에 하위 메뉴. 한 번에 하나만 표시, 바깥 클릭/Esc 로 닫힘.
function showContextMenu(x, y, items) {
    document.getElementById('pdmCtxMenu')?.remove();
    const close = () => {
        menu.remove();
        document.removeEventListener('mousedown', outside, true);
        document.removeEventListener('keydown', esc);
    };
    const outside = e => { if (!menu.contains(e.target)) close(); };
    const esc = e => { if (e.key === 'Escape') close(); };
    const PANEL = 'bg-white border border-slate-300 rounded shadow-lg py-1 text-sm min-w-44';

    const buildSubmenu = (it) => {
        const sub = build(it.children, 'absolute top-0 hidden');
        const wrap = h('div', { class: 'relative' },
            h('div', { class: 'flex justify-between gap-4 px-4 py-1.5 hover:bg-blue-50 cursor-default' },
                h('span', {}, it.label), h('span', { class: 'text-slate-400' }, '▸')),
            sub);
        wrap.addEventListener('mouseenter', () => {
            sub.classList.remove('hidden');
            const flip = wrap.getBoundingClientRect().right + sub.offsetWidth > window.innerWidth;
            sub.style.left = flip ? '' : '100%';
            sub.style.right = flip ? '100%' : '';
        });
        wrap.addEventListener('mouseleave', () => sub.classList.add('hidden'));
        return wrap;
    };

    const buildItem = (it) => {
        if (it.separator) return h('div', { class: 'my-1 border-t border-slate-200' });
        if (it.children) return buildSubmenu(it);
        return h('button', {
            class: 'block w-full text-left px-4 py-1.5 whitespace-nowrap ' +
                   (it.disabled ? 'text-slate-300 cursor-default' : 'hover:bg-blue-50'),
            disabled: !!it.disabled, title: it.title || false,
            onclick: () => { close(); if (!it.disabled) it.onClick(); },
        }, it.label);
    };

    const build = (list, extra) => h('div', { class: PANEL + ' ' + extra }, list.map(buildItem));

    const menu = build(items, 'fixed z-50');
    menu.id = 'pdmCtxMenu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    document.body.append(menu);
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', esc);
}

// 선택 대화상자 — buttons: [{label, value, primary}] → 누른 버튼의 value (Esc/바깥 클릭은 null)
function showChoice(title, message, buttons) {
    return new Promise(resolve => {
        const done = v => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
        const onKey = e => { if (e.key === 'Escape') done(null); };
        const overlay = h('div', {
            id: 'pdmChoice',    // 편집기 같은 전체 화면 모달(z-60) 위에 떠야 하므로 z-[70]
            class: 'fixed inset-0 z-[70] bg-black/40 flex items-center justify-center',
            onmousedown: e => { if (e.target === overlay) done(null); },
        }, h('div', { class: 'bg-white rounded-lg shadow-xl p-5 w-96' },
            h('h3', { class: 'font-bold text-lg mb-2' }, title),
            h('p', { class: 'text-sm text-slate-600 mb-4' }, message),
            h('div', { class: 'flex flex-wrap justify-end gap-2' }, buttons.map(b => h('button', {
                class: 'px-3 py-1.5 rounded ' + (b.primary ? 'bg-blue-600 text-white' : 'bg-slate-200'),
                onclick: () => done(b.value),
            }, b.label)))));
        document.addEventListener('keydown', onKey);
        document.body.append(overlay);
    });
}

// File/Blob → base64 data URI
function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
    });
}
