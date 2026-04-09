// web/js/auth.js - 인증 관련 JavaScript

// eel 호출 타임아웃 래퍼 (기본 8초)
function eelWithTimeout(promise, ms = 8000) {
    return Promise.race([
        promise,
        new Promise((_, rej) =>
            setTimeout(() => rej(new Error('eel timeout')), ms)
        )
    ]);
}

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

    // 로그인 화면 하단에 현재 버전 표시
    try {
        eel.get_app_info()(function(info) {
            const el = document.getElementById('loginVersionText');
            if (el && info && info.version) {
                el.textContent = 'v' + info.version;
            }
        });
    } catch(e) {
        console.warn('버전 표시 실패 (eel 연결 전):', e);
    }
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

    // 헤더 버전 배지 업데이트
    try {
        eel.get_app_info()(function(info) {
            const badge = document.getElementById('appVersionBadge');
            if (badge && info && info.version) badge.textContent = 'v' + info.version;
        });
    } catch(e) { console.warn('앱 버전 배지 표시 실패:', e); }
    
    // 날짜 초기화
    if (typeof updateDateInput === 'function') {
        updateDateInput();
    }
    
    // 사용자 설정에 따라 기본 화면 표시 (2티어 형식 "view:subtab" 지원)
    const savedDefaultView = localStorage.getItem('userDefaultView');
    const defaultView = savedDefaultView || currentUser.default_view || 'dashboard';
    currentUser.default_view = defaultView; // currentUser에도 저장
    applyDefaultView(defaultView);

    // 자동 로그인 만료 임박 알림
    _showAutoLoginExpiryBanner();
}

/**
 * 기본 화면 적용 — "view:subtab" 형식을 파싱하여 1티어 + 2티어 탭을 모두 이동.
 * @param {string} fullView  예: "search:status", "report:monthly", "daily"
 */
function applyDefaultView(fullView) {
    if (!fullView) { showView('dashboard'); return; }
    const [view, subtab] = fullView.split(':');
    showView(view);  // 기본 서브탭으로 이동
    if (subtab) {
        // showView가 설정한 기본 서브탭을 지정된 서브탭으로 덮어씀
        try {
            const subFns = {
                dashboard: typeof showDashboardTab !== 'undefined' ? showDashboardTab : null,
                report:    typeof showReportTab    !== 'undefined' ? showReportTab    : null,
                search:    typeof showSearchTab    !== 'undefined' ? showSearchTab    : null,
            };
            if (subFns[view]) subFns[view](subtab);
        } catch(e) { console.warn('뷰 전환 실패:', e); }
    }
}

function showAdminApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('registerScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('adminApp').classList.remove('hidden');

    // 관리자 이름 표시
    document.getElementById('adminName').textContent = currentUser.full_name;

    // 관리자 헤더 버전 배지 업데이트
    try {
        eel.get_app_info()(function(info) {
            const badge = document.getElementById('adminVersionBadge');
            if (badge && info && info.version) badge.textContent = 'v' + info.version;
        });
    } catch(e) { console.warn('관리자 버전 배지 표시 실패:', e); }
    
    // 관리자 데이터 로드
    loadAdminData();

    // 자동 로그인 만료 임박 알림
    _showAutoLoginExpiryBanner();
}

// ============================================================================
// 로그인
// ============================================================================

async function handleLogin() {
    const userId = document.getElementById('userId').value.trim();
    const password = document.getElementById('password').value.trim();

    if (!userId || !password) {
        showToast('아이디와 비밀번호를 입력하세요.');
        return;
    }

    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = '로그인 중...'; }

    try {
        const result = await eelWithTimeout(eel.authenticate(userId, password)());

        if (result.success) {
            currentUser = result.user;

            // 자동 로그인 처리
            const rememberCb = document.getElementById('rememberMe');
            if (rememberCb && rememberCb.checked) {
                try {
                    const tr = await eel.create_remember_token(currentUser.user_id)();
                    if (tr.success) {
                        localStorage.setItem('autoLoginToken', tr.token);
                        localStorage.setItem('autoLoginUserId', currentUser.user_id);
                        localStorage.setItem('autoLoginTokenAt', Date.now().toString()); // #2 — 발급 시각
                    }
                } catch (e) {
                    console.warn('자동 로그인 토큰 저장 실패 (무시):', e);
                }
            } else if (rememberCb && !rememberCb.checked) {
                _clearLocalAutoLogin();
            }

            // 역할에 따라 화면 전환
            if (currentUser.role === 'admin') {
                showAdminApp();
            } else {
                showMainApp();
                await loadWorkRecords();
            }

            // 로그인 성공 후: 시작 시 적용된 패치 확인 → 재시작 안내
            notifyLoginSuccess();
        } else {
            const msg = result.message || '로그인에 실패했습니다.';
            // 없는 사용자 → 신규 PC 안내
            if (msg.includes('없는 사용자')) {
                showCustomAlert('로그인 실패', msg + '\n\n💡 이 PC에 아직 계정이 없습니다.\n\n① 관리자(ha_admin) 계정으로 먼저 로그인하거나\n② 아래 "계정 등록 요청"으로 신청 후 관리자 승인을 받으세요.', 'error');
            // 비밀번호 불일치
            } else if (msg.includes('비밀번호')) {
                showCustomAlert('로그인 실패', msg + '\n\n💡 비밀번호를 다시 확인하거나 관리자에게 문의하세요.', 'error');
            } else {
                showCustomAlert('로그인 실패', msg, 'error');
            }
        }
    } catch (error) {
        console.error('로그인 오류:', error);
        showCustomAlert('오류', '로그인 중 오류가 발생했습니다.\n\n프로그램을 재시작하고 다시 시도해주세요.', 'error');
    } finally {
        if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = '로그인'; }
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
        showToast('모든 필드를 입력하세요.');
        return;
    }

    if (userId.length < 3 || userId.length > 30) {
        showToast('아이디는 3~30자이어야 합니다.');
        return;
    }
    if (fullName.length < 2 || fullName.length > 50) {
        showToast('이름은 2~50자이어야 합니다.');
        return;
    }
    if (password.length < 4) {
        showToast('비밀번호는 4자 이상이어야 합니다.');
        return;
    }

    try {
        const result = await eel.register_user(userId, password, fullName)();

        if (result.success) {
            showCustomAlert('등록 완료', result.message, 'success');
            showLoginForm();

            // 입력 필드 초기화
            document.getElementById('regUserId').value = '';
            document.getElementById('regPassword').value = '';
            document.getElementById('regFullName').value = '';
        } else {
            showCustomAlert('등록 실패', result.message, 'error');
        }
    } catch (error) {
        console.error('등록 오류:', error);
        showCustomAlert('오류', '등록 요청 중 오류가 발생했습니다.', 'error');
    }
}

// ============================================================================
// 로그아웃
// ============================================================================

