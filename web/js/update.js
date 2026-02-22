// web/js/update.js - 업데이트 관리 JavaScript

let updateInfo = null;

// ============================================================================
// 초기화 - 앱 시작 시 업데이트 확인
// ============================================================================

window.addEventListener('load', function() {
    // 로그인 후 5초 뒤에 자동으로 업데이트 확인
    setTimeout(checkForUpdatesAuto, 5000);
});

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
            alert('업데이트 확인 실패: ' + result.error);
        } else {
            alert('최신 버전을 사용 중입니다.');
        }
    } catch (error) {
        showLoading(false);
        console.error('수동 업데이트 확인 오류:', error);
        alert('업데이트 확인 중 오류가 발생했습니다.');
    }
}

// ============================================================================
// 업데이트 알림 (작은 알림)
// ============================================================================

function showUpdateNotification() {
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
                    ${updateInfo.current_version} → ${updateInfo.latest_version}
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
        alert('업데이트 정보가 없습니다.');
        return;
    }
    
    // 모달 표시
    document.getElementById('updateModal').classList.remove('hidden');
    
    // 정보 표시
    document.getElementById('currentVersion').textContent = updateInfo.current_version;
    document.getElementById('latestVersion').textContent = updateInfo.latest_version;
    
    // 릴리즈 노트 표시 (Markdown을 간단한 HTML로 변환)
    const releaseNotes = updateInfo.release_notes || '릴리즈 노트가 없습니다.';
    document.getElementById('releaseNotes').innerHTML = formatReleaseNotes(releaseNotes);
}

function closeUpdateModal() {
    document.getElementById('updateModal').classList.add('hidden');
    
    // 다운로드 진행률 초기화
    document.getElementById('downloadProgress').classList.add('hidden');
    document.getElementById('downloadBar').style.width = '0%';
    document.getElementById('downloadPercent').textContent = '0%';
}

// ============================================================================
// 업데이트 다운로드 및 설치
// ============================================================================

async function startUpdate() {
    if (!updateInfo) {
        alert('업데이트 정보가 없습니다.');
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
            if (result.needs_restart) {
                alert(result.message + '\n\n프로그램을 재시작해주세요.');
            } else {
                alert(result.message);
            }
            closeUpdateModal();
        } else {
            alert('패치 적용 실패: ' + result.message);
            resetUpdateButtons();
        }
    } catch (error) {
        console.error('패치 적용 오류:', error);
        alert('패치 적용 중 오류가 발생했습니다.');
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
    // 간단한 Markdown → HTML 변환
    let html = markdown
        // 헤더
        .replace(/^### (.+)$/gm, '<h3 class="font-bold text-lg mt-4 mb-2">$1</h3>')
        .replace(/^## (.+)$/gm, '<h2 class="font-bold text-xl mt-4 mb-2">$1</h2>')
        .replace(/^# (.+)$/gm, '<h1 class="font-bold text-2xl mt-4 mb-2">$1</h1>')
        // 리스트
        .replace(/^\* (.+)$/gm, '<li class="ml-4">• $1</li>')
        .replace(/^- (.+)$/gm, '<li class="ml-4">• $1</li>')
        // 강조
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // 코드
        .replace(/`(.+?)`/g, '<code class="bg-slate-200 px-1 rounded">$1</code>')
        // 링크
        .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-blue-600 hover:underline" target="_blank">$1</a>')
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
