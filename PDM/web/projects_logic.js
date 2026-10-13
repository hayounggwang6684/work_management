// 레포트관리 순수 로직 (DOM 없음 — node 로 테스트: node --test PDM/tests/projects_logic.test.js)
const ProjectsLogic = (() => {
    const pad = n => String(n).padStart(2, '0');
    // 로컬 날짜 → YYYY-MM-DD (toISOString 은 UTC 로 바뀌어 하루 어긋날 수 있다)
    const fmtDate = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

    // 기간 프리셋 → {start, end}. today 를 받아 테스트할 수 있게 한다.
    function presetRange(name, today = new Date()) {
        const y = today.getFullYear(), m = today.getMonth();
        const range = (from, to) => ({ start: fmtDate(from), end: fmtDate(to) });
        const lastDay = (yy, mm) => new Date(yy, mm + 1, 0);
        switch (name) {
            case 'lastMonth': return range(new Date(y, m - 1, 1), lastDay(y, m - 1));
            case 'last3Months': return range(new Date(y, m - 2, 1), lastDay(y, m));
            case 'thisYear': return range(new Date(y, 0, 1), new Date(y, 11, 31));
            default: return range(new Date(y, m, 1), lastDay(y, m));           // thisMonth
        }
    }

    // 정렬 키 → 값. 문서 건수는 숫자, 나머지는 문자열.
    const sortValue = (p, key) => (key === 'serviceReport' ? p.docs.serviceReport : key === 'measurement' ? p.docs.measurement : key === 'photoAlbum' ? p.docs.photoAlbum
        : key === 'daysInRange' ? p.daysInRange : String(p[key] ?? ''));

    // 새 배열 반환 (원본 불변). 같은 값이면 계약번호 순으로 안정 정렬.
    function sortProjects(list, key, dir = 'asc') {
        const sign = dir === 'desc' ? -1 : 1;
        return [...list].sort((a, b) => {
            const va = sortValue(a, key), vb = sortValue(b, key);
            const c = typeof va === 'number' ? va - vb : va.localeCompare(vb, 'ko');
            return c * sign || a.contractNumber.localeCompare(b.contractNumber);
        });
    }

    const filterUnwritten = (list, only) => (only ? list.filter(p => p.docs.serviceReport === 0) : list);

    // 작업 기간 표시: 같은 날 / 같은 해(종료일 연도 생략) / 해가 다를 때
    function periodText(first, last) {
        if (!first || first === last) return first || '';
        return first.slice(0, 4) === last.slice(0, 4) ? `${first} ~ ${last.slice(5)}` : `${first} ~ ${last}`;
    }

    return { fmtDate, presetRange, sortProjects, filterUnwritten, periodText };
})();

if (typeof module !== 'undefined') module.exports = ProjectsLogic;
