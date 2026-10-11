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

// ── 사진 페이지 배치 (6장 세로 / 4장 가로) ────────────────────────────────────

test('PHOTO_GEOMETRY: 6장은 세로 A4(2x3), 4장은 가로 A4(2x2)', () => {
    assert.deepEqual([L.PHOTO_GEOMETRY[6].landscape, L.PHOTO_GEOMETRY[4].landscape], [false, true]);
    assert.deepEqual([L.PHOTO_GEOMETRY[6].page.w, L.PHOTO_GEOMETRY[6].page.h], [210, 297]);
    assert.deepEqual([L.PHOTO_GEOMETRY[4].page.w, L.PHOTO_GEOMETRY[4].page.h], [297, 210]);
    assert.equal(L.PHOTO_GEOMETRY[6].rows.length * 2, 6);
    assert.equal(L.PHOTO_GEOMETRY[4].rows.length * 2, 4);
});

test('slotPosition: 칸 번호 → 좌표 (왼→오, 위→아래)', () => {
    const g6 = L.PHOTO_GEOMETRY[6];
    assert.deepEqual(L.slotPosition(6, 0), { x: g6.cols[0], y: g6.rows[0] });
    assert.deepEqual(L.slotPosition(6, 3), { x: g6.cols[1], y: g6.rows[1] });
    assert.deepEqual(L.slotPosition(6, 5), { x: g6.cols[1], y: g6.rows[2] });
    const g4 = L.PHOTO_GEOMETRY[4];
    assert.deepEqual(L.slotPosition(4, 2), { x: g4.cols[0], y: g4.rows[1] });
});

for (const per of [6, 4]) {
    test(`${per}장 배치: 모든 칸(사진+캡션)이 페이지 안에 있고 서로 겹치지 않으며 푸터 위에 있다`, () => {
        const g = L.PHOTO_GEOMETRY[per];
        const boxes = Array.from({ length: per }, (_, i) => {
            const { x, y } = L.slotPosition(per, i);
            return { x, y, w: g.photo.w, h: g.captionDy + g.captionH };
        });
        for (const b of boxes) {
            assert.ok(b.x >= 0 && b.x + b.w <= g.page.w, `가로 범위 ${JSON.stringify(b)}`);
            assert.ok(b.y >= g.band.y + g.band.h, '제목 띠 아래에서 시작');
            assert.ok(b.y + b.h <= g.footerTop, `푸터(${g.footerTop}) 위에서 끝나야 함: ${b.y + b.h}`);
        }
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
            assert.ok(!overlap, `칸 ${i} 와 ${j} 가 겹침`);
        }
    });
}

test('photoPages: 4장 기준으로 묶으면 페이지가 더 많아진다', () => {
    const photos = Array.from({ length: 6 }, (_, i) => ({ id: i, slotIndex: i }));
    assert.equal(L.photoPages(photos, 6).length, 1);
    assert.equal(L.photoPages(photos, 4).length, 2);
    assert.equal(L.photoPages(photos, 4)[1].slots[1].id, 5);
});
