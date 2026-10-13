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

// ── 부품사진첩 표지 INDEX ─────────────────────────────────────────────────────

test('albumIndexLines: 구간(소제목)마다 "번호. 제목 (n매)", 제목이 하나도 없으면 작업 사진 한 줄', () => {
    const pages = L.photoPages([{ id: 1, slotIndex: 0 }, { id: 2, slotIndex: 1 }, { id: 3, slotIndex: 6 }], 6);
    assert.deepEqual(L.albumIndexLines(pages, { 0: ' NO.1 G/E 쿨러 외 ' }), ['1. NO.1 G/E 쿨러 외 (3매)']);       // 둘째 페이지는 제목이 없어 앞 구간에 합산
    assert.deepEqual(L.albumIndexLines(pages, { 0: 'A', 1: 'B' }), ['1. A (2매)', '2. B (1매)']);
    assert.deepEqual(L.albumIndexLines(pages, {}), ['1. 작업 사진 (3매)']);
});

test('albumIndexLines: 제목 없는 이어지는 페이지는 앞 구간에 합산 (구간 = 소제목 하나)', () => {
    const photos = Array.from({ length: 14 }, (_, i) => ({ id: i, slotIndex: i < 8 ? i : 12 + (i - 8) }));   // 구간1: 페이지 0~1(8장), 구간2: 페이지 2
    const pages = L.photoPages(photos, 6);
    assert.deepEqual(L.albumIndexLines(pages, { 0: '1호기', 2: '2호기' }), ['1. 1호기 (8매)', '2. 2호기 (6매)']);
});

test('albumIndexLines: 최대 줄 수를 넘으면 마지막 줄을 "… 외 N건"으로', () => {
    const pages = L.photoPages(Array.from({ length: 8 }, (_, i) => ({ id: i, slotIndex: i * 6 })), 6);
    const titles = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, `항목${i + 1}`]));
    const lines = L.albumIndexLines(pages, titles, 6);
    assert.equal(lines.length, 6);
    assert.equal(lines[4], '5. 항목5 (1매)');
    assert.equal(lines[5], '… 외 3건');
    assert.deepEqual(L.albumIndexLines([], {}), []);
});

// ── 소제목 구간(섹션) ─────────────────────────────────────────────────────────

test('sectionOf: 제목 있는 페이지가 구간 시작, 제목 없는 페이지는 앞 구간에 속함', () => {
    const titles = { 0: '1호기', 2: '2호기', 5: '3호기' };
    assert.deepEqual(L.sectionOf(titles, 0), { startPage: 0, endPage: 2 });
    assert.deepEqual(L.sectionOf(titles, 1), { startPage: 0, endPage: 2 });
    assert.deepEqual(L.sectionOf(titles, 2), { startPage: 2, endPage: 5 });
    assert.deepEqual(L.sectionOf(titles, 4), { startPage: 2, endPage: 5 });
    assert.deepEqual(L.sectionOf(titles, 5), { startPage: 5, endPage: null });     // 마지막 구간은 끝까지
    assert.deepEqual(L.sectionOf(titles, 9), { startPage: 5, endPage: null });
});

test('sectionOf: 제목이 하나도 없으면 문서 전체가 한 구간, 공백뿐인 제목은 없는 것으로', () => {
    assert.deepEqual(L.sectionOf({}, 3), { startPage: 0, endPage: null });
    assert.deepEqual(L.sectionOf({ 1: '   ' }, 2), { startPage: 0, endPage: null });
    assert.deepEqual(L.sectionOf({ 0: 'A', 3: 'B' }, 1), { startPage: 0, endPage: 3 });
});

test('shiftTitles: 지정 페이지 이상의 제목만 한 페이지씩 뒤로, 원본은 그대로', () => {
    const titles = { 0: '1호기', 2: '2호기', 3: '3호기' };
    assert.deepEqual(L.shiftTitles(titles, 1), { 0: '1호기', 3: '2호기', 4: '3호기' });
    assert.deepEqual(L.shiftTitles(titles, 0), { 1: '1호기', 3: '2호기', 4: '3호기' });
    assert.deepEqual(titles, { 0: '1호기', 2: '2호기', 3: '3호기' });
});

test('expandEngine: 제조사 약어를 풀네임으로 (CUM\' CUM. CAT), 이미 풀네임/다른 글자는 그대로', () => {
    assert.equal(L.expandEngine("CUM' KTA19"), 'CUMMINS KTA19');
    assert.equal(L.expandEngine('M/E CUM. KTA38'), 'M/E CUMMINS KTA38');
    assert.equal(L.expandEngine('cat 3512'), 'CATERPILLAR 3512');
    assert.equal(L.expandEngine('CUMMINS KTA38'), 'CUMMINS KTA38');
    assert.equal(L.expandEngine('CUMBERLAND X'), 'CUMBERLAND X');
    assert.equal(L.expandEngine(null), '');
});

// ── Summary / Remark 배치 ─────────────────────────────────────────────────────

const sum = n => Array.from({ length: n }, (_, i) => `line ${i + 1}`);

test('planServiceReport: Summary 가 첫 페이지에 들어가면 Remark 도 첫 페이지 정해진 자리', () => {
    const p = L.planServiceReport(sum(18), ['r']);
    assert.equal(p.remarkOnFirst, true);
    assert.deepEqual(p.rest, []);
    assert.equal(p.first.length, 18);
});

test('planServiceReport: Summary 가 넘치면 Remark 는 첫 페이지에서 빠지고 마지막 Summary 줄 아래로', () => {
    const p = L.planServiceReport(sum(30), ['r1', 'r2']);
    assert.equal(p.remarkOnFirst, false);
    assert.equal(p.first.length, 18);
    assert.deepEqual(p.rest.map(r => [r.lines.length, r.remark]), [[12, 'after']]);
});

test('planServiceReport: 마지막 페이지에 Remark 가 들어갈 줄이 없으면 Remark 만 있는 새 페이지', () => {
    assert.deepEqual(L.planServiceReport(sum(18 + 37), ['r']).rest.map(r => [r.lines.length, r.remark]), [[37, false], [0, 'top']]);
    // 38줄 가득이면 제목 2줄 + 1줄이 모자라고, 35줄이면 딱 들어간다
    assert.deepEqual(L.planServiceReport(sum(18 + 35), ['r']).rest.map(r => [r.lines.length, r.remark]), [[35, 'after']]);
    assert.deepEqual(L.planServiceReport(sum(19), Array(40).fill('x')).rest.map(r => [r.lines.length, r.remark]), [[1, false], [0, 'top']]);
});

test('planServiceReport: Remark 가 비어 있어도 Remark 제목 자리는 Summary 뒤에 둔다 (최소 1줄)', () => {
    assert.deepEqual(L.planServiceReport(sum(40), []).rest.map(r => r.remark), ['after']);
});
