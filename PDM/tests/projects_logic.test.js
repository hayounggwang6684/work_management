// 공사현황 순수 로직 테스트 — node --test PDM/tests/projects_logic.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../web/projects_logic.js');

const d = (y, m, day) => new Date(y, m - 1, day);

test('fmtDate: 로컬 날짜를 YYYY-MM-DD 로 (UTC 변환 없이)', () => {
    assert.equal(L.fmtDate(d(2026, 1, 5)), '2026-01-05');
    assert.equal(L.fmtDate(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
});

test('presetRange: 이번 달 / 지난 달(연초 경계) / 최근 3개월 / 올해', () => {
    const today = d(2026, 10, 6);
    assert.deepEqual(L.presetRange('thisMonth', today), { start: '2026-10-01', end: '2026-10-31' });
    assert.deepEqual(L.presetRange('lastMonth', today), { start: '2026-09-01', end: '2026-09-30' });
    assert.deepEqual(L.presetRange('lastMonth', d(2026, 1, 15)), { start: '2025-12-01', end: '2025-12-31' });
    assert.deepEqual(L.presetRange('last3Months', today), { start: '2026-08-01', end: '2026-10-31' });
    assert.deepEqual(L.presetRange('thisYear', today), { start: '2026-01-01', end: '2026-12-31' });
});

test('presetRange: 2월 말일(윤년 포함)', () => {
    assert.equal(L.presetRange('thisMonth', d(2028, 2, 10)).end, '2028-02-29');
    assert.equal(L.presetRange('thisMonth', d(2026, 2, 10)).end, '2026-02-28');
});

test('presetRange: 모르는 이름은 이번 달', () => {
    assert.deepEqual(L.presetRange('???', d(2026, 10, 6)), { start: '2026-10-01', end: '2026-10-31' });
});

const P = (n, last, sr = 0, mm = 0, ship = 'S') => ({ contractNumber: n, lastDate: last, shipName: ship, firstDate: '2026-01-01', daysInRange: 1, docs: { serviceReport: sr, measurement: mm } });

test('sortProjects: 문자열은 한글/영문 사전순, 방향 전환, 원본 불변', () => {
    const list = [P('B', '2026-06-01', 0, 0, '나'), P('A', '2026-06-02', 0, 0, '가')];
    const asc = L.sortProjects(list, 'shipName', 'asc');
    assert.deepEqual(asc.map(p => p.contractNumber), ['A', 'B']);
    assert.deepEqual(L.sortProjects(list, 'shipName', 'desc').map(p => p.contractNumber), ['B', 'A']);
    assert.deepEqual(list.map(p => p.contractNumber), ['B', 'A']);        // 원본 순서 유지
});

test('sortProjects: 숫자 열(문서 건수)은 숫자로 비교', () => {
    const list = [P('A', 'x', 10), P('B', 'x', 2), P('C', 'x', 3)];
    assert.deepEqual(L.sortProjects(list, 'serviceReport', 'asc').map(p => p.contractNumber), ['B', 'C', 'A']);
    assert.deepEqual(L.sortProjects(list, 'serviceReport', 'desc').map(p => p.contractNumber), ['A', 'C', 'B']);
});

test('sortProjects: 같은 값이면 계약번호로 안정 정렬', () => {
    const list = [P('B', '2026-06-01'), P('A', '2026-06-01')];
    assert.deepEqual(L.sortProjects(list, 'lastDate', 'desc').map(p => p.contractNumber), ['A', 'B']);
});

test('onlyUnwritten: 서비스레포트가 하나도 없는 주문만', () => {
    const list = [P('A', 'x', 1), P('B', 'x', 0, 2), P('C', 'x', 0, 0)];
    assert.deepEqual(L.filterUnwritten(list, true).map(p => p.contractNumber), ['B', 'C']);
    assert.equal(L.filterUnwritten(list, false).length, 3);
});

test('periodText: 같은 날/같은 해/해가 다를 때', () => {
    assert.equal(L.periodText('2026-05-20', '2026-05-20'), '2026-05-20');
    assert.equal(L.periodText('2026-05-20', '2026-06-23'), '2026-05-20 ~ 06-23');
    assert.equal(L.periodText('2025-12-30', '2026-01-02'), '2025-12-30 ~ 2026-01-02');
});
