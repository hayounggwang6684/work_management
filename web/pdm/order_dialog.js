// 판매용 주문 입력 창 (신규 / 수정) — 계약번호, 선사, 선박, 엔진. 작업현황에 공사가 없는 건(부품 판매 등)의 레포트용.
// open(onSubmit, initial?) — initial 이 있으면 수정 창(값 미리 채움). onSubmit(값) → Promise<{success, message}>: 성공하면 창을 닫고, 실패하면 메시지를 보여 주며 열어 둔다.
// 의존: dom.js(h)
const OrderDialog = (() => {
    const INPUT = 'w-full border border-slate-300 rounded px-2 py-1.5 text-sm bg-white';
    const FIELDS = [['contractNumber', '계약번호', true], ['company', '선사(업체)', false], ['shipName', '선박', true], ['engineModel', '엔진', false]];

    function open(onSubmit, initial = null) {
        document.getElementById('pdmOrderDialog')?.remove();
        const values = { contractNumber: '', company: '', shipName: '', engineModel: '', ...(initial || {}) };
        const message = h('p', { class: 'text-sm text-red-600 min-h-5' });
        const inputs = FIELDS.map(([key, label, required]) => {
            const i = h('input', { class: INPUT, maxlength: 100, value: values[key] || '' });
            i.addEventListener('input', () => { values[key] = i.value; });
            return [key, h('label', { class: 'block text-xs text-slate-500' }, label + (required ? ' *' : ''), i), i];
        });
        const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
        const onKey = e => { if (e.key === 'Escape') close(); };
        const ok = h('button', { class: 'px-4 py-1.5 rounded bg-blue-600 text-white' }, initial ? '저장' : '만들기');
        const submit = async () => {
            ok.disabled = true; message.textContent = '';
            let r;
            try { r = await onSubmit({ ...values }); } catch (e) { r = { success: false, message: '서버와 통신하지 못했습니다.' }; }
            if (r.success) close();
            else { message.textContent = r.message || '만들지 못했습니다.'; ok.disabled = false; }
        };
        ok.addEventListener('click', submit);
        for (const [, , i] of inputs) i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
        const overlay = h('div', { id: 'pdmOrderDialog', class: 'fixed inset-0 z-50 flex items-center justify-center bg-black/40' },
            h('div', { class: 'bg-white rounded-lg shadow-xl p-5 w-96 space-y-3' },
                h('h2', { class: 'font-bold text-lg' }, initial ? '판매 주문 수정' : '신규 (판매용 부품사진첩)'),
                h('p', { class: 'text-xs text-slate-500' }, initial
                    ? '계약번호를 바꾸면 이 주문의 문서도 함께 옮겨지고, 문서 안의 같은 값(계약번호/업체/선박/엔진)도 새 값으로 바뀝니다.'
                    : '작업현황에 공사가 없는 건을 등록합니다. 표지가 포함된 부품사진첩이 만들어지고, 목록에서 서비스레포트·계측지도 만들 수 있습니다.'),
                ...inputs.map(([, label]) => label), message,
                h('div', { class: 'flex justify-end gap-2' }, h('button', { class: 'px-4 py-1.5 rounded bg-slate-200', onclick: close }, '취소'), ok)));
        document.body.append(overlay);
        document.addEventListener('keydown', onKey);
        inputs[0][2].focus();
    }

    return { open };
})();
