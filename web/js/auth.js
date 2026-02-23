// web/js/auth.js - 인증 관련 JavaScript

function escapeHtml(text) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(String(text ?? '')));
    return div.innerHTML;
}

// 전역 변수
let currentUser = null;
let currentDate = new Date();  // app.js와 공유

// ============================================================================
// 화면 전환
// ============================================================================

function showLoginForm() {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('registerScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('adminApp').classList.add('hidden');
}

function showRegisterForm() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('registerScreen').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('adminApp').classList.add('hidden');
}

function showMainApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('registerScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    document.getElementById('adminApp').classList.add('hidden');
    
    // 사용자 이름 표시
    document.getElementById('currentUser').textContent = currentUser.full_name;
    
    // 날짜 초기화
    if (typeof updateDateInput === 'function') {
        updateDateInput();
    }
    
    // 사용자 설정에 따라 기본 화면 표시
    const savedDefaultView = localStorage.getItem('userDefaultView');
    const defaultView = savedDefaultView || currentUser.default_view || 'dashboard';
    currentUser.default_view = defaultView; // currentUser에도 저장
    showView(defaultView);
}

function showAdminApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('registerScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('adminApp').classList.remove('hidden');
    
    // 관리자 이름 표시
    document.getElementById('adminName').textContent = currentUser.full_name;
    
    // 관리자 데이터 로드
    loadAdminData();
}

// ============================================================================
// 로그인
// ============================================================================

async function handleLogin() {
    const userId = document.getElementById('userId').value.trim();
    const password = document.getElementById('password').value.trim();
    
    if (!userId || !password) {
        alert('아이디와 비밀번호를 입력하세요.');
        return;
    }
    
    try {
        const result = await eel.authenticate(userId, password)();
        
        if (result.success) {
            currentUser = result.user;

            // 역할에 따라 화면 전환
            if (currentUser.role === 'admin') {
                showAdminApp();
            } else {
                showMainApp();
                await loadWorkRecords();
            }
        } else {
            const msg = result.message || '로그인에 실패했습니다.';
            // 없는 사용자 → 신규 PC 안내
            if (msg.includes('없는 사용자')) {
                alert(msg + '\n\n💡 이 PC에 아직 계정이 없습니다.\n\n① 관리자(ha_admin) 계정으로 먼저 로그인하거나\n② 아래 "계정 등록 요청"으로 신청 후 관리자 승인을 받으세요.\n\n관리자 초기 비밀번호: 44448901');
            // 비밀번호 불일치
            } else if (msg.includes('비밀번호')) {
                alert(msg + '\n\n💡 관리자 계정(ha_admin) 초기 비밀번호는 44448901 입니다.\n변경하셨다면 변경한 비밀번호를 입력하세요.');
            } else {
                alert(msg);
            }
        }
    } catch (error) {
        console.error('로그인 오류:', error);
        alert('로그인 중 오류가 발생했습니다.\n\n프로그램을 재시작하고 다시 시도해주세요.');
    }
}

// ============================================================================
// 계정 등록 요청
// ============================================================================

async function handleRegister() {
    const userId = document.getElementById('regUserId').value.trim();
    const password = document.getElementById('regPassword').value.trim();
    const fullName = document.getElementById('regFullName').value.trim();
    
    if (!userId || !password || !fullName) {
        alert('모든 필드를 입력하세요.');
        return;
    }
    
    if (password.length < 4) {
        alert('비밀번호는 4자 이상이어야 합니다.');
        return;
    }
    
    try {
        const result = await eel.register_user(userId, password, fullName)();
        
        if (result.success) {
            alert(result.message);
            showLoginForm();
            
            // 입력 필드 초기화
            document.getElementById('regUserId').value = '';
            document.getElementById('regPassword').value = '';
            document.getElementById('regFullName').value = '';
        } else {
            alert(result.message);
        }
    } catch (error) {
        console.error('등록 오류:', error);
        alert('등록 요청 중 오류가 발생했습니다.');
    }
}

