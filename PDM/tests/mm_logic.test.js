// 계측지 순수 로직 테스트 — node --test PDM/tests/mm_logic.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../web/mm_logic.js');

const blank = (r, c) => Array.from({ length: r }, () => Array(c).fill(''));

test('parseNum: 부호/소수/쉼표/공백, 비어 있거나 숫자가 아니면 null', () => {
    assert.equal(L.parseNum('2'), 2);
    assert.equal(L.parseNum(' -1 '), -1);
    assert.equal(L.parseNum('0,5'), 0.5);
    assert.equal(L.parseNum(''), null);
    assert.equal(L.parseNum('abc'), null);
});

test('calcClearance: (안지름 기준 + c/100) − (외경 기준 − c/100), TB/PS 중 큰 값', () => {
    const out = blank(4, 8), inner = blank(4, 8);
    // 1번 열 F: 외경 TB=2, PS=3 → 89.91-0.02=89.89 / 89.88 ; 안지름 기준 90.00, TB=5, PS=4 → 90.05 / 90.04
    out[0][0] = '2'; out[1][0] = '3'; inner[0][0] = '5'; inner[1][0] = '4';
    const r = L.calcClearance({ outDia: out, innerDia: inner }, { outDia: '89.91', innerDia: '90.00' });
    // TB: 90.05-89.89=0.16, PS: 90.04-89.88=0.16 → 0.16
    assert.equal(r[0][0], '0.16');
    assert.equal(r[0][1], '');            // 값이 없는 열은 빈칸
    assert.equal(r[1][0], '');            // A 행은 입력이 없으면 빈칸
});

test('calcClearance: 한 방향만 있어도 계산, 큰 쪽 선택', () => {
    const out = blank(4, 8), inner = blank(4, 8);
    out[2][3] = '1'; inner[2][3] = '10';          // A, TB
    out[3][3] = '1'; inner[3][3] = '20';          // A, PS (더 큼)
    const r = L.calcClearance({ outDia: out, innerDia: inner }, { outDia: '100', innerDia: '100' });
    assert.equal(r[1][3], '0.21');                // (100+0.20) − (100−0.01) = 0.21
});

test('calcClearance: 기준값이 비었거나 숫자가 아니면 전부 빈칸', () => {
    const out = blank(4, 8), inner = blank(4, 8);
    out[0][0] = '2'; inner[0][0] = '5';
    const r = L.calcClearance({ outDia: out, innerDia: inner }, { outDia: '89.91', innerDia: '' });
    assert.deepEqual(r, blank(2, 8));
});

test('applyPaste: 엑셀(TSV) 붙여넣기 — 시작 칸부터 채우고 범위를 넘으면 버림', () => {
    const g = blank(3, 3);
    const out = L.applyPaste(g, 1, 1, '1\t2\t3\n4\t5\t6\n7\t8\t9\n');
    assert.deepEqual(out, [['', '', ''], ['', '1', '2'], ['', '4', '5']]);
    assert.deepEqual(g, blank(3, 3));              // 원본은 변경하지 않음 (불변)
});

test('applyPaste: 한 칸 값, 끝의 빈 줄/CRLF, 앞뒤 공백', () => {
    assert.deepEqual(L.applyPaste(blank(2, 2), 0, 0, ' 7 \r\n'), [['7', ''], ['', '']]);
});

test('indexLines: 선택 순서대로 번호를 붙이고 (구분) 표기', () => {
    const forms = [{ formId: 'crankpin', side: 'PORT' }, { formId: 'conrod', side: 'STBD' }];
    const tpl = [{ id: 'crankpin', indexTitle: 'RECORD OF CRANK PIN BEARING' }, { id: 'conrod', indexTitle: 'RECORD OF CON ROD BIG END HOUSING' }];
    assert.deepEqual(L.indexLines(forms, tpl), [
        '1. RECORD OF CRANK PIN BEARING(PORT)', '2. RECORD OF CON ROD BIG END HOUSING(STBD)']);
});

test('makerTypeFor: 엔진 모델 + 구분', () => {
    assert.equal(L.makerTypeFor({ makerType: 'M/E FUSSO 91A' }, 'PORT'), 'M/E FUSSO 91A PORT');
    assert.equal(L.makerTypeFor({ makerType: '' }, 'PORT'), 'PORT');
});

test('formatUnit: 기준값 표기 ( 기준 ) ± C/100 mm', () => {
    assert.equal(L.formatUnit('89.91', '-'), 'Unit : ( 89.91 ) - C/100 mm');
    assert.equal(L.formatUnit('', '+'), 'Unit : (          ) + C/100 mm');
});
