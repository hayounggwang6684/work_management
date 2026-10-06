// 로더 목록 ↔ 실제 파일 일치 검사 — node --test PDM/tests/loader.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PDM_SCRIPT_ORDER } = require('../web/pdm_loader.js');

const webDir = path.join(__dirname, '..', 'web');
const files = fs.readdirSync(webDir).filter(f => f.endsWith('.js') && f !== 'pdm_loader.js');

test('로더 목록에 없는 PDM 스크립트가 없다 (새 파일을 추가하면 목록에도 넣어야 한다)', () => {
    assert.deepEqual(files.filter(f => !PDM_SCRIPT_ORDER.includes(f)), []);
});

test('로더 목록의 파일이 모두 존재하고 중복이 없다', () => {
    assert.deepEqual(PDM_SCRIPT_ORDER.filter(f => !files.includes(f)), []);
    assert.equal(new Set(PDM_SCRIPT_ORDER).size, PDM_SCRIPT_ORDER.length);
});

test('의존 순서: dom.js 가 맨 앞, pdm.js(진입점)가 맨 뒤', () => {
    assert.equal(PDM_SCRIPT_ORDER[0], 'dom.js');
    assert.equal(PDM_SCRIPT_ORDER.at(-1), 'pdm.js');
});

test('주요 의존 순서 (사용되는 쪽이 정의하는 쪽보다 뒤)', () => {
    const idx = f => PDM_SCRIPT_ORDER.indexOf(f);
    const after = [['print_view.js', 'print_layout.js'], ['sr_print.js', 'print_view.js'], ['mm_print.js', 'mm_logic.js'],
        ['mm_print.js', 'print_view.js'], ['projects_view.js', 'projects_logic.js'], ['layout_editor.js', 'sr_print.js'],
        ['form_manager.js', 'mm_print.js'], ['photo_grid.js', 'photo_editor.js'], ['sr_editor.js', 'editor_bar.js'],
        ['sr_editor.js', 'photo_grid.js'], ['mm_editor.js', 'editor_bar.js'], ['pdm.js', 'projects_view.js']];
    for (const [later, earlier] of after) assert.ok(idx(later) > idx(earlier), `${later} 는 ${earlier} 뒤에 와야 한다`);
});

const { makeLoader } = require('../web/pdm_loader.js');

test('makeLoader: 순서대로 한 번만 불러오고, 같은 promise 를 재사용한다', async () => {
    const calls = [];
    const loader = makeLoader(['a', 'b', 'c'], async f => { calls.push(f); });
    const p1 = loader.load(), p2 = loader.load();
    assert.equal(p1, p2);
    await p1;
    await loader.load();
    assert.deepEqual(calls, ['a', 'b', 'c']);
});

test('makeLoader: 한 파일이 실패해도 다음에 다시 시도하고, 이미 불러온 파일은 다시 실행하지 않는다', async () => {
    const calls = [];
    let failB = true;
    const loader = makeLoader(['a', 'b', 'c'], async f => {
        calls.push(f);
        if (f === 'b' && failB) throw new Error('boom');
    });
    await assert.rejects(loader.load(), /boom/);
    failB = false;
    await loader.load();                                    // 실패한 promise 가 캐시되지 않는다
    assert.deepEqual(calls, ['a', 'b', 'b', 'c']);          // a 는 재실행하지 않음 (const 재선언 오류 방지)
});
