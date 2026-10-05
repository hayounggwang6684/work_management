// 계측지 순수 로직 (DOM 없음 — node 로 테스트: node --test PDM/tests/mm_logic.test.js)
const MmLogic = (() => {
    // 숫자 문자열 → number. 비었거나 숫자가 아니면 null (쉼표 소수점 허용)
    function parseNum(s) {
        const t = String(s ?? '').trim().replace(',', '.');
        if (t === '') return null;
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
    }

    // 표 행 순서: [F TB, F PS, A TB, A PS]. 반환: [[F 열별 값], [A 열별 값]] (문자열, 계산 불가는 '')
    // 실제 치수 = 기준 ∓ C/100  (외경: 기준 − C/100, 안지름: 기준 + C/100)
    // 클리어런스 = 안지름 − 외경 을 TB/PS 방향별로 구해 그 중 큰 값 (가정 — 규칙이 다르면 이 함수만 고치면 된다)
    function calcClearance(tables, unitBase) {
        const outBase = parseNum(unitBase.outDia), innerBase = parseNum(unitBase.innerDia);
        const cols = tables.outDia[0].length;
        const result = [Array(cols).fill(''), Array(cols).fill('')];
        if (outBase === null || innerBase === null) return result;
        [[0, 1], [2, 3]].forEach((rows, g) => {
            for (let c = 0; c < cols; c++) {
                const values = rows.flatMap(r => {
                    const o = parseNum(tables.outDia[r][c]), i = parseNum(tables.innerDia[r][c]);
                    return o === null || i === null ? [] : [(innerBase + i / 100) - (outBase - o / 100)];
                });
                if (values.length) result[g][c] = Math.max(...values).toFixed(2);
            }
        });
        return result;
    }

    // 엑셀에서 복사한 탭/줄바꿈 텍스트를 (r0,c0) 부터 채운 새 격자. 범위를 넘는 값은 버리고 원본은 바꾸지 않는다.
    function applyPaste(grid, r0, c0, text) {
        const lines = String(text).replace(/\r/g, '').replace(/\n+$/, '').split('\n');
        const out = grid.map(row => row.slice());
        lines.forEach((line, i) => line.split('\t').forEach((cell, j) => {
            if (out[r0 + i] && c0 + j < out[r0 + i].length) out[r0 + i][c0 + j] = cell.trim();
        }));
        return out;
    }

    // 표지 INDEX 줄: "1. RECORD OF CRANK PIN BEARING(PORT)"
    function indexLines(forms, templates) {
        const byId = Object.fromEntries(templates.map(t => [t.id, t]));
        return forms.map((f, i) => `${i + 1}. ${byId[f.formId].indexTitle}(${f.side})`);
    }

    const makerTypeFor = (header, side) => [header.makerType, side].filter(Boolean).join(' ');

    // "Unit : ( 89.91 ) - C/100 mm" (기준값이 비면 직접 쓸 빈칸)
    const formatUnit = (base, op) => `Unit : ( ${base || '        '} ) ${op} C/100 mm`;

    return { parseNum, calcClearance, applyPaste, indexLines, makerTypeFor, formatUnit };
})();

if (typeof module !== 'undefined') module.exports = MmLogic;
