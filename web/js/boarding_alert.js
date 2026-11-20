// 승선신고서 만료 임박 알림 — 로그인 직후, 쓰기 권한이 있는 사용자에게만 한 번 팝업으로 보여 준다.
//   대상: 만료 3일 전부터(이미 지난 것 포함), 준공 처리되기 전까지의 공사 (서버가 판정 — get_boarding_expiry_alerts).
//   [오늘 그만 보기]를 누르면 오늘은 다시 뜨지 않는다 (이 PC 의 localStorage, 사용자별·날짜별).
// 의존: eel, currentUser(auth.js), showView(app.js)
(() => {
    const snoozeKey = () => 'boardingAlertSnooze:' + ((typeof currentUser !== 'undefined' && currentUser && currentUser.user_id) || '');

    const readSnooze = () => { try { return localStorage.getItem(snoozeKey()) || ''; } catch (e) { return ''; } };
    const writeSnooze = today => { try { localStorage.setItem(snoozeKey(), today); } catch (e) { /* 저장 못 하면 다음 로그인 때 다시 뜬다 */ } };

    const daysText = n => (n > 0 ? `D-${n}` : n === 0 ? '오늘 만료' : `${-n}일 지남`);

    function build(alerts, today) {
        const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
        const overlay = el('div', 'fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4');
        overlay.id = 'boardingAlertPopup';
        const box = el('div', 'bg-white rounded-lg shadow-xl w-full max-w-xl max-h-[85vh] flex flex-col');
        box.append(el('h3', 'font-bold text-lg px-5 pt-4', '⚠ 승선신고서 만료 임박'),
                   el('p', 'text-sm text-slate-500 px-5 pb-2', '만료 3일 전부터 준공 처리될 때까지 알려 드립니다.'));
        const list = el('ul', 'px-5 overflow-y-auto divide-y');
        alerts.forEach(a => {
            const li = el('li', 'py-2 flex items-center gap-3 text-sm');
            const info = el('div', 'flex-1 min-w-0');
            info.append(el('div', 'font-mono font-medium', a.contractNumber), el('div', 'text-xs text-slate-500 truncate', [a.shipName, a.company].filter(Boolean).join(' · ')));
            const badge = el('span', 'px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap ' + (a.daysLeft < 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'), daysText(a.daysLeft));
            li.append(info, el('span', 'text-slate-600 whitespace-nowrap', a.expiryDate), badge);
            list.append(li);
        });
        const close = () => overlay.remove();
        const bar = el('div', 'flex flex-wrap justify-end gap-2 px-5 py-4');
        const open = el('button', 'px-3 py-1.5 rounded bg-slate-200', '세관서류 화면으로');
        open.onclick = () => { close(); if (typeof showView === 'function') showView('docCustoms'); };
        const snooze = el('button', 'px-3 py-1.5 rounded bg-slate-200', '오늘 그만 보기');
        snooze.onclick = () => { writeSnooze(today); close(); };
        const ok = el('button', 'px-3 py-1.5 rounded bg-blue-600 text-white', '확인');
        ok.onclick = close;
        bar.append(open, snooze, ok);
        box.append(list, bar);
        overlay.append(box);
        return overlay;
    }

    // 로그인 직후 한 번 부른다 (auth.js showMainApp). 실패해도 로그인 흐름에는 영향이 없다.
    window.checkBoardingExpiryAlerts = async function checkBoardingExpiryAlerts() {
        try {
            if (!currentUser || !currentUser.can_write || currentUser.is_guest) return;
            if (document.getElementById('boardingAlertPopup')) return;
            const result = await eel.get_boarding_expiry_alerts()();
            if (!result || !result.success || !result.alerts.length) return;
            if (readSnooze() === result.today) return;
            document.body.append(build(result.alerts, result.today));
        } catch (e) {
            console.warn('승선신고서 만료 알림 확인 실패:', e);
        }
    };
})();