function handleLogout() {
    if (confirm('로그아웃 하시겠습니까?')) {
        if (typeof stopAutoSave === 'function') stopAutoSave();
        // 자동 로그인 토큰 서버에서 비활성화
        const token = localStorage.getItem('autoLoginToken');
        if (token) {
            try { eel.clear_remember_token(token)(); } catch(e) { console.warn('토큰 삭제 실패:', e); }
        }
        _clearLocalAutoLogin();

        currentUser = null;
        localStorage.removeItem('currentUser');
        showLoginForm();

        // 입력 필드 초기화
        document.getElementById('userId').value = '';
        document.getElementById('password').value = '';
        const cb = document.getElementById('rememberMe');
        if (cb) cb.checked = false;
    }
}

// ============================================================================
// 자동 로그인 체크
// ============================================================================

async function checkAutoLogin() {
    const token = localStorage.getItem('autoLoginToken');
    if (token) {
        // #2 — 클라이언트 측 max-age 30일 (서버 검증과 이중 방어)
        const tokenAt = parseInt(localStorage.getItem('autoLoginTokenAt') || '0');
        if (tokenAt && (Date.now() - tokenAt) > 30 * 24 * 3600 * 1000) {
            _clearLocalAutoLogin();
            showLoginForm();
            return;
        }
        try {
            const result = await eelWithTimeout(eel.auto_login(token)());
            if (result.success) {
                currentUser = result.user;
                currentUser._autoLoginDaysRemaining = result.days_remaining ?? 99;
                if (currentUser.role === 'admin') {
                    showAdminApp();
                } else {
                    showMainApp();
                    await loadWorkRecords();
                }
                notifyLoginSuccess();
                return;
            } else {
                // 토큰 만료/무효 → 정리
                _clearLocalAutoLogin();
            }
        } catch (e) {
            // 연결 오류 등 예외 시 토큰은 유지 (다음 재시도 가능)
            console.warn('자동 로그인 연결 오류 (토큰 유지):', e);
        }
    }
    showLoginForm();
}

function _showAutoLoginExpiryBanner() {
    const days = currentUser && currentUser._autoLoginDaysRemaining;
    if (days == null || days > 7) return;  // 7일 초과면 표시 안 함

    // 기존 배너 제거
    const old = document.getElementById('autoLoginExpiryBanner');
    if (old) old.remove();

    const color = days <= 2
        ? 'bg-red-100 border-red-400 text-red-700'
        : 'bg-yellow-100 border-yellow-400 text-yellow-700';
    const msg = days === 0
        ? '자동 로그인이 오늘 만료됩니다. 로그아웃 후 재로그인하여 갱신해 주세요.'
        : `자동 로그인이 ${days}일 후 만료됩니다. 로그아웃 후 재로그인하면 갱신됩니다.`;

    const banner = document.createElement('div');
    banner.id = 'autoLoginExpiryBanner';
    banner.className = `fixed bottom-4 right-4 z-40 border rounded-lg px-4 py-3 text-sm shadow-md flex items-center gap-3 max-w-sm ${color}`;
    banner.innerHTML = `
        <span>⚠️ ${escapeHtml(msg)}</span>
        <button onclick="document.getElementById('autoLoginExpiryBanner').remove()"
                class="ml-1 font-bold opacity-60 hover:opacity-100 flex-shrink-0">✕</button>`;
    document.body.appendChild(banner);

    // 10초 후 자동 제거
    setTimeout(() => { if (banner.parentNode) banner.remove(); }, 10000);
}

function _clearLocalAutoLogin() {
    localStorage.removeItem('autoLoginToken');
    localStorage.removeItem('autoLoginUserId');
    localStorage.removeItem('autoLoginTokenAt'); // #2
}

// ============================================================================
// 관리자 기능
// ============================================================================

const _adminDbState = {
    subtab: 'excel',
    owners: [],
    selectedOwner: '',
    vendors: [],
    selectedVendor: '',
    selectedVendorWorkers: new Set(),
};

function showAdminTab(tab) {
    const tabs = ['users', 'settings', 'db', 'telegram', 'status', 'activity'];
    const activeClass = 'px-6 py-3 font-medium border-b-2 border-blue-600 text-blue-600';
    const inactiveClass = 'px-6 py-3 font-medium text-slate-600 hover:text-slate-800';

    tabs.forEach(t => {
        const key = t.charAt(0).toUpperCase() + t.slice(1);
        const btn = document.getElementById('tab' + key);
        const panel = document.getElementById('admin' + key + 'Tab');
        if (btn) btn.className = t === tab ? activeClass : inactiveClass;
        if (panel) panel.classList.toggle('hidden', t !== tab);
    });

    if (tab === 'status') {
        loadAdminStatusTab();
    }
    if (tab === 'activity') {
        loadActivityLogTab();
    }
    if (tab === 'db') {
        showAdminDbSubtab(_adminDbState.subtab || 'excel');
    }
}

function showAdminDbSubtab(tab) {
    _adminDbState.subtab = tab;
    const config = {
        excel: { btn: 'btnAdminDbExcel', panel: 'adminDbExcelSubtab' },
        owners: { btn: 'btnAdminDbOwners', panel: 'adminDbOwnersSubtab' },
        vendors: { btn: 'btnAdminDbVendors', panel: 'adminDbVendorsSubtab' },
    };
    Object.entries(config).forEach(([key, value]) => {
        const btn = document.getElementById(value.btn);
        const panel = document.getElementById(value.panel);
        if (btn) {
            btn.className = key === tab
                ? 'px-4 py-2 rounded-t-lg bg-blue-600 text-white font-semibold'
                : 'px-4 py-2 rounded-t-lg bg-slate-100 text-slate-600 font-semibold hover:bg-slate-200';
        }
        if (panel) panel.classList.toggle('hidden', key !== tab);
    });
    closeAdminVendorWorkerContextMenu();
    if (tab === 'owners') loadAdminOwnerCompanyCatalog();
    if (tab === 'vendors') loadAdminVendorCompanyCatalog();
}
window.showAdminDbSubtab = showAdminDbSubtab;

async function loadAdminOwnerCompanyCatalog(force = false) {
    if (!force && _adminDbState.owners.length > 0) {
        renderAdminOwnerCompanyList();
        return;
    }
    try {
        const result = await eel.admin_get_owner_company_catalog(currentUser?.user_id || '')();
        if (!result || !result.success) {
            showCustomAlert('오류', result?.message || '선사 목록을 불러오지 못했습니다.', 'error');
            return;
        }
        _adminDbState.owners = result.owners || [];
        if (!_adminDbState.selectedOwner && _adminDbState.owners.length > 0) {
            _adminDbState.selectedOwner = _adminDbState.owners[0].name;
        }
        if (_adminDbState.selectedOwner && !_adminDbState.owners.some(o => o.name === _adminDbState.selectedOwner)) {
            _adminDbState.selectedOwner = _adminDbState.owners[0]?.name || '';
        }
        renderAdminOwnerCompanyList();
    } catch (error) {
        console.error('선사 목록 로드 오류:', error);
        showCustomAlert('오류', '선사 목록을 불러오지 못했습니다.', 'error');
    }
}

