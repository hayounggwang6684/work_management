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

test('indexLines: 양식 순서대로 번호를 붙이고, 장 구분 라벨이 있으면 (라벨) 표기', () => {
    const forms = [{ formId: 'crankpin', label: '1호기' }, { formId: 'crankpin', label: '2호기' }, { formId: 'conrod', label: '' }];
    const tpl = [{ id: 'crankpin', indexTitle: 'RECORD OF CRANK PIN BEARING' }, { id: 'conrod', indexTitle: 'RECORD OF CON ROD BIG END HOUSING' }];
    assert.deepEqual(L.indexLines(forms, tpl), [
        '1. RECORD OF CRANK PIN BEARING(1호기)', '2. RECORD OF CRANK PIN BEARING(2호기)', '3. RECORD OF CON ROD BIG END HOUSING']);
});

test('makerTypeFor: 엔진 모델 + 구분', () => {
    assert.equal(L.makerTypeFor({ makerType: 'M/E FUSSO 91A' }, 'PORT'), 'M/E FUSSO 91A PORT');
    assert.equal(L.makerTypeFor({ makerType: '' }, 'PORT'), 'PORT');
});

test('formatUnit: 기준값 표기 ( 기준 ) ± C/100 mm', () => {
    assert.equal(L.formatUnit('89.91', '-'), 'Unit : ( 89.91 ) - C/100 mm');
    assert.equal(L.formatUnit('', '+'), 'Unit : (          ) + C/100 mm');
});

test('calcClearance: 사용자 정의 표 id(t1/t2)도 ids 로 지정해 계산', () => {
    const t1 = blank(4, 6), t2 = blank(4, 6);
    t1[0][0] = '2'; t2[0][0] = '5';
    const r = L.calcClearance({ t1, t2 }, { t1: '89.91', t2: '90.00' }, { outer: 't1', inner: 't2' });
    assert.equal(r[0][0], '0.16');
    assert.equal(r[0].length, 6);
});

test('roleIds: 양식 정의에서 역할별 표 id', () => {
    const form = { tables: [{ id: 'outDia', role: 'outer' }, { id: 'innerDia', role: 'inner' }, { id: 'clearance', role: 'clearance' }] };
    assert.deepEqual(L.roleIds(form), { outer: 'outDia', inner: 'innerDia', clearance: 'clearance' });
    assert.deepEqual(L.roleIds({ tables: [{ id: 't1', role: 'plain' }] }), { outer: undefined, inner: undefined, clearance: undefined });
});

const TPL = [{ id: 'crankpin' }, { id: 'mainjournal' }, { id: 'conrod' }];
const inst = (formId, label = '') => ({ formId, label });

test('sortForms: 양식 정의 순서로 정렬하되 같은 양식 안에서는 입력한 순서를 유지 (안정 정렬)', () => {
    const forms = [inst('conrod', 'A'), inst('crankpin', '2호기'), inst('crankpin', '1호기'), inst('mainjournal')];
    assert.deepEqual(L.sortForms(forms, TPL).map(f => `${f.formId}:${f.label}`),
        ['crankpin:2호기', 'crankpin:1호기', 'mainjournal:', 'conrod:A']);
    assert.equal(forms[0].formId, 'conrod');                 // 원본 불변
});

test('countOf: 양식별 장 수', () => {
    assert.equal(L.countOf([inst('crankpin'), inst('crankpin'), inst('conrod')], 'crankpin'), 2);
    assert.equal(L.countOf([], 'crankpin'), 0);
});

test('withPageCount: 늘리면 새 장을 뒤에 추가, 줄이면 뒤쪽 장부터 제거, 다른 양식은 그대로', () => {
    const base = [inst('crankpin', '1호기'), inst('conrod', 'X')];
    const made = [];
    const up = L.withPageCount(base, 'crankpin', 3, i => { made.push(i); return inst('crankpin', `new${i}`); });
    assert.deepEqual(up.map(f => f.label), ['1호기', 'new1', 'new2', 'X']);          // 같은 양식끼리 붙여서 추가
    assert.deepEqual(made, [1, 2]);                          // 이미 있는 0번째는 새로 만들지 않는다
    const down = L.withPageCount(up, 'crankpin', 1, () => { throw new Error('no new'); });
    assert.deepEqual(down.map(f => f.label), ['1호기', 'X']);
    assert.equal(L.withPageCount(base, 'conrod', 0, () => null).length, 1);
    assert.equal(base.length, 2);                            // 원본 불변
});

test('droppedBy: 장 수를 줄일 때 사라질 장 (뒤쪽부터)', () => {
    const forms = [inst('crankpin', 'a'), inst('crankpin', 'b'), inst('crankpin', 'c')];
    assert.deepEqual(L.droppedBy(forms, 'crankpin', 1).map(f => f.label), ['b', 'c']);
    assert.deepEqual(L.droppedBy(forms, 'crankpin', 3), []);
});

test('calcClearance perRow: 클리어런스 표가 4행(F/A × TB/PS)이면 행마다 계산한다', () => {
    const out = blank(4, 3), inner = blank(4, 3);
    out[0][0] = '2'; inner[0][0] = '5';          // F TB: (90.00+0.05) − (89.91−0.02) = 0.16
    out[3][2] = '1'; inner[3][2] = '10';         // A PS: (90.00+0.10) − (89.91−0.01) = 0.20
    out[1][1] = '4';                             // 안지름이 비어 있으면 그 칸만 빈칸
    const r = L.calcClearance({ outDia: out, innerDia: inner }, { outDia: '89.91', innerDia: '90.00' }, undefined, true);
    assert.equal(r.length, 4);
    assert.equal(r[0][0], '0.16');
    assert.equal(r[3][2], '0.20');
    assert.equal(r[1][1], '');
});

test('calcClearance perRow: 기준값이 없으면 4행 모두 빈칸', () => {
    const out = blank(4, 3), inner = blank(4, 3);
    out[0][0] = '2'; inner[0][0] = '5';
    assert.deepEqual(L.calcClearance({ outDia: out, innerDia: inner }, { outDia: '', innerDia: '90' }, undefined, true), blank(4, 3));
});
