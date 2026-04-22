// web/js/update.js - 업데이트 관리 JavaScript

let updateInfo = null;

// ============================================================================
// 초기화 - 앱 시작 시 업데이트 확인
// ============================================================================

// 자동 업데이트 확인은 로그인 성공 후 auth.js에서 notifyLoginSuccess() 호출 시 실행됨
// (이전: window.load + setTimeout 방식은 타이밍 버그로 제거)

// ============================================================================
// 자동 업데이트 확인
// ============================================================================

async function checkForUpdatesAuto() {
    try {
        const result = await eel.check_for_updates(false)();  // force=false (캐시 사용)

        if (result.update_available) {
            updateInfo = result;
            showUpdateNotification();
        }
    } catch (error) {
        console.error('자동 업데이트 확인 오류:', error);
    }
}

// 스플래시에서 감지한 업데이트 정보로 모달 바로 표시 (로그인 전 호출용)
function showUpdateModalWithInfo(info) {
    if (!info || !info.update_available) return;
    updateInfo = info;
    showUpdateModal();
}

// ============================================================================
// 수동 업데이트 확인 (관리자 페이지)
// ============================================================================

async function checkForUpdatesManual() {
    try {
        showLoading(true);
        
        const result = await eel.check_for_updates(true)();  // force=true (강제 확인)
        
        showLoading(false);
        
        if (result.update_available) {
            updateInfo = result;
            showUpdateModal();
        } else if (result.error) {
            showCustomAlert('업데이트 확인 실패', result.error, 'error');
        } else {
            showCustomAlert('알림', '최신 버전을 사용 중입니다.', 'info');
        }
    } catch (error) {
        showLoading(false);
        console.error('수동 업데이트 확인 오류:', error);
        showCustomAlert('오류', '업데이트 확인 중 오류가 발생했습니다.', 'error');
    }
}

// ============================================================================
// 업데이트 알림 (작은 알림)
// ============================================================================