function renderAdminOwnerCompanyList() {
    const listEl = document.getElementById('adminOwnerCompanyList');
    const detailEl = document.getElementById('adminOwnerCompanyDetail');
    if (!listEl || !detailEl) return;

    if (_adminDbState.owners.length === 0) {
        listEl.innerHTML = '<p class="text-sm text-slate-400 p-3">등록된 선사가 없습니다.</p>';
        detailEl.innerHTML = '<p class="text-sm text-slate-400">선사를 선택하면 선박과 장비가 표시됩니다.</p>';
        return;
    }

    listEl.innerHTML = _adminDbState.owners.map(owner => {
        const active = owner.name === _adminDbState.selectedOwner;
        return `
            <button onclick="selectAdminOwnerCompany('${escapeJs(owner.name)}')"
                    class="w-full text-left rounded-lg border px-3 py-3 transition ${active ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white hover:bg-slate-100 border-slate-200'}">
                <div class="font-semibold">${escapeHtml(owner.name)}</div>
                <div class="text-xs text-slate-500 mt-1">선박 ${owner.shipCount}척 · 작업 ${owner.workRecordCount + owner.holidayCount}건 · 등록 ${owner.projectCount}건</div>
            </button>`;
    }).join('');

    const owner = _adminDbState.owners.find(item => item.name === _adminDbState.selectedOwner) || _adminDbState.owners[0];
    _adminDbState.selectedOwner = owner?.name || '';
    if (!owner) {
        detailEl.innerHTML = '<p class="text-sm text-slate-400">선사를 선택하면 선박과 장비가 표시됩니다.</p>';
        return;
    }

    detailEl.innerHTML = `
        <div class="mb-4">
            <div class="text-lg font-bold text-slate-800">${escapeHtml(owner.name)}</div>
            <div class="text-sm text-slate-500 mt-1">선박 ${owner.shipCount}척 · 작업 ${owner.workRecordCount + owner.holidayCount}건 · 등록 ${owner.projectCount}건</div>
        </div>
        <div class="space-y-3">
            ${owner.ships.map(ship => `
                <div class="border border-slate-200 rounded-xl p-4 bg-slate-50">
                    <div class="flex items-center justify-between gap-4 mb-2">
                        <div class="font-semibold text-slate-800">${escapeHtml(ship.shipName)}</div>
                        <div class="text-xs text-slate-500">작업 ${ship.workRecordCount + ship.holidayCount}건 · 등록 ${ship.projectCount}건</div>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        ${ship.engineModels.length > 0
                            ? ship.engineModels.map(model => `<span class="px-2 py-1 bg-white border border-slate-200 rounded-full text-xs text-slate-700">${escapeHtml(model)}</span>`).join('')
                            : '<span class="text-xs text-slate-400">등록된 장비 없음</span>'}
                    </div>
                </div>
            `).join('')}
        </div>`;
}

function selectAdminOwnerCompany(ownerName) {
    _adminDbState.selectedOwner = ownerName;
    renderAdminOwnerCompanyList();
}
window.selectAdminOwnerCompany = selectAdminOwnerCompany;

async function loadAdminVendorCompanyCatalog(force = false) {
    if (!force && _adminDbState.vendors.length > 0) {
        renderAdminVendorCompanyList();
        return;
    }
    try {
        const result = await eel.admin_get_vendor_company_catalog(currentUser?.user_id || '')();
        if (!result || !result.success) {
            showCustomAlert('오류', result?.message || '외주 목록을 불러오지 못했습니다.', 'error');
            return;
        }
        _adminDbState.vendors = result.vendors || [];
        if (!_adminDbState.selectedVendor && _adminDbState.vendors.length > 0) {
            _adminDbState.selectedVendor = _adminDbState.vendors[0].name;
        }
        if (_adminDbState.selectedVendor && !_adminDbState.vendors.some(v => v.name === _adminDbState.selectedVendor)) {
            _adminDbState.selectedVendor = _adminDbState.vendors[0]?.name || '';
        }
        _adminDbState.selectedVendorWorkers = new Set();
        renderAdminVendorCompanyList();
    } catch (error) {
        console.error('외주 목록 로드 오류:', error);
        showCustomAlert('오류', '외주 목록을 불러오지 못했습니다.', 'error');
    }
}

function renderAdminVendorCompanyList() {
    const listEl = document.getElementById('adminVendorCompanyList');
    const detailEl = document.getElementById('adminVendorWorkerDetail');
    if (!listEl || !detailEl) return;

    if (_adminDbState.vendors.length === 0) {
        listEl.innerHTML = '<p class="text-sm text-slate-400 p-3">등록된 외주 업체가 없습니다.</p>';
        detailEl.innerHTML = '<p class="text-sm text-slate-400">외주 업체를 선택하면 소속 직원명이 표시됩니다.</p>';
        return;
    }

    listEl.innerHTML = _adminDbState.vendors.map(vendor => {
        const active = vendor.name === _adminDbState.selectedVendor;
        return `
            <button onclick="selectAdminVendorCompany('${escapeJs(vendor.name)}')"
                    class="w-full text-left rounded-lg border px-3 py-3 transition ${active ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white hover:bg-slate-100 border-slate-200'}">
                <div class="font-semibold">${escapeHtml(vendor.name)}</div>
                <div class="text-xs text-slate-500 mt-1">직원 ${vendor.workerCount}명 · 작업 ${vendor.workRecordCount}건 · 휴일 ${vendor.holidayCount}건</div>
            </button>`;
    }).join('');

    const vendor = _adminDbState.vendors.find(item => item.name === _adminDbState.selectedVendor) || _adminDbState.vendors[0];
    _adminDbState.selectedVendor = vendor?.name || '';
    if (!vendor) {
        detailEl.innerHTML = '<p class="text-sm text-slate-400">외주 업체를 선택하면 소속 직원명이 표시됩니다.</p>';
        return;
    }

    detailEl.innerHTML = `
        <div class="mb-4 flex items-start justify-between gap-4">
            <div>
                <div class="text-lg font-bold text-slate-800">${escapeHtml(vendor.name)}</div>
                <div class="text-sm text-slate-500 mt-1">직원 ${vendor.workerCount}명 · 작업 ${vendor.workRecordCount}건 · 휴일 ${vendor.holidayCount}건</div>
            </div>
            <div class="text-xs text-slate-400">Ctrl+클릭 선택 후 우클릭</div>
        </div>
        <div class="flex flex-wrap gap-2">
            ${vendor.workers.map(worker => {
                const selected = _adminDbState.selectedVendorWorkers.has(worker.name);
                return `
                    <button
                        onclick="handleAdminVendorWorkerClick('${escapeJs(worker.name)}', event)"
                        oncontextmenu="handleAdminVendorWorkerContextMenu('${escapeJs(worker.name)}', event)"
                        class="px-3 py-2 rounded-lg border text-left transition ${selected ? 'bg-blue-100 border-blue-300 text-blue-800' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}">
                        <div class="font-semibold text-sm">${escapeHtml(worker.name)}</div>
                        <div class="text-[11px] text-slate-500 mt-1">총 ${worker.totalCount} · 작업 ${worker.workCount} · 휴일 ${worker.holidayCount}</div>
                    </button>`;
            }).join('')}
        </div>`;
}