// ============================================================================
// 로그아웃
// ============================================================================

function handleLogout() {
    if (confirm('로그아웃 하시겠습니까?')) {
        currentUser = null;
        localStorage.removeItem('currentUser');
        showLoginForm();
        
        // 입력 필드 초기화
        document.getElementById('userId').value = '';
        document.getElementById('password').value = '';
    }
}

// ============================================================================
// 자동 로그인 체크 (비활성화)
// ============================================================================

function checkAutoLogin() {
    // 자동 로그인 기능 비활성화 - 항상 로그인 화면 표시
    localStorage.removeItem('currentUser'); // 기존 세션 제거
    showLoginForm();
}

// ============================================================================
// 관리자 기능
// ============================================================================

function showAdminTab(tab) {
    const tabUsers = document.getElementById('tabUsers');
    const tabSettings = document.getElementById('tabSettings');
    const usersTab = document.getElementById('adminUsersTab');
    const settingsTab = document.getElementById('adminSettingsTab');
    
    if (tab === 'users') {
        tabUsers.className = 'px-6 py-3 font-medium border-b-2 border-blue-600 text-blue-600';
        tabSettings.className = 'px-6 py-3 font-medium text-slate-600 hover:text-slate-800';
        usersTab.classList.remove('hidden');
        settingsTab.classList.add('hidden');
    } else if (tab === 'settings') {
        tabUsers.className = 'px-6 py-3 font-medium text-slate-600 hover:text-slate-800';
        tabSettings.className = 'px-6 py-3 font-medium border-b-2 border-blue-600 text-blue-600';
        usersTab.classList.add('hidden');
        settingsTab.classList.remove('hidden');
    }
}

async function loadAdminData() {
    await loadPendingUsers();
    await loadAllUsers();
    await loadAdminSettings();
}

