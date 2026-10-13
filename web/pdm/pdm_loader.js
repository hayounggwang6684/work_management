// PDM 스크립트 로더 — 이 파일 하나만 <script> 로 넣으면 나머지를 의존 순서대로 불러온다.
//   본체(index.html): <script src="pdm/pdm_loader.js"></script>  →  PdmLoader.load().then(() => PDM.mount(el))
//   단독(pdm.html)  : 같은 방식.  이 목록이 PDM 스크립트의 유일한 순서 정의다 (tests 가 파일과 일치하는지 검사).
// 이 파일의 ?v= 쿼리는 하위 스크립트에도 붙여 패치 후 캐시를 갱신한다.
const PDM_SCRIPT_ORDER = [
    'dom.js', 'sr_fields.js', 'print_assets.js', 'print_layout.js', 'print_logic.js', 'print_view.js', 'sr_print.js',
    'mm_assets.js', 'mm_logic.js', 'mm_print.js', 'album_print.js', 'projects_logic.js', 'projects_view.js', 'layout_editor.js', 'form_manager.js', 'standards_manager.js',
    'photo_editor.js', 'photo_grid.js', 'editor_bar.js', 'sr_editor.js', 'mm_editor.js', 'album_editor.js', 'order_dialog.js', 'pdm.js',
];

// 로더 팩토리: loadScript(file) → Promise. 순서대로 한 번씩 불러오며,
//   · 진행 중/성공한 결과는 같은 promise 를 재사용하고
//   · 실패하면 캐시하지 않아 다음 load() 가 다시 시도하되, 이미 불러온 파일은 다시 실행하지 않는다
//     (스크립트를 다시 실행하면 최상위 const 재선언 오류가 난다).
function makeLoader(order, loadScript) {
    const done = new Set();
    let promise = null;
    const loadOne = file => (done.has(file) ? Promise.resolve() : loadScript(file).then(() => { done.add(file); }));
    return {
        load() {
            if (!promise) {
                promise = order.reduce((p, f) => p.then(() => loadOne(f)), Promise.resolve())
                    .catch(err => { promise = null; throw err; });
            }
            return promise;
        },
    };
}

const PdmLoader = (() => {
    if (typeof document === 'undefined') return null;               // node(테스트): 팩토리만 쓴다
    const self = document.currentScript;
    const base = self.src.replace(/\?.*$/, '').replace(/[^/]*$/, '');
    const query = new URL(self.src, location.href).search || '';
    return makeLoader(PDM_SCRIPT_ORDER, file => new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = base + file + query;
        s.onload = resolve;
        s.onerror = () => reject(new Error('PDM 스크립트를 불러오지 못했습니다: ' + file));
        document.head.append(s);
    }));
})();

if (typeof module !== 'undefined') module.exports = { PDM_SCRIPT_ORDER, makeLoader };