function selectAdminVendorCompany(vendorName) {
    _adminDbState.selectedVendor = vendorName;
    _adminDbState.selectedVendorWorkers = new Set();
    closeAdminVendorWorkerContextMenu();
    renderAdminVendorCompanyList();
}
window.selectAdminVendorCompany = selectAdminVendorCompany;

function handleAdminVendorWorkerClick(workerName, event) {
    closeAdminVendorWorkerContextMenu();
    const multi = !!(event && (event.ctrlKey || event.metaKey));
    if (multi) {
        if (_adminDbState.selectedVendorWorkers.has(workerName)) _adminDbState.selectedVendorWorkers.delete(workerName);
        else _adminDbState.selectedVendorWorkers.add(workerName);
    } else {
        _adminDbState.selectedVendorWorkers = new Set([workerName]);
    }
    renderAdminVendorCompanyList();
}
window.handleAdminVendorWorkerClick = handleAdminVendorWorkerClick;

function handleAdminVendorWorkerContextMenu(workerName, event) {
    event.preventDefault();
    if (!_adminDbState.selectedVendorWorkers.has(workerName)) {
        _adminDbState.selectedVendorWorkers = new Set([workerName]);
        renderAdminVendorCompanyList();
    }
    if (_adminDbState.selectedVendorWorkers.size < 2) {
        closeAdminVendorWorkerContextMenu();
        return;
    }
    const menu = document.getElementById('adminVendorWorkerContextMenu');
    if (!menu) return;
    const parentRect = menu.parentElement?.getBoundingClientRect();
    const offsetX = parentRect ? event.clientX - parentRect.left : event.clientX;
    const offsetY = parentRect ? event.clientY - parentRect.top : event.clientY;
    menu.style.left = `${offsetX}px`;
    menu.style.top = `${offsetY}px`;
    menu.classList.remove('hidden');
}
window.handleAdminVendorWorkerContextMenu = handleAdminVendorWorkerContextMenu;

function closeAdminVendorWorkerContextMenu() {
    document.getElementById('adminVendorWorkerContextMenu')?.classList.add('hidden');
}
window.closeAdminVendorWorkerContextMenu = closeAdminVendorWorkerContextMenu;

async function promptMergeSelectedVendorWorkers() {
    closeAdminVendorWorkerContextMenu();
    const selected = [..._adminDbState.selectedVendorWorkers];
    if (!_adminDbState.selectedVendor || selected.length < 2) {
        showToast('병합할 직원을 2명 이상 선택하세요.', 'warning');
        return;
    }
    const targetName = prompt(
        `대표 이름을 입력하세요.\n\n업체: ${_adminDbState.selectedVendor}\n선택: ${selected.join(', ')}`,
        selected[0]
    );
    if (!targetName || !targetName.trim()) return;
    if (!confirm(`"${selected.join(', ')}" 을(를) "${targetName.trim()}" 으로 병합하시겠습니까?`)) return;

    try {
        const result = await eel.admin_merge_vendor_workers(
            _adminDbState.selectedVendor,
            selected,
            targetName.trim(),
            currentUser?.user_id || ''
        )();
        if (!result || !result.success) {
            showCustomAlert('오류', result?.message || '병합에 실패했습니다.', 'error');
            return;
        }
        showToast(result.message || '병합이 완료되었습니다.', 'success');
        _adminDbState.selectedVendorWorkers = new Set();
        await loadAdminVendorCompanyCatalog(true);
    } catch (error) {
        console.error('외주 직원 병합 오류:', error);
        showCustomAlert('오류', '외주 직원 병합 중 오류가 발생했습니다.', 'error');
    }
}
window.promptMergeSelectedVendorWorkers = promptMergeSelectedVendorWorkers;

document.addEventListener('click', (event) => {
    const menu = document.getElementById('adminVendorWorkerContextMenu');
    if (!menu || menu.classList.contains('hidden')) return;
    if (menu.contains(event.target)) return;
    closeAdminVendorWorkerContextMenu();
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAdminVendorWorkerContextMenu();
});

async function loadAdminData() {
    await loadPendingUsers();
    await loadAllUsers();
    await loadAdminSettings();
    await loadAdminStatusTab();
    await loadActivityLogTab();
}

async function loadActivityLogTab() {
    const userFilter = document.getElementById('activityUserFilter')?.value || '';
    const limit = parseInt(document.getElementById('activityLimitFilter')?.value || '100');
    const logs = await eel.get_activity_logs(limit, userFilter)();
    const tbody = document.getElementById('activityLogTable');
    if (!tbody) return;

    // 사용자 필터 드롭다운 채우기 (최초 1회)
    const sel = document.getElementById('activityUserFilter');
    if (sel && sel.options.length <= 1 && logs.length > 0) {
        const users = [...new Set(logs.map(l => l.user).filter(Boolean))].sort();
        users.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u; opt.textContent = u;
            sel.appendChild(opt);
        });
        if (userFilter) sel.value = userFilter;
    }

    if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-400">로그 없음</td></tr>';
        return;
    }
    tbody.innerHTML = logs.map(l => {
        const ts = l.timestamp ? escapeHtml(l.timestamp.replace('T', ' ').substring(0, 16)) : '-';
        return `<tr class="border-b hover:bg-slate-50">
            <td class="border p-2 text-xs text-slate-500">${ts}</td>
            <td class="border p-2 font-medium">${escapeHtml(l.user || '')}</td>
            <td class="border p-2">${escapeHtml(l.action || '')}</td>
            <td class="border p-2 text-slate-600">${escapeHtml(l.target || '')}</td>
            <td class="border p-2 text-xs text-slate-500">${escapeHtml(l.details || '')}</td>
        </tr>`;
    }).join('');
}

