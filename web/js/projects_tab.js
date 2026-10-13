// 레포트관리 탭 — PDM(서비스레포트/계측지) 화면을 #projectsView 에 붙인다.
// PDM 스크립트(web/pdm/, 원본은 PDM/web)는 탭을 처음 열 때 한 번만 불러온다 (앱 시작 속도/오류 격리).
// 의존: pdm/pdm_loader.js (PdmLoader), eel

window.PDM_EMBEDDED = true;           // 본체에 붙은 상태 — 편집기의 [저장]은 상단 💾 저장 버튼으로 통합 (editor_bar.js)
let _pdmMounted = false;
let _pdmMounting = null;      // 진행 중인 마운트 — 빠르게 연타해도 한 번만 마운트한다

// 관리자 페이지 '레포트 설정' 탭 — 관리자는 일반 화면(레포트관리 탭)에 들어가지 않으므로 PDM 의 관리자 전용 설정 화면(출력 양식/계측 양식/계측 표준값)을 여기서 연다.
let _pdmAdminMounting = null;

function openAdminReportTab() {
    const el = document.getElementById('adminReportTab');
    if (!el) return Promise.resolve();
    if (!_pdmAdminMounting) {
        el.textContent = '불러오는 중…';
        _pdmAdminMounting = PdmLoader.load()
            .then(() => PDM.mountAdmin(el))
            .catch(e => {                     // 실패하면 다음에 탭을 열 때 다시 시도한다
                console.error('레포트 설정 로드 실패:', e);
                el.textContent = '레포트 설정을 불러오지 못했습니다: ' + (e && e.message ? e.message : e);
            })
            .finally(() => { _pdmAdminMounting = null; });
    }
    return _pdmAdminMounting;
}

function openProjectsTab() {
    const el = document.getElementById('projectsView');
    if (!el) return Promise.resolve();
    if (_pdmMounted) {
        PDM.show();                           // 이미 열려 있으면 목록(문서 건수)만 갱신
        return Promise.resolve();
    }
    if (!_pdmMounting) {
        el.textContent = '불러오는 중…';
        _pdmMounting = PdmLoader.load()
            .then(() => PDM.mount(el))
            .then(() => { _pdmMounted = true; })
            .catch(e => {                     // 실패하면 다음에 탭을 열 때 다시 시도한다
                console.error('레포트관리 로드 실패:', e);
                el.textContent = '레포트관리을 불러오지 못했습니다: ' + (e && e.message ? e.message : e);
            })
            .finally(() => { _pdmMounting = null; });
    }
    return _pdmMounting;
}
