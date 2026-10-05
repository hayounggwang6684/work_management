// 사진 편집기 순수 함수 테스트 — node --test PDM/tests/photo_editor.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { lockAspect, cropFromDrag, currentCrop } = require('../web/photo_editor.js');

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('lockAspect: 가로가 기준, 세로는 비율에 맞게 (정사각 화면에서 4:3)', () => {
    // 화면 픽셀 비율 1:1 이면 w:h = 4:3 → h = w * 3/4
    const b = lockAspect([0.1, 0.1], [0.5, 0.9], 4 / 3, 1);
    close(b[0], 0.5);
    close(b[1], 0.1 + 0.4 * 0.75);
});

test('lockAspect: 화면 픽셀 비율을 반영 (가로로 긴 화면)', () => {
    // 화면이 2:1 이면 정규화 dx=0.3 은 픽셀 0.6, 4:3 이면 픽셀 높이 0.45 → 정규화 dy = 0.45 (높이 기준 1)
    const b = lockAspect([0, 0], [0.3, 1], 4 / 3, 2);
    close(b[1], 0.3 * 2 / (4 / 3));
});

test('lockAspect: 아래 공간이 모자라면 가로도 함께 줄여 비율 유지', () => {
    const b = lockAspect([0.1, 0.8], [0.9, 0.85], 4 / 3, 1);   // 세로 여유 0.2 뿐
    close(b[1] - 0.8, 0.2);
    close((b[0] - 0.1) / (b[1] - 0.8), 4 / 3);
});

test('lockAspect: 왼쪽/위로 끄는 방향도 지원', () => {
    const b = lockAspect([0.9, 0.9], [0.5, 0.5], 4 / 3, 1);
    close(b[0], 0.5);
    close(b[1], 0.9 - 0.4 * 0.75);
});

test('cropFromDrag: 보이는 영역 기준 선택을 원본 기준으로 변환', () => {
    const crop = { x: 0.5, y: 0.5, w: 0.5, h: 0.5 };
    const r = cropFromDrag(crop, [0, 0], [0.5, 0.5]);
    assert.deepEqual(r, { x: 0.5, y: 0.5, w: 0.25, h: 0.25 });
});

test('cropFromDrag: 너무 작으면 null', () => {
    assert.equal(cropFromDrag({ x: 0, y: 0, w: 1, h: 1 }, [0.2, 0.2], [0.21, 0.21]), null);
});

test('currentCrop: 마지막 crop 작업이 현재 영역, 없으면 전체', () => {
    assert.deepEqual(currentCrop([]), { x: 0, y: 0, w: 1, h: 1 });
    const ops = [{ type: 'crop', rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }, { type: 'pen' }, { type: 'crop', rect: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 } }];
    assert.deepEqual(currentCrop(ops), { x: 0.2, y: 0.2, w: 0.2, h: 0.2 });
});
