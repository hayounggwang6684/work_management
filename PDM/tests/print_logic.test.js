// 출력 로직 테스트 — node --test PDM/tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../web/print_logic.js');

const lines = n => Array.from({ length: n }, (_, i) => `line ${i + 1}`);

test('splitSummary: 첫 페이지 용량 안이면 한 덩어리', () => {
    const out = L.splitSummary(lines(10), 18, 38);
    assert.equal(out.length, 1);
    assert.equal(out[0].length, 10);
});

test('splitSummary: 첫 페이지 18줄, 넘치면 다음 페이지로 이어짐', () => {
    const out = L.splitSummary(lines(60), 18, 38);
    assert.deepEqual(out.map(c => c.length), [18, 38, 4]);
    assert.equal(out[1][0], 'line 19');
});

test('splitSummary: 빈 입력도 빈 첫 페이지 하나', () => {
    assert.deepEqual(L.splitSummary([], 18, 38), [[]]);
});

test('photoPages: 사진이 있는 페이지만, 슬롯 위치 유지', () => {
    const photos = [{ id: 1, slotIndex: 0 }, { id: 2, slotIndex: 2 }, { id: 3, slotIndex: 13 }];
    const pages = L.photoPages(photos, 6);
    assert.deepEqual(pages.map(p => p.page), [0, 2]);       // 1페이지(6~11)는 비어 있어 건너뜀
    assert.equal(pages[0].slots[0].id, 1);
    assert.equal(pages[0].slots[1], undefined);              // 빈칸은 그대로 비워 둠
    assert.equal(pages[0].slots[2].id, 2);
    assert.equal(pages[1].slots[1].id, 3);                   // 13 → 페이지 2의 1번 칸
});

test('photoPages: 사진 없으면 빈 배열', () => {
    assert.deepEqual(L.photoPages([], 6), []);
});

test('pageLabel', () => {
    assert.equal(L.pageLabel(3, 19), '3 / 19');
});
