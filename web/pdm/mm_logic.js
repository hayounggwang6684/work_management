// 계측지 순수 로직 (DOM 없음 — node 로 테스트: node --test PDM/tests/mm_logic.test.js)
const MmLogic = (() => {
    // 숫자 문자열 → number. 비었거나 숫자가 아니면 null (쉼표 소수점 허용)
    function parseNum(s) {
        const t = String(s ?? '').trim().replace(',', '.');
        if (t === '') return null;
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
    }

    // 표 행 순서: [F TB, F PS, A TB, A PS]. 실제 치수 = 기준 ∓ C/100  (외경: 기준 − C/100, 안지름: 기준 + C/100)
    // 클리어런스 = 안지름 − 외경.
    //   perRow=false(기본): 반환 [[F 열별 값], [A 열별 값]] — TB/PS 방향별로 구해 그 중 큰 값 (가정 — 규칙이 다르면 이 함수만 고치면 된다)
    //   perRow=true      : 클리어런스 표가 외경/안지름 표와 같은 행 구성(F/A × TB/PS)일 때 — 행마다 그대로 계산
    // 문자열(계산 불가는 ''). ids: 외경/안지름 표의 id (양식 정의의 role 이 outer/inner 인 표). 내장 양식은 outDia/innerDia.
    function calcClearance(tables, unitBase, ids = { outer: 'outDia', inner: 'innerDia' }, perRow = false) {
        const out = tables[ids.outer], inner = tables[ids.inner];
        const outBase = parseNum(unitBase[ids.outer]), innerBase = parseNum(unitBase[ids.inner]);
        const cols = out[0].length;
        const one = (r, c) => {
            const o = parseNum(out[r][c]), i = parseNum(inner[r][c]);
            return o === null || i === null ? null : (innerBase + i / 100) - (outBase - o / 100);
        };
        const blank = () => Array(cols).fill('');
        if (outBase === null || innerBase === null) return perRow ? out.map(blank) : [blank(), blank()];
        if (perRow) return out.map((_, r) => Array.from({ length: cols }, (_, c) => { const v = one(r, c); return v === null ? '' : v.toFixed(2); }));
        const result = [blank(), blank()];
        [[0, 1], [2, 3]].forEach((rows, g) => {
            for (let c = 0; c < cols; c++) {
                const values = rows.map(r => one(r, c)).filter(v => v !== null);
                if (values.length) result[g][c] = Math.max(...values).toFixed(2);
            }
        });
        return result;
    }

    // 양식 정의에서 역할별 표 id 찾기 → {outer, inner, clearance} (없으면 undefined)
    const roleIds = form => Object.fromEntries(['outer', 'inner', 'clearance'].map(role => [role, (form.tables || []).find(t => t.role === role)?.id]));

    // 엑셀에서 복사한 탭/줄바꿈 텍스트를 (r0,c0) 부터 채운 새 격자. 범위를 넘는 값은 버리고 원본은 바꾸지 않는다.
    function applyPaste(grid, r0, c0, text) {
        const lines = String(text).replace(/\r/g, '').replace(/\n+$/, '').split('\n');
        const out = grid.map(row => row.slice());
        lines.forEach((line, i) => line.split('\t').forEach((cell, j) => {
            if (out[r0 + i] && c0 + j < out[r0 + i].length) out[r0 + i][c0 + j] = cell.trim();
        }));
        return out;
    }

    // 표지 INDEX 줄: "1. RECORD OF CRANK PIN BEARING(1호기)" — 장 구분 라벨이 없으면 괄호 생략
    function indexLines(forms, templates) {
        const byId = Object.fromEntries(templates.map(t => [t.id, t]));
        return forms.map((f, i) => `${i + 1}. ${byId[f.formId].indexTitle}${f.label ? `(${f.label})` : ''}`);
    }

    // 양식 정의 순서로 정렬 (같은 양식 안에서는 입력한 순서 유지). 새 배열 반환.
    function sortForms(forms, templates) {
        const order = Object.fromEntries(templates.map((t, i) => [t.id, i]));
        return forms.map((f, i) => [f, i]).sort((a, b) => order[a[0].formId] - order[b[0].formId] || a[1] - b[1]).map(x => x[0]);
    }

    const countOf = (forms, formId) => forms.filter(f => f.formId === formId).length;

    // 양식 하나의 장 수를 count 로 맞춘 새 배열. 늘리면 같은 양식 뒤에 makeInstance(번째)로 만든 장을 붙이고,
    // 줄이면 뒤쪽 장부터 뺀다. 이미 있는 장(앞쪽)은 그대로 유지한다.
    function withPageCount(forms, formId, count, makeInstance) {
        const have = countOf(forms, formId);
        if (count <= have) {
            let seen = 0;
            return forms.filter(f => f.formId !== formId || ++seen <= count);
        }
        const added = Array.from({ length: count - have }, (_, i) => makeInstance(have + i));
        const lastAt = forms.map(f => f.formId).lastIndexOf(formId);
        const at = lastAt >= 0 ? lastAt + 1 : forms.length;
        return [...forms.slice(0, at), ...added, ...forms.slice(at)];
    }

    // 장 수를 count 로 줄일 때 사라질 장들 (확인 대화상자용)
    const droppedBy = (forms, formId, count) => forms.filter(f => f.formId === formId).slice(count);

    const makerTypeFor = (header, label) => [header.makerType, label].filter(Boolean).join(' ');

    // "Unit : ( 89.91 ) - C/100 mm" (기준값이 비면 직접 쓸 빈칸)
    const formatUnit = (base, op) => `Unit : ( ${base || '        '} ) ${op} C/100 mm`;

    return { parseNum, calcClearance, roleIds, applyPaste, indexLines, sortForms, countOf, withPageCount, droppedBy, makerTypeFor, formatUnit };
})();

if (typeof module !== 'undefined') module.exports = MmLogic;
