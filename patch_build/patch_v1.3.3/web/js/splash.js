// web/js/splash.js - 스플래시 로딩 화면 제어

(function () {
    // =========================================================
    // 진행 단계별 재미있는 메시지 목록
    // =========================================================
    const STEPS = [
        { pct: 5,  msg: '⚙️ 엔진 예열 중...',             sub: '기어 돌아가는 소리가 들리시나요?' },
        { pct: 15, msg: '🔧 렌치 찾는 중...',             sub: '공구함 어디 뒀더라...' },
        { pct: 25, msg: '📋 작업일지 펼치는 중...',        sub: '오늘도 열심히 해봅시다!' },
        { pct: 35, msg: '🚢 선박 현황 확인 중...',         sub: '모든 배가 제자리에 있는지 확인합니다' },
        { pct: 45, msg: '🗄️ 데이터베이스 깨우는 중...',   sub: 'DB가 기지개를 켜고 있습니다' },
        { pct: 55, msg: '👷 작업자 명단 불러오는 중...',   sub: '오늘 출근 체크!' },
        { pct: 65, msg: '📡 서버와 악수하는 중...',        sub: '통신 채널 확보 중...' },
        { pct: 75, msg: '🔐 보안 점검 중...',              sub: '자물쇠 꼭 잠겼나 확인합니다' },
        { pct: 85, msg: '🎨 화면 단장 중...',              sub: '예쁘게 꾸며드리겠습니다' },
        { pct: 95, msg: '✅ 거의 다 됐습니다!',            sub: '마지막 점검 중...' },
        { pct: 100, msg: '🚀 준비 완료!',                  sub: '출항 준비 완료입니다' },
    ];

    let stepIndex = 0;
    let intervalId = null;
    let finished = false;
    let readyToClose = false;  // eel 준비 신호 받았는지

    // =========================================================
    // 진행바 업데이트
    // =========================================================
    function setProgress(pct, msg, sub) {
        const bar = document.getElementById('splashProgress');
        const pctEl = document.getElementById('splashPercent');
        const msgEl = document.getElementById('splashMessage');
        const subEl = document.getElementById('splashSubMessage');
        if (bar) bar.style.width = pct + '%';
        if (pctEl) pctEl.textContent = pct + '%';
        if (msg && msgEl) {
            msgEl.style.opacity = '0';
            setTimeout(() => {
                msgEl.textContent = msg;
                msgEl.style.opacity = '1';
            }, 200);
        }
        if (sub && subEl) subEl.textContent = sub;
    }

    // =========================================================
    // 자동 진행 (타이머 기반)
    // =========================================================
    function startAutoProgress() {
        intervalId = setInterval(() => {
            if (finished) return;
            if (stepIndex >= STEPS.length - 1) {
                // 마지막 직전에서 멈춤 — eel 신호 기다림
                clearInterval(intervalId);
                return;
            }
            const step = STEPS[stepIndex];
            setProgress(step.pct, step.msg, step.sub);
            stepIndex++;

            // 65% 도달 시 멈추고 eel 패치 결과 확인
            if (step.pct >= 65) {
                clearInterval(intervalId);
                checkUpdateAndClose();
                return;
            }

            // eel이 이미 준비됐으면 바로 닫기
            if (readyToClose && stepIndex >= STEPS.length - 1) {
                closeSplash();
            }
        }, 600);  // 600ms마다 다음 단계
    }

    // =========================================================
    // eel 패치 결과 조회 후 splashReady 호출
    // =========================================================
    function checkUpdateAndClose() {
        if (typeof eel === 'undefined' || typeof eel.get_startup_patch_result !== 'function') {
            setTimeout(checkUpdateAndClose, 400);
            return;
        }
        setProgress(70, '🔄 업데이트 확인 중...', 'GitHub에서 최신 버전 확인합니다');
        try {
            eel.get_startup_patch_result()(function(result) {
                if (!result) { window.splashReady(); return; }
                // 스플래시 하단 버전 동적 갱신
                const splashVer = document.getElementById('splashVersionText');
                if (splashVer && result.current_version) {
                    splashVer.textContent = 'v' + result.current_version + '\u00A0|\u00A0HA Engineering';
                }
                if (result.applied_count > 0) {
                    // 자동 재시작 완료 후 첫 실행 → "업데이트 완료" 표시
                    setProgress(100, '🚀 v' + result.current_version + ' 업데이트 완료!',
                        '자동 재시작으로 새 버전이 적용되었습니다');
                    window._splashUpdateChecked = true;
                    setTimeout(() => window.splashReady(), 1500);
                } else {
                    // 패치 없음 → 새 업데이트 확인 (캐시 프라이밍, 로그인 전 알림용)
                    setProgress(80, '🌐 서버 확인 중...', '최신 버전 정보를 가져옵니다');
                    try {
                        eel.check_for_updates(false)(function(updateResult) {
                            window._splashUpdateResult = updateResult;
                            window._splashUpdateChecked = true;
                            if (updateResult && updateResult.update_available) {
                                setProgress(90, '🆕 새 업데이트 발견!',
                                    'v' + updateResult.latest_version + ' 업데이트가 있습니다');
                            } else {
                                setProgress(90, '✅ 최신 버전입니다', 'v' + (result.current_version || ''));
                            }
                            setTimeout(() => window.splashReady(), 1200);
                        });
                    } catch(e2) {
                        window._splashUpdateChecked = true;
                        setProgress(90, '✅ 최신 버전입니다', 'v' + (result.current_version || ''));
                        setTimeout(() => window.splashReady(), 1200);
                    }
                }
            });
        } catch(e) {
            window.splashReady();
        }
    }

    // =========================================================
    // 스플래시 닫기
    // =========================================================
    function closeSplash() {
        if (finished) return;
        finished = true;
        clearInterval(intervalId);

        const last = STEPS[STEPS.length - 1];
        setProgress(last.pct, last.msg, last.sub);

        setTimeout(() => {
            const splash = document.getElementById('splashScreen');
            if (splash) {
                splash.style.transition = 'opacity 0.6s ease';
                splash.style.opacity = '0';
                setTimeout(() => {
                    splash.style.display = 'none';
                    // 로그인 화면 표시
                    const loginScreen = document.getElementById('loginScreen');
                    if (loginScreen) loginScreen.classList.remove('hidden');
                    // 스플래시에서 확인한 새 버전이 있으면 업데이트 모달 즉시 표시 (로그인 전)
                    if (window._splashUpdateResult && window._splashUpdateResult.update_available) {
                        if (typeof showUpdateModalWithInfo === 'function') {
                            setTimeout(() => showUpdateModalWithInfo(window._splashUpdateResult), 300);
                        }
                    }
                }, 650);
            }
        }, 500);
    }

    // =========================================================
    // 외부에서 호출 가능한 API
    // =========================================================

    // eel Python에서 진행상황 메시지 전달용 (선택)
    window.splashSetStep = function (msg, sub, pct) {
        if (finished) return;
        if (pct !== undefined) {
            // 현재 자동 진행보다 앞서면 건너뜀 방지
            const currentPct = stepIndex > 0 ? STEPS[Math.min(stepIndex - 1, STEPS.length - 1)].pct : 0;
            if (pct > currentPct) setProgress(pct, msg, sub);
        } else {
            const step = STEPS[Math.min(stepIndex, STEPS.length - 2)];
            setProgress(step.pct, msg, sub);
        }
    };

    // eel Python이 준비됐을 때 호출
    window.splashReady = function () {
        readyToClose = true;
        if (stepIndex >= STEPS.length - 1 || finished) {
            closeSplash();
        }
        // 아직 자동 진행 중이면 남은 단계 빠르게 처리
        else {
            clearInterval(intervalId);
            const remaining = STEPS.slice(stepIndex, STEPS.length - 1);
            let i = 0;
            const fast = setInterval(() => {
                if (i >= remaining.length) {
                    clearInterval(fast);
                    closeSplash();
                    return;
                }
                const s = remaining[i++];
                setProgress(s.pct, s.msg, s.sub);
            }, 180);
        }
    };

    // =========================================================
    // 시작
    // =========================================================
    document.addEventListener('DOMContentLoaded', function () {
        setProgress(STEPS[0].pct, STEPS[0].msg, STEPS[0].sub);
        stepIndex = 1;
        startAutoProgress();

        // 최대 15초 후 강제 닫기 (eel 응답 없을 때 대비)
        setTimeout(() => {
            if (!finished) {
                console.warn('스플래시: 타임아웃으로 강제 닫힘');
                closeSplash();
            }
        }, 15000);
    });

})();