async function loadPendingUsers() {
    try {
        const requests = await eel.admin_get_pending_requests(currentUser?.user_id || '')();
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
                    <button onclick="approveUser('${escapeJs(req.user_id)}')"
                            class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
                        승인
                    </button>
                    <button onclick="rejectUser('${escapeJs(req.user_id)}')"
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
        const users = await eel.admin_get_all_users(currentUser?.user_id || '')();
        const container = document.getElementById('allUsers');
        
        container.innerHTML = users.map(user => {
            let statusColor = 'slate';
            if (user.status === 'active') statusColor = 'green';
            else if (user.status === 'pending') statusColor = 'yellow';
            else if (user.status === 'rejected') statusColor = 'red';
            else if (user.status === 'retired') statusColor = 'slate';

            const statusLabel = {
                active: '활성', pending: '대기', rejected: '거부',
                inactive: '비활성', retired: '퇴사'
            }[user.status] || escapeHtml(user.status);

            return `
                <div class="flex items-center justify-between p-4 bg-slate-50 border rounded-lg">
                    <div class="flex-1">
                        <div class="font-semibold">${escapeHtml(user.full_name)} ${user.role === 'admin' ? '👑' : ''}</div>
                        <div class="text-sm text-slate-600">아이디: ${escapeHtml(user.user_id)}</div>
                        <div class="text-xs text-slate-500">
                            상태: <span class="px-2 py-1 bg-${statusColor}-200 text-${statusColor}-800 rounded">${statusLabel}</span>
                            | 마지막 로그인: ${escapeHtml(user.last_login || '없음')}
                        </div>
                    </div>
                    ${user.role !== 'admin' ? `
                        <div class="flex gap-2 flex-wrap">
                            ${user.status === 'active' ? `
                                <button onclick="deactivateUser('${escapeJs(user.user_id)}')"
                                        class="px-3 py-1 bg-orange-600 text-white text-sm rounded hover:bg-orange-700">
                                    비활성화
                                </button>
                            ` : ''}
                            ${user.status === 'inactive' ? `
                                <button onclick="activateUser('${escapeJs(user.user_id)}')"
                                        class="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700">
                                    활성화
                                </button>
                            ` : ''}
                            ${user.status !== 'retired' ? `
                                <button onclick="deleteUser('${escapeJs(user.user_id)}')"
                                        class="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700">
                                    퇴사처리
                                </button>
                                <button onclick="toggleLeaveReportEdit('${escapeJs(user.user_id)}', ${!user.leave_report_edit})"
                                        class="px-3 py-1 text-sm rounded ${user.leave_report_edit ? 'bg-green-100 text-green-700 border border-green-300 hover:bg-green-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}">
                                    월보편집${user.leave_report_edit ? '✓' : ''}
                                </button>
                                <button onclick="toggleWritePermission('${escapeJs(user.user_id)}', ${!user.can_write})"
                                        class="px-3 py-1 text-sm rounded ${user.can_write ? 'bg-blue-100 text-blue-700 border border-blue-300 hover:bg-blue-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}">
                                    쓰기${user.can_write ? '✓' : ''}
                                </button>
                                <button onclick="toggleErpInput('${escapeJs(user.user_id)}', ${!user.erp_input})"
                                        class="px-3 py-1 text-sm rounded ${user.erp_input ? 'bg-purple-100 text-purple-700 border border-purple-300 hover:bg-purple-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}">
                                    ERP입력${user.erp_input ? '✓' : ''}
                                </button>
                            ` : ''}
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
            showToast('사용자가 승인되었습니다.');
            await loadAdminData();
        } else {
            showCustomAlert('오류', result.message, 'error');
        }
    } catch (error) {
        console.error('승인 오류:', error);
        showCustomAlert('오류', '승인 중 오류가 발생했습니다.', 'error');
    }
}

async function rejectUser(userId) {
    const note = prompt(`${userId} 사용자를 거부합니다. 거부 사유를 입력하세요 (선택사항):`);
    if (note === null) return; // 취소
    
    try {
        const result = await eel.admin_reject_user(userId, currentUser.user_id, note)();
        if (result.success) {
            showToast('사용자가 거부되었습니다.');
            await loadAdminData();
        } else {
            showCustomAlert('오류', result.message, 'error');
        }
    } catch (error) {
        console.error('거부 오류:', error);
        showCustomAlert('오류', '거부 중 오류가 발생했습니다.', 'error');
    }
}

async function deleteUser(userId) {
    if (!confirm(`${userId} 사용자를 퇴사 처리하시겠습니까?\n계정은 비활성화되고 기록은 유지됩니다.`)) return;

    try {
        const result = await eel.admin_delete_user(userId, currentUser.user_id)();
        if (result.success) {
            showToast('퇴사 처리되었습니다.');
            await loadAdminData();
        } else {
            showCustomAlert('오류', result.message, 'error');
        }
    } catch (error) {
        console.error('퇴사 처리 오류:', error);
        showCustomAlert('오류', '퇴사 처리 중 오류가 발생했습니다.', 'error');
    }
}

async function activateUser(userId) {
    try {
        const result = await eel.admin_update_user_status(userId, 'active', currentUser.user_id)();
        if (result.success) {
            showToast('사용자가 활성화되었습니다.');
            await loadAdminData();
        } else {
            showCustomAlert('오류', result.message, 'error');
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
            showToast('사용자가 비활성화되었습니다.');
            await loadAdminData();
        } else {
            showCustomAlert('오류', result.message, 'error');
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
        showToast('활성화하려면 봇 토큰을 입력하세요.');
        return;
    }

    try {
        const result = await eel.admin_save_telegram_settings(botToken, enabled, currentUser.user_id)();
        if (result.success) {
            showToast(result.message);
            loadTelegramBotSettings();
        } else {
            showCustomAlert('오류', result.message, 'error');
        }
    } catch (error) {
        console.error('텔레그램 봇 설정 저장 오류:', error);
        showCustomAlert('오류', '설정 저장 중 오류가 발생했습니다.', 'error');
    }
}

// ============================================================================
// 사용자 현황 탭 (v1.8.6)
// ============================================================================

async function loadAdminStatusTab() {
    try {
        // 0) 실시간 현황 요약 카드
        const summary = await eel.admin_get_realtime_summary(currentUser?.user_id || '')();
        if (summary && summary.success) {
            const elActive = document.getElementById('statActiveUsers');
            const elToday = document.getElementById('statTodayRecords');
            const elErrors = document.getElementById('statUnresolvedErrors');
            const elTime = document.getElementById('statRefreshTime');
            if (elActive) elActive.textContent = summary.activeUsers;
            if (elToday) elToday.textContent = summary.todayFilledRecords + '건';
            if (elErrors) elErrors.textContent = summary.unresolvedErrors;
            if (elTime) elTime.textContent = '업데이트: ' + summary.timestamp;
        }

        // 1) 버전 현황 테이블
        const users = await eel.admin_get_user_status(currentUser?.user_id || '')();
        const tbody = document.getElementById('userStatusTable');
        if (tbody) {
            tbody.innerHTML = (users && users.length > 0) ? users.map(u => {
                const versionBadge = u.client_version
                    ? `<span class="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs font-mono">v${escapeHtml(u.client_version)}</span>`
                    : '<span class="text-slate-400 text-xs">미접속</span>';
                const lastSeen = u.last_seen
                    ? escapeHtml(u.last_seen.replace('T', ' ').substring(0, 16))
                    : '-';
                const statusBadge = u.status === 'active'
                    ? '<span class="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs">활성</span>'
                    : `<span class="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">${escapeHtml(u.status || '')}</span>`;
                return `<tr class="border-b hover:bg-slate-50">
                    <td class="border p-2 font-medium">${escapeHtml(u.full_name)}<br><span class="text-xs text-slate-400">${escapeHtml(u.user_id)}</span></td>
                    <td class="border p-2">${escapeHtml(u.role)}</td>
                    <td class="border p-2">${statusBadge}</td>
                    <td class="border p-2 text-center">${versionBadge}</td>
                    <td class="border p-2 text-center text-xs text-slate-600">${lastSeen}</td>
                </tr>`;
            }).join('') : '<tr><td colspan="5" class="p-4 text-center text-slate-400">사용자 없음</td></tr>';
        }

        // 2) 오류 리포트
        const errors = await eel.admin_get_error_reports(50, currentUser?.user_id || '')();
        const badge = document.getElementById('errorReportBadge');
        const unread = (errors || []).filter(e => !e.is_read).length;
        if (badge) {
            if (unread > 0) { badge.textContent = `${unread}건`; badge.classList.remove('hidden'); }
            else { badge.classList.add('hidden'); }
        }

        const listEl = document.getElementById('errorReportList');
        if (!listEl) return;
        if (!errors || !errors.length) {
            listEl.innerHTML = '<p class="text-sm text-slate-400 py-4 text-center">오류 리포트 없음</p>';
            return;
        }
        const typeColor = { js_runtime: 'orange', js_crash: 'red', startup: 'red', python: 'red' };
        listEl.innerHTML = errors.map(r => {
            const color = typeColor[r.error_type] || 'slate';
            return `<div class="border rounded-lg p-3 ${r.is_read ? 'opacity-60' : 'border-red-200 bg-red-50'}">
                <div class="flex justify-between items-start gap-2">
                    <div class="flex-1 min-w-0">
                        <div class="flex gap-2 items-center mb-1">
                            <span class="text-xs px-1.5 py-0.5 bg-${color}-100 text-${color}-700 rounded font-mono">${escapeHtml(r.error_type)}</span>
                            <span class="text-xs text-slate-500">${escapeHtml(r.timestamp ? r.timestamp.substring(0, 16) : '')}</span>
                            <span class="text-xs text-slate-500">· ${escapeHtml(r.user_name || r.user_id || '')} · v${escapeHtml(r.app_version || '')}</span>
                        </div>
                        <div class="text-sm font-medium text-slate-800 truncate">${escapeHtml(r.error_message)}</div>
                        ${r.stack_trace ? `<details class="mt-1"><summary class="text-xs text-slate-400 cursor-pointer">스택 트레이스</summary><pre class="text-xs bg-slate-100 rounded p-2 mt-1 overflow-x-auto whitespace-pre-wrap">${escapeHtml(r.stack_trace)}</pre></details>` : ''}
                    </div>
                    ${!r.is_read ? `<button onclick="markErrorRead(${r.id})" class="shrink-0 text-xs px-2 py-1 bg-slate-200 hover:bg-slate-300 rounded">읽음</button>` : ''}
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        console.error('사용자 현황 로드 오류:', e);
    }
}

async function markErrorRead(errorId) {
    await eel.admin_mark_error_read(errorId, currentUser?.user_id || '')();
    await loadAdminStatusTab();
}

async function loadAdminSettings() {
    try {
        const result = await eel.admin_get_paths(currentUser?.user_id || '')();

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

    // 클라우드 동기화 상태 로드 (sync_mode 기반 UI 표시)
    loadCloudStatus();

    // 텔레그램 봇 설정 로드
    loadTelegramBotSettings();

    // 공휴일 API 키 저장 여부 표시
    loadHolidayKeyStatus();
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
        showToast('경로를 입력하세요.');
        return;
    }

    if (!confirm('로컬 DB 경로를 변경하시겠습니까?\n\n' +
                 '• 대상 경로에 DB 파일이 없으면: 현재 DB를 복사합니다.\n' +
                 '• 대상 경로에 DB 파일이 있으면: 기존 DB를 그대로 사용합니다.\n\n' +
                 '프로그램 재시작이 필요합니다.')) {
        return;
    }

    try {
        const result = await eel.admin_update_local_db_path(newPath, currentUser.user_id)();

        if (result.success) {
            if (result.used_existing) {
                showCustomAlert('완료', '대상 경로에 기존 DB 파일이 있어 그대로 사용합니다.\n현재 PC의 데이터는 복사되지 않습니다.\n\n프로그램을 재시작하면 해당 DB로 연결됩니다.', 'info');
            } else {
                showCustomAlert('완료', 'DB 경로가 변경되었습니다.\n\n프로그램을 재시작해주세요.', 'info');
            }
        } else {
            showCustomAlert('오류', result.message, 'error');
        }
    } catch (error) {
        console.error('경로 변경 오류:', error);
        showCustomAlert('오류', '경로 변경 중 오류가 발생했습니다.', 'error');
    }
}

async function updateBackupPath() {
    const newPath = document.getElementById('backupPath').value.trim();

    if (!newPath) {
        showToast('경로를 입력하세요.');
        return;
    }

    try {
        const result = await eel.admin_update_backup_path(newPath, currentUser.user_id)();

        if (result.success) {
            showToast(result.message);
        } else {
            showCustomAlert('오류', result.message, 'error');
        }
    } catch (error) {
        console.error('백업 경로 변경 오류:', error);
        showCustomAlert('오류', '경로 변경 중 오류가 발생했습니다.', 'error');
    }
}

async function updateCloudPath() {
    const newPath = document.getElementById('cloudPath').value.trim();

    if (!newPath) {
        showToast('경로를 입력하세요.');
        return;
    }

    try {
        const result = await eel.admin_update_cloud_path(newPath, currentUser.user_id)();

        if (result.success) {
            showToast(result.message);
            loadCloudStatus();   // UI 갱신
        } else {
            showCustomAlert('오류', result.message, 'error');
        }
    } catch (error) {
        console.error('클라우드 경로 변경 오류:', error);
        showCustomAlert('오류', '경로 변경 중 오류가 발생했습니다.', 'error');
    }
}

// ─────────────────────────────────────────────
// 클라우드 동기화 상태 / 외부 PC 연결
// ─────────────────────────────────────────────

async function loadCloudStatus() {
    /**
     * 관리자 패널 진입 시 현재 sync_mode에 따라 UI 패널 전환
     * - company / standalone → cloudCompanyPanel 표시
     * - external            → cloudExternalPanel 표시
     */
    try {
        const status = await eel.get_sync_status()();
        const mode   = (status && status.sync_mode) ? status.sync_mode : 'standalone';

        const companyPanel  = document.getElementById('cloudCompanyPanel');
        const externalPanel = document.getElementById('cloudExternalPanel');

        if (mode === 'external') {
            companyPanel.classList.add('hidden');
            externalPanel.classList.remove('hidden');

            // 연결 정보 표시
            const pathEl     = document.getElementById('externalConnectedPath');
            const lastSyncEl = document.getElementById('externalLastSync');
            if (pathEl)     pathEl.textContent     = status.cloud_folder || '-';
            if (lastSyncEl) lastSyncEl.textContent = status.last_sync
                ? new Date(status.last_sync).toLocaleString('ko-KR')
                : '없음';
        } else {
            companyPanel.classList.remove('hidden');
            externalPanel.classList.add('hidden');
        }
    } catch (e) {
        console.error('클라우드 상태 로드 오류:', e);
    }
}

async function connectExternalCloud() {
    /**
     * 외부 PC에서 클라우드에 연결
     * 클라우드 경로 입력 → connect_to_cloud_external 호출 → UI 갱신
     */
    const cloudPath = document.getElementById('externalCloudPath').value.trim();
    if (!cloudPath) {
        showToast('클라우드 경로를 입력하세요.');
        return;
    }

    try {
        const result = await eel.connect_to_cloud_external(cloudPath)();

        if (!result.success) {
            showCustomAlert('연결 실패', result.message, 'error');
            return;
        }

        // 잠금 경고 먼저
        if (result.warning) {
            if (!confirm('⚠️ ' + result.warning + '\n\n계속 진행하시겠습니까?')) {
                // 사용자가 취소했으므로 연결 해제 처리
                await eel.disconnect_from_cloud()();
                loadCloudStatus();
                return;
            }
        }

        showCustomAlert('연결 완료', result.message + '\n\n이제 외부 PC 모드로 동작합니다.', 'success');
        loadCloudStatus();
        // 페이지 전체 새로고침으로 DB 변경 반영
        setTimeout(() => location.reload(), 500);

    } catch (e) {
        console.error('외부 PC 연결 오류:', e);
        showCustomAlert('오류', '연결 중 오류가 발생했습니다.', 'error');
    }
}

async function disconnectFromCloud() {
    /**
     * 외부 PC 연결 해제
     * push + 알림 생성 + 잠금 삭제 + sync_mode=standalone
     */
    if (!confirm('클라우드 연결을 해제하시겠습니까?\n\n현재 데이터가 클라우드에 저장되고 로컬 모드로 전환됩니다.')) {
        return;
    }

    try {
        const result = await eel.disconnect_from_cloud()();
        if (result.success) {
            showToast(result.message);
        } else {
            showCustomAlert('오류', result.message, 'error');
        }
        loadCloudStatus();
    } catch (e) {
        console.error('연결 해제 오류:', e);
        showCustomAlert('오류', '연결 해제 중 오류가 발생했습니다.', 'error');
    }
}

async function syncToCloudNow() {
    /**
     * 외부 PC에서 지금 동기화 버튼 (push + 알림)
     */
    try {
        const result = await eel.sync_to_cloud()();
        if (result.success) {
            showToast('동기화 완료');
            loadCloudStatus();
        } else {
            showCustomAlert('동기화 실패', result.message, 'error');
        }
    } catch (e) {
        console.error('동기화 오류:', e);
        showCustomAlert('오류', '동기화 중 오류가 발생했습니다.', 'error');
    }
}

async function createManualBackup() {
    if (!confirm('현재 DB를 백업하시겠습니까?')) return;
    
    try {
        const result = await eel.admin_create_backup(currentUser.user_id)();

        if (result.success) {
            showToast(result.message);
        } else {
            showCustomAlert('오류', result.message, 'error');
        }
    } catch (error) {
        console.error('백업 생성 오류:', error);
        showCustomAlert('오류', '백업 생성 중 오류가 발생했습니다.', 'error');
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
            if (resultDiv) resultDiv.innerHTML = `<p class="text-red-600 text-sm">오류: ${escapeHtml(result.message || '알 수 없는 오류')}</p>`;
            showCustomAlert('실패', result.message || '불러오기 실패', 'error');
        }
    } catch (error) {
        showLoading(false);
        console.error('엑셀 불러오기 오류:', error);
        if (resultDiv) resultDiv.innerHTML = `<p class="text-red-600 text-sm">오류가 발생했습니다.</p>`;
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
            if (resultDiv) resultDiv.innerHTML = '<p class="text-red-600 text-sm">오류: ' + escapeHtml(result.message) + '</p>';
            showCustomAlert('실패', result.message, 'error');
        }
    } catch (error) {
        showLoading(false);
        console.error('DB 전체 삭제 오류:', error);
        showCustomAlert('오류', 'DB 삭제 중 오류가 발생했습니다.', 'error');
    }
}

// ============================================================================
// 로그인 성공 후 패치 알림
// ============================================================================

async function notifyLoginSuccess() {
    try {
        // 시작 시 자동 적용된 패치 결과 확인
        const patchResult = await eel.get_startup_patch_result()();
        if (patchResult && patchResult.needs_restart) {
            // 우하단에 재시작 안내 알림 표시
            showRestartNotification(patchResult.applied_count);
        } else {
            // 스플래시가 성공적으로 업데이트 확인을 마친 경우에만 스킵 (오류/미확인 시 재확인)
            // _splashUpdateResult 없음(오류) → 재확인 필요 / 있으면 closeSplash가 이미 처리
            const splashAlreadyHandled = window._splashUpdateChecked
                && window._splashUpdateResult
                && !window._splashUpdateResult.error;
            if (!splashAlreadyHandled) {
                if (typeof checkForUpdatesAuto === 'function') {
                    setTimeout(checkForUpdatesAuto, 3000);
                }
            }
        }
    } catch(e) {
        // 오류 시 무시
    }

    // J: 알림 센터 배지 업데이트 (로그인 후 비동기 로드)
    if (typeof loadNotifications === 'function') {
        setTimeout(loadNotifications, 2000);
    }

    // v1.8.6: 클라이언트 버전 서버 등록 + JS 전역 오류 핸들러 활성화
    try {
        const info = await eel.get_app_info()();
        if (info && info.version && currentUser) {
            eel.update_client_version(currentUser.user_id, info.version)();
        }
    } catch(_) { console.warn('클라이언트 버전 등록 실패'); }
    window._errorReporterEnabled = true;
    if (typeof startAutoSave === 'function') startAutoSave();

    // 트레이 모드 설정 Python 동기화
    try {
        eel.set_python_tray_mode(currentUser.tray_mode || false)();
    } catch(_) { console.warn('트레이 모드 동기화 실패'); }

    // 연차 월별 보고 편집 권한에 따라 버튼 표시/숨김
    try {
        const addBtn = document.getElementById('btnAddLeaveReportRow');
        if (addBtn) addBtn.classList.toggle('hidden', !currentUser.leave_report_edit);
    } catch(_) { console.warn('연차 보고 버튼 표시 실패'); }

    // 월별 보고 탭 버튼 표시/숨김 (leave_report_edit 권한 기반)
    try {
        const leaveReportTabBtn = document.getElementById('btnEmployeeLeaveReport');
        if (leaveReportTabBtn) leaveReportTabBtn.classList.toggle('hidden', !currentUser.leave_report_edit);
    } catch(_) { console.warn('연차 보고 탭 버튼 표시 실패'); }

    try {
        await maybeShowMorningRecordReminder();
    } catch(_) { console.warn('아침 기록 팝업 표시 실패'); }
}

function _formatDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function _getYesterdayDateStr() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return _formatDateKey(d);
}

function _isMorningReminderWindow() {
    const now = new Date();
    const hour = now.getHours();
    return hour >= 6 && hour < 12;
}

function closeMorningRecordReminder() {
    document.getElementById('morningRecordReminder')?.remove();
}

async function maybeShowMorningRecordReminder() {
    if (!currentUser || !(currentUser.can_write || currentUser.role === 'admin')) return;
    if (!_isMorningReminderWindow()) return;

    const todayKey = _formatDateKey(new Date());
    const storageKey = `morning-record-reminder:${currentUser.user_id}:${todayKey}`;
    if (localStorage.getItem(storageKey)) return;

    const yesterdayStr = _getYesterdayDateStr();
    const yesterday = new Date(yesterdayStr + 'T00:00:00');
    const weekday = yesterday.getDay();
    const showHolidayButton = weekday === 5 || weekday === 6 || weekday === 0;

    let holidayPeriodKey = '';
    if (showHolidayButton) {
        try {
            holidayPeriodKey = await eel.get_latest_friday(yesterdayStr)();
        } catch (_) { /* ignore */ }
    }

    showMorningRecordReminder({
        yesterdayStr,
        holidayPeriodKey,
        showHolidayButton: !!holidayPeriodKey,
        storageKey,
    });
}

function showMorningRecordReminder({ yesterdayStr, holidayPeriodKey, showHolidayButton, storageKey }) {
    closeMorningRecordReminder();

    const div = document.createElement('div');
    div.id = 'morningRecordReminder';
    div.className = 'fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50';
    div.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4">
            <div class="flex items-start justify-between gap-4 mb-4">
                <div>
                    <h3 class="text-xl font-bold text-slate-800">지난 작업 기록 확인</h3>
                    <p class="text-sm text-slate-500 mt-1">${escapeHtml(yesterdayStr)} 기준 작업 현황과 연장 근무 결과를 기록/확인해 주세요.</p>
                </div>
                <button id="btnCloseMorningReminder" class="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
            </div>
            <div class="grid grid-cols-1 gap-2">
                <button id="btnMorningDaily" class="px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-left">지난 작업 입력</button>
                <button id="btnMorningNight" class="px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-left">야간 결과 입력</button>
                ${showHolidayButton ? '<button id="btnMorningHoliday" class="px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-left">휴일 OT 입력</button>' : ''}
                <button id="btnMorningDismiss" class="px-4 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold">오늘은 닫기</button>
            </div>
        </div>`;

    document.body.appendChild(div);
    div.addEventListener('click', (e) => { if (e.target === div) closeMorningRecordReminder(); });
    document.getElementById('btnCloseMorningReminder')?.addEventListener('click', closeMorningRecordReminder);
    document.getElementById('btnMorningDismiss')?.addEventListener('click', () => {
        if (storageKey) localStorage.setItem(storageKey, 'shown');
        closeMorningRecordReminder();
    });
    document.getElementById('btnMorningDaily')?.addEventListener('click', () => {
        closeMorningRecordReminder();
        if (typeof openDailyWorkInputForDate === 'function') openDailyWorkInputForDate(yesterdayStr);
    });
    document.getElementById('btnMorningNight')?.addEventListener('click', () => {
        closeMorningRecordReminder();
        if (typeof openNightReportForDate === 'function') openNightReportForDate(yesterdayStr);
    });
    document.getElementById('btnMorningHoliday')?.addEventListener('click', () => {
        closeMorningRecordReminder();
        if (typeof openHolidayReportForPeriod === 'function') openHolidayReportForPeriod(holidayPeriodKey);
    });
}

function showRestartNotification(count) {
    // 기존 알림 제거
    const existing = document.getElementById('restartNotification');
    if (existing) existing.remove();

    const div = document.createElement('div');
    div.id = 'restartNotification';
    div.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9000;max-width:320px;';
    div.innerHTML = `
        <div style="background:#1d4ed8;color:#fff;border-radius:12px;padding:16px 20px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
            <div style="font-weight:700;font-size:14px;margin-bottom:6px;">🔄 패치 ${count}개 적용 완료</div>
            <div style="font-size:13px;opacity:0.9;">변경사항을 완전히 적용하려면 프로그램을 재시작하세요.</div>
            <div style="margin-top:12px;display:flex;gap:8px;">
                <button onclick="window.close()" style="flex:1;background:#fff;color:#1d4ed8;border:none;border-radius:6px;padding:6px 0;font-size:12px;font-weight:700;cursor:pointer;">재시작</button>
                <button onclick="document.getElementById('restartNotification').remove()" style="flex:1;background:rgba(255,255,255,0.2);color:#fff;border:none;border-radius:6px;padding:6px 0;font-size:12px;cursor:pointer;">나중에</button>
            </div>
        </div>`;
    document.body.appendChild(div);
}

// ============================================================================
// 트레이 모드 설정
// ============================================================================

async function saveTrayMode(enabled) {
    if (!currentUser) return;
    const toggle = document.getElementById('trayModeToggle');
    const label  = document.getElementById('trayModeLabel');
    try {
        const result = await eel.save_user_tray_mode(currentUser.user_id, enabled)();
        if (result && result.success) {
            currentUser.tray_mode = enabled;
            eel.set_python_tray_mode(enabled)();
            if (label) label.textContent = enabled ? '트레이로 최소화' : '앱 완전 종료';
            if (typeof showToast === 'function') {
                showToast(enabled ? '창을 닫으면 트레이로 최소화됩니다.' : '창을 닫으면 앱이 종료됩니다.');
            }
        } else {
            // 실패 시 토글 원복
            if (toggle) toggle.checked = !enabled;
            if (typeof showToast === 'function') showToast('설정 저장 실패', 'error');
        }
    } catch(e) {
        if (toggle) toggle.checked = !enabled;
        if (typeof showToast === 'function') showToast('설정 저장 오류', 'error');
    }
}

// ============================================================================
// 초기화
// ============================================================================

window.addEventListener('DOMContentLoaded', function() {
    // checkAutoLogin은 스플래시 종료 시(splash.js closeSplash) 호출됨
    // → Eel 준비 완료(splashReady) 이후 실행 보장
    // 스플래시 화면이 없는 환경(개발 테스트 등) 대비 fallback
    if (!document.getElementById('splashScreen')) {
        checkAutoLogin();
    }
});