async function loadPendingUsers() {
    try {
        const requests = await eel.admin_get_pending_requests()();
        const container = document.getElementById('pendingUsers');
        
        if (requests.length === 0) {
            container.innerHTML = '<p class="text-slate-500">승인 대기 중인 요청이 없습니다.</p>';
            return;
        }
        
        container.innerHTML = requests.map(req => `
            <div class="flex items-center justify-between p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div>
                    <div class="font-semibold">${escapeHtml(req.full_name)}</div>
                    <div class="text-sm text-slate-600">아이디: ${escapeHtml(req.user_id)}</div>
                    <div class="text-xs text-slate-500">요청일: ${escapeHtml(req.requested_at)}</div>
                </div>
                <div class="flex gap-2">
                    <button onclick="approveUser('${escapeHtml(req.user_id)}')"
                            class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
                        승인
                    </button>
                    <button onclick="rejectUser('${escapeHtml(req.user_id)}')"
                            class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">
                        거부
                    </button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('승인 대기 목록 로드 오류:', error);
    }
}

async function loadAllUsers() {
    try {
        const users = await eel.admin_get_all_users()();
        const container = document.getElementById('allUsers');
        
        container.innerHTML = users.map(user => {
            let statusColor = 'slate';
            if (user.status === 'active') statusColor = 'green';
            else if (user.status === 'pending') statusColor = 'yellow';
            else if (user.status === 'rejected') statusColor = 'red';

            return `
                <div class="flex items-center justify-between p-4 bg-slate-50 border rounded-lg">
                    <div class="flex-1">
                        <div class="font-semibold">${escapeHtml(user.full_name)} ${user.role === 'admin' ? '👑' : ''}</div>
                        <div class="text-sm text-slate-600">아이디: ${escapeHtml(user.user_id)}</div>
                        <div class="text-xs text-slate-500">
                            상태: <span class="px-2 py-1 bg-${statusColor}-200 text-${statusColor}-800 rounded">${escapeHtml(user.status)}</span>
                            | 마지막 로그인: ${escapeHtml(user.last_login || '없음')}
                        </div>
                    </div>
                    ${user.role !== 'admin' ? `
                        <div class="flex gap-2">
                            ${user.status === 'active' ? `
                                <button onclick="deactivateUser('${escapeHtml(user.user_id)}')"
                                        class="px-3 py-1 bg-orange-600 text-white text-sm rounded hover:bg-orange-700">
                                    비활성화
                                </button>
                            ` : ''}
                            ${user.status === 'inactive' ? `
                                <button onclick="activateUser('${escapeHtml(user.user_id)}')"
                                        class="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700">
                                    활성화
                                </button>
                            ` : ''}
                            <button onclick="deleteUser('${escapeHtml(user.user_id)}')"
                                    class="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700">
                                삭제
                            </button>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('사용자 목록 로드 오류:', error);
    }
}

async function approveUser(userId) {
    if (!confirm(`${userId} 사용자를 승인하시겠습니까?`)) return;
    
    try {
        const result = await eel.admin_approve_user(userId, currentUser.user_id)();
        if (result.success) {
            alert('사용자가 승인되었습니다.');
            await loadAdminData();
        } else {
            alert(result.message);
        }
    } catch (error) {
        console.error('승인 오류:', error);
        alert('승인 중 오류가 발생했습니다.');
    }
}

async function rejectUser(userId) {
    const note = prompt(`${userId} 사용자를 거부합니다. 거부 사유를 입력하세요 (선택사항):`);
    if (note === null) return; // 취소
    
    try {
        const result = await eel.admin_reject_user(userId, currentUser.user_id, note)();
        if (result.success) {
            alert('사용자가 거부되었습니다.');
            await loadAdminData();
        } else {
            alert(result.message);
        }
    } catch (error) {
        console.error('거부 오류:', error);
        alert('거부 중 오류가 발생했습니다.');
    }
}

async function deleteUser(userId) {
    if (!confirm(`${userId} 사용자를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
    
    try {
        const result = await eel.admin_delete_user(userId, currentUser.user_id)();
        if (result.success) {
            alert('사용자가 삭제되었습니다.');
            await loadAdminData();
        } else {
            alert(result.message);
        }
    } catch (error) {
        console.error('삭제 오류:', error);
        alert('삭제 중 오류가 발생했습니다.');
    }
}

async function activateUser(userId) {
    try {
        const result = await eel.admin_update_user_status(userId, 'active', currentUser.user_id)();
        if (result.success) {
            alert('사용자가 활성화되었습니다.');
            await loadAdminData();
        } else {
            alert(result.message);
        }
    } catch (error) {
        console.error('활성화 오류:', error);
    }
}

async function deactivateUser(userId) {
    if (!confirm(`${userId} 사용자를 비활성화하시겠습니까?`)) return;
    
    try {
        const result = await eel.admin_update_user_status(userId, 'inactive', currentUser.user_id)();
        if (result.success) {
            alert('사용자가 비활성화되었습니다.');
            await loadAdminData();
        } else {
            alert(result.message);
        }
    } catch (error) {
        console.error('비활성화 오류:', error);
    }
}

// ============================================================================
// 텔레그램 봇 설정 (관리자)
// ============================================================================

async function loadTelegramBotSettings() {
    try {
        const result = await eel.get_telegram_bot_enabled()();
        if (result.success) {
            const enabledCheck = document.getElementById('telegramEnabled');
            const statusSpan = document.getElementById('telegramBotStatus');

            if (enabledCheck) enabledCheck.checked = result.enabled;
            if (result.enabled && result.botUsername) {
                statusSpan.textContent = `@${result.botUsername} 활성화됨`;
                statusSpan.className = 'text-xs text-green-600 font-semibold';
            } else if (result.hasToken) {
                statusSpan.textContent = '비활성화됨';
                statusSpan.className = 'text-xs text-orange-600';
            } else {
                statusSpan.textContent = '토큰 미설정';
                statusSpan.className = 'text-xs text-slate-500';
            }
        }
    } catch (error) {
        console.error('텔레그램 봇 설정 로드 오류:', error);
    }
}

async function saveTelegramBotToken() {
    const tokenInput = document.getElementById('telegramBotToken');
    const enabledCheck = document.getElementById('telegramEnabled');
    const botToken = tokenInput ? tokenInput.value.trim() : '';
    const enabled = enabledCheck ? enabledCheck.checked : false;

    if (enabled && !botToken) {
        alert('활성화하려면 봇 토큰을 입력하세요.');
        return;
    }

    try {
        const result = await eel.admin_save_telegram_settings(botToken, enabled, currentUser.user_id)();
        if (result.success) {
            alert(result.message);
            loadTelegramBotSettings();
        } else {
            alert('오류: ' + result.message);
        }
    } catch (error) {
        console.error('텔레그램 봇 설정 저장 오류:', error);
        alert('설정 저장 중 오류가 발생했습니다.');
    }
}

async function loadAdminSettings() {
    try {
        const result = await eel.admin_get_paths()();

        if (result.success) {
            const paths = result.paths;

            // 현재 경로 표시
            document.getElementById('currentDbPath').textContent = paths.local_db_path || '설정 안됨';
            document.getElementById('currentCloudPath').textContent = paths.cloud_sync_path || '설정 안됨';
            document.getElementById('currentBackupPath').textContent = paths.backup_path || '설정 안됨';

            // 입력 필드 (비워두기)
            document.getElementById('dbPath').value = '';
            document.getElementById('cloudPath').value = '';
            document.getElementById('backupPath').value = '';
        }
    } catch (error) {
        console.error('경로 로드 오류:', error);
    }

    // 텔레그램 봇 설정 로드
    loadTelegramBotSettings();
}

async function selectDbPath() {
    try {
        const result = await eel.select_folder_path()();
        if (result.success && result.path) {
            document.getElementById('dbPath').value = result.path + '\\work_management.db';
        }
    } catch (error) {
        console.error('경로 선택 오류:', error);
    }
}

async function selectCloudPath() {
    try {
        const result = await eel.select_folder_path()();
        if (result.success && result.path) {
            document.getElementById('cloudPath').value = result.path;
        }
    } catch (error) {
        console.error('경로 선택 오류:', error);
    }
}

async function selectBackupPath() {
    try {
        const result = await eel.select_folder_path()();
        if (result.success && result.path) {
            document.getElementById('backupPath').value = result.path;
        }
    } catch (error) {
        console.error('경로 선택 오류:', error);
    }
}

async function updateLocalDbPath() {
    const newPath = document.getElementById('dbPath').value.trim();
    
    if (!newPath) {
        alert('경로를 입력하세요.');
        return;
    }
    
    if (!confirm('로컬 DB 경로를 변경하시겠습니까?\n기존 DB가 새 위치로 복사되며, 프로그램 재시작이 필요합니다.')) {
        return;
    }
    
    try {
        const result = await eel.admin_update_local_db_path(newPath, currentUser.user_id)();
        
        if (result.success) {
            alert(result.message + '\n\n프로그램을 재시작해주세요.');
        } else {
            alert('오류: ' + result.message);
        }
    } catch (error) {
        console.error('경로 변경 오류:', error);
        alert('경로 변경 중 오류가 발생했습니다.');
    }
}

async function updateBackupPath() {
    const newPath = document.getElementById('backupPath').value.trim();
    
    if (!newPath) {
        alert('경로를 입력하세요.');
        return;
    }
    
    try {
        const result = await eel.admin_update_backup_path(newPath, currentUser.user_id)();
        
        if (result.success) {
            alert(result.message);
        } else {
            alert('오류: ' + result.message);
        }
    } catch (error) {
        console.error('백업 경로 변경 오류:', error);
        alert('경로 변경 중 오류가 발생했습니다.');
    }
}

async function updateCloudPath() {
    const newPath = document.getElementById('cloudPath').value.trim();
    
    if (!newPath) {
        alert('경로를 입력하세요.');
        return;
    }
    
    try {
        const result = await eel.admin_update_cloud_path(newPath, currentUser.user_id)();
        
        if (result.success) {
            alert(result.message);
        } else {
            alert('오류: ' + result.message);
        }
    } catch (error) {
        console.error('클라우드 경로 변경 오류:', error);
        alert('경로 변경 중 오류가 발생했습니다.');
    }
}

async function createManualBackup() {
    if (!confirm('현재 DB를 백업하시겠습니까?')) return;
    
    try {
        const result = await eel.admin_create_backup(currentUser.user_id)();
        
        if (result.success) {
            alert(result.message);
        } else {
            alert('오류: ' + result.message);
        }
    } catch (error) {
        console.error('백업 생성 오류:', error);
        alert('백업 생성 중 오류가 발생했습니다.');
    }
}

// ============================================================================
// 엑셀 불러오기 (관리자)
// ============================================================================

async function importExcelData() {
    const fileInput = document.getElementById('excelFileInput');
    const resultDiv = document.getElementById('importResult');

    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        showCustomAlert('알림', '엑셀 파일을 선택해주세요.', 'info');
        return;
    }

    const file = fileInput.files[0];
    resultDiv.innerHTML = '<p class="text-amber-700 text-sm">파일 읽는 중...</p>';

    try {
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
        }
        const base64Data = btoa(binary);

        showLoading(true, '엑셀 데이터 업로드 중...');
        const result = await eel.import_excel_data(base64Data, currentUser.user_id)();
        showLoading(false);

        if (result.success) {
            resultDiv.innerHTML = `
                <div class="bg-green-100 text-green-800 p-3 rounded-lg text-sm">
                    <p class="font-semibold">불러오기 성공</p>
                    <p>총 ${result.total_dates || 0}일, ${result.total_records || 0}건 저장됨</p>
                    ${result.skipped ? '<p class="text-xs text-green-600">빈 행 ' + result.skipped + '건 건너뜀</p>' : ''}
                </div>`;
            showCustomAlert('성공', `엑셀 데이터 ${result.total_records}건이 저장되었습니다.`, 'success');
        } else {
            resultDiv.innerHTML = `<p class="text-red-600 text-sm">오류: ${result.message || '알 수 없는 오류'}</p>`;
            showCustomAlert('실패', result.message || '불러오기 실패', 'error');
        }
    } catch (error) {
        showLoading(false);
        console.error('엑셀 불러오기 오류:', error);
        resultDiv.innerHTML = `<p class="text-red-600 text-sm">오류: ${error.message}</p>`;
        showCustomAlert('오류', '엑셀 불러오기 중 오류가 발생했습니다.', 'error');
    }
}

// ============================================================================
// DB 전체 삭제
// ============================================================================

async function clearAllRecords() {
    if (!confirm('정말로 모든 작업 레코드를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;
    if (!confirm('한 번 더 확인합니다. 전체 데이터가 삭제됩니다. 계속하시겠습니까?')) return;

    try {
        showLoading(true, 'DB 전체 삭제 중...');
        const result = await eel.clear_all_records()();
        showLoading(false);

        const resultDiv = document.getElementById('clearResult');
        if (result.success) {
            if (resultDiv) resultDiv.innerHTML = '<p class="text-green-600 text-sm font-semibold">전체 삭제 완료</p>';
            showCustomAlert('성공', result.message, 'success');
        } else {
            if (resultDiv) resultDiv.innerHTML = '<p class="text-red-600 text-sm">오류: ' + result.message + '</p>';
            showCustomAlert('실패', result.message, 'error');
        }
    } catch (error) {
        showLoading(false);
        console.error('DB 전체 삭제 오류:', error);
        showCustomAlert('오류', 'DB 삭제 중 오류가 발생했습니다.', 'error');
    }
}

// ============================================================================
// 초기화
// ============================================================================

window.addEventListener('DOMContentLoaded', function() {
    checkAutoLogin();
});