function showUpdateNotification() {
    // XSS 방어용 이스케이프
    function esc(text) {
        const div = document.createElement('div');
        div.textContent = String(text ?? '');
        return div.innerHTML;
    }

    // 우측 하단에 작은 알림 표시
    const notification = document.createElement('div');
    notification.id = 'updateNotification';
    notification.className = 'fixed bottom-6 right-6 bg-blue-600 text-white p-4 rounded-lg shadow-2xl z-50 max-w-sm';
    notification.innerHTML = `
        <div class="flex items-start gap-3">
            <div class="text-3xl">🚀</div>
            <div class="flex-1">
                <div class="font-bold mb-1">새 버전이 있습니다!</div>
                <div class="text-sm mb-3">
                    ${esc(updateInfo.current_version)} → ${esc(updateInfo.latest_version)}
                </div>
                <div class="flex gap-2">
                    <button onclick="showUpdateModal()"
                            class="px-3 py-1 bg-white text-blue-600 rounded text-sm font-semibold hover:bg-blue-50">
                        자세히
                    </button>
                    <button onclick="closeUpdateNotification()"
                            class="px-3 py-1 bg-blue-700 rounded text-sm hover:bg-blue-800">
                        나중에
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(notification);
}

function closeUpdateNotification() {
    const notification = document.getElementById('updateNotification');
    if (notification) {
        notification.remove();
    }
}

// ============================================================================
// 업데이트 모달
// ============================================================================

function showUpdateModal() {
    closeUpdateNotification();
    
    if (!updateInfo) {
        showCustomAlert('알림', '업데이트 정보가 없습니다.', 'info');
        return;
    }

    // 모달 표시
    const modal = document.getElementById('updateModal');
    if (!modal) return;
    modal.classList.remove('hidden');

    // 정보 표시
    const curVerEl = document.getElementById('currentVersion');
    const latVerEl = document.getElementById('latestVersion');
    if (curVerEl) curVerEl.textContent = updateInfo.current_version;
    if (latVerEl) latVerEl.textContent = updateInfo.latest_version;
    
    // 릴리즈 노트 표시 (Markdown을 간단한 HTML로 변환)
    const releaseNotes = updateInfo.release_notes || '릴리즈 노트가 없습니다.';
    const releaseNotesEl = document.getElementById('releaseNotes');
    if (releaseNotesEl) releaseNotesEl.innerHTML = formatReleaseNotes(releaseNotes);
}

function closeUpdateModal() {
    document.getElementById('updateModal')?.classList.add('hidden');

    // 다운로드 진행률 초기화
    document.getElementById('downloadProgress')?.classList.add('hidden');
    const downloadBar = document.getElementById('downloadBar');
    if (downloadBar) downloadBar.style.width = '0%';
    const downloadPercent = document.getElementById('downloadPercent');
    if (downloadPercent) downloadPercent.textContent = '0%';
}

// ============================================================================
// 업데이트 다운로드 및 설치
// ============================================================================

async function startUpdate() {
    if (!updateInfo) {
        showCustomAlert('알림', '업데이트 정보가 없습니다.', 'info');
        return;
    }

    // 버튼 비활성화
    document.getElementById('btnUpdate').disabled = true;
    document.getElementById('btnLater').disabled = true;
    document.getElementById('btnUpdate').textContent = '패치 적용 중...';

    // 진행률 표시
    document.getElementById('downloadProgress').classList.remove('hidden');
    updateDownloadProgress(30);

    try {
        // 패치 ZIP 다운로드 + 적용
        const result = await eel.download_and_apply_patches()();

        updateDownloadProgress(100);

        if (result.success) {
            const msg = result.needs_restart
                ? result.message + '\n\n잠시 후 프로그램을 자동 재시작합니다.'
                : result.message;
            showCustomAlert('업데이트 완료', msg, 'success');
            closeUpdateModal();
            if (result.needs_restart && typeof eel.restart_app_after_update === 'function') {
                setTimeout(() => {
                    try {
                        eel.restart_app_after_update()();
                    } catch (e) {
                        console.error('업데이트 후 자동 재시작 오류:', e);
                    }
                }, 1200);
            }
        } else {
            showCustomAlert('패치 적용 실패', result.message, 'error');
            resetUpdateButtons();
        }
    } catch (error) {
        console.error('패치 적용 오류:', error);
        showCustomAlert('오류', '패치 적용 중 오류가 발생했습니다.', 'error');
        resetUpdateButtons();
    }
}

function updateDownloadProgress(percent) {
    document.getElementById('downloadBar').style.width = percent + '%';
    document.getElementById('downloadPercent').textContent = Math.round(percent) + '%';
}

function resetUpdateButtons() {
    document.getElementById('btnUpdate').disabled = false;
    document.getElementById('btnLater').disabled = false;
    document.getElementById('btnUpdate').textContent = '지금 업데이트';
}

// ============================================================================
// 릴리즈 노트 포맷팅
// ============================================================================

function formatReleaseNotes(markdown) {
    // XSS 방어: 텍스트 노드를 이용한 이스케이프
    function escapeText(text) {
        const div = document.createElement('div');
        div.textContent = String(text ?? '');
        return div.innerHTML;
    }

    // URL 안전성 검증 (javascript: / data: 등 위험 프로토콜 차단)
    function safeUrl(url) {
        try {
            const u = new URL(url, window.location.href);
            if (u.protocol === 'https:' || u.protocol === 'http:') {
                return u.href;
            }
        } catch (_) {
            // 상대경로 등 파싱 실패 시 차단
        }
        return '#';
    }

    // 줄바꿈 정규화: Windows CRLF(\r\n) → LF(\n), BOM 제거
    markdown = markdown.replace(/^\uFEFF/, '');      // UTF-8 BOM 제거
    markdown = markdown.replace(/\r\n/g, '\n');      // CRLF → LF
    markdown = markdown.replace(/\r/g, '\n');        // 단독 CR → LF

    // 간단한 Markdown → HTML 변환 (링크 먼저 처리하여 URL 검증)
    let html = markdown
        // 헤더
        .replace(/^### (.+)$/gm, (_, t) => `<h3 class="font-bold text-lg mt-4 mb-2">${escapeText(t)}</h3>`)
        .replace(/^## (.+)$/gm, (_, t) => `<h2 class="font-bold text-xl mt-4 mb-2">${escapeText(t)}</h2>`)
        .replace(/^# (.+)$/gm, (_, t) => `<h1 class="font-bold text-2xl mt-4 mb-2">${escapeText(t)}</h1>`)
        // 리스트
        .replace(/^\* (.+)$/gm, (_, t) => `<li class="ml-4">• ${escapeText(t)}</li>`)
        .replace(/^- (.+)$/gm, (_, t) => `<li class="ml-4">• ${escapeText(t)}</li>`)
        // 강조
        .replace(/\*\*(.+?)\*\*/g, (_, t) => `<strong>${escapeText(t)}</strong>`)
        .replace(/\*(.+?)\*/g, (_, t) => `<em>${escapeText(t)}</em>`)
        // 코드
        .replace(/`(.+?)`/g, (_, t) => `<code class="bg-slate-200 px-1 rounded">${escapeText(t)}</code>`)
        // 링크 (URL 검증 포함)
        .replace(/\[(.+?)\]\((.+?)\)/g, (_, label, url) =>
            `<a href="${safeUrl(url)}" class="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">${escapeText(label)}</a>`)
        // 줄바꿈
        .replace(/\n/g, '<br>');

    return html;
}

// ============================================================================
// 관리자 페이지: 업데이트 확인 버튼
// ============================================================================

// 관리자 페이지 초기화 시 호출
if (typeof loadAdminData !== 'undefined') {
    const originalLoadAdminData = loadAdminData;
    loadAdminData = async function() {
        await originalLoadAdminData();
        addUpdateCheckButton();
    };
}

function addUpdateCheckButton() {
    // 관리자 페이지에 업데이트 확인 버튼 추가
    const header = document.querySelector('#adminApp header .flex.items-center.gap-4');
    if (header && !document.getElementById('btnCheckUpdate')) {
        const button = document.createElement('button');
        button.id = 'btnCheckUpdate';
        button.onclick = checkForUpdatesManual;
        button.className = 'px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700';
        button.textContent = '업데이트 확인';
        
        // 로그아웃 버튼 앞에 삽입
        const logoutBtn = header.querySelector('button:last-child');
        header.insertBefore(button, logoutBtn);
    }
}
