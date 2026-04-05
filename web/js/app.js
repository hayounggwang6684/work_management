// ============================================================================
// 금일작업현황 관리 시스템 - 작업 관리 JavaScript
// ============================================================================

// 전역 변수 (auth.js와 공유)
// currentUser, currentDate는 auth.js에서 정의됨
let workRecords = [];
let vacationData = { '연차': '', '반차': '', '공가': '' };
let isDirty = false;
let dayIsDirty = false;
let nightIsDirty = false;
let _isSaving = false;  // 중복 저장 방지 플래그
let _autoSaveTimer = null;  // 자동 저장 타이머 핸들
let _dateLoadedAt = null; // 현재 날짜 데이터 로드 시각 (충돌 감지용)
let _searchSortState = { records: [], container: null, term: '', type: '', key: 'date', dir: -1 }; // 검색 결과 정렬 상태

// 아카이브 달 네비게이션 상태
let _archiveAllData = [];
let _archiveYear    = null;
let _archiveMonth   = null;

// 업체별 조회 달 네비게이션 상태
let _companySearchRecords = [];
let _companySearchName    = '';
let _companySearchMonths  = []; // 정렬된 YYYY-MM 배열
let _companySearchMonthIdx = 0;

// 한글→영문 변환 매핑
const koreanToEnglish = {
    'ㄱ': 'r', 'ㄲ': 'R', 'ㄴ': 's', 'ㄷ': 'e', 'ㄸ': 'E',
    'ㄹ': 'f', 'ㅁ': 'a', 'ㅂ': 'q', 'ㅃ': 'Q', 'ㅅ': 't',
    'ㅆ': 'T', 'ㅇ': 'd', 'ㅈ': 'w', 'ㅉ': 'W', 'ㅊ': 'c',
    'ㅋ': 'z', 'ㅌ': 'x', 'ㅍ': 'v', 'ㅎ': 'g',
    'ㅏ': 'k', 'ㅐ': 'o', 'ㅑ': 'i', 'ㅒ': 'O', 'ㅓ': 'j',
    'ㅔ': 'p', 'ㅕ': 'u', 'ㅖ': 'P', 'ㅗ': 'h', 'ㅘ': 'hk',
    'ㅙ': 'ho', 'ㅚ': 'hl', 'ㅛ': 'y', 'ㅜ': 'n', 'ㅝ': 'nj',
    'ㅞ': 'np', 'ㅟ': 'nl', 'ㅠ': 'b', 'ㅡ': 'm', 'ㅢ': 'ml',
    'ㅣ': 'l'
};

// ============================================================================
// 화면 전환 (일일 작업 / 보고서)
// ============================================================================

function showView(view) {
    if (view !== 'daily' && !checkUnsavedChanges('any')) return;
    const btnDaily = document.getElementById('btnDaily');
    const btnReport = document.getElementById('btnReport');
    const btnSearch = document.getElementById('btnSearch');
    const btnDashboard = document.getElementById('btnDashboard');
    const btnSettings = document.getElementById('btnSettings');
    const dailyView = document.getElementById('dailyView');
    const reportView = document.getElementById('reportView');
    const searchView = document.getElementById('searchView');
    const dashboardView = document.getElementById('dashboardView');
    const settingsView  = document.getElementById('settingsView');
    const btnEmployee    = document.getElementById('btnEmployee');
    const employeeView   = document.getElementById('employeeView');

    if (!btnDaily || !btnReport || !dailyView || !reportView) return;

    // 모든 버튼 초기화
    btnDaily.className = 'px-4 py-2 rounded-lg bg-slate-200';
    btnReport.className = 'px-4 py-2 rounded-lg bg-slate-200';
    if (btnSearch)    btnSearch.className    = 'px-4 py-2 rounded-lg bg-slate-200';
    if (btnDashboard) btnDashboard.className = 'px-4 py-2 rounded-lg bg-slate-200';
    if (btnSettings)  btnSettings.className  = 'px-4 py-2 rounded-lg bg-slate-200';
    if (btnEmployee)  btnEmployee.className  = 'px-4 py-2 rounded-lg bg-slate-200';

    // 모든 뷰 숨기기
    dailyView.classList.add('hidden');
    reportView.classList.add('hidden');
    if (searchView)   searchView.classList.add('hidden');
    if (dashboardView) dashboardView.classList.add('hidden');
    if (settingsView)  settingsView.classList.add('hidden');
    if (employeeView)  employeeView.classList.add('hidden');

    // 선택된 뷰 표시
    if (view === 'dashboard') {
        if (btnDashboard) btnDashboard.className = 'px-4 py-2 rounded-lg bg-blue-600 text-white';
        if (dashboardView) dashboardView.classList.remove('hidden');
        showDashboardTab('chart');
    } else if (view === 'daily') {
        btnDaily.className = 'px-4 py-2 rounded-lg bg-blue-600 text-white';
        dailyView.classList.remove('hidden');
    } else if (view === 'report') {
        btnReport.className = 'px-4 py-2 rounded-lg bg-blue-600 text-white';
        reportView.classList.remove('hidden');
        showReportTab('daily');
    } else if (view === 'search') {
        if (btnSearch) btnSearch.className = 'px-4 py-2 rounded-lg bg-blue-600 text-white';
        if (searchView) searchView.classList.remove('hidden');
        showSearchTab('status');
        initSearchTabDefaults();
    } else if (view === 'settings') {
        if (btnSettings) btnSettings.className = 'px-4 py-2 rounded-lg bg-blue-600 text-white';
        if (settingsView) settingsView.classList.remove('hidden');
        loadUserSettings();
        // ERP 입력 탭 버튼 — erp_input 권한 또는 admin인 경우에만 표시
        const erpTabBtn = document.getElementById('btnSettingsErp');
        if (erpTabBtn) {
            erpTabBtn.classList.toggle('hidden',
                !currentUser?.erp_input && currentUser?.role !== 'admin');
        }
        showSettingsTab('userSettings'); // 기본 탭: 사용자 설정
    } else if (view === 'employee') {
        if (btnEmployee) btnEmployee.className = 'px-4 py-2 rounded-lg bg-blue-600 text-white';
        if (employeeView) employeeView.classList.remove('hidden');
        showEmployeeTab('leave');
        loadLeaveEmployeeList();
    }
}

// ============================================================================
// 미저장 변경 경고
// ============================================================================

function _syncDirtyState() {
    isDirty = !!(dayIsDirty || nightIsDirty);
}

function _hasUnsavedChanges(scope = 'current') {
    if (scope === 'any') return !!(dayIsDirty || nightIsDirty);
    return currentWorkTab === 'night' ? !!nightIsDirty : !!dayIsDirty;
}

function _setDirtyForTab(tab, value) {
    if (tab === 'night') {
        nightIsDirty = !!value;
    } else {
        dayIsDirty = !!value;
    }
    _syncDirtyState();
}

function _markCurrentTabDirty() {
    _setDirtyForTab(currentWorkTab, true);
}

function checkUnsavedChanges(scope = 'current', message = '') {
    if (!_hasUnsavedChanges(scope)) return true;
    return confirm(message || '저장되지 않은 변경 사항이 있습니다.\n저장하지 않고 이동하시겠습니까?');
}

// ============================================================================
// 날짜 관리
// ============================================================================

const _DAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

function updateDateInput() {
    if (!currentDate) {
        currentDate = new Date();
    }
    const dateStr = formatDateForInput(currentDate);
    const dateInput = document.getElementById('dateInput');
    if (dateInput) {
        dateInput.value = dateStr;
    }
    const dayEl = document.getElementById('dateDayOfWeek');
    if (dayEl) {
        const dow = currentDate.getDay();
        const isHoliday = !!KOREAN_HOLIDAYS[dateStr];
        const holidayName = isHoliday ? ` ${KOREAN_HOLIDAYS[dateStr]}` : '';
        dayEl.textContent = `(${_DAYS_KO[dow]}요일${holidayName})`;
        dayEl.className = (dow === 0 || isHoliday) ? 'font-bold text-lg px-1 text-red-500'
                        : dow === 6 ? 'font-bold text-lg px-1 text-blue-500'
                        : 'font-bold text-lg px-1 text-slate-700';
    }
}

function formatDateForInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function changeDate(days) {
    if (!checkUnsavedChanges()) return;
    currentDate.setDate(currentDate.getDate() + days);
    updateDateInput();
    if (currentWorkTab === 'night') {
        loadNightRecords();
    } else {
        loadWorkRecords();
    }
}

function onDateChange() {
    const dateInput = document.getElementById('dateInput');
    if (dateInput && dateInput.value) {
        if (!checkUnsavedChanges()) {
            dateInput.value = formatDateForInput(currentDate);
            return;
        }
        currentDate = new Date(dateInput.value + 'T00:00:00');
        if (currentWorkTab === 'night') {
            loadNightRecords();
        } else {
            loadWorkRecords();
        }
    }
}

// 마우스 휠로 날짜 이동
function setupDateWheelNavigation() {
    const dateInput = document.getElementById('dateInput');
    if (dateInput) {
        dateInput.addEventListener('wheel', function(e) {
            e.preventDefault();
            if (e.deltaY < 0) {
                changeDate(1);  // 휠 위 = 다음날
            } else if (e.deltaY > 0) {
                changeDate(-1); // 휠 아래 = 이전날
            }
        }, { passive: false });
    }
}

// 초기화 시 호출
document.addEventListener('DOMContentLoaded', function() {
    setupDateWheelNavigation();
    loadHolidays();
});

// ============================================================================
// 조회 탭 전환
// ============================================================================

function showSearchTab(tab) {
    const statusTab      = document.getElementById('statusSearchTab');
    const workTab        = document.getElementById('workSearchTab');
    const companyTab     = document.getElementById('companySearchTab');
    const perfTab        = document.getElementById('performanceSearchTab');
    const btnStatus      = document.getElementById('btnSearchStatus');
    const btnWork        = document.getElementById('btnSearchWork');
    const btnCompany     = document.getElementById('btnSearchCompany');
    const btnPerformance = document.getElementById('btnSearchPerformance');

    // 모두 숨김 + 버튼 기본 스타일 초기화
    [statusTab, workTab, companyTab, perfTab].forEach(t => { if (t) t.classList.add('hidden'); });
    [btnStatus, btnWork, btnCompany, btnPerformance].forEach(b => {
        if (!b) return;
        b.classList.remove('bg-blue-600', 'text-white');
        b.classList.add('bg-slate-200');
    });

    // 선택된 탭만 표시
    const tabMap = { status: statusTab, work: workTab, company: companyTab, performance: perfTab };
    const btnMap = { status: btnStatus, work: btnWork, company: btnCompany, performance: btnPerformance };
    if (tabMap[tab]) tabMap[tab].classList.remove('hidden');
    if (btnMap[tab]) {
        btnMap[tab].classList.remove('bg-slate-200');
        btnMap[tab].classList.add('bg-blue-600', 'text-white');
    }

    // 탭별 진입 처리
    if (tab === 'company') loadCompanyNameList();
}

async function loadCompanyNameList() {
    try {
        const names = await eel.get_outsource_company_names()();
        const datalist = document.getElementById('companyNameList');
        if (!datalist) return;
        datalist.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">`).join('');
    } catch(e) {
        console.warn('업체명 목록 로드 실패:', e);
        showToast('업체명 목록을 불러오지 못했습니다.', 'warning');
    }
}


// ============================================================================
// 조회 탭 초기 기본값: DB 최신 계약번호 설정
// ============================================================================

// navigateToSearch()에서 설정 중일 때 initSearchTabDefaults가 덮어쓰지 못하도록 하는 플래그
let _navigatingToSearch = false;

async function initSearchTabDefaults() {
    // navigateToSearch()가 계약번호를 직접 세팅하는 중이면 기본값 덮어쓰기 방지
    if (_navigatingToSearch) return;
    try {
        const latest = await eel.get_latest_contract_number()();
        // await 이후에도 플래그 재확인 (비동기 완료 시점에 이미 navigate 중일 수 있음)
        if (_navigatingToSearch) return;
        if (latest) {
            const match = latest.match(/^SH-(\d{4})-(\d{3,})/i);
            if (match) {
                const yearEl = document.getElementById('contractYear');
                const seqEl  = document.getElementById('contractSeq');
                if (yearEl) yearEl.value = match[1];
                if (seqEl)  seqEl.value  = match[2];
                // 최신 계약번호 설정 후 자동 조회 실행
                if (typeof searchByContract === 'function') {
                    await searchByContract();
                }
            }
        }
    } catch(e) {
        // 오류 시 빈 상태 유지
    }
}

// ============================================================================
// 차트/보드 → 현황 조회 이동 (더블클릭)
// ============================================================================

function navigateToSearch(contractNumber) {
    if (!contractNumber) return;
    // initSearchTabDefaults()의 덮어쓰기 방지 플래그 설정
    _navigatingToSearch = true;
    // 1. 조회 탭으로 이동 (내부에서 initSearchTabDefaults 호출되지만 플래그로 차단됨)
    showView('search');
    // 2. 현황 조회 서브탭 활성화
    showSearchTab('status');
    // 3. 계약번호 파싱 (SH-YYYY-NNN-T)
    const match = contractNumber.match(/^SH-(\d{4})-(\d{3})-T$/);
    if (match) {
        document.getElementById('contractYear').value = match[1];
        document.getElementById('contractSeq').value = match[2];
    }
    // 4. 자동 검색 후 플래그 해제
    searchByContract().finally(() => { _navigatingToSearch = false; });
}

// ============================================================================
// 대시보드 탭 전환
// ============================================================================

function showDashboardTab(tab) {
    const chartTab = document.getElementById('chartTab');
    const boardTab = document.getElementById('boardTab');
    const statsTab = document.getElementById('statsTab');
    const btnChart = document.getElementById('btnDashboardChart');
    const btnBoard = document.getElementById('btnDashboardBoard');
    const btnStats = document.getElementById('btnDashboardStats');

    // 모든 탭 숨기기, 모든 버튼 초기화
    [chartTab, boardTab, statsTab].forEach(t => t && t.classList.add('hidden'));
    [btnChart, btnBoard, btnStats].forEach(b => {
        if (!b) return;
        b.classList.remove('bg-blue-600', 'text-white');
        b.classList.add('bg-slate-200');
    });

    if (tab === 'chart') {
        chartTab && chartTab.classList.remove('hidden');
        if (btnChart) { btnChart.classList.remove('bg-slate-200'); btnChart.classList.add('bg-blue-600', 'text-white'); }
        loadGanttChart();
    } else if (tab === 'board') {
        boardTab && boardTab.classList.remove('hidden');
        if (btnBoard) { btnBoard.classList.remove('bg-slate-200'); btnBoard.classList.add('bg-blue-600', 'text-white'); }
        loadKanbanBoard();
    } else if (tab === 'stats') {
        statsTab && statsTab.classList.remove('hidden');
        if (btnStats) { btnStats.classList.remove('bg-slate-200'); btnStats.classList.add('bg-blue-600', 'text-white'); }
        loadStatsData();
    }
}

// ============================================================================
// 한국 공휴일 데이터 (config/holidays.json 에서 동적 로드)
// ============================================================================

let KOREAN_HOLIDAYS = {};

async function loadHolidays() {
    try {
        const data = await eelWithTimeout(eel.get_holidays()(), 5000);
        if (data && typeof data === 'object') {
            KOREAN_HOLIDAYS = data;
        }
    } catch (e) {
        console.warn('공휴일 데이터 로드 실패, 빈 데이터로 진행:', e);
    }
}

async function saveAndRefreshHolidays() {
    const keyInput = document.getElementById('holidayApiKey');
    const statusEl = document.getElementById('holidayApiStatus');
    const key = keyInput ? keyInput.value.trim() : '';
    if (!key) {
        if (statusEl) statusEl.textContent = '❌ 서비스키를 입력하세요.';
        return;
    }
    if (statusEl) statusEl.textContent = '🔄 갱신 중... (최대 1분 소요)';
    try {
        const result = await eelWithTimeout(
            eel.refresh_holidays(key, currentUser?.user_id || '')(),
            70000  // 12개월 × 3년 = 최대 36회 HTTP 요청 여유
        );
        if (result && result.success) {
            if (statusEl) statusEl.textContent = `✅ ${result.message}`;
            keyInput.value = '';
            keyInput.placeholder = '●●●●●●●● (저장됨)';
            await loadHolidays();  // 메모리 갱신
        } else {
            if (statusEl) statusEl.textContent = `❌ ${result?.message || '갱신 실패'}`;
        }
    } catch (e) {
        if (statusEl) statusEl.textContent = `❌ 오류: ${e.message}`;
    }
}

async function loadHolidayKeyStatus() {
    try {
        const settings = await eel.admin_get_settings(currentUser?.user_id || '')();
        const key = settings?.holidays?.data_go_kr_key || '';
        const input = document.getElementById('holidayApiKey');
        if (input && key) {
            input.placeholder = '●●●●●●●● (저장됨)';
        }
    } catch (_) { /* 무시 */ }
}

// ============================================================================
// 간트 차트
// ============================================================================

let ganttYear = new Date().getFullYear();
let ganttMonth = new Date().getMonth() + 1;
let ganttDualView = false;

// 간트 차트용 색상 팔레트 (프로젝트별 로테이션)
const GANTT_COLORS = [
    { bar: 'bg-blue-400', light: 'bg-blue-100' },
    { bar: 'bg-emerald-400', light: 'bg-emerald-100' },
    { bar: 'bg-amber-400', light: 'bg-amber-100' },
    { bar: 'bg-purple-400', light: 'bg-purple-100' },
    { bar: 'bg-rose-400', light: 'bg-rose-100' }
];

function changeGanttMonth(delta) {
    ganttMonth += delta;
    if (ganttMonth < 1) { ganttMonth = 12; ganttYear--; }
    if (ganttMonth > 12) { ganttMonth = 1; ganttYear++; }
    loadGanttChart();
}

function toggleGanttDualView() {
    ganttDualView = !ganttDualView;
    const btn = document.getElementById('ganttDualBtn');
    if (btn) btn.textContent = ganttDualView ? '1개월 뷰' : '2개월 뷰';
    loadGanttChart();
}

function buildGanttTableHTML(projects, year, month) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];

    let html = '<table class="w-full border-collapse text-sm"><thead>';

    // 1행: 날짜
    html += '<tr class="bg-slate-50">';
    html += '<th rowspan="2" class="border p-2 text-center bg-slate-100 sticky left-0 z-10 min-w-32">선사/선명</th>';
    html += '<th rowspan="2" class="border p-2 text-center bg-slate-100 min-w-28">작업내용</th>';
    html += '<th rowspan="2" class="border p-2 text-center bg-slate-100 min-w-20">기간</th>';

    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month - 1, day);
        const dow = date.getDay();
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isHoliday = KOREAN_HOLIDAYS[dateStr];
        const isSunday = dow === 0;
        const isSaturday = dow === 6;

        let cellClass = 'border p-1 text-center text-xs min-w-7';
        if (isSunday || isHoliday) {
            cellClass += ' bg-red-100 text-red-600';
        } else if (isSaturday) {
            cellClass += ' bg-blue-100 text-blue-600';
        }

        html += `<th class="${cellClass}" title="${isHoliday || ''}">${day}</th>`;
    }
    html += '</tr>';

    // 2행: 요일
    html += '<tr class="bg-slate-50">';
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month - 1, day);
        const dow = date.getDay();
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isHoliday = KOREAN_HOLIDAYS[dateStr];
        const isSunday = dow === 0;
        const isSaturday = dow === 6;

        let cellClass = 'border p-0 text-center text-xs';
        if (isSunday || isHoliday) {
            cellClass += ' bg-red-100 text-red-600 font-bold';
        } else if (isSaturday) {
            cellClass += ' bg-blue-100 text-blue-600 font-bold';
        } else {
            cellClass += ' text-slate-400';
        }

        let label = weekdays[dow];
        if (isHoliday && !isSunday && !isSaturday) {
            label = isHoliday.charAt(0);
        }

        html += `<th class="${cellClass}" title="${isHoliday || ''}">${label}</th>`;
    }
    html += '</tr></thead>';

    // 프로젝트 행
    html += '<tbody>';
    projects.forEach((project, idx) => {
        const color = GANTT_COLORS[idx % GANTT_COLORS.length];
        const workDatesSet = new Set(project.workDates || []);
        const safeCn = escapeHtml(project.contractNumber || '');

        html += `<tr class="hover:bg-slate-50 cursor-pointer" data-gantt-cn="${safeCn}">`;
        html += `<td class="border p-2 text-xs sticky left-0 bg-white z-10 whitespace-nowrap">
            <div class="font-semibold">${escapeHtml(project.company || '')}</div>
            <div class="text-slate-500">${escapeHtml(project.shipName || '')}</div>
        </td>`;

        let workDesc = '';
        if (project.engineModel && project.workContent) {
            workDesc = `${project.engineModel} ${project.workContent}`;
        } else {
            workDesc = project.engineModel || project.workContent || '';
        }
        html += `<td class="border p-2 text-xs">${escapeHtml(workDesc)}</td>`;
        html += `<td class="border p-2 text-xs text-center whitespace-nowrap">${project.startMD}~${project.endMD}</td>`;

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isWorkDate = workDatesSet.has(dateStr);
            const isInRange = dateStr >= project.startDate && dateStr <= project.endDate;

            let cellClass = 'border p-0';
            if (isWorkDate) {
                cellClass += ` ${color.bar}`;
            } else if (isInRange) {
                cellClass += ` ${color.light}`;
            }

            html += `<td class="${cellClass}"></td>`;
        }
        html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
}

async function loadGanttChart() {
    try {
        const display   = document.getElementById('ganttMonthDisplay');
        const container = document.getElementById('ganttContainer');

        // 최초 1회만 이벤트 위임 등록 (ondblclick 인라인 핸들러 대체)
        if (container && !container._ganttDblClickAttached) {
            container.addEventListener('dblclick', e => {
                const row = e.target.closest('[data-gantt-cn]');
                if (row) navigateToSearch(row.dataset.ganttCn);
            });
            container._ganttDblClickAttached = true;
        }
        const emptyDiv  = document.getElementById('ganttEmpty');

        if (ganttDualView) {
            let prevMonth = ganttMonth - 1, prevYear = ganttYear;
            if (prevMonth < 1) { prevMonth = 12; prevYear--; }

            if (display)
                display.textContent = `${prevYear}년 ${prevMonth}월 ~ ${ganttYear}년 ${ganttMonth}월`;

            const [prevProjects, currProjects] = await Promise.all([
                eel.get_gantt_data(prevYear, prevMonth)(),
                eel.get_gantt_data(ganttYear, ganttMonth)()
            ]);

            const hasData = (prevProjects && prevProjects.length > 0)
                         || (currProjects && currProjects.length > 0);
            if (!hasData) {
                if (container) container.innerHTML = '';
                if (emptyDiv) emptyDiv.classList.remove('hidden');
                return;
            }
            if (emptyDiv) emptyDiv.classList.add('hidden');

            if (container) container.innerHTML =
                `<div class="text-sm font-bold text-slate-500 mb-1 px-1">${prevYear}년 ${prevMonth}월</div>
                 <div class="overflow-x-auto">
                     ${prevProjects && prevProjects.length > 0
                         ? buildGanttTableHTML(prevProjects, prevYear, prevMonth)
                         : '<p class="text-slate-400 text-sm py-4 text-center">해당 월 작업 없음</p>'}
                 </div>
                 <div class="border-t-2 border-slate-300 my-5"></div>
                 <div class="text-sm font-bold text-slate-500 mb-1 px-1">${ganttYear}년 ${ganttMonth}월</div>
                 <div class="overflow-x-auto">
                     ${currProjects && currProjects.length > 0
                         ? buildGanttTableHTML(currProjects, ganttYear, ganttMonth)
                         : '<p class="text-slate-400 text-sm py-4 text-center">해당 월 작업 없음</p>'}
                 </div>`;
        } else {
            if (display) display.textContent = `${ganttYear}년 ${ganttMonth}월`;

            const projects = await eel.get_gantt_data(ganttYear, ganttMonth)();

            if (!projects || projects.length === 0) {
                if (container) container.innerHTML = '';
                if (emptyDiv) emptyDiv.classList.remove('hidden');
                return;
            }
            if (emptyDiv) emptyDiv.classList.add('hidden');

            if (container) container.innerHTML =
                `<div class="overflow-x-auto">${buildGanttTableHTML(projects, ganttYear, ganttMonth)}</div>`;
        }
    } catch (error) {
        console.error('간트 차트 로드 실패:', error);
        showCustomAlert('오류', '간트 차트 로드에 실패했습니다.', 'error');
    }
}

// ============================================================================
// 칸반 보드
// ============================================================================

async function loadKanbanBoard() {
    try {
        const data = await eel.get_kanban_data()();
        // #12 — 칸반 카드 더블클릭 이벤트 위임 (ondblclick 인라인 핸들러 대체, 최초 1회만 등록)
        const _kc = document.getElementById('kanbanContainer');
        if (_kc && !_kc._dblClickAttached) {
            _kc.addEventListener('dblclick', e => {
                const card = e.target.closest('[data-kanban-cn]');
                if (card) navigateToSearch(card.dataset.kanbanCn);
            });
            _kc._dblClickAttached = true;
        }

        const receptionCards = document.getElementById('receptionCards');
        const startedCards = document.getElementById('startedCards');
        const doneCards = document.getElementById('doneCards');
        const receptionCount = document.getElementById('receptionCount');
        const startedCount = document.getElementById('startedCount');
        const doneCount = document.getElementById('doneCount');

        if (!receptionCards || !startedCards || !doneCards) return;

        receptionCards.innerHTML = '';
        startedCards.innerHTML = '';
        doneCards.innerHTML = '';

        if (receptionCount) receptionCount.textContent = (data.reception || []).length;
        if (startedCount) startedCount.textContent = (data.started || []).length;
        if (doneCount) doneCount.textContent = (data.done || []).length;

        // 접수 / 착수 / 준공 — #5: innerHTML += 루프 → map().join() 한 번 대입 (O(n²)→O(n))
        receptionCards.innerHTML = (data.reception || []).map(p => renderReceptionCard(p)).join('');
        startedCards.innerHTML   = (data.started   || []).map(p => renderCard(p, 'border-blue-500')).join('');
        doneCards.innerHTML      = (data.done       || []).map(p => renderCard(p, 'border-green-500')).join('');
        // 아카이브: 전체 데이터 저장 후 달 필터링으로 렌더링
        _archiveAllData = data.archive || [];
        if (_archiveYear === null) {
            const d = new Date();
            d.setMonth(d.getMonth() - 1);
            _archiveYear  = d.getFullYear();
            _archiveMonth = d.getMonth() + 1;
        }
        renderArchiveForMonth();

        // 빈 상태 표시
        if ((data.reception || []).length === 0) {
            receptionCards.innerHTML = '<p class="text-center text-slate-400 text-sm py-4">접수된 프로젝트가 없습니다.</p>';
        }
        if ((data.started || []).length === 0) {
            startedCards.innerHTML = '<p class="text-center text-slate-400 text-sm py-4">착수된 프로젝트가 없습니다.</p>';
        }
        if ((data.done || []).length === 0) {
            doneCards.innerHTML = '<p class="text-center text-slate-400 text-sm py-4">준공된 프로젝트가 없습니다.</p>';
        }

    } catch (error) {
        console.error('칸반 보드 로드 실패:', error);
        showCustomAlert('오류', '칸반 보드 로드에 실패했습니다.', 'error');
    }
}

// ============================================================================
// 칸반 카드 렌더링 (전역 — loadKanbanBoard + renderArchiveForMonth 공유)
// ============================================================================

function renderReceptionCard(project) {
    let workDesc = '';
    if (project.engineModel && project.workContent) {
        workDesc = `${project.engineModel} ${project.workContent}`;
    } else {
        workDesc = project.engineModel || project.workContent || '';
    }
    const safeCompany  = escapeHtml(project.company  || '');
    const safeShipName = escapeHtml(project.shipName || '');
    const safeCn       = escapeHtml(project.contractNumber || '');
    const jsTitle      = escapeJs(`${project.company || ''} ${project.shipName || ''}`);
    return `
        <div class="bg-white rounded-lg shadow-sm p-3 border-l-4 border-yellow-400 hover:shadow-md transition-shadow">
            <div class="flex justify-between items-start">
                <div class="font-bold text-sm">${safeCompany} ${safeShipName}</div>
                <div class="flex gap-1">
                    <button onclick="promptStartProject(${project.id})" class="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200" title="착수 전환">착수 ▶</button>
                    <button onclick="deleteBoardProject(${project.id})" class="text-xs px-1 py-0.5 bg-red-100 text-red-600 rounded hover:bg-red-200" title="삭제">✕</button>
                </div>
            </div>
            ${safeCn ? `<div class="text-xs text-slate-400 mt-0.5">${safeCn}</div>` : ''}
            <div class="text-xs mt-1 text-slate-700">${escapeHtml(workDesc)}</div>
            ${_renderMilestoneBadges(project)}
            <div class="flex justify-between items-center mt-1">
                <div class="flex gap-1 items-center">
                    <div class="text-xs text-slate-400">접수 대기</div>
                    <button onclick="event.stopPropagation(); openMilestoneModal(${project.id}, '${escapeJs(project.targetStartDate||'')}', '${escapeJs(project.targetEndDate||'')}', '${escapeJs(project.actualEndDate||'')}', '${escapeJs(project.engineModel||'')}', '${escapeJs(project.workContent||'')}')"
                            class="text-xs px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded hover:bg-slate-200" title="마일스톤 편집">📅</button>
                </div>
                <button onclick="event.stopPropagation(); openCommentModal('', ${project.id}, '${jsTitle}')" class="text-slate-400 hover:text-blue-500 text-sm" title="댓글">💬</button>
            </div>
        </div>
    `;
}

function renderCard(project, borderColor) {
    let workDesc = '';
    if (project.engineModel && project.workContent) {
        workDesc = `${project.engineModel} ${project.workContent}`;
    } else {
        workDesc = project.engineModel || project.workContent || '';
    }
    const cn            = project.contractNumber || '';
    const safeCn        = escapeHtml(cn);
    const jsCn          = escapeJs(cn);
    const currentStatus = project.status || '';
    const safeCompany   = escapeHtml(project.company  || '');
    const safeShipName  = escapeHtml(project.shipName || '');
    const jsTitle       = escapeJs(`${project.company || ''} ${project.shipName || ''}`);

    let statusSelect = '';
    if (currentStatus !== '아카이브') {
        statusSelect = `
            <select onchange="changeKanbanStatus('${jsCn}', this.value)" class="text-xs border rounded px-1 py-0.5 bg-slate-50">
                <option value="착수" ${currentStatus === '착수' ? 'selected' : ''}>착수</option>
                <option value="준공" ${currentStatus === '준공' ? 'selected' : ''}>준공</option>
            </select>`;
    } else {
        // 아카이브 카드: manualStatus가 '준공'이면 처리됨 표시, 아니면 버튼
        if (project.manualStatus === '준공') {
            statusSelect = `<span class="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded border border-emerald-200 cursor-default">✓ 준공처리됨</span>`;
        } else {
            statusSelect = `<button onclick="changeKanbanStatus('${jsCn}', '준공')"
                class="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200"
                title="월간 보고에 준공 날짜 반영">준공처리</button>`;
        }
    }

    return `
        <div class="bg-white rounded-lg shadow-sm p-3 border-l-4 ${borderColor} hover:shadow-md transition-shadow cursor-pointer"
             data-kanban-cn="${escapeHtml(cn)}">
            <div class="flex justify-between items-start">
                <div class="font-bold text-sm">${safeCompany} ${safeShipName}</div>
                ${statusSelect}
            </div>
            <div class="text-xs text-slate-500 mt-0.5">${safeCn}</div>
            <div class="text-xs mt-1 text-slate-700">${escapeHtml(workDesc)}</div>
            ${_renderMilestoneBadges(project)}
            <div class="flex justify-between mt-2 text-xs text-slate-500">
                <span>${escapeHtml(project.startMD || '')} ~ ${escapeHtml(project.endMD || '')}</span>
                <span class="font-semibold text-blue-600">${project.totalManpower || 0}공</span>
            </div>
            <div class="flex justify-between items-center mt-1">
                <div class="flex gap-1 items-center">
                    <div class="text-xs text-slate-400">${project.workDays || 0}일 작업</div>
                    ${project.boardProjectId
                        ? `<button onclick="event.stopPropagation(); openMilestoneModal(${project.boardProjectId}, '${escapeJs(project.targetStartDate||'')}', '${escapeJs(project.targetEndDate||'')}', '${escapeJs(project.actualEndDate||'')}', '${escapeJs(project.engineModel||'')}', '${escapeJs(project.workContent||'')}')" class="text-xs px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded hover:bg-slate-200" title="마일스톤 편집">📅</button>`
                        : `<button onclick="event.stopPropagation(); _openMilestoneForNew('${jsCn}', '${escapeJs(project.engineModel||'')}', '${escapeJs(project.workContent||'')}')" class="text-xs px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded hover:bg-slate-200" title="마일스톤 편집">📅</button>`}
                </div>
                <button onclick="event.stopPropagation(); openCommentModal(this.dataset.cn, null, this.dataset.title)" data-cn="${escapeHtml(cn)}" data-title="${escapeHtml(project.company || '')} ${escapeHtml(project.shipName || '')}" class="text-slate-400 hover:text-blue-500 text-sm" title="댓글">💬</button>
            </div>
        </div>
    `;
}

// ============================================================================
// 마일스톤 UI 헬퍼
// ============================================================================

function _renderMilestoneBadges(project) {
    const ts = project.targetStartDate || '';
    const te = project.targetEndDate   || '';
    const ae = project.actualEndDate   || '';
    const parts = [];
    if (ts) parts.push(`<span class="text-slate-400">착수 ${escapeHtml(ts)}</span>`);
    if (te) parts.push(`<span class="text-orange-500">완료예정 ${escapeHtml(te)}</span>`);
    if (ae) parts.push(`<span class="text-green-600">완료 ✅ ${escapeHtml(ae)}</span>`);
    return parts.length ? `<div class="flex flex-wrap gap-1 mt-1 text-xs">${parts.join('')}</div>` : '';
}

// boardProjectId 없는 카드(착수 직접 등록)에서 📅 클릭 시 호출
// board_projects 행을 자동 생성 후 마일스톤 모달 열기
async function _openMilestoneForNew(contractNumber, engineModel, workContent) {
    try {
        const res = await eel.get_or_create_board_project(contractNumber)();
        if (res && res.success) {
            openMilestoneModal(res.projectId, '', '', '', engineModel, workContent);
        } else {
            showToast(res?.message || '마일스톤 생성 중 오류가 발생했습니다.', 'error');
        }
    } catch(e) {
        showToast('마일스톤 생성 중 오류가 발생했습니다.', 'error');
    }
}

function openMilestoneModal(projectId, targetStart, targetEnd, actualEnd, engineModel, workContent) {
    // 기존 모달이 있으면 제거
    const old = document.getElementById('milestoneModal');
    if (old) old.remove();

    const m = document.createElement('div');
    m.id = 'milestoneModal';
    m.className = 'fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50';
    m.innerHTML = `
        <div class="bg-white rounded-xl shadow-xl p-6 w-80">
            <h3 class="font-bold text-base mb-4">📅 마일스톤 편집</h3>
            <label class="block text-xs text-slate-500 mb-1">착수 예정일</label>
            <input id="msTargetStart" type="date" value="${escapeHtml(targetStart || '')}"
                   class="w-full border rounded px-2 py-1 text-sm mb-3"
                   oninput="_fetchEtaSuggestion()">
            <label class="block text-xs text-slate-500 mb-1">완료 예정일</label>
            <input id="msTargetEnd" type="date" value="${escapeHtml(targetEnd || '')}"
                   class="w-full border rounded px-2 py-1 text-sm mb-1">
            <!-- ETA 제안 -->
            <div id="msEtaHint" class="text-xs text-blue-600 mb-3 min-h-[1rem]"></div>
            <label class="block text-xs text-slate-500 mb-1">실제 완료일</label>
            <input id="msActualEnd" type="date" value="${escapeHtml(actualEnd || '')}"
                   class="w-full border rounded px-2 py-1 text-sm mb-4">
            <div class="flex justify-end gap-2">
                <button onclick="document.getElementById('milestoneModal').remove()"
                        class="px-3 py-1.5 text-sm border rounded text-slate-600 hover:bg-slate-50">취소</button>
                <button onclick="saveMilestone(${projectId})"
                        class="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">저장</button>
            </div>
        </div>
    `;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) m.remove(); });

    // 모달 열릴 때 자동 ETA 조회
    m._engineModel  = engineModel  || '';
    m._workContent  = workContent  || '';
    _fetchEtaSuggestion();
}

async function _fetchEtaSuggestion() {
    const modal = document.getElementById('milestoneModal');
    if (!modal) return;
    const hint   = document.getElementById('msEtaHint');
    const tsVal  = document.getElementById('msTargetStart')?.value || '';
    if (!hint) return;
    try {
        const r = await eel.estimate_completion(modal._engineModel || '', modal._workContent || '', tsVal)();
        if (r.success && r.avgDays) {
            hint.innerHTML = `📊 과거 평균: <strong>${r.avgDays}일</strong> (${r.sampleCount}건 기준)
                ${r.suggestionEndDate ? ` &nbsp;<button onclick="document.getElementById('msTargetEnd').value='${escapeJs(r.suggestionEndDate)}'"
                    class="underline text-blue-700 hover:text-blue-900">적용 (${escapeHtml(r.suggestionEndDate)})</button>` : ''}`;
        } else {
            hint.textContent = '(과거 유사 작업 데이터 없음)';
        }
    } catch (_) {
        hint.textContent = '';
    }
}

async function saveMilestone(projectId) {
    const ts = document.getElementById('msTargetStart')?.value || '';
    const te = document.getElementById('msTargetEnd')?.value   || '';
    const ae = document.getElementById('msActualEnd')?.value   || '';
    try {
        const result = await eel.update_project_milestones(projectId, ts, te, ae)();
        if (result.success) {
            showToast('마일스톤이 저장되었습니다.', 'success');
            document.getElementById('milestoneModal')?.remove();
            loadKanbanBoard();
        } else {
            showToast(result.message || '저장 실패', 'error');
        }
    } catch (e) {
        showToast('마일스톤 저장 중 오류가 발생했습니다.', 'error');
    }
}

// ============================================================================
// 아카이브 달 네비게이션
// ============================================================================

function renderArchiveForMonth() {
    const archiveCards      = document.getElementById('archiveCards');
    const archiveCount      = document.getElementById('archiveCount');
    const archiveMonthLabel = document.getElementById('archiveMonthLabel');
    const archiveNextBtn    = document.getElementById('archiveNextBtn');
    if (!archiveCards) return;

    if (archiveMonthLabel)
        archiveMonthLabel.textContent = `${_archiveYear}년 ${_archiveMonth}월`;

    const monthStr = `${_archiveYear}-${String(_archiveMonth).padStart(2, '0')}`;
    const filtered = _archiveAllData.filter(p => p.endDate && p.endDate.startsWith(monthStr));

    // 다음 달 버튼: 이전 달(오늘 기준)을 초과하면 비활성화
    if (archiveNextBtn) {
        const now  = new Date();
        const prevY = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
        const prevM = now.getMonth() === 0 ? 12 : now.getMonth();
        const atLatest = _archiveYear > prevY || (_archiveYear === prevY && _archiveMonth >= prevM);
        archiveNextBtn.disabled     = atLatest;
        archiveNextBtn.style.opacity = atLatest ? '0.3' : '';
    }

    archiveCards.innerHTML = filtered.length === 0
        ? '<p class="text-center text-slate-400 text-sm py-4 col-span-3">해당 월 아카이브가 없습니다.</p>'
        : filtered.map(p => renderCard(p, 'border-slate-400')).join('');

    if (archiveCount) archiveCount.textContent = filtered.length;
}

function archiveChangeMonth(delta) {
    if (_archiveYear === null || _archiveMonth === null) return; // #7 — 초기화 전 호출 방어
    let m = _archiveMonth + delta, y = _archiveYear;
    if (m < 1)  { m = 12; y--; }
    if (m > 12) { m = 1;  y++; }
    _archiveYear  = y;
    _archiveMonth = m;
    renderArchiveForMonth();
}

// 아카이브 토글
function toggleArchive() {
    const panel = document.getElementById('archivePanel');
    const btn = document.getElementById('archiveToggleBtn');
    if (panel) {
        panel.classList.toggle('hidden');
        if (btn) btn.textContent = panel.classList.contains('hidden') ? '아카이브 ▼' : '아카이브 ▲';
    }
}

// 칸반 상태 변경 (드롭다운)
async function changeKanbanStatus(contractNumber, newStatus) {
    try {
        const result = await eel.set_project_status(contractNumber, newStatus)();
        if (result.success) {
            if (newStatus === '준공') {
                showToast('준공처리 완료. 월간 보고에 반영됩니다.');
            }
            loadKanbanBoard();
        }
    } catch (error) {
        console.error('상태 변경 실패:', error);
        showCustomAlert('오류', '상태 변경에 실패했습니다.', 'error');
    }
}

function showToast(msg, type = 'default', duration = 2500) {
    const t = document.createElement('div');
    const colorMap = {
        'error':   'bg-red-600',
        'warning': 'bg-yellow-500',
        'success': 'bg-green-600',
        'default': 'bg-slate-800'
    };
    const color = colorMap[type] || colorMap['default'];
    t.className = `fixed bottom-6 left-1/2 -translate-x-1/2 ${color} text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), duration);
}

// 새 프로젝트 접수 모달
function showNewProjectModal() {
    document.getElementById('npCompany').value = '';
    document.getElementById('npShipName').value = '';
    document.getElementById('npEngineModel').value = '';
    document.getElementById('npWorkContent').value = '';
    document.getElementById('newProjectModal').classList.remove('hidden');
}

function closeNewProjectModal() {
    document.getElementById('newProjectModal').classList.add('hidden');
}

async function submitNewProject() {
    const data = {
        company: document.getElementById('npCompany').value.trim(),
        ship_name: document.getElementById('npShipName').value.trim().toUpperCase(),
        engine_model: document.getElementById('npEngineModel').value.trim(),
        work_content: document.getElementById('npWorkContent').value.trim(),
        username: currentUser ? currentUser.full_name : ''
    };
    if (!data.ship_name) {
        showCustomAlert('알림', '선명을 입력해주세요.', 'info');
        return;
    }
    try {
        const result = await eel.create_board_project(data)();
        if (result.success) {
            closeNewProjectModal();
            loadKanbanBoard();
        } else {
            showCustomAlert('오류', result.message, 'error');
        }
    } catch (error) {
        console.error('프로젝트 접수 실패:', error);
        showCustomAlert('오류', '프로젝트 접수에 실패했습니다.', 'error');
    }
}

// 착수 전환 모달 (계약번호 입력)
function promptStartProject(projectId) {
    document.getElementById('spProjectId').value = projectId;
    const now = new Date();
    document.getElementById('spContractYear').value = now.getFullYear();
    document.getElementById('spContractSeq').value = '001';
    document.getElementById('startProjectModal').classList.remove('hidden');
}

function closeStartProjectModal() {
    document.getElementById('startProjectModal').classList.add('hidden');
}

async function confirmStartProject() {
    const projectId = parseInt(document.getElementById('spProjectId').value);
    const year = document.getElementById('spContractYear').value.trim();
    const seq = document.getElementById('spContractSeq').value.trim().padStart(3, '0');
    const contractNumber = `SH-${year}-${seq}-T`;

    try {
        const result = await eel.update_board_project(projectId, {
            contract_number: contractNumber,
            status: '착수'
        })();
        if (result.success) {
            closeStartProjectModal();
            loadKanbanBoard();
        } else {
            showCustomAlert('오류', result.message, 'error');
        }
    } catch (error) {
        console.error('착수 전환 실패:', error);
        showCustomAlert('오류', '착수 전환에 실패했습니다.', 'error');
    }
}

// 보드 프로젝트 삭제
async function deleteBoardProject(projectId) {
    if (!confirm('이 접수 프로젝트를 삭제하시겠습니까?')) return;
    try {
        const result = await eel.delete_board_project(projectId)();
        if (result.success) {
            loadKanbanBoard();
        }
    } catch (error) {
        console.error('프로젝트 삭제 실패:', error);
        showCustomAlert('오류', '프로젝트 삭제에 실패했습니다.', 'error');
    }
}

// ============================================================================
// 댓글 시스템
// ============================================================================

let _commentPollTimer = null;

function openCommentModal(contractNumber, boardProjectId, title) {
    document.getElementById('commentContractNumber').value = contractNumber || '';
    document.getElementById('commentBoardProjectId').value = boardProjectId || '';
    document.getElementById('commentTitle').textContent = `💬 ${title || '프로젝트'} 댓글`;
    document.getElementById('commentInput').value = '';
    document.getElementById('commentReplyToId').value = '';
    document.getElementById('replyIndicator').classList.add('hidden');
    document.getElementById('commentModal').classList.remove('hidden');

    // T2a: textarea keydown 이벤트 설정 (Enter=제출, Shift+Enter=줄바꿈)
    const textarea = document.getElementById('commentInput');
    if (textarea && !textarea._commentKeydownBound) {
        textarea.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitComment();
            }
        });
        textarea._commentKeydownBound = true;
    }

    // T2c: 자동 폴링 시작 (10초 주기)
    clearInterval(_commentPollTimer);
    _commentPollTimer = setInterval(async () => {
        try { await loadComments(); } catch(e) {}
    }, 10000);

    // 클라우드 pull 후 댓글 로드 (실패해도 로컬 DB로 계속)
    (async () => {
        try {
            const syncMode = await eel.get_cloud_sync_mode()();
            if (syncMode && syncMode !== 'standalone') {
                await eel.sync_from_cloud()();
            }
        } catch (e) {
            console.warn('댓글 모달 sync_from_cloud 실패:', e);
        }
        loadComments();
    })();
}

function closeCommentModal() {
    // T2c: 폴링 해제
    clearInterval(_commentPollTimer);
    _commentPollTimer = null;
    document.getElementById('commentModal').classList.add('hidden');
}

async function loadComments() {
    const cn = document.getElementById('commentContractNumber').value;
    const bpId = document.getElementById('commentBoardProjectId').value;
    const listDiv = document.getElementById('commentsList');
    if (!listDiv) return;

    try {
        let result;
        if (cn) {
            result = await eel.get_project_comments(cn, 0)();
        } else if (bpId) {
            result = await eel.get_project_comments('', parseInt(bpId))();
        } else {
            listDiv.innerHTML = '<p class="text-slate-400 text-sm text-center">댓글을 불러올 수 없습니다.</p>';
            return;
        }

        if (!result) {
            listDiv.innerHTML = '<p class="text-slate-400 text-sm text-center py-4">아직 댓글이 없습니다.</p>';
            return;
        }

        const comments = result.comments || [];
        if (comments.length === 0) {
            listDiv.innerHTML = '<p class="text-slate-400 text-sm text-center py-4">아직 댓글이 없습니다.</p>';
            return;
        }

        // 트리 구조 빌드
        const topLevel = comments.filter(c => !c.parentId);
        const replies = comments.filter(c => c.parentId);
        const replyMap = {};
        replies.forEach(r => {
            if (!replyMap[r.parentId]) replyMap[r.parentId] = [];
            replyMap[r.parentId].push(r);
        });

        let html = '';
        topLevel.forEach(c => {
            html += renderComment(c, false);
            (replyMap[c.id] || []).forEach(r => {
                html += renderComment(r, true);
            });
        });

        listDiv.innerHTML = html;
    } catch (error) {
        console.error('댓글 로드 실패:', error);
        listDiv.innerHTML = '<p class="text-red-400 text-sm text-center">댓글 로드 실패</p>';
    }
}

function renderComment(comment, isReply) {
    if (!comment) return '';  // #8 — null/undefined 방어
    const userId = currentUser ? currentUser.user_id : '';
    const isOwner = comment.userId === userId;
    const indent = isReply ? 'ml-6 border-l-2 border-slate-200 pl-3' : '';
    const time = comment.createdAt ? formatCommentTime(comment.createdAt) : '';
    const safeUserName = escapeHtml(comment.userName || '익명');

    let actions = `<button onclick="setReplyTo(${comment.id}, this.getAttribute('data-name'))" data-name="${safeUserName}" class="text-xs text-blue-500 hover:text-blue-700">답글</button>`;
    if (isOwner) {
        actions += ` <button onclick="deleteComment(${comment.id})" class="text-xs text-red-400 hover:text-red-600">삭제</button>`;
    }

    return `
        <div class="${indent} py-2">
            <div class="flex justify-between items-start">
                <div class="text-xs font-semibold text-slate-700">${safeUserName} <span class="font-normal text-slate-400">${time}</span></div>
                <div class="flex gap-2">${actions}</div>
            </div>
            <div class="text-sm text-slate-600 mt-1">${escapeHtml(comment.content)}</div>
        </div>
    `;
}

function formatCommentTime(isoStr) {
    try {
        const d = new Date(isoStr);
        const now = new Date();
        const diff = now - d;
        if (diff < 60000) return '방금';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
        return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch {
        return '';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
}

// JS 인라인 이벤트 핸들러 내 문자열 안전 처리 (홑따옴표·역슬래시·개행 이스케이프)
function escapeJs(text) {
    return String(text || '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

function setReplyTo(commentId, userName) {
    document.getElementById('commentReplyToId').value = commentId;
    document.getElementById('replyToName').textContent = userName;
    document.getElementById('replyIndicator').classList.remove('hidden');
    document.getElementById('commentInput')?.focus();
}

function cancelReply() {
    document.getElementById('commentReplyToId').value = '';
    document.getElementById('replyIndicator').classList.add('hidden');
}

let _isSubmittingComment = false; // T2b: 중복 제출 방지 플래그

async function submitComment() {
    if (_isSubmittingComment) return; // T2b: 중복 제출 차단
    const input = document.getElementById('commentInput');
    const content = input.value.trim();
    if (!content) return;

    _isSubmittingComment = true;
    const cn = document.getElementById('commentContractNumber').value;
    const bpId = document.getElementById('commentBoardProjectId').value;
    const parentId = document.getElementById('commentReplyToId').value;
    const userId = (currentUser && currentUser.user_id) ? currentUser.user_id : 'unknown';
    const userName = (currentUser && currentUser.full_name) ? currentUser.full_name : '익명';

    try {
        const result = await eel.add_project_comment_with_user(
            cn || '',
            content,
            userId,
            userName,
            parentId ? parseInt(parentId) : 0,
            bpId ? parseInt(bpId) : 0
        )();

        if (result.success) {
            input.value = '';
            cancelReply();
            try { await loadComments(); } catch(e) { console.warn('댓글 목록 갱신 실패:', e); }
            // 즉시 클라우드 push (백그라운드, 실패해도 댓글은 이미 등록됨)
            (async () => {
                try {
                    const syncMode = await eel.get_cloud_sync_mode()();
                    if (syncMode && syncMode !== 'standalone') {
                        await eel.sync_to_cloud()();
                    }
                } catch (e) {
                    console.warn('댓글 작성 후 sync_to_cloud 실패:', e);
                }
            })();
        } else {
            showCustomAlert('오류', result.message, 'error');
        }
    } catch (error) {
        console.error('댓글 등록 실패:', error);
    } finally {
        _isSubmittingComment = false; // T2b: 항상 플래그 해제
    }
}

async function deleteComment(commentId) {
    if (!confirm('이 댓글을 삭제하시겠습니까?')) return;
    const userId = currentUser ? currentUser.user_id : '';
    try {
        const result = await eel.delete_project_comment(commentId, userId)();
        if (result.success) {
            loadComments();
        } else {
            showCustomAlert('알림', result.message, 'info');
        }
    } catch (error) {
        console.error('댓글 삭제 실패:', error);
    }
}

// ============================================================================
// 입력 변환 함수
// ============================================================================

function convertKoreanToEnglish(text) {
    let result = '';
    for (let char of text) {
        result += koreanToEnglish[char] || char;
    }
    return result;
}

function sanitizeContractNumber(value) {
    let converted = convertKoreanToEnglish(value);
    converted = converted.replace(/[^a-zA-Z0-9-]/g, '');
    return converted.toUpperCase();
}

function toUpperCase(value) {
    return value.toUpperCase();
}

// ============================================================================
// 인원 계산 (즉시 계산)
// ============================================================================

function hasHalfManpowerMarker(text) {
    const value = (text || '').trim();
    if (!value) return false;
    return /<i>.*?<\/i>/i.test(value) || /\*[^*]+\*/.test(value);
}

async function calculateManpowerInstant(index) {
    const records = _getActiveRecords();
    const leader = records[index]?.leader || '';
    const teammates = records[index]?.teammates || '';
    
    let manpower = 0;
    
    // 작업자
    if (leader.trim()) {
        manpower += hasHalfManpowerMarker(leader) ? 0.5 : 1;
    }
    
    // 동반자 (간단 계산)
    if (teammates.trim()) {
        const contractMatches = teammates.match(/[^()\[\],]+\([^)]+\)/g);
        if (contractMatches) {
            manpower += contractMatches.length * 1;
        }
        
        const dailyMatches = teammates.match(/[^()\[\],]+\[[^\]]+\]/g);
        if (dailyMatches) {
            dailyMatches.forEach(match => {
                const namesInBracket = match.match(/\[([^\]]+)\]/)[1];
                const names = namesInBracket.split(',').filter(n => n.trim());
                names.forEach(name => {
                    manpower += hasHalfManpowerMarker(name) ? 0.5 : 1;
                });
            });
        }
        
        let remaining = teammates;
        if (contractMatches) {
            contractMatches.forEach(m => {
                remaining = remaining.replace(m, '');
            });
        }
        if (dailyMatches) {
            dailyMatches.forEach(m => {
                remaining = remaining.replace(m, '');
            });
        }
        
        const internalNames = remaining.split(',').filter(n => n.trim());
        internalNames.forEach(name => {
            if (name.trim()) {
                manpower += hasHalfManpowerMarker(name) ? 0.5 : 1;
            }
        });
    }
    
    if (records[index]) records[index].manpower = manpower;
    updateManpowerDisplay(index, manpower);
}

function updateManpowerDisplay(index, manpower) {
    const tableId = currentWorkTab === 'night' ? 'nightRecordsTable' : 'workRecordsTable';
    const tbody = document.getElementById(tableId);
    if (tbody && tbody.rows[index]) {
        const manpowerCell = tbody.rows[index].cells[8];
        if (manpowerCell) {
            manpowerCell.textContent = manpower > 0 ? manpower : '';
        }
    }
    updateTotalManpower();
}

function updateTotalManpower() {
    const records = _getActiveRecords();
    const total = records.reduce((sum, record) => sum + (record.manpower || 0), 0);
    const tableId = currentWorkTab === 'night' ? 'nightRecordsTable' : 'workRecordsTable';
    const tbody = document.getElementById(tableId);
    if (tbody && tbody.rows.length > 0) {
        const lastRow = tbody.rows[tbody.rows.length - 1];
        // 총 인원 행: cells[0]=colspan8 "총 인원", cells[1]=공수 값
        if (lastRow && lastRow.cells.length > 1) {
            lastRow.cells[1].textContent = total;
        }
    }
}

// ============================================================================
// 데이터 관리
// ============================================================================

function updateVacation(category, value) {
    vacationData[category] = value;
    _setDirtyForTab('day', true);
}

async function loadWorkRecords() {
    try {
        updateDateInput();
        const dateStr = formatDateForInput(currentDate);
        showLoading(true);
        
        const records = await eel.load_work_records(dateStr, 'day')();
        workRecords = records || [];

        renderTable();
        _applyWritePermissionUI();
        _setDirtyForTab('day', false);
        _dateLoadedAt = new Date().toISOString(); // 로드 시각 기록

        // 휴가자 현황 로드
        try {
            const vData = await eel.load_vacation_data(dateStr)();
            vacationData = { '연차': '', '반차': '', '공가': '', ...vData };
            const annualEl = document.getElementById('vacation_annual');
            const halfEl   = document.getElementById('vacation_half');
            const specEl   = document.getElementById('vacation_special');
            if (annualEl) annualEl.value = vacationData['연차'];
            if (halfEl)   halfEl.value   = vacationData['반차'];
            if (specEl)   specEl.value   = vacationData['공가'];
        } catch (e) {
            console.error('휴가자 현황 로드 오류:', e);
        }

        showLoading(false);
        return true;
    } catch (error) {
        console.error('데이터 로드 오류:', error);
        showCustomAlert('오류', '데이터 로드 중 오류가 발생했습니다.', 'error');
        showLoading(false);
        return false;
    }
}

// ── G: 같은 계약번호 + 같은 장소 중복 입력 경고 ──────────────────────
function _checkDuplicateCNLocation(records) {
    const seen = new Map();
    const warnings = [];
    records.forEach((row, i) => {
        const cn  = (row.contractNumber || '').trim().toUpperCase();
        const loc = (row.location || '').trim();
        if (!cn) return;                          // 계약번호 없으면 검사 제외
        const key = `${cn}||${loc}`;
        if (seen.has(key)) {
            warnings.push(`${seen.get(key) + 1}행과 ${i + 1}행: 계약번호 '${cn}' · 장소 '${loc}' 중복`);
        } else {
            seen.set(key, i);
        }
    });
    return warnings;
}

async function saveWorkRecords() {
    if (_isSaving) return;  // 중복 저장 방지
    _isSaving = true;
    try {
        if (!currentUser || !currentUser.full_name) {
            showCustomAlert('오류', '로그인 정보가 없습니다.', 'error');
            return;
        }

        // 계약번호 형식 유효성 검사
        const cns = [...new Set(
            workRecords.map(r => (r.contract_number || '').trim().toUpperCase()).filter(cn => cn)
        )];
        for (const cn of cns) {
            const v = await eel.validate_contract_number(cn)();
            if (!v.valid) {
                showCustomAlert('계약번호 오류', `[${cn}] ${v.message}`, 'error');
                return;
            }
        }

        // G: 같은 계약번호 + 같은 장소 중복 경고
        const dupWarnings = _checkDuplicateCNLocation(workRecords);
        if (dupWarnings.length > 0) {
            const proceed = confirm(
                '⚠️ 중복 입력 감지:\n' + dupWarnings.join('\n') +
                '\n\n계속 저장하시겠습니까?'
            );
            if (!proceed) return;
        }

        const dateStr = formatDateForInput(currentDate);
        showLoading(true, '저장 중...');

        const result = await eel.save_work_records(dateStr, workRecords, currentUser.full_name)();

        showLoading(false);

        if (result.success) {
            // 휴가자 현황 저장
            try {
                await eel.save_vacation_data(dateStr, vacationData, currentUser.full_name)();
            } catch (e) {
                console.error('휴가자 현황 저장 오류:', e);
            }
            _setDirtyForTab('day', false);
            _dateLoadedAt = new Date().toISOString(); // 저장 성공 시 로드 시각 갱신
            const _saveNow = new Date();
            const _saveEl = document.getElementById('saveStatusText');
            if (_saveEl) _saveEl.textContent =
                `✓ ${String(_saveNow.getHours()).padStart(2,'0')}:${String(_saveNow.getMinutes()).padStart(2,'0')}`;
            showCustomAlert('성공', '저장되었습니다.', 'success');
            // 저장 후 재로드 제거 (이미 workRecords 배열에 저장됨)
        } else {
            showCustomAlert('실패', '저장 실패: ' + result.message, 'error');
        }
    } catch (error) {
        console.error('저장 오류:', error);
        showLoading(false);
        showCustomAlert('오류', '저장 중 오류가 발생했습니다.', 'error');
    } finally {
        _isSaving = false;  // 성공/실패 모두 플래그 해제
    }
}

async function forceSaveWorkRecords() {
    if (_isSaving) return;
    try {
        const dateStr = formatDateForInput(currentDate);
        const info = await eel.get_date_save_info(dateStr)();

        if (info.has_records && _dateLoadedAt && info.updated_at > _dateLoadedAt) {
            // 내가 로드한 이후 다른 사람이 저장함 → 덮어쓰기 확인
            const updatedTime = info.updated_at
                ? info.updated_at.replace('T', ' ').substring(0, 16)
                : '';
            const who = info.updated_by || '다른 사용자';
            const ok = confirm(
                `⚠️ 충돌 감지\n\n${who}님이 ${updatedTime}에 저장한 내용이 있습니다.\n현재 내용으로 덮어쓰시겠습니까?`
            );
            if (!ok) return;
        }

        await saveWorkRecords();
    } catch (error) {
        console.error('강제 저장 오류:', error);
        showCustomAlert('오류', '저장 중 오류가 발생했습니다.', 'error');
    }
}

async function saveCurrentWorkRecords() {
    const dailyView = document.getElementById('dailyView');
    if (!dailyView || dailyView.classList.contains('hidden')) return;

    if (currentWorkTab === 'night') {
        await saveNightWorkRecords();
        return;
    }

    await forceSaveWorkRecords();
}

async function _autoSaveWorkRecords() {
    if (!dayIsDirty || _isSaving || _isNightSaving) return;
    if (!currentUser || !currentUser.full_name) return;
    const dailyView = document.getElementById('dailyView');
    if (!dailyView || dailyView.classList.contains('hidden')) return;

    // 야간 탭 자동저장
    if (currentWorkTab === 'night') {
        await saveNightWorkRecords();
        return;
    }

    const dateStr = formatDateForInput(currentDate);

    // 충돌 감지 — 서버의 최신 저장 시각과 비교
    try {
        const info = await eel.get_date_save_info(dateStr, 'day')();
        if (info && info.has_records && _dateLoadedAt && info.updated_at > _dateLoadedAt) {
            const who = info.updated_by || '다른 사용자';
            const when = info.updated_at ? info.updated_at.replace('T', ' ').substring(11, 16) : '';
            const timeStr = when ? `${when}에 ` : '';
            showToast(`⚠️ ${who}님이 ${timeStr}수정했습니다. [저장] 버튼으로 확인 후 직접 저장해 주세요.`, 'warning', 5000);
            return;
        }
    } catch (e) {
        console.warn('자동 저장 충돌 확인 실패:', e);
    }

    _isSaving = true;
    try {
        const result = await eel.save_work_records(dateStr, workRecords, currentUser.full_name, 'day')();
        if (result.success) {
            _setDirtyForTab('day', false);
            _dateLoadedAt = new Date().toISOString();
            const now = new Date();
            const el = document.getElementById('saveStatusText');
            if (el) el.textContent = `✓ ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
            showToast('자동 저장되었습니다.', 'success', 2000);
        }
    } catch (e) {
        console.error('자동 저장 오류:', e);
    } finally {
        _isSaving = false;
    }
}

function startAutoSave() {
    stopAutoSave();
    _autoSaveTimer = setInterval(_autoSaveWorkRecords, 30000);
}

function stopAutoSave() {
    if (_autoSaveTimer) { clearInterval(_autoSaveTimer); _autoSaveTimer = null; }
}

// ── 쓰기 권한에 따른 UI 적용 ─────────────────────────────────────────
function _applyWritePermissionUI() {
    const canWrite = !!(currentUser && currentUser.can_write);
    const readOnly = !canWrite;

    // 입력 필드 읽기 전용 처리 (주간 + 야간 테이블 모두)
    document.querySelectorAll(
        '#workRecordsTable input, #workRecordsTable textarea,' +
        '#nightRecordsTable input, #nightRecordsTable textarea'
    ).forEach(el => {
        el.readOnly = readOnly;
        el.style.cursor = readOnly ? 'default' : '';
    });

    // 저장 버튼: 탭에 따라 해당 버튼만 표시/숨김
    const btnForceSave = document.getElementById('btnForceSave');
    const btnWorkSave = document.getElementById('btnWorkSave');
    if (btnForceSave) btnForceSave.classList.toggle('hidden', readOnly);
    if (btnWorkSave) btnWorkSave.classList.toggle('hidden', readOnly);

    // 읽기 전용 배지 표시/숨김
    const badge = document.getElementById('readOnlyBadge');
    if (badge) badge.classList.toggle('hidden', !readOnly);

    // 자동 저장 제어
    if (readOnly) {
        stopAutoSave();
    }
}

async function loadYesterdayRecords() {
    try {
        const dateStr = formatDateForInput(currentDate);
        showLoading(true);

        const result = await eel.load_yesterday_records(dateStr)();
        workRecords = (result && result.records) || [];

        renderTable();
        _applyWritePermissionUI();
        _setDirtyForTab('day', true);
        showLoading(false);

        // 실제 불러온 날짜를 알림에 표시 (월요일→금요일, 연휴 다음날→연휴 전 마지막 평일)
        const loadedDate = result && result.date ? result.date : '';
        let msg = '이전 평일 작업을 불러왔습니다.';
        if (loadedDate) {
            const d = new Date(loadedDate + 'T00:00:00');
            const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
            const wd = weekdays[d.getDay()];
            const mm = d.getMonth() + 1;
            const dd = d.getDate();
            msg = `${mm}/${dd}(${wd}) 작업을 불러왔습니다.`;
        }
        showCustomAlert('알림', msg, 'info');
    } catch (error) {
        console.error('어제 작업 로드 오류:', error);
        showCustomAlert('오류', '이전 작업 로드 중 오류가 발생했습니다.', 'error');
        showLoading(false);
    }
}

async function refreshCurrentWorkRecords() {
    const dailyView = document.getElementById('dailyView');
    if (!dailyView || dailyView.classList.contains('hidden')) return;

    if (_hasUnsavedChanges('current')) {
        const tabLabel = currentWorkTab === 'night' ? '야간 작업' : '주간 작업';
        const proceed = confirm(
            `${tabLabel}에 저장하지 않은 내용이 있습니다.\n리프레쉬하면 현재 입력 내용이 사라집니다. 계속하시겠습니까?`
        );
        if (!proceed) return;
    }

    const ok = currentWorkTab === 'night'
        ? await loadNightRecords()
        : await loadWorkRecords();

    if (ok) {
        const tabLabel = currentWorkTab === 'night' ? '야간 작업' : '주간 작업';
        showToast(`${tabLabel} 데이터를 새로 불러왔습니다.`, 'success');
    }
}

// ============================================================================
// 테이블 렌더링
// ============================================================================

// 주간/야간 탭 전환
let currentWorkTab = 'day'; // 'day' | 'night'
let nightWorkRecords = [];
let _isNightSaving = false;
let _nightDateLoadedAt = null;

function showWorkTab(tab) {
    if (tab === currentWorkTab) return;
    if (!checkUnsavedChanges(
        'current',
        '현재 탭에 저장하지 않은 내용이 있습니다.\n탭을 바꾸면 입력 내용은 유지되지만 저장되지는 않습니다. 계속하시겠습니까?'
    )) {
        return;
    }

    currentWorkTab = tab;
    const btnDay   = document.getElementById('btnWorkDay');
    const btnNight = document.getElementById('btnWorkNight');
    const daySection   = document.getElementById('dayWorkSection');
    const nightSection = document.getElementById('nightWorkSection');
    if (!btnDay || !btnNight) return;

    if (tab === 'day') {
        btnDay.className   = 'px-5 py-2 rounded-lg font-semibold bg-blue-600 text-white shadow';
        btnNight.className = 'px-5 py-2 rounded-lg font-semibold bg-white text-slate-600 border border-slate-300 hover:bg-slate-50';
        daySection?.classList.remove('hidden');
        nightSection?.classList.add('hidden');
        document.getElementById('btnYesterdayWork')?.classList.remove('hidden');
        document.getElementById('btnLoadDayWork')?.classList.add('hidden');
    } else {
        btnNight.className = 'px-5 py-2 rounded-lg font-semibold bg-indigo-700 text-white shadow';
        btnDay.className   = 'px-5 py-2 rounded-lg font-semibold bg-white text-slate-600 border border-slate-300 hover:bg-slate-50';
        daySection?.classList.add('hidden');
        nightSection?.classList.remove('hidden');
        document.getElementById('btnYesterdayWork')?.classList.add('hidden');
        document.getElementById('btnLoadDayWork')?.classList.remove('hidden');
        loadNightRecords();
    }
    _applyWritePermissionUI();
}

async function loadNightRecords() {
    try {
        const dateStr = document.getElementById('dateInput')?.value;
        if (!dateStr) return;
        showLoading(true);
        const records = await eel.load_work_records(dateStr, 'night')();
        nightWorkRecords = records || [];
        renderNightTable();
        _setDirtyForTab('night', false);
        _nightDateLoadedAt = new Date().toISOString();
        showLoading(false);
        return true;
    } catch (e) {
        console.error('야간 레코드 로드 오류:', e);
        showLoading(false);
        return false;
    }
}

function renderNightTable() {
    const tbody = document.getElementById('nightRecordsTable');
    if (!tbody) return;
    tbody.innerHTML = '';

    while (nightWorkRecords.length < 10) {
        nightWorkRecords.push(createEmptyRecord(nightWorkRecords.length + 1));
    }

    let totalManpower = 0;
    nightWorkRecords.forEach((record, index) => {
        const row = createTableRow(record, index, nightWorkRecords, true);
        tbody.appendChild(row);
        totalManpower += record.manpower || 0;
    });
    tbody.appendChild(createTotalRow(totalManpower, 3)); // 야간: 동반자+A/S+종료시간
    _applyWritePermissionUI();
}

async function saveNightWorkRecords() {
    if (_isNightSaving) return;
    _isNightSaving = true;
    try {
        if (!currentUser?.full_name) {
            showCustomAlert('오류', '로그인 정보가 없습니다.', 'error');
            return;
        }
        const dateStr = document.getElementById('dateInput')?.value;
        if (!dateStr) return;

        showLoading(true, '저장 중...');
        const result = await eel.save_work_records(dateStr, nightWorkRecords, currentUser.full_name, 'night')();
        showLoading(false);

        if (result.success) {
            _setDirtyForTab('night', false);
            _nightDateLoadedAt = new Date().toISOString();
            showToast('야간 작업 저장되었습니다.', 'success');
        } else {
            showCustomAlert('실패', '저장 실패: ' + result.message, 'error');
        }
    } catch (e) {
        console.error('야간 저장 오류:', e);
        showLoading(false);
        showCustomAlert('오류', '저장 중 오류가 발생했습니다.', 'error');
    } finally {
        _isNightSaving = false;
    }
}

async function loadDayRecordsIntoNight() {
    try {
        const dateStr = document.getElementById('dateInput')?.value;
        if (!dateStr) return;
        showLoading(true);
        const dayRec = await eel.load_work_records(dateStr, 'day')();
        nightWorkRecords = (dayRec || []).map(r => ({ ...r, isAs: 0 }));
        renderNightTable();
        showLoading(false);
        showToast('주간 작업을 불러왔습니다.', 'success');
    } catch (e) {
        console.error('주간→야간 복사 오류:', e);
        showLoading(false);
    }
}

function renderTable() {
    const tbody = document.getElementById('workRecordsTable');
    if (!tbody) {
        console.error('workRecordsTable을 찾을 수 없습니다.');
        return;
    }
    
    tbody.innerHTML = '';
    
    while (workRecords.length < 10) {
        workRecords.push(createEmptyRecord(workRecords.length + 1));
    }
    
    let totalManpower = 0;
    
    workRecords.forEach((record, index) => {
        const row = createTableRow(record, index, workRecords);
        tbody.appendChild(row);
        totalManpower += record.manpower || 0;
    });
    
    const totalRow = createTotalRow(totalManpower, 2); // 주간: 동반자+A/S
    tbody.appendChild(totalRow);

    setupKeyboardListeners();
}

function createTableRow(record, index, records = workRecords, showEndTime = false) {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-blue-50 group';

    const displayLeader = (record.leader || '').replace(/<i>/g, '*').replace(/<\/i>/g, '*');
    const displayTeammates = (record.teammates || '').replace(/<i>/g, '*').replace(/<\/i>/g, '*');

    // value를 비워두고 innerHTML 생성 (특수문자 깨짐 방지)
    tr.innerHTML = `
        <td class="border p-0 text-center w-10 select-none">
            <span class="row-num text-sm text-gray-400 block py-2">${index + 1}</span>
            <button class="del-btn hidden w-full py-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 text-base font-bold leading-none transition-colors"
                    onclick="deleteRow(${index})" title="행 삭제">✕</button>
        </td>
        <td class="border p-0">
            <input type="text"
                   id="contractNumber_${index}"
                   oninput="handleContractNumberInput(${index}, this, event)"
                   onblur="autoExpandContractNumber(${index}, this)"
                   class="w-full px-2 py-1 border-0 focus:bg-yellow-50"
                   placeholder="SH-2026-001-T">
        </td>
        <td class="border p-0">
            <input type="text"
                   data-field="company"
                   onchange="updateRecord(${index}, 'company', this.value)"
                   class="w-full px-2 py-1 border-0 focus:bg-yellow-50"
                   placeholder="고객사">
        </td>
        <td class="border p-0">
            <input type="text"
                   id="shipName_${index}"
                   oninput="handleUpperCaseInput(${index}, 'shipName', this)"
                   class="w-full px-2 py-1 border-0 focus:bg-yellow-50"
                   placeholder="선박명">
        </td>
        <td class="border p-0">
            <input type="text"
                   id="engineModel_${index}"
                   oninput="handleUpperCaseInput(${index}, 'engineModel', this)"
                   class="w-full px-2 py-1 border-0 focus:bg-yellow-50"
                   placeholder="CAT' 3412">
        </td>
        <td class="border p-0">
            <input type="text"
                   data-field="workContent"
                   onchange="updateRecord(${index}, 'workContent', this.value)"
                   class="w-full px-2 py-1 border-0 focus:bg-yellow-50"
                   placeholder="작업내용">
        </td>
        <td class="border p-0">
            <input type="text"
                   data-field="location"
                   onchange="updateRecord(${index}, 'location', this.value)"
                   class="w-full px-2 py-1 border-0 focus:bg-yellow-50"
                   placeholder="장소">
        </td>
        <td class="border p-0">
            <input type="text"
                   id="leader_${index}"
                   oninput="handleLeaderInput(${index}, this)"
                   class="w-full px-2 py-1 border-0 focus:bg-yellow-50"
                   placeholder="대리 홍길동">
        </td>
        <td class="border p-2 text-center font-semibold text-blue-600">
            ${record.manpower > 0 ? record.manpower : ''}
        </td>
        <td class="border p-0">
            <input type="text"
                   id="teammates_${index}"
                   oninput="handleTeammatesInput(${index}, this)"
                   class="w-full px-2 py-1 border-0 focus:bg-yellow-50"
                   placeholder="홍길동, 박명수">
        </td>
        <td class="border p-2 text-center w-10">
            <input type="checkbox" id="isAs_${index}" class="w-4 h-4 cursor-pointer accent-orange-500">
        </td>
        ${showEndTime ? `<td class="border p-0 w-20">
            <input type="text" id="endTime_${index}"
                   oninput="updateRecord(${index}, 'endTime', this.value)"
                   class="w-full px-2 py-1 text-center border-0 focus:bg-indigo-50 outline-none text-sm"
                   placeholder="23:30">
        </td>` : ''}
    `;

    // DOM 생성 후 프로그래밍적으로 value 설정 (특수문자 안전)
    tr.querySelector(`#contractNumber_${index}`).value = record.contractNumber || '';
    tr.querySelector('[data-field="company"]').value = record.company || '';
    tr.querySelector(`#shipName_${index}`).value = record.shipName || '';
    tr.querySelector(`#engineModel_${index}`).value = record.engineModel || '';
    tr.querySelector('[data-field="workContent"]').value = record.workContent || '';
    tr.querySelector('[data-field="location"]').value = record.location || '';
    tr.querySelector(`#leader_${index}`).value = displayLeader;
    tr.querySelector(`#teammates_${index}`).value = displayTeammates;

    // 종료시간 값 설정 (야간 탭에서만 렌더링됨)
    const endTimeEl = tr.querySelector(`#endTime_${index}`);
    if (endTimeEl) endTimeEl.value = record.endTime || '';

    // A/S 체크박스 상태 및 이벤트 등록
    const asCheckbox = tr.querySelector(`#isAs_${index}`);
        if (asCheckbox) {
        asCheckbox.checked = !!(record.isAs);
        asCheckbox.addEventListener('change', () => {
            if (records[index]) records[index].isAs = asCheckbox.checked ? 1 : 0;
            _markCurrentTabDirty();
        });
    }

    // 순번 칸 hover → 삭제 버튼 토글
    const rowNum = tr.querySelector('.row-num');
    const delBtn = tr.querySelector('.del-btn');
    tr.addEventListener('mouseenter', () => {
        rowNum.classList.add('hidden');
        delBtn.classList.remove('hidden');
    });
    tr.addEventListener('mouseleave', () => {
        rowNum.classList.remove('hidden');
        delBtn.classList.add('hidden');
    });

    return tr;
}

// ============================================================================
// 행 삭제
// ============================================================================

// 현재 활성 탭의 레코드 배열 반환
function _getActiveRecords() {
    return currentWorkTab === 'night' ? nightWorkRecords : workRecords;
}

function deleteRow(index) {
    const records = _getActiveRecords();
    const record = records[index];
    const hasData = !!(
        record.contractNumber || record.company || record.shipName ||
        record.engineModel    || record.workContent || record.location ||
        record.leader         || record.teammates
    );

    if (hasData && !confirm(`${index + 1}번 행의 내용을 삭제하시겠습니까?`)) return;

    records.splice(index, 1);
    _markCurrentTabDirty();
    if (currentWorkTab === 'night') {
        renderNightTable();
    } else {
        renderTable();
        _applyWritePermissionUI();
    }
}

function createTotalRow(totalManpower, trailingCols = 2) {
    // trailingCols: 인원 칸 이후 빈 칸 수 (주간=2: 동반자+A/S, 야간=3: 동반자+A/S+종료시간)
    const tr = document.createElement('tr');
    tr.className = 'bg-green-100 font-bold';
    const emptyCells = '<td class="border"></td>'.repeat(trailingCols);
    tr.innerHTML = `
        <td colspan="8" class="border p-3 text-right text-lg">총 인원</td>
        <td class="border p-3 text-center text-blue-600 text-xl">${totalManpower}</td>
        ${emptyCells}
    `;
    return tr;
}

function createEmptyRecord(recordNumber) {
    return {
        id: null,
        record_number: recordNumber,
        contractNumber: '',
        company: '',
        shipName: '',
        engineModel: '',
        workContent: '',
        location: '',
        leader: '',
        teammates: '',
        manpower: 0
    };
}

// ============================================================================
// 입력 핸들러
// ============================================================================

function handleContractNumberInput(index, input, event) {
    if (event && event.isComposing) return;  // 한글 IME 조합 중 처리 skip
    const cursorPosition = input.selectionStart;
    const oldValue = input.value;
    const newValue = sanitizeContractNumber(oldValue);

    if (oldValue !== newValue) {
        input.value = newValue;
        const offset = newValue.length - oldValue.length;
        input.setSelectionRange(cursorPosition + offset, cursorPosition + offset);
    }

    updateRecord(index, 'contractNumber', newValue);
}

async function autoExpandContractNumber(index, input) {
    const val = input.value.trim();

    // 숫자 1~3자리만 입력 → SH-YYYY-NNN-T 자동 완성
    if (/^\d{1,3}$/.test(val)) {
        const currentYear = new Date().getFullYear();
        const padded = val.padStart(3, '0');
        const expanded = `SH-${currentYear}-${padded}-T`;
        input.value = expanded;
        updateRecord(index, 'contractNumber', expanded);
    }

    // 유효한 계약번호가 있으면 DB에서 최근 작업 내역 자동완성
    const cn = input.value.trim().toUpperCase();
    if (!cn) return;

    try {
        const result = await eel.get_latest_record_by_contract(cn)();
        if (!result || !result.found) return;

        // tbody의 해당 행 참조
        const tbody = document.getElementById('workRecordsTable');
        const tr = tbody && tbody.rows[index];
        if (!tr) return;

        // 비어있는 필드만 자동완성 (이미 입력된 값은 유지)
        const autoFillMap = {
            company:     () => tr.querySelector('[data-field="company"]'),
            shipName:    () => document.getElementById(`shipName_${index}`),
            engineModel: () => document.getElementById(`engineModel_${index}`),
            workContent: () => tr.querySelector('[data-field="workContent"]'),
            location:    () => tr.querySelector('[data-field="location"]'),
        };

        let filled = false;
        for (const [field, getEl] of Object.entries(autoFillMap)) {
            if (workRecords[index] && workRecords[index][field]) continue; // 이미 데이터 있으면 skip
            const el = getEl();
            if (el && !el.value.trim() && result[field]) {
                el.value = result[field];
                updateRecord(index, field, result[field]);
                filled = true;
            }
        }

        // 자동완성 완료 시 행 flash 효과
        if (filled) {
            const rowEl = input.closest('tr');
            if (rowEl) {
                rowEl.style.transition = 'background-color 0.15s';
                rowEl.style.backgroundColor = '#fef9c3'; // 노란색 flash
                setTimeout(() => { rowEl.style.backgroundColor = ''; }, 900);
            }
        }
    } catch (e) {
        console.warn('계약번호 자동완성 오류 (무시):', e); // #16
    }
}

function handleUpperCaseInput(index, field, input) {
    const cursorPosition = input.selectionStart;
    const oldValue = input.value;
    const newValue = toUpperCase(oldValue);
    
    if (oldValue !== newValue) {
        input.value = newValue;
        input.setSelectionRange(cursorPosition, cursorPosition);
    }
    
    updateRecord(index, field, newValue);
}

function handleLeaderInput(index, input) {
    const displayValue = input.value;
    const storedValue = displayValue.replace(/\*(.*?)\*/g, '<i>$1</i>');
    updateRecord(index, 'leader', storedValue);
    calculateManpowerInstant(index);
}

function handleTeammatesInput(index, input) {
    // 업체명과 괄호 사이 공백 자동 제거: '업체명 [' → '업체명[', '업체명 (' → '업체명('
    const raw = input.value;
    const normalized = raw.replace(/(\S)\s+([\[\(])/g, '$1$2');
    if (normalized !== raw) {
        const curPos = Math.max(0, (input.selectionStart || 0) - (raw.length - normalized.length));
        input.value = normalized;
        try { input.setSelectionRange(curPos, curPos); } catch(e) {}
    }
    const displayValue = input.value;
    const storedValue = displayValue.replace(/\*(.*?)\*/g, '<i>$1</i>');
    updateRecord(index, 'teammates', storedValue);
    calculateManpowerInstant(index);
}

// ============================================================================
// 키보드 이벤트 (Ctrl+I)
// ============================================================================

function setupKeyboardListeners() {
    // #14 — 이벤트 위임: querySelectorAll 루프 대신 테이블에 한 번만 위임 등록
    const table = document.getElementById('workRecordsTable');
    if (!table || table._keyListenerAttached) return;
    table.addEventListener('keydown', e => {
        if (e.target.matches('[id^="leader_"], [id^="teammates_"]')) {
            handleItalicShortcut(e);
        }
    });
    table._keyListenerAttached = true;
}

function handleItalicShortcut(event) {
    if (event.ctrlKey && event.key === 'i') {
        event.preventDefault();
        
        const input = event.target;
        const start = input.selectionStart;
        const end = input.selectionEnd;
        
        if (start !== end) {
            const text = input.value;
            const selectedText = text.substring(start, end);
            const beforeText = text.substring(0, start);
            const afterText = text.substring(end);
            
            const newText = beforeText + '*' + selectedText + '*' + afterText;
            input.value = newText;
            
            input.setSelectionRange(start, end + 2);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }
}

// ============================================================================
// 데이터 업데이트
// ============================================================================

function updateRecord(index, field, value) {
    const records = _getActiveRecords();
    if (records[index]) {
        records[index][field] = value;
        _markCurrentTabDirty();
    }
}

// ============================================================================
// Excel 내보내기
// ============================================================================

async function exportToExcel() {
    const dateStr = formatDateForInput(currentDate);
    showLoading(true, 'Excel 파일 생성 중...');
    try {
        const result = await eel.export_to_excel(dateStr)();
        if (result.success) {
            showToast('Excel 파일이 저장되었습니다: ' + result.path, 'success');
        } else {
            showCustomAlert('오류', 'Excel 내보내기 실패: ' + result.message, 'error');
        }
    } catch (error) {
        console.error('Excel 내보내기 오류:', error);
        showCustomAlert('오류', 'Excel 내보내기 중 오류가 발생했습니다.', 'error');
    } finally {
        showLoading(false);
    }
}

// ============================================================================
// UI 헬퍼
// ============================================================================

function showLoading(show, message = '처리 중...') {
    const overlay = document.getElementById('loadingOverlay');
    const messageEl = document.getElementById('loadingMessage');
    
    if (show) {
        if (messageEl) messageEl.textContent = message;
        if (overlay) overlay.classList.remove('hidden');
        document.body.style.cursor = 'wait';
    } else {
        if (overlay) overlay.classList.add('hidden');
        document.body.style.cursor = 'default';
    }
}

function showCustomAlert(title, message, type = 'success') {
    const alertEl = document.getElementById('customAlert');
    const titleEl = document.getElementById('alertTitle');
    const messageEl = document.getElementById('alertMessage');
    const iconEl = document.getElementById('alertIcon');
    
    if (!alertEl) return;
    
    titleEl.textContent = title;
    messageEl.innerHTML = escapeHtml(message).replace(/\n/g, '<br>');
    
    // 아이콘 설정
    if (type === 'success') {
        iconEl.innerHTML = '<svg class="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
    } else if (type === 'error') {
        iconEl.innerHTML = '<svg class="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
    } else if (type === 'info') {
        iconEl.innerHTML = '<svg class="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
    }
    
    alertEl.classList.remove('hidden');
}

function closeCustomAlert() {
    const alertEl = document.getElementById('customAlert');
    if (alertEl) alertEl.classList.add('hidden');
}

// ============================================================================
// 조회 기능
// ============================================================================

function getContractNumber() {
    const year = document.getElementById('contractYear');
    const seq = document.getElementById('contractSeq');
    if (!year || !seq) return '';
    const seqPadded = String(parseInt(seq.value) || 1).padStart(3, '0');
    seq.value = seqPadded;
    return `SH-${year.value}-${seqPadded}-T`;
}

function changeContractPart(part, delta) {
    if (part === 'year') {
        const el = document.getElementById('contractYear');
        let yr = (parseInt(el.value) || new Date().getFullYear()) + delta;
        if (yr < 2000) yr = 2000;
        if (yr > 2099) yr = 2099;
        el.value = String(yr);
    } else if (part === 'seq') {
        const el = document.getElementById('contractSeq');
        let val = (parseInt(el.value) || 1) + delta;
        if (val < 1)   val = 1;
        if (val > 999) val = 999;
        el.value = String(val).padStart(3, '0');
    }
    searchByContract();
}

function setupContractWheelNavigation() {
    const yearEl = document.getElementById('contractYear');
    const seqEl = document.getElementById('contractSeq');
    if (yearEl) {
        yearEl.addEventListener('wheel', function(e) {
            e.preventDefault();
            changeContractPart('year', e.deltaY < 0 ? 1 : -1);
        }, { passive: false });
        yearEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') searchByContract();
        });
    }
    if (seqEl) {
        seqEl.addEventListener('wheel', function(e) {
            e.preventDefault();
            changeContractPart('seq', e.deltaY < 0 ? 1 : -1);
        }, { passive: false });
        seqEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') searchByContract();
        });
    }
}

document.addEventListener('DOMContentLoaded', function() {
    setupContractWheelNavigation();
});

async function searchByContract() {
    const resultDiv = document.getElementById('statusSearchResult');
    if (!resultDiv) return;

    const contractNumber = getContractNumber();
    if (!contractNumber) {
        showCustomAlert('알림', '계약번호를 입력해주세요.', 'info');
        return;
    }

    try {
        showLoading(true, '조회 중...');
        const records = await eel.search_records_by_contract(contractNumber)();
        showLoading(false);

        renderSearchResults(records, resultDiv, contractNumber, '계약번호');
    } catch (error) {
        console.error('현황 조회 오류:', error);
        showLoading(false);
        showCustomAlert('오류', '조회 중 오류가 발생했습니다.', 'error');
    }
}

async function searchByShipName() {
    const input = document.getElementById('searchShipInput');
    const resultDiv = document.getElementById('workSearchResult');
    if (!input || !resultDiv) return;

    const shipName = input.value.trim().toUpperCase();
    if (!shipName) {
        showCustomAlert('알림', '선명을 입력해주세요.', 'info');
        return;
    }
    if (shipName.length > 100) {
        showCustomAlert('입력 오류', '선명은 100자 이하로 입력해주세요.', 'warning');
        return;
    }

    try {
        showLoading(true, '조회 중...');
        const records = await eel.search_records_by_ship(shipName)();
        showLoading(false);

        renderSearchResults(records, resultDiv, shipName, '선명');
    } catch (error) {
        console.error('작업별 조회 오류:', error);
        showLoading(false);
        showCustomAlert('오류', '조회 중 오류가 발생했습니다.', 'error');
    }
}

async function searchByCompany() {
    const input = document.getElementById('searchCompanyInput');
    const resultDiv = document.getElementById('companySearchResult');
    if (!input || !resultDiv) return;

    const companyName = input.value.trim();
    if (!companyName) {
        showCustomAlert('알림', '업체명을 입력해주세요.', 'info');
        return;
    }
    if (companyName.length > 100) {
        showCustomAlert('입력 오류', '업체명은 100자 이하로 입력해주세요.', 'warning');
        return;
    }

    try {
        showLoading(true, '조회 중...');
        const records = await eel.search_records_by_company(companyName)();
        showLoading(false);

        if (!records || records.length === 0) {
            resultDiv.innerHTML = `<p class="text-slate-500">업체 "${escapeHtml(companyName)}"에 대한 작업 내역이 없습니다.</p>`;
            return;
        }

        // 전역 상태 저장
        _companySearchRecords = records;
        _companySearchName = companyName;

        // 월 목록 추출
        const monthSet = new Set(records.map(r => (r.date || '').substring(0, 7)).filter(k => k));
        _companySearchMonths = [...monthSet].sort();

        // 현재 달로 기본 선택, 없으면 가장 최근 달
        const currentMonth = new Date().toISOString().substring(0, 7);
        let idx = _companySearchMonths.indexOf(currentMonth);
        if (idx === -1) {
            // 현재 달 이전 중 가장 최근 달
            const past = _companySearchMonths.filter(m => m <= currentMonth);
            idx = past.length > 0 ? _companySearchMonths.indexOf(past[past.length - 1]) : _companySearchMonths.length - 1;
        }
        _companySearchMonthIdx = idx;

        renderCompanyMonthView(resultDiv);
    } catch (error) {
        console.error('업체별 조회 오류:', error);
        showLoading(false);
        showCustomAlert('오류', '조회 중 오류가 발생했습니다.', 'error');
    }
}

function moveCompanyMonth(dir) {
    const newIdx = _companySearchMonthIdx + dir;
    if (newIdx < 0 || newIdx >= _companySearchMonths.length) return;
    _companySearchMonthIdx = newIdx;
    const resultDiv = document.getElementById('companySearchResult');
    if (resultDiv) renderCompanyMonthView(resultDiv);
}

function renderCompanyMonthView(container) {
    if (!_companySearchMonths.length) {
        container.innerHTML = `<p class="text-slate-500">작업 내역이 없습니다.</p>`;
        return;
    }

    const monthKey = _companySearchMonths[_companySearchMonthIdx];
    const [year, month] = monthKey.split('-');
    const monthRecords = _companySearchRecords.filter(r => (r.date || '').startsWith(monthKey));

    // 해당 업체 인원 집계 기반으로 공수 계산 (record.manpower 는 전체 작업 공수라 업체 분만 따로 계산)
    function calcCompanyManpower(records) {
        let total = 0;
        records.forEach(record => {
            const workers = extractCompanyWorkers(record.teammates || '', _companySearchName);
            total += workers.length;
        });
        return total;
    }

    const monthManpower = calcCompanyManpower(monthRecords);
    const totalManpower  = calcCompanyManpower(_companySearchRecords);
    const canPrev = _companySearchMonthIdx > 0;
    const canNext = _companySearchMonthIdx < _companySearchMonths.length - 1;

    let html = `
        <div class="mb-2 text-sm text-slate-600">
            <span class="font-semibold">업체: ${escapeHtml(_companySearchName)}</span> |
            전체 <span class="font-semibold text-blue-600">${_companySearchRecords.length}</span>건 /
            <span class="font-semibold text-blue-600">${totalManpower}</span>공
        </div>
        <div class="flex items-center gap-3 mb-3">
            <button onclick="moveCompanyMonth(-1)" ${canPrev ? '' : 'disabled'}
                    class="px-3 py-1 rounded bg-slate-200 hover:bg-slate-300 font-bold disabled:opacity-30 disabled:cursor-not-allowed">◀</button>
            <span class="font-bold text-slate-700 text-base">${year}년 ${parseInt(month)}월</span>
            <button onclick="moveCompanyMonth(1)" ${canNext ? '' : 'disabled'}
                    class="px-3 py-1 rounded bg-slate-200 hover:bg-slate-300 font-bold disabled:opacity-30 disabled:cursor-not-allowed">▶</button>
            <span class="text-xs text-slate-500">${monthRecords.length}건, ${monthManpower}공 &nbsp;|&nbsp; ${_companySearchMonthIdx + 1} / ${_companySearchMonths.length}개월</span>
        </div>`;

    if (monthRecords.length === 0) {
        html += `<p class="text-slate-400 text-sm">이 달에는 작업 내역이 없습니다.</p>`;
    } else {
        html += `
        <div class="overflow-x-auto">
        <table class="w-full border-collapse border text-sm">
            <thead>
                <tr class="bg-indigo-100">
                    <th class="border p-2 text-center w-16">작업일</th>
                    <th class="border p-2 text-center w-20">선사</th>
                    <th class="border p-2 text-center w-24">선명</th>
                    <th class="border p-2 text-center w-28">엔진모델</th>
                    <th class="border p-2 text-center">작업내용</th>
                    <th class="border p-2 text-center w-36">직원</th>
                </tr>
            </thead>
            <tbody>`;

        monthRecords.forEach(record => {
            let dateDisplay = record.date || '';
            if (dateDisplay) {
                const d = new Date(dateDisplay + 'T00:00:00');
                dateDisplay = `${d.getMonth() + 1}/${d.getDate()}`;
            }
            const workers = extractCompanyWorkers(record.teammates || '', _companySearchName);
            const workersDisplay = workers.length > 0 ? workers.join(', ') : '-';

            html += `
                <tr class="hover:bg-blue-50">
                    <td class="border p-2 text-center">${escapeHtml(dateDisplay)}</td>
                    <td class="border p-2 text-center">${escapeHtml(record.company || '-')}</td>
                    <td class="border p-2 text-center">${escapeHtml(record.ship_name || '-')}</td>
                    <td class="border p-2 text-center">${escapeHtml(record.engine_model || '-')}</td>
                    <td class="border p-2">${escapeHtml(record.work_content || '-')}</td>
                    <td class="border p-2 text-center">${escapeHtml(workersDisplay)}</td>
                </tr>`;
        });

        html += `
            </tbody>
        </table>
        </div>`;

        // 인원별 공수 소계
        const personMap = {};
        monthRecords.forEach(record => {
            const workers = extractCompanyWorkers(record.teammates || '', _companySearchName);
            workers.forEach(name => {
                personMap[name] = (personMap[name] || 0) + 1;
            });
        });
        const personEntries = Object.entries(personMap).sort((a, b) => b[1] - a[1]);
        if (personEntries.length > 0) {
            const personItems = personEntries
                .map(([name, count]) => `<span class="inline-flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded text-xs"><span class="text-slate-700 font-medium">${escapeHtml(name)}</span><b class="text-blue-600">${count}공</b></span>`)
                .join(' ');
            html += `
        <div class="mt-2 flex flex-wrap items-center gap-1">
            <span class="bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-semibold text-xs mr-1">인원별 소계</span>
            ${personItems}
        </div>`;
        }
    }

    container.innerHTML = html;
}

function extractCompanyWorkers(teammates, companyName) {
    // teammates 필드에서 특정 업체 소속 직원 이름만 추출
    const workers = [];
    const addWorkers = (co, namesStr) => {
        if (co.trim().includes(companyName) || companyName.includes(co.trim())) {
            namesStr.split(',').forEach(w => {
                const name = w.replace(/\*/g, '').trim();
                if (name) workers.push(name);
            });
        }
    };
    // 도급: 업체명(직원1, 직원2)
    const contractRegex = /([^,\[\]()\n]+?)\(([^)]+)\)/g;
    let m;
    while ((m = contractRegex.exec(teammates)) !== null) addWorkers(m[1], m[2]);
    // 일당: 업체명[직원1, 직원2]
    const dailyRegex = /([^,\[\]()\n]+?)\[([^\]]+)\]/g;
    while ((m = dailyRegex.exec(teammates)) !== null) addWorkers(m[1], m[2]);
    return workers;
}

function calculateOutsourceManpower(records) {
    // { 업체명: { total: N, persons: { 이름: 횟수 } } }
    const companyMap = {};

    records.forEach(record => {
        const teammates = record.teammates || '';

        function addNames(company, namesStr) {
            const co = company.replace(/\*/g, '').replace(/<\/?i>/g, '').trim();
            if (!co) return;
            if (!companyMap[co]) companyMap[co] = { total: 0, persons: {} };
            const names = namesStr.split(',').map(n => n.replace(/\*/g, '').replace(/<\/?i>/g, '').trim()).filter(n => n);
            names.forEach(name => {
                companyMap[co].total += 1;
                companyMap[co].persons[name] = (companyMap[co].persons[name] || 0) + 1;
            });
        }

        // 도급: 업체명(직원1, 직원2)
        const contractRegex = /([^,]+?)\(([^)]+)\)/g;
        let match;
        while ((match = contractRegex.exec(teammates)) !== null) {
            addNames(match[1], match[2]);
        }

        // 일당: 업체명[직원1, 직원2]
        const dailyRegex = /([^,]+?)\[([^\]]+)\]/g;
        while ((match = dailyRegex.exec(teammates)) !== null) {
            addNames(match[1], match[2]);
        }
    });

    return companyMap;
}

function toggleOutsourceDetail(el, company) {
    const block = el.closest('.outsource-block');
    if (!block) return;
    const detail = block.querySelector('[data-outsource-detail="' + company + '"]');
    if (detail) detail.classList.toggle('hidden');
}

function renderSearchResults(records, container, searchTerm, searchType) {
    // 상태 저장 후 정렬 렌더러에 위임 (기본: 최신순)
    _searchSortState.records   = records;
    _searchSortState.container = container;
    _searchSortState.term      = searchTerm;
    _searchSortState.type      = searchType;
    _searchSortState.key       = 'date';
    _searchSortState.dir       = -1;
    _renderSortedSearch();
}

function sortSearchBy(key) {
    if (_searchSortState.key === key) {
        _searchSortState.dir *= -1;
    } else {
        _searchSortState.key = key;
        _searchSortState.dir = (key === 'manpower') ? -1 : 1;
    }
    _renderSortedSearch();
}

function _renderSortedSearch() {
    const { records, container, term, type, key, dir } = _searchSortState;
    if (!container) return;

    if (!records || records.length === 0) {
        container.innerHTML = `<p class="text-slate-500">${escapeHtml(type)} "${escapeHtml(term)}"에 대한 작업 내역이 없습니다.</p>`;
        return;
    }

    // 정렬
    const sorted = [...records].sort((a, b) => {
        const av = a[key] ?? '';
        const bv = b[key] ?? '';
        if (key === 'manpower') return (parseFloat(av) - parseFloat(bv)) * dir;
        return String(av).localeCompare(String(bv), 'ko') * dir;
    });

    // 정렬 표시 헬퍼
    const si = (k) => key === k ? (dir === -1 ? ' ▼' : ' ▲') : '';
    const thCls = 'border p-2 text-center cursor-pointer hover:bg-indigo-200 select-none';

    // 총 인원 합계
    const totalManpower = records.reduce((sum, r) => sum + (r.manpower || 0), 0);

    // 외주 업체별 공수 집계
    const outsourceMap = calculateOutsourceManpower(records);
    const outsourceEntries = Object.entries(outsourceMap);

    let outsourceHtml = '';
    if (outsourceEntries.length > 0) {
        const outsourceItems = outsourceEntries.map(([company, data]) =>
            `<span class="font-semibold text-orange-600 cursor-pointer hover:underline" onclick="toggleOutsourceDetail(this, '${escapeJs(company)}')">${escapeHtml(company)}</span>: ${data.total}공`
        ).join(' &nbsp;|&nbsp; ');
        const detailSections = outsourceEntries.map(([company, data]) => {
            const personItems = Object.entries(data.persons)
                .sort((a, b) => b[1] - a[1])
                .map(([name, count]) => `<span class="text-slate-700">${escapeHtml(name)} <b class="text-orange-600">${count}공</b></span>`)
                .join(', ');
            return `<div data-outsource-detail="${escapeHtml(company)}" class="hidden ml-6 mb-1 text-xs text-slate-500">└ <span class="font-semibold">${escapeHtml(company)}</span> 상세: ${personItems}</div>`;
        }).join('');
        outsourceHtml = `
        <div class="outsource-block mb-1 text-sm text-slate-600 flex flex-col gap-0.5">
            <div class="flex items-center gap-2">
                <span class="bg-orange-100 text-orange-700 px-2 py-0.5 rounded font-semibold text-xs">외주 공수</span>
                ${outsourceItems}
                <span class="text-xs text-slate-400">(클릭하면 상세)</span>
            </div>
            ${detailSections}
        </div>`;
    }

    let html = `
        <div class="mb-1 text-sm text-slate-600">
            <span class="font-semibold">${escapeHtml(type)}: ${escapeHtml(term)}</span> |
            총 <span class="font-semibold text-blue-600">${sorted.length}</span>건 |
            총 인원 <span class="font-semibold text-blue-600">${totalManpower.toFixed(1)}</span>공
        </div>
        ${outsourceHtml}
        <div class="overflow-x-auto">
        <table class="w-full border-collapse border">
            <thead><tr class="bg-indigo-100">
                <th class="${thCls} w-24" onclick="sortSearchBy('date')">작업일${si('date')}</th>
                <th class="${thCls} w-20" onclick="sortSearchBy('company')">선사${si('company')}</th>
                <th class="${thCls} w-20" onclick="sortSearchBy('ship_name')">선명${si('ship_name')}</th>
                <th class="${thCls} w-28" onclick="sortSearchBy('engine_model')">엔진모델${si('engine_model')}</th>
                <th class="${thCls}" onclick="sortSearchBy('work_content')">작업내용${si('work_content')}</th>
                <th class="${thCls} w-24" onclick="sortSearchBy('leader')">작업자${si('leader')}</th>
                <th class="${thCls} w-12" onclick="sortSearchBy('manpower')">인원${si('manpower')}</th>
                <th class="${thCls}" onclick="sortSearchBy('teammates')">동반자${si('teammates')}</th>
            </tr></thead>
            <tbody>`;

    sorted.forEach(record => {
        let dateDisplay = record.date || '';
        if (dateDisplay) {
            const d = new Date(dateDisplay + 'T00:00:00');
            dateDisplay = `${d.getMonth() + 1}/${d.getDate()}`;
        }
        const leader    = escapeHtml((record.leader    || '-').replace(/<i>/g, '').replace(/<\/i>/g, ''));
        const teammates = escapeHtml((record.teammates || '-').replace(/<i>/g, '').replace(/<\/i>/g, ''));
        html += `<tr class="hover:bg-blue-50">
            <td class="border p-2 text-center">${escapeHtml(dateDisplay)}</td>
            <td class="border p-2 text-center">${escapeHtml(record.company || '-')}</td>
            <td class="border p-2 text-center">${escapeHtml(record.ship_name || '-')}</td>
            <td class="border p-2 text-center">${escapeHtml(record.engine_model || '-')}</td>
            <td class="border p-2">${escapeHtml(record.work_content || '-')}</td>
            <td class="border p-2 text-center">${leader}</td>
            <td class="border p-2 text-center font-semibold text-blue-600">${record.manpower > 0 ? record.manpower : ''}</td>
            <td class="border p-2">${teammates}</td>
        </tr>`;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
}

// ============================================================================
// 사용자 설정
// ============================================================================

// ============================================================================
// 기본 화면 2티어 트리 선택기
// ============================================================================

const DEFAULT_VIEW_TREE = [
    { value: 'dashboard', label: '대시보드', subs: [
        { value: 'chart',  label: '간트 차트' },
        { value: 'board',  label: '칸반 보드' },
        { value: 'stats',  label: '통계' },
    ]},
    { value: 'daily', label: '일일 작업', subs: [] },
    { value: 'report', label: '보고서', subs: [
        { value: 'daily',   label: '일일 보고' },
        { value: 'monthly', label: '월간 보고' },
    ]},
    { value: 'search', label: '조회', subs: [
        { value: 'status',  label: '현황 조회' },
        { value: 'work',    label: '작업별 조회' },
        { value: 'company', label: '업체별 조회' },
    ]},
];

// 선택된 기본화면 값 반환 ("view" 또는 "view:subtab")
function getSelectedDefaultView() {
    const t1 = document.querySelector('#defaultViewTier1 [data-selected="true"]');
    const t2 = document.querySelector('#defaultViewTier2 [data-selected="true"]');
    if (!t1) return 'dashboard';
    return t2 ? `${t1.dataset.value}:${t2.dataset.value}` : t1.dataset.value;
}

// 2티어 트리 UI 렌더링
function renderDefaultViewTree(currentValue) {
    const tier1El = document.getElementById('defaultViewTier1');
    const tier2El = document.getElementById('defaultViewTier2');
    if (!tier1El || !tier2El) return;

    const parts    = (currentValue || 'dashboard').split(':');
    const selView  = parts[0];
    const selSub   = parts[1] || null;

    // 1티어 렌더링
    tier1El.innerHTML = DEFAULT_VIEW_TREE.map(item => {
        const active = item.value === selView;
        const cls = active
            ? 'px-3 py-2 text-sm font-semibold cursor-pointer bg-blue-600 text-white'
            : 'px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 text-slate-700';
        return `<div class="${cls} border-b border-blue-100 last:border-b-0"
                     data-value="${item.value}" data-selected="${active}"
                     onclick="onDefaultViewTier1Click(this)">${item.label}</div>`;
    }).join('');

    // 2티어 렌더링
    _renderDefaultViewTier2(selView, selSub);
}

function _renderDefaultViewTier2(view, selSub) {
    const tier2El = document.getElementById('defaultViewTier2');
    if (!tier2El) return;
    const node = DEFAULT_VIEW_TREE.find(n => n.value === view);
    if (!node || node.subs.length === 0) {
        tier2El.innerHTML = '<div class="px-3 py-2 text-xs text-slate-400 italic">단일 페이지</div>';
        return;
    }
    tier2El.innerHTML = node.subs.map((sub, idx) => {
        const active = selSub ? sub.value === selSub : idx === 0;
        const cls = active
            ? 'px-3 py-2 text-sm font-semibold cursor-pointer bg-blue-600 text-white'
            : 'px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 text-slate-700';
        return `<div class="${cls} border-b border-blue-100 last:border-b-0"
                     data-value="${sub.value}" data-selected="${active}"
                     onclick="onDefaultViewTier2Click(this)">${sub.label}</div>`;
    }).join('');
}

function onDefaultViewTier1Click(el) {
    // 1티어 선택 상태 갱신
    document.querySelectorAll('#defaultViewTier1 [data-selected]').forEach(e => {
        e.dataset.selected = 'false';
        e.className = 'px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 text-slate-700 border-b border-blue-100 last:border-b-0';
    });
    el.dataset.selected = 'true';
    el.className = 'px-3 py-2 text-sm font-semibold cursor-pointer bg-blue-600 text-white border-b border-blue-100 last:border-b-0';
    // 2티어 재렌더링 (기본 첫 번째 서브탭 선택)
    _renderDefaultViewTier2(el.dataset.value, null);
}

function onDefaultViewTier2Click(el) {
    document.querySelectorAll('#defaultViewTier2 [data-selected]').forEach(e => {
        e.dataset.selected = 'false';
        e.className = 'px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 text-slate-700 border-b border-blue-100 last:border-b-0';
    });
    el.dataset.selected = 'true';
    el.className = 'px-3 py-2 text-sm font-semibold cursor-pointer bg-blue-600 text-white border-b border-blue-100 last:border-b-0';
}

// ============================================================================

function loadUserSettings() {
    // 현재 사용자의 기본 화면 설정 로드
    const defaultView = localStorage.getItem('userDefaultView') || currentUser.default_view || 'dashboard';
    renderDefaultViewTree(defaultView);
    // 텔레그램 연결 상태 로드
    loadTelegramStatus();
    // 트레이 모드 토글 초기화
    const trayToggle = document.getElementById('trayModeToggle');
    const trayLabel  = document.getElementById('trayModeLabel');
    if (trayToggle && currentUser) {
        trayToggle.checked = !!currentUser.tray_mode;
        if (trayLabel) trayLabel.textContent = currentUser.tray_mode ? '트레이로 최소화' : '앱 완전 종료';
    }
}

// ============================================================================
// 텔레그램 알림 연결 (사용자)
// ============================================================================

async function loadTelegramStatus() {
    if (!currentUser) return;

    // 봇이 활성화되어 있는지 확인
    try {
        const botStatus = await eel.get_telegram_bot_enabled()();
        const botDisabledDiv = document.getElementById('telegramBotDisabled');
        const linkedDiv = document.getElementById('telegramLinked');
        const notLinkedDiv = document.getElementById('telegramNotLinked');
        const linkCodeDiv = document.getElementById('telegramLinkCode');

        if (!botStatus || !botStatus.enabled) {
            botDisabledDiv.classList.remove('hidden');
            linkedDiv.classList.add('hidden');
            notLinkedDiv.classList.add('hidden');
            linkCodeDiv.classList.add('hidden');
            return;
        }

        botDisabledDiv.classList.add('hidden');

        const result = await eel.get_telegram_status(currentUser.user_id)();
        if (result.linked) {
            linkedDiv.classList.remove('hidden');
            notLinkedDiv.classList.add('hidden');
            linkCodeDiv.classList.add('hidden');
            document.getElementById('telegramLinkedDate').textContent =
                result.linked_at ? `(연결일: ${result.linked_at.split('T')[0]})` : '';
        } else {
            linkedDiv.classList.add('hidden');
            notLinkedDiv.classList.remove('hidden');
            linkCodeDiv.classList.add('hidden');
        }
    } catch (error) {
        console.error('텔레그램 상태 로드 오류:', error);
    }
}

async function generateTelegramCode() {
    if (!currentUser) return;
    try {
        const result = await eel.generate_telegram_link_code(currentUser.user_id)();
        if (result.success) {
            const linkDiv = document.getElementById('telegramLinkCode');
            linkDiv.classList.remove('hidden');

            const qrImg     = document.getElementById('telegramQrCode');
            const botNameEl = document.getElementById('telegramBotNameDisplay');
            const cmdEl     = document.getElementById('telegramStartCmd');
            const deepLinkEl = document.getElementById('telegramDeepLink');

            // 수동 입력용 코드 표시
            if (cmdEl) cmdEl.textContent = `/start ${result.code}`;
            if (botNameEl) botNameEl.textContent = result.botUsername ? `@${result.botUsername}` : '봇';

            // QR 코드: webLink(https://)로 생성 → 모바일 스캔용
            const qrTarget = result.webLink || (result.botUsername ? `https://t.me/${result.botUsername}?start=${result.code}` : '');
            if (qrImg && qrTarget) {
                qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=112x112&data=${encodeURIComponent(qrTarget)}`;
            } else if (qrImg) {
                qrImg.src = '';
            }

            // 딥링크 버튼: deepLink(tg://)로 → PC Telegram Desktop 직접 실행
            if (deepLinkEl) {
                if (result.deepLink) {
                    deepLinkEl.href = result.deepLink;
                    deepLinkEl.textContent = '텔레그램 앱으로 열기';
                    const _url = result.deepLink;
                    deepLinkEl.onclick = function(e) { e.preventDefault(); eel.open_external_url(_url)(); };
                } else {
                    deepLinkEl.textContent = '';
                    deepLinkEl.onclick = null;
                }
            }
        } else {
            showCustomAlert('오류', result.message || '코드 생성 실패', 'error');
        }
    } catch (error) {
        console.error('텔레그램 코드 생성 오류:', error);
    }
}

async function copyTelegramCode() {
    const cmd = document.getElementById('telegramStartCmd');
    if (!cmd || !cmd.textContent) return;
    try {
        await navigator.clipboard.writeText(cmd.textContent);
        showCustomAlert('복사됨', '코드가 클립보드에 복사되었습니다.', 'success');
    } catch (e) {
        showCustomAlert('복사 실패', '직접 코드를 선택하여 복사해 주세요.', 'warning');
    }
}

async function unlinkTelegram() {
    if (!confirm('텔레그램 연결을 해제하시겠습니까?\n더 이상 댓글 알림을 받지 않게 됩니다.')) return;
    try {
        const result = await eel.unlink_telegram(currentUser.user_id)();
        if (result.success) {
            showCustomAlert('완료', '텔레그램 연결이 해제되었습니다.', 'success');
            loadTelegramStatus();
        }
    } catch (error) {
        console.error('텔레그램 연결 해제 오류:', error);
    }
}

// ============================================================================
// ESC 키로 모달 닫기
// ============================================================================

document.addEventListener('keydown', function(e) {
    // ── ESC: 열린 모달 닫기 ────────────────────────────────────────
    if (e.key === 'Escape') {
        const modals = [
            { id: 'commentModal',      close: closeCommentModal },
            { id: 'newProjectModal',   close: closeNewProjectModal },
            { id: 'startProjectModal', close: closeStartProjectModal },
        ];
        for (const m of modals) {
            const el = document.getElementById(m.id);
            if (el && !el.classList.contains('hidden')) {
                m.close();
                break;
            }
        }
        return;
    }

    // ── Ctrl+S: 일일 작업 저장 (입력 필드 포함 어디서든) ──────────
    if (e.ctrlKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
        const dailyView = document.getElementById('dailyView');
        if (dailyView && !dailyView.classList.contains('hidden')) {
            e.preventDefault();
            if (typeof saveCurrentWorkRecords === 'function') saveCurrentWorkRecords();
        }
        return;
    }

    if (e.key === 'F5') {
        const dailyView = document.getElementById('dailyView');
        if (dailyView && !dailyView.classList.contains('hidden')) {
            e.preventDefault();
            if (typeof refreshCurrentWorkRecords === 'function') refreshCurrentWorkRecords();
        }
        return;
    }

    // ── 입력 필드 내부에서는 이하 단축키 무시 ─────────────────────
    if (e.target.matches('input, textarea, select, [contenteditable]')) return;

    if (!e.ctrlKey || e.altKey || e.shiftKey) return;

    switch (e.key) {
        // 탭 전환
        case '1': e.preventDefault(); showView('dashboard'); break;
        case '2': e.preventDefault(); showView('daily');     break;
        case '3': e.preventDefault(); showView('report');    break;
        case '4': e.preventDefault(); showView('search');    break;
        case '5': e.preventDefault(); showView('employee');  break;

        // 날짜 이동 (일일 뷰에서만)
        case 'ArrowLeft': {
            const dv = document.getElementById('dailyView');
            if (dv && !dv.classList.contains('hidden')) {
                e.preventDefault();
                changeDate(-1);
            }
            break;
        }
        case 'ArrowRight': {
            const dv = document.getElementById('dailyView');
            if (dv && !dv.classList.contains('hidden')) {
                e.preventDefault();
                changeDate(1);
            }
            break;
        }

        // 오늘 날짜 이동 (일일 뷰에서만)
        case 't': case 'T': {
            const dv = document.getElementById('dailyView');
            if (dv && !dv.classList.contains('hidden')) {
                e.preventDefault();
                if (!checkUnsavedChanges()) break;
                currentDate = new Date();
                updateDateInput();
                if (currentWorkTab === 'night') {
                    loadNightRecords();
                } else {
                    loadWorkRecords();
                }
            }
            break;
        }
    }
});

async function saveUserSettings() {
    // 2티어 트리에서 선택된 값 읽기
    const defaultView = getSelectedDefaultView();

    try {
        showLoading(true, '설정 저장 중...');

        // localStorage에 저장
        currentUser.default_view = defaultView;
        localStorage.setItem('userDefaultView', defaultView);

        showLoading(false);
        showCustomAlert('성공', '기본 화면이 설정되었습니다.', 'success');
    } catch (error) {
        showLoading(false);
        showCustomAlert('오류', '설정 저장에 실패했습니다.', 'error');
    }
}

// ============================================================================
// 직원 관리 - 연차 관리
// ============================================================================

// 어드민 페이지 → 직원 관리 탭으로 전환 (mainApp 임시 사용)
function showEmployeeFromAdmin() {
    document.getElementById('adminApp').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    const bar = document.getElementById('adminReturnBar');
    if (bar) bar.classList.remove('hidden');
    showView('employee');
}

// 직원 관리에서 어드민 페이지로 복귀
function returnToAdminPanel() {
    const bar = document.getElementById('adminReturnBar');
    if (bar) bar.classList.add('hidden');
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('adminApp').classList.remove('hidden');
}

function showEmployeeTab(tab) {
    const tabMap = {
        leave: document.getElementById('employeeLeaveTab'),
        leaveReport: document.getElementById('employeeLeaveReportTab')
    };
    const btnMap = {
        leave: document.getElementById('btnEmployeeLeave'),
        leaveReport: document.getElementById('btnEmployeeLeaveReport')
    };
    // 모든 탭 패널 숨김
    Object.values(tabMap).forEach(t => t && t.classList.add('hidden'));
    // 버튼 스타일 업데이트
    Object.keys(btnMap).forEach(key => {
        const b = btnMap[key];
        if (!b) return;
        b.classList.remove('bg-blue-600', 'text-white', 'bg-slate-200',
                           'bg-white', 'text-slate-600', 'border', 'border-slate-300', 'hover:bg-slate-50');
        if (key === tab) {
            b.classList.add('bg-blue-600', 'text-white');
        } else {
            b.classList.add('bg-white', 'text-slate-600', 'border', 'border-slate-300', 'hover:bg-slate-50');
        }
    });
    if (tabMap[tab]) tabMap[tab].classList.remove('hidden');
    if (tab === 'leaveReport') loadLeaveMonthlyReport();
}

// ============================================================================
// 연차 월별 보고
// ============================================================================

let _leaveReportData = [];  // T3: 현재 표시 중인 직원 데이터 (순서 변경용)
let _leaveExcluded = [];    // 제외된 직원 이름 목록
let _leaveReportYear = 0;   // T3: 현재 조회 연도

async function loadLeaveMonthlyReport() {
    const sel = document.getElementById('leaveReportYear');
    if (!sel) return;
    // 연도 셀렉터 초기화 (처음 호출 시)
    if (!sel.options.length) {
        const curYear = new Date().getFullYear();
        for (let y = curYear; y >= curYear - 2; y--) {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = y + '년';
            sel.appendChild(opt);
        }
    }
    const year = parseInt(sel.value) || new Date().getFullYear();
    const container = document.getElementById('leaveReportTableContainer');
    if (!container) return;
    container.innerHTML = '<p class="text-slate-400 text-sm">불러오는 중...</p>';
    try {
        // T3: 저장된 순서 먼저 로드
        const [result, orderResult, excludedResult] = await Promise.all([
            eel.get_all_leave_monthly_report(year)(),
            eel.get_employee_leave_order()(),
            eel.get_employee_leave_excluded()()
        ]);
        // 제외 목록 파싱
        _leaveExcluded = [];
        if (excludedResult && excludedResult.excluded) {
            try { _leaveExcluded = JSON.parse(excludedResult.excluded); } catch(e) {}
        }
        if (result && result.success) {
            let data = result.data || [];
            // 제외된 직원 필터링
            data = data.filter(emp => !_leaveExcluded.includes(emp.name));
            // T3: 저장된 순서가 있으면 적용
            if (orderResult && orderResult.order) {
                try {
                    const savedOrder = JSON.parse(orderResult.order);
                    data = _applyLeaveOrder(data, savedOrder);
                } catch(e) { console.warn('직원 순서 파싱 실패:', e); }
            }
            renderLeaveMonthlyReport(data, year);
        } else {
            container.innerHTML = '<p class="text-red-500 text-sm">데이터 조회 실패</p>';
        }
    } catch (e) {
        container.innerHTML = '<p class="text-red-500 text-sm">오류: ' + escapeHtml(String(e)) + '</p>';
    }
}

// T3: 저장된 이름 순서대로 data 배열 재정렬 (저장된 이름 없는 항목은 뒤에 추가)
function _applyLeaveOrder(data, savedOrder) {
    const orderMap = {};
    savedOrder.forEach((name, idx) => { orderMap[name] = idx; });
    return [...data].sort((a, b) => {
        const ia = orderMap[a.name] ?? 9999;
        const ib = orderMap[b.name] ?? 9999;
        return ia - ib;
    });
}

// T3: 직원 행 이동
function moveLeaveRow(idx, dir) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= _leaveReportData.length) return;
    [_leaveReportData[idx], _leaveReportData[newIdx]] = [_leaveReportData[newIdx], _leaveReportData[idx]];
    renderLeaveMonthlyReport(_leaveReportData, _leaveReportYear);
}

// T3: 현재 순서 DB에 저장
async function saveLeaveOrder() {
    const names = _leaveReportData.map(e => e.name);
    try {
        const r = await eel.save_employee_leave_order(JSON.stringify(names))();
        if (r && r.success) {
            showToast('직원 순서가 저장되었습니다.', 'success');
        } else {
            showToast('순서 저장 실패', 'error');
        }
    } catch(e) {
        showToast('순서 저장 중 오류가 발생했습니다.', 'error');
    }
}

// 직원 제거 — 제외 목록에 추가 후 테이블에서 숨김
async function removeLeaveEmployee(idx) {
    const emp = _leaveReportData[idx];
    if (!emp) return;
    const name = emp.name;
    if (!confirm(`"${name}"을(를) 보고서에서 제거하시겠습니까?\n하단 목록에서 복원할 수 있습니다.`)) return;
    _leaveExcluded.push(name);
    _leaveReportData.splice(idx, 1);
    try {
        await Promise.all([
            eel.set_employee_leave_excluded(JSON.stringify(_leaveExcluded))(),
            eel.save_employee_leave_order(JSON.stringify(_leaveReportData.map(e => e.name)))()
        ]);
        showToast(`${escapeHtml(name)}이(가) 보고서에서 제거되었습니다.`, 'success');
        renderLeaveMonthlyReport(_leaveReportData, _leaveReportYear);
    } catch(e) {
        showToast('제거 중 오류가 발생했습니다.', 'error');
    }
}

// 제외된 직원 복원
async function restoreLeaveEmployee(name) {
    _leaveExcluded = _leaveExcluded.filter(n => n !== name);
    try {
        await eel.set_employee_leave_excluded(JSON.stringify(_leaveExcluded))();
        showToast(`${escapeHtml(name)}이(가) 복원되었습니다.`, 'success');
        loadLeaveMonthlyReport();
    } catch(e) {
        showToast('복원 중 오류가 발생했습니다.', 'error');
    }
}

function renderLeaveMonthlyReport(data, year) {
    const container = document.getElementById('leaveReportTableContainer');
    if (!container) return;
    if (!data || data.length === 0) {
        container.innerHTML = '<p class="text-slate-400 text-sm">연차 데이터가 없습니다.</p>';
        return;
    }

    // T3: 모듈 변수 업데이트
    _leaveReportData = data;
    _leaveReportYear = year;

    const curYear = new Date().getFullYear();
    const maxMonth = (year === curYear) ? new Date().getMonth() + 1 : 12;
    const monthNames = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

    let html = `<div id="leaveReportPrintArea">
        <h3 class="text-lg font-bold text-center mb-3 hidden" id="leaveReportPrintTitle">${escapeHtml(String(year))}년 연차 현황</h3>
        <div class="mb-2 no-print flex items-center gap-2">
            <span class="text-xs text-slate-500">↑↓ 버튼으로 순서를 조정하고</span>
            <button onclick="saveLeaveOrder()" class="px-3 py-1 bg-slate-600 text-white rounded text-xs font-semibold hover:bg-slate-700">💾 순서 저장</button>
        </div>
        <table class="w-full border-collapse text-sm">
            <thead>
                <tr class="bg-blue-50">
                    <th class="border border-gray-400 px-2 py-2 text-center whitespace-nowrap no-print">순서</th>
                    <th class="border border-gray-400 px-2 py-2 text-center whitespace-nowrap">순번</th>
                    <th class="border border-gray-400 px-3 py-2 text-center whitespace-nowrap">이름</th>`;
    for (let m = 1; m <= maxMonth; m++) {
        html += `<th class="border border-gray-400 px-2 py-2 text-center whitespace-nowrap">${monthNames[m-1]}</th>`;
    }
    html += `<th class="border border-gray-400 px-2 py-2 text-center whitespace-nowrap">연차 생성월</th>
                    <th class="border border-gray-400 px-2 py-2 text-center whitespace-nowrap">잔여 연차</th>
                    <th class="border border-gray-400 px-4 py-2 text-center whitespace-nowrap">서명</th>
                </tr>
            </thead>
            <tbody>`;

    data.forEach((emp, idx) => {
        html += `<tr class="${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}">
            <td class="border border-gray-400 px-1 py-1 text-center no-print whitespace-nowrap">
                <button onclick="moveLeaveRow(${idx}, -1)" class="px-1 text-slate-500 hover:text-blue-600 disabled:opacity-30 text-xs" ${idx === 0 ? 'disabled' : ''}>▲</button>
                <button onclick="moveLeaveRow(${idx}, 1)" class="px-1 text-slate-500 hover:text-blue-600 disabled:opacity-30 text-xs" ${idx === data.length - 1 ? 'disabled' : ''}>▼</button>
                <button onclick="removeLeaveEmployee(${idx})" class="px-1 text-red-400 hover:text-red-600 text-xs ml-1" title="보고서에서 제거">✕</button>
            </td>
            <td class="border border-gray-400 px-2 py-2 text-center">${idx + 1}</td>
            <td class="border border-gray-400 px-3 py-2 text-center font-medium">${escapeHtml(emp.name)}</td>`;
        for (let m = 1; m <= maxMonth; m++) {
            const used = emp.monthly[m];
            html += `<td class="border border-gray-400 px-2 py-2 text-center">${used != null ? used : '-'}</td>`;
        }
        const remaining = emp.remaining;
        const remColor = remaining < 0 ? 'text-red-600 font-bold' : remaining === 0 ? 'text-slate-500' : 'text-green-700 font-semibold';
        html += `<td class="border border-gray-400 px-2 py-2 text-center">${emp.generation_month}월</td>
            <td class="border border-gray-400 px-2 py-2 text-center ${remColor}">${remaining}</td>
            <td class="border border-gray-400 px-4 py-2 text-center">&nbsp;</td>
        </tr>`;
    });

    html += `</tbody></table>`;

    // 제외된 직원 복원 영역 (인쇄 제외)
    if (_leaveExcluded.length > 0) {
        html += `<div class="mt-3 no-print p-3 bg-slate-50 rounded border border-slate-200">
            <p class="text-xs text-slate-500 font-semibold mb-2">🚫 제외된 직원 — 클릭하면 복원됩니다</p>
            <div class="flex flex-wrap gap-2">`;
        _leaveExcluded.forEach(name => {
            html += `<button onclick="restoreLeaveEmployee(this.dataset.name)" data-name="${escapeHtml(name)}"
                class="px-2 py-1 bg-white border border-slate-300 rounded text-xs text-slate-600 hover:bg-blue-50 hover:border-blue-400 hover:text-blue-700">
                ↩ ${escapeHtml(name)}</button>`;
        });
        html += `</div></div>`;
    }

    html += `</div>`;
    container.innerHTML = html;
}

function printLeaveReport() {
    // 인쇄 전 타이틀 임시 표시
    const title = document.getElementById('leaveReportPrintTitle');
    if (title) title.classList.remove('hidden');
    window.print();
    if (title) title.classList.add('hidden');
}

function showAddLeaveRowModal() {
    const modal = document.getElementById('addLeaveRowModal');
    const nameEl = document.getElementById('addLeaveRowName');
    if (!modal) return;
    if (nameEl) nameEl.value = '';
    modal.classList.remove('hidden');
    if (nameEl) nameEl.focus();
}

async function confirmAddLeaveRow() {
    const nameEl = document.getElementById('addLeaveRowName');
    const monthEl = document.getElementById('addLeaveRowMonth');
    const name = nameEl ? nameEl.value.trim() : '';
    const month = parseInt(monthEl ? monthEl.value : '1') || 1;
    if (!name) { showToast('직원명을 입력해주세요.', 'error'); return; }
    try {
        const r = await eel.save_employee_annual_config(name, month, '')();
        document.getElementById('addLeaveRowModal').classList.add('hidden');
        if (r && r.success) {
            showToast(escapeHtml(name) + ' 추가 완료');
            loadLeaveMonthlyReport();
        } else {
            showToast('추가 실패', 'error');
        }
    } catch(e) {
        showToast('오류: ' + String(e), 'error');
    }
}

async function toggleLeaveReportEdit(userId, enabled) {
    if (!currentUser) return;
    const btn = document.querySelector(`button[onclick*="toggleLeaveReportEdit('${userId}'"]`);
    if (btn) { btn.disabled = true; btn.textContent = '처리중...'; }
    try {
        const r = await eel.set_leave_report_edit(userId, enabled, currentUser.user_id)();
        if (r && r.success) {
            showToast(enabled ? '월보편집 권한이 부여되었습니다.' : '월보편집 권한이 해제되었습니다.', 'success');
            if (typeof loadAllUsers === 'function') loadAllUsers();
        } else {
            showToast('권한 설정 실패: ' + escapeHtml(r?.message || ''), 'error');
            if (btn) { btn.disabled = false; btn.textContent = '월보편집'; }
        }
    } catch(e) {
        showToast('오류가 발생했습니다.', 'error');
        if (btn) { btn.disabled = false; btn.textContent = '월보편집'; }
    } finally {
        // loadAllUsers 완료 후 버튼이 재렌더링되지 않았을 때 대비
        if (btn && btn.isConnected && btn.disabled) {
            btn.disabled = false;
            btn.textContent = '월보편집';
        }
    }
}

async function toggleWritePermission(userId, enabled) {
    if (!currentUser) return;
    const btn = document.querySelector(`button[onclick*="toggleWritePermission('${userId}'"]`);
    if (btn) { btn.disabled = true; btn.textContent = '처리중...'; }
    try {
        const r = await eel.admin_set_write_permission(userId, enabled, currentUser.user_id)();
        if (r && r.success) {
            showToast(enabled ? '쓰기 권한이 부여되었습니다.' : '쓰기 권한이 해제되었습니다.', 'success');
            if (typeof loadAllUsers === 'function') loadAllUsers();
        } else {
            showToast('쓰기 권한 설정 실패: ' + escapeHtml(r?.message || ''), 'error');
            if (btn) { btn.disabled = false; btn.textContent = '쓰기'; }
        }
    } catch(e) {
        showToast('오류가 발생했습니다.', 'error');
        if (btn) { btn.disabled = false; btn.textContent = '쓰기'; }
    } finally {
        // loadAllUsers 완료 후 버튼이 재렌더링되지 않았을 때 대비
        if (btn && btn.isConnected && btn.disabled) {
            btn.disabled = false;
            btn.textContent = '쓰기';
        }
    }
}

async function loadErpPermList() {
    const listEl = document.getElementById('erpPermList');
    if (!listEl) return;
    try {
        const res = await eel.admin_get_all_users(currentUser?.user_id || '')();
        const users = Array.isArray(res) ? res : (res?.users || []);
        if (!users.length) { listEl.innerHTML = '<p class="text-slate-400 text-xs">사용자 없음</p>'; return; }
        listEl.innerHTML = users
            .filter(u => u.user_id !== 'guest')
            .map(u => `
                <div class="flex items-center justify-between py-1 px-2 rounded hover:bg-purple-100">
                    <span class="text-slate-700">${escapeHtml(u.full_name)} <span class="text-xs text-slate-400">(${escapeHtml(u.user_id)})</span></span>
                    <button onclick="toggleErpInput('${escapeJs(u.user_id)}', ${!u.erp_input})"
                            class="px-3 py-0.5 text-xs rounded font-semibold ${u.erp_input
                                ? 'bg-purple-600 text-white hover:bg-purple-700'
                                : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}">
                        ${u.erp_input ? 'ERP ✓' : 'ERP 권한 없음'}
                    </button>
                </div>`).join('');
    } catch(e) {
        listEl.innerHTML = '<p class="text-red-400 text-xs">목록 로드 실패</p>';
    }
}

async function toggleErpInput(userId, enabled) {
    if (!currentUser) return;
    const btn = document.querySelector(`button[onclick*="toggleErpInput('${userId}'"]`);
    if (btn) { btn.disabled = true; btn.textContent = '처리중...'; }
    try {
        const r = await eel.admin_set_erp_input(userId, enabled, currentUser.user_id)();
        if (r && r.success) {
            showToast(enabled ? 'ERP입력 권한이 부여되었습니다.' : 'ERP입력 권한이 해제되었습니다.', 'success');
            if (typeof loadAllUsers === 'function') loadAllUsers();
            if (typeof loadErpPermList === 'function') loadErpPermList();
        } else {
            showToast('ERP입력 권한 설정 실패: ' + escapeHtml(r?.message || ''), 'error');
            if (btn) { btn.disabled = false; btn.textContent = 'ERP입력'; }
        }
    } catch(e) {
        showToast('오류가 발생했습니다.', 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'ERP입력'; }
    } finally {
        if (btn && btn.isConnected && btn.disabled) {
            btn.disabled = false;
            btn.textContent = 'ERP입력';
        }
    }
}

async function loadLeaveEmployeeList() {
    try {
        const names = await eel.get_employee_names_for_leave()();
        const datalist = document.getElementById('leaveEmployeeList');
        if (!datalist) return;
        datalist.innerHTML = '';
        (names || []).forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            datalist.appendChild(opt);
        });
    } catch (e) {
        console.error('직원 목록 로드 실패:', e);
    }
}

async function searchEmployeeLeave() {
    const input = document.getElementById('leaveEmployeeInput');
    const name = input ? input.value.trim() : '';
    if (!name) {
        showCustomAlert('알림', '직원명을 입력하세요.', 'warning');
        return;
    }
    const resultDiv = document.getElementById('leaveResult');
    if (resultDiv) resultDiv.innerHTML = '<p class="text-slate-400">조회 중...</p>';
    try {
        const info = await eel.get_employee_leave_info(name)();
        renderLeaveResult(info, name);
    } catch (e) {
        if (resultDiv) resultDiv.innerHTML = '<p class="text-red-500">조회 실패: ' + escapeHtml(e.message) + '</p>';
    }
}

// ----------------------------------------------------------------------------
// 직원 개인 프로필 모달
// ----------------------------------------------------------------------------

let _empProfileChart = null;

async function openEmployeeProfile(name) {
    if (!name) return;
    const year = new Date().getFullYear();
    try {
        const result = await eel.get_employee_profile(name, year)();
        if (!result.success) { showToast('프로필 조회 실패', 'error'); return; }
        _showEmployeeProfileModal(result);
    } catch (e) {
        console.error('직원 프로필 오류:', e);
        showToast('프로필 조회 중 오류가 발생했습니다.', 'error');
    }
}

function _showEmployeeProfileModal(data) {
    const old = document.getElementById('empProfileModal');
    if (old) old.remove();
    if (_empProfileChart) { _empProfileChart.destroy(); _empProfileChart = null; }

    const leave = data.leaveBalance;
    const leaveHtml = leave
        ? `<div class="flex gap-4 text-sm text-center mt-2">
            <div class="flex-1 bg-blue-50 rounded p-2"><div class="text-xs text-slate-500">총 부여</div><div class="font-bold text-blue-700">${leave.total}</div></div>
            <div class="flex-1 bg-amber-50 rounded p-2"><div class="text-xs text-slate-500">사용</div><div class="font-bold text-amber-600">${leave.used}</div></div>
            <div class="flex-1 bg-emerald-50 rounded p-2"><div class="text-xs text-slate-500">잔여</div><div class="font-bold text-emerald-600">${leave.remaining}</div></div>
           </div>`
        : '<p class="text-xs text-slate-400 mt-2">연차 데이터 없음</p>';

    const modal = document.createElement('div');
    modal.id = 'empProfileModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50';
    modal.innerHTML = `
      <div class="bg-white rounded-xl shadow-xl p-6 w-96 max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center mb-4">
          <h3 class="font-bold text-lg">👤 ${escapeHtml(data.name)} (${data.year}년)</h3>
          <button onclick="document.getElementById('empProfileModal').remove()"
                  class="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>
        <!-- 요약 카드 -->
        <div class="grid grid-cols-2 gap-3 mb-4">
          <div class="bg-blue-50 rounded-lg p-3 text-center">
            <div class="text-xs text-slate-500 mb-1">총 공수</div>
            <div class="text-2xl font-bold text-blue-700">${data.totalManpower.toFixed(1)}</div>
          </div>
          <div class="bg-slate-50 rounded-lg p-3 text-center">
            <div class="text-xs text-slate-500 mb-1">참여 프로젝트</div>
            <div class="text-2xl font-bold text-slate-700">${data.projectCount}</div>
          </div>
        </div>
        <!-- 월별 공수 차트 -->
        <div class="mb-4">
          <div class="text-xs text-slate-500 mb-1 font-semibold">월별 공수</div>
          <canvas id="empMonthlyChart" height="80"></canvas>
        </div>
        <!-- 연차 -->
        <div class="mb-4">
          <div class="text-xs text-slate-500 font-semibold mb-1">연차 현황</div>
          ${leaveHtml}
        </div>
        <!-- 최근 프로젝트 -->
        ${data.projects.length ? `
        <div>
          <div class="text-xs text-slate-500 font-semibold mb-1">참여 계약 (최대 10건)</div>
          <div class="flex flex-wrap gap-1">
            ${data.projects.map(p => `<span class="text-xs bg-slate-100 rounded px-2 py-0.5">${escapeHtml(p)}</span>`).join('')}
          </div>
        </div>` : ''}
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    // 차트 렌더링
    const canvas = document.getElementById('empMonthlyChart');
    if (canvas) {
        const months = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
        _empProfileChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: months,
                datasets: [{ label: '공수', data: data.monthlyManpower, backgroundColor: 'rgba(59,130,246,0.6)' }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true } }
            }
        });
    }
}

function renderLeaveResult(info, name) {
    const resultDiv = document.getElementById('leaveResult');
    if (!resultDiv) return;

    const cfg = info.config || {};
    const grants = info.grants || [];
    const usageThisYear = info.usage_this_year || [];
    const allUsageCount = info.all_usage_count || 0;
    const summary = info.summary || { total_granted: 0, total_used: 0, remaining: 0 };

    const currentYear = new Date().getFullYear();

    // ── 섹션 1: 잔여 연차 요약 ──
    const remainingColor = summary.remaining < 0 ? 'text-red-600' : 'text-emerald-600';
    let html = `
    <div class="space-y-6">
      <!-- 프로필 버튼 -->
      <div class="flex justify-end">
        <button onclick="openEmployeeProfile('${escapeJs(name)}')"
                class="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 border border-blue-200">
          📊 ${escapeHtml(name)} 공수 프로필 보기
        </button>
      </div>
      <!-- 요약 박스 -->
      <div class="grid grid-cols-3 gap-4">
        <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
          <p class="text-sm text-slate-500 mb-1">총 부여</p>
          <p class="text-3xl font-bold text-blue-600">${summary.total_granted.toFixed(1)}</p>
        </div>
        <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
          <p class="text-sm text-slate-500 mb-1">총 사용</p>
          <p class="text-3xl font-bold text-amber-500">${summary.total_used.toFixed(1)}</p>
        </div>
        <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
          <p class="text-sm text-slate-500 mb-1">잔여</p>
          <p class="text-3xl font-bold ${remainingColor}">${summary.remaining.toFixed(1)}</p>
        </div>
      </div>

      <!-- 섹션 2: 연차 설정 (생성월) -->
      <div class="bg-white border border-slate-200 rounded-xl p-5">
        <h3 class="text-lg font-semibold text-slate-700 mb-4">⚙️ 연차 설정</h3>
        <div class="flex gap-3 items-center flex-wrap">
          <label class="text-sm text-slate-600 font-medium">연차 생성 월:</label>
          <select id="leaveGenMonth" class="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            ${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${cfg.generation_month===(i+1)?'selected':''}>${i+1}월</option>`).join('')}
          </select>
          <label class="text-sm text-slate-600 font-medium ml-2">메모:</label>
          <input type="text" id="leaveConfigNote" value="${escapeHtml(cfg.note||'')}"
                 class="border border-slate-300 rounded-lg px-3 py-2 text-sm w-48" placeholder="메모 (선택)">
          <button onclick="saveLeaveConfig('${escapeJs(name)}')"
                  class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">저장</button>
        </div>
      </div>

      <!-- 섹션 3: 연차 부여 이력 -->
      <div class="bg-white border border-slate-200 rounded-xl p-5">
        <h3 class="text-lg font-semibold text-slate-700 mb-4">📋 연차 부여 이력 (전체)</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm border-collapse">
            <thead>
              <tr class="bg-slate-100">
                <th class="px-3 py-2 text-left border border-slate-200">연도</th>
                <th class="px-3 py-2 text-left border border-slate-200">월</th>
                <th class="px-3 py-2 text-right border border-slate-200">일수</th>
                <th class="px-3 py-2 text-left border border-slate-200">메모</th>
                <th class="px-3 py-2 text-center border border-slate-200">삭제</th>
              </tr>
            </thead>
            <tbody>`;

    if (grants.length === 0) {
        html += `<tr><td colspan="5" class="px-3 py-3 text-center text-slate-400">부여 이력이 없습니다.</td></tr>`;
    } else {
        grants.forEach(g => {
            html += `
              <tr class="hover:bg-slate-50">
                <td class="px-3 py-2 border border-slate-100">${g.grant_year}년</td>
                <td class="px-3 py-2 border border-slate-100">${g.grant_month}월</td>
                <td class="px-3 py-2 border border-slate-100 text-right font-medium">${g.days}일</td>
                <td class="px-3 py-2 border border-slate-100 text-slate-500">${escapeHtml(g.note||'')}</td>
                <td class="px-3 py-2 border border-slate-100 text-center">
                  <button onclick="deleteLeaveGrant(${g.id},'${escapeJs(name)}')"
                          class="px-2 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200 text-xs">삭제</button>
                </td>
              </tr>`;
        });
    }

    html += `
            </tbody>
          </table>
        </div>
        <!-- 부여 추가 폼 -->
        <div class="flex gap-2 mt-4 items-center flex-wrap">
          <span class="text-sm font-medium text-slate-600">추가:</span>
          <input type="number" id="grantYear" value="${currentYear}"
                 class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm w-20" placeholder="연도">
          <select id="grantMonth" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            ${Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1}월</option>`).join('')}
          </select>
          <input type="number" id="grantDays" value="15" step="0.5" min="0.5"
                 class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm w-16" placeholder="일수">
          <input type="text" id="grantNote"
                 class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm w-36" placeholder="메모 (선택)">
          <button onclick="addLeaveGrant('${escapeJs(name)}')"
                  class="px-4 py-1.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700">추가</button>
        </div>
      </div>

      <!-- 섹션 4: 연차 사용 내역 (올해) -->
      <div class="bg-white border border-slate-200 rounded-xl p-5">
        <h3 class="text-lg font-semibold text-slate-700 mb-1">📅 연차 사용 내역 (${currentYear}년)</h3>
        <p class="text-xs text-slate-400 mb-4">전체 사용 건수: ${allUsageCount}건 (이전 연도 포함)</p>
        <div class="overflow-x-auto">
          <table class="w-full text-sm border-collapse">
            <thead>
              <tr class="bg-slate-100">
                <th class="px-3 py-2 text-left border border-slate-200">날짜</th>
                <th class="px-3 py-2 text-center border border-slate-200">종류</th>
                <th class="px-3 py-2 text-right border border-slate-200">차감</th>
                <th class="px-3 py-2 text-left border border-slate-200">메모</th>
                <th class="px-3 py-2 text-center border border-slate-200">삭제</th>
              </tr>
            </thead>
            <tbody>`;

    if (usageThisYear.length === 0) {
        html += `<tr><td colspan="5" class="px-3 py-3 text-center text-slate-400">올해 사용 내역이 없습니다.</td></tr>`;
    } else {
        usageThisYear.forEach(u => {
            const isAuto = u.created_by === 'auto_vacation';
            const deductLabel = u.leave_type === '공가' ? '<span class="text-slate-400">-</span>' :
                `<span class="font-medium text-amber-600">${u.days}</span>`;
            const typeBadge = u.leave_type === '연차' ? 'bg-blue-100 text-blue-700' :
                              u.leave_type === '반차' ? 'bg-purple-100 text-purple-700' :
                              'bg-slate-100 text-slate-600';
            const noteDisplay = isAuto
                ? `<span class="text-slate-400 text-xs">일일작업현황</span>${u.note && u.note !== '일일작업현황 자동' ? ' ' + escapeHtml(u.note) : ''}`
                : escapeHtml(u.note || '');
            const deleteBtn = isAuto
                ? `<span class="text-xs text-slate-300">자동</span>`
                : `<button onclick="deleteLeaveUsage(${u.id},'${escapeJs(name)}')"
                           class="px-2 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200 text-xs">삭제</button>`;
            html += `
              <tr class="${isAuto ? 'bg-slate-50/60' : 'hover:bg-slate-50'}">
                <td class="px-3 py-2 border border-slate-100">${u.use_date}</td>
                <td class="px-3 py-2 border border-slate-100 text-center">
                  <span class="px-2 py-0.5 rounded text-xs font-semibold ${typeBadge}">${u.leave_type}</span>
                </td>
                <td class="px-3 py-2 border border-slate-100 text-right">${deductLabel}</td>
                <td class="px-3 py-2 border border-slate-100 text-slate-500">${noteDisplay}</td>
                <td class="px-3 py-2 border border-slate-100 text-center">${deleteBtn}</td>
              </tr>`;
        });
    }

    html += `
            </tbody>
          </table>
        </div>
        <!-- 사용 내역 추가 폼 -->
        <div class="flex gap-2 mt-4 items-center flex-wrap">
          <span class="text-sm font-medium text-slate-600">추가:</span>
          <input type="date" id="usageDate" value="${new Date().toISOString().slice(0,10)}"
                 class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
          <select id="usageType" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="연차">연차 (1공)</option>
            <option value="반차">반차 (0.5공)</option>
            <option value="공가">공가 (차감없음)</option>
          </select>
          <input type="text" id="usageNote"
                 class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm w-36" placeholder="메모 (선택)">
          <button onclick="addLeaveUsage('${escapeJs(name)}')"
                  class="px-4 py-1.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700">추가</button>
        </div>
      </div>
    </div>`;

    resultDiv.innerHTML = html;
}

async function saveLeaveConfig(name) {
    const genMonth = parseInt(document.getElementById('leaveGenMonth').value);
    const note = document.getElementById('leaveConfigNote').value.trim();
    try {
        const result = await eel.save_employee_annual_config(name, genMonth, note)();
        if (result && result.success) {
            showCustomAlert('성공', '연차 설정이 저장되었습니다.', 'success');
        } else {
            showCustomAlert('오류', (result && result.error) || '저장 실패', 'error');
        }
    } catch (e) {
        showCustomAlert('오류', '저장 중 오류: ' + e.message, 'error');
    }
}

async function addLeaveGrant(name) {
    const year  = parseInt(document.getElementById('grantYear').value);
    const month = parseInt(document.getElementById('grantMonth').value);
    const days  = parseFloat(document.getElementById('grantDays').value);
    const note  = document.getElementById('grantNote').value.trim();
    if (!year || !month || isNaN(days) || days <= 0) {
        showCustomAlert('알림', '연도, 월, 일수를 올바르게 입력하세요.', 'warning');
        return;
    }
    try {
        const result = await eel.add_leave_grant(name, year, month, days, note)();
        if (result && result.success) {
            await searchEmployeeLeave();
        } else {
            showCustomAlert('오류', (result && result.error) || '추가 실패', 'error');
        }
    } catch (e) {
        showCustomAlert('오류', '추가 중 오류: ' + e.message, 'error');
    }
}

async function deleteLeaveGrant(id, employeeName) {
    if (!confirm('이 부여 이력을 삭제하시겠습니까?')) return;
    try {
        const result = await eel.delete_leave_grant(id)();
        if (result && result.success) {
            document.getElementById('leaveEmployeeInput').value = employeeName;
            await searchEmployeeLeave();
        } else {
            showCustomAlert('오류', (result && result.error) || '삭제 실패', 'error');
        }
    } catch (e) {
        showCustomAlert('오류', '삭제 중 오류: ' + e.message, 'error');
    }
}

async function addLeaveUsage(name) {
    const useDate   = document.getElementById('usageDate').value;
    const leaveType = document.getElementById('usageType').value;
    const note      = document.getElementById('usageNote').value.trim();
    if (!useDate) {
        showCustomAlert('알림', '날짜를 입력하세요.', 'warning');
        return;
    }
    try {
        const result = await eel.add_leave_usage(name, useDate, leaveType, note)();
        if (result && result.success) {
            await searchEmployeeLeave();
        } else {
            showCustomAlert('오류', (result && result.error) || '추가 실패', 'error');
        }
    } catch (e) {
        showCustomAlert('오류', '추가 중 오류: ' + e.message, 'error');
    }
}

async function deleteLeaveUsage(id, employeeName) {
    if (!confirm('이 사용 내역을 삭제하시겠습니까?')) return;
    try {
        const result = await eel.delete_leave_usage(id)();
        if (result && result.success) {
            document.getElementById('leaveEmployeeInput').value = employeeName;
            await searchEmployeeLeave();
        } else {
            showCustomAlert('오류', (result && result.error) || '삭제 실패', 'error');
        }
    } catch (e) {
        showCustomAlert('오류', '삭제 중 오류: ' + e.message, 'error');
    }
}

// ============================================================================
// 설정 하위 탭
// ============================================================================

function showSettingsTab(tab) {
    const userTab = document.getElementById('userSettingsTab');
    const logTab  = document.getElementById('activityLogTab');
    const erpTab  = document.getElementById('erpInputTab');
    const btnUser = document.getElementById('btnSettingsUser');
    const btnLog  = document.getElementById('btnSettingsLog');
    const btnErp  = document.getElementById('btnSettingsErp');

    const activeClass   = 'px-6 py-2 rounded-lg bg-blue-600 text-white font-semibold';
    const inactiveClass = 'px-6 py-2 rounded-lg bg-slate-200 font-semibold';

    // 모든 탭 숨기기
    [userTab, logTab, erpTab].forEach(t => t?.classList.add('hidden'));
    [btnUser, btnLog, btnErp].forEach(b => { if (b) b.className = inactiveClass; });

    if (tab === 'activityLog') {
        if (logTab)  logTab.classList.remove('hidden');
        if (btnLog)  btnLog.className = activeClass;
        loadActivityLog(50);
    } else if (tab === 'erpInput') {
        if (erpTab)  erpTab.classList.remove('hidden');
        if (btnErp)  btnErp.className = activeClass;
        // 관리자이면 권한 관리 섹션 표시 + 목록 로드
        const adminSec = document.getElementById('erpAdminSection');
        if (adminSec) {
            const isAdmin = currentUser?.role === 'admin';
            adminSec.classList.toggle('hidden', !isAdmin);
            if (isAdmin) loadErpPermList();
        }
    } else {
        if (userTab) userTab.classList.remove('hidden');
        if (btnUser) btnUser.className = activeClass;
    }
}

// ============================================================================
// 활동 로그
// ============================================================================

async function loadActivityLog(limit = 50, containerId = 'activityLogContent') {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '<p class="text-slate-400">불러오는 중...</p>';
    try {
        const logs = await eel.get_activity_logs(limit)();
        if (!logs || logs.length === 0) {
            container.innerHTML = '<p class="text-slate-400">활동 로그가 없습니다.</p>';
            return;
        }
        const actionLabel = { save: '저장', load: '조회', delete: '삭제', export: '내보내기', import: '가져오기' };
        const actionColor = {
            save:   'bg-blue-100 text-blue-700',
            load:   'bg-slate-100 text-slate-600',
            delete: 'bg-red-100 text-red-700',
            export: 'bg-green-100 text-green-700',
            import: 'bg-orange-100 text-orange-700'
        };
        let html = `<div class="overflow-x-auto">
            <table class="w-full border-collapse border text-sm">
                <thead><tr class="bg-slate-100">
                    <th class="border p-2 text-center w-36">시각</th>
                    <th class="border p-2 text-center w-24">사용자</th>
                    <th class="border p-2 text-center w-20">작업</th>
                    <th class="border p-2 text-center w-28">대상</th>
                    <th class="border p-2 text-left">상세</th>
                </tr></thead><tbody>`;
        logs.forEach(log => {
            const ts = log.timestamp ? log.timestamp.replace('T', ' ').substring(0, 16) : '';
            const label = actionLabel[log.action] || log.action;
            const colorClass = actionColor[log.action] || 'bg-slate-100 text-slate-600';
            html += `<tr class="hover:bg-slate-50">
                <td class="border p-2 text-center text-slate-500">${escapeHtml(ts)}</td>
                <td class="border p-2 text-center font-medium">${escapeHtml(log.user || '')}</td>
                <td class="border p-2 text-center"><span class="px-2 py-0.5 rounded text-xs font-semibold ${colorClass}">${escapeHtml(label)}</span></td>
                <td class="border p-2 text-center text-slate-600">${escapeHtml(log.target || '')}</td>
                <td class="border p-2 text-slate-600">${escapeHtml(log.details || '')}</td>
            </tr>`;
        });
        html += `</tbody></table></div>
            <p class="text-xs text-slate-400 mt-2 text-right">총 ${logs.length}건</p>`;
        container.innerHTML = html;
    } catch (e) {
        console.error('활동 로그 로드 오류:', e);
        container.innerHTML = '<p class="text-red-400">로그 로드 실패</p>';
    }
}

// ============================================================================
// J: 알림 센터
// ============================================================================

let _notifData = [];

async function loadNotifications() {
    _notifData = [];

    // 1) 업데이트 확인 (캐시 사용)
    try {
        const upd = await eel.check_for_updates(false)();
        if (upd && upd.update_available) {
            _notifData.push({
                icon:   '🆕',
                title:  `v${upd.latest_version} 업데이트 있음`,
                body:   upd.release_name || '',
                action: () => { if (typeof showUpdateModal === 'function') showUpdateModal(); }
            });
        }
    } catch (_) {}

    // 2) 미승인 사용자 (관리자 전용)
    if (currentUser && currentUser.role === 'admin') {
        try {
            const pending = await eel.admin_get_pending_requests(currentUser?.user_id || '')();
            if (pending && pending.length > 0) {
                _notifData.push({
                    icon:   '👤',
                    title:  `승인 대기 ${pending.length}명`,
                    body:   pending.map(u => u.full_name).join(', '),
                    action: () => { if (typeof showAdminApp === 'function') showAdminApp(); }
                });
            }
        } catch (_) {}
    }

    _renderNotifBadge();
}

function _renderNotifBadge() {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    if (_notifData.length > 0) {
        badge.textContent = _notifData.length;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function toggleNotificationPanel() {
    const panel = document.getElementById('notifPanel');
    const list  = document.getElementById('notifList');
    if (!panel) return;

    if (panel.classList.contains('hidden')) {
        // 패널 열기 — 목록 렌더링
        list.innerHTML = _notifData.length === 0
            ? '<p class="p-4 text-sm text-slate-400 text-center">새 알림이 없습니다</p>'
            : _notifData.map((n, i) => `
                <div class="p-3 hover:bg-slate-50 cursor-pointer" onclick="_notifClick(${i})">
                    <div class="flex gap-2 items-start">
                        <span class="text-xl">${n.icon}</span>
                        <div>
                            <div class="text-sm font-semibold text-slate-800">${escapeHtml(n.title)}</div>
                            ${n.body ? `<div class="text-xs text-slate-500 mt-0.5">${escapeHtml(n.body)}</div>` : ''}
                        </div>
                    </div>
                </div>`).join('');
        panel.classList.remove('hidden');
        // 패널 외부 클릭 시 닫기
        setTimeout(() => document.addEventListener('click', _closeNotifPanel, { once: true }), 50);
    } else {
        panel.classList.add('hidden');
    }
}

function _notifClick(i) {
    document.getElementById('notifPanel')?.classList.add('hidden');
    if (_notifData[i] && typeof _notifData[i].action === 'function') {
        _notifData[i].action();
    }
}

function _closeNotifPanel(e) {
    const wrap = document.getElementById('notificationWrap');
    if (wrap && !wrap.contains(e.target)) {
        document.getElementById('notifPanel')?.classList.add('hidden');
    }
}

// ============================================================================
// E: 통계 대시보드
// ============================================================================

let _statsYear = new Date().getFullYear();
let _manpowerChart = null;
let _projectCountChart = null;
let _manpowerRatioChart = null;

async function loadStatsData() {
    const label = document.getElementById('statsYearLabel');
    if (label) label.textContent = `${_statsYear}년`;

    let data;
    try {
        data = await eel.get_analytics_data(_statsYear)();
    } catch (e) {
        console.error('통계 데이터 로드 오류:', e);
        return;
    }
    if (!data || !data.success) return;

    // ── 월별 공수 누적 막대 차트 (본공 / 외주) ──────────────────────
    const ctx = document.getElementById('manpowerChart');
    if (ctx) {
        if (_manpowerChart) { _manpowerChart.destroy(); _manpowerChart = null; }
        _manpowerChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'],
                datasets: [
                    {
                        label: '본공',
                        data: data.inHouseMonthly || data.monthly,
                        backgroundColor: 'rgba(59,130,246,0.75)',
                        borderRadius: 3,
                        stack: 'total'
                    },
                    {
                        label: '외주',
                        data: data.outsourcedMonthly || [],
                        backgroundColor: 'rgba(234,88,12,0.75)',
                        borderRadius: 3,
                        stack: 'total'
                    }
                ]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: true, position: 'top' },
                    tooltip: {
                        mode: 'nearest',
                        intersect: true,
                        callbacks: {
                            beforeBody: (items) => {
                                if (!items.length) return '';
                                const item = items[0];
                                const dataIndex = item.dataIndex;
                                const total = item.chart.data.datasets.reduce(
                                    (s, ds) => s + (parseFloat(ds.data[dataIndex]) || 0), 0
                                );
                                return `합계: ${total.toFixed(1)}공`;
                            }
                        }
                    }
                },
                scales: {
                    x: { stacked: true },
                    y: { stacked: true, beginAtZero: true }
                }
            }
        });
    }

    // ── 공수 요약 (본공 / 외주 / 전체) ────────────────────────────────
    const totalLabel   = document.getElementById('totalManpowerLabel');
    const inHouseLabel = document.getElementById('inHouseLabel');
    const outLabel     = document.getElementById('outsourcedLabel');
    if (totalLabel && data.inHouseTotal !== undefined) {
        totalLabel.textContent   = ((data.inHouseTotal || 0) + (data.outsourcedTotal || 0)).toFixed(1);
        inHouseLabel.textContent = (data.inHouseTotal || 0).toFixed(1);
        outLabel.textContent     = (data.outsourcedTotal || 0).toFixed(1);
        document.getElementById('manpowerSummary')?.classList.remove('hidden');
    }

    // ── KPI 카드 ─────────────────────────────────────────────────────
    const kpiCards = document.getElementById('kpiCards');
    if (kpiCards && data.totalProjects !== undefined) {
        const grandTotal = (data.inHouseTotal || 0) + (data.outsourcedTotal || 0);
        document.getElementById('kpiTotalProjects').textContent  = data.totalProjects;
        document.getElementById('kpiAsRate').textContent         = (data.asRate ?? 0).toFixed(1);
        document.getElementById('kpiOutsourcedRate').textContent = (data.outsourcedRate ?? 0).toFixed(1);
        document.getElementById('kpiTotalManpower').textContent  = grandTotal.toFixed(1);
        const cRate = Math.min(data.asRate ?? 0, 100);
        const oRate = Math.min(data.outsourcedRate ?? 0, 100);
        document.getElementById('kpiAsBar').style.width          = `${cRate}%`;
        document.getElementById('kpiOutsourcedBar').style.width  = `${oRate}%`;
        kpiCards.classList.remove('hidden');
    }

    // ── 본공/외주 도넛 차트 + 월별 작업 건수 꺾은선 차트 ─────────────
    const ratioBox = document.getElementById('ratioAndCountChartBox');
    const ratioCtx = document.getElementById('manpowerRatioChart');
    const pcCtx    = document.getElementById('projectCountChart');
    const hasRatio = data.inHouseTotal !== undefined && (data.inHouseTotal + data.outsourcedTotal) > 0;
    const hasCount = data.monthlyProjectCount;
    if (ratioBox && (hasRatio || hasCount)) ratioBox.classList.remove('hidden');

    if (ratioCtx && hasRatio) {
        if (_manpowerRatioChart) { _manpowerRatioChart.destroy(); _manpowerRatioChart = null; }
        _manpowerRatioChart = new Chart(ratioCtx, {
            type: 'doughnut',
            data: {
                labels: ['본공', '외주'],
                datasets: [{
                    data: [data.inHouseTotal || 0, data.outsourcedTotal || 0],
                    backgroundColor: ['rgba(59,130,246,0.8)', 'rgba(234,88,12,0.8)'],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' },
                    tooltip: {
                        callbacks: {
                            label: (item) => {
                                const total = item.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = total > 0 ? (item.raw / total * 100).toFixed(1) : 0;
                                return ` ${item.label}: ${item.raw}공 (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    if (pcCtx && hasCount) {
        if (_projectCountChart) { _projectCountChart.destroy(); _projectCountChart = null; }
        _projectCountChart = new Chart(pcCtx, {
            type: 'line',
            data: {
                labels: ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'],
                datasets: [{
                    label: '작업 건수',
                    data: data.monthlyProjectCount,
                    borderColor: 'rgba(99,102,241,0.9)',
                    backgroundColor: 'rgba(99,102,241,0.12)',
                    tension: 0.3,
                    pointRadius: 4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
            }
        });
    }

    // ── 회사별 상위 10 ────────────────────────────────────────────────
    const compEl = document.getElementById('companyStatsList');
    if (compEl) {
        if (!data.companies || data.companies.length === 0) {
            compEl.innerHTML = '<p class="text-sm text-slate-400 py-4 text-center">데이터 없음</p>';
        } else {
            const maxC = Math.max(...data.companies.map(c => c.total), 1);
            compEl.innerHTML = data.companies.map(c => `
                <div class="flex items-center gap-2 mb-2">
                    <div class="text-xs w-24 truncate text-slate-600" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>
                    <div class="flex-1 bg-slate-200 rounded-full h-3">
                        <div class="bg-blue-500 h-3 rounded-full" style="width:${(c.total/maxC*100).toFixed(1)}%"></div>
                    </div>
                    <div class="text-xs w-10 text-right font-semibold text-slate-700">${c.total}</div>
                </div>`).join('');
        }
    }

    // ── 계약별 상위 10 ────────────────────────────────────────────────
    const contEl = document.getElementById('contractStatsList');
    if (contEl) {
        if (!data.contracts || data.contracts.length === 0) {
            contEl.innerHTML = '<p class="text-sm text-slate-400 py-4 text-center">데이터 없음</p>';
        } else {
            const maxR = Math.max(...data.contracts.map(r => r.total), 1);
            contEl.innerHTML = data.contracts.map(r => `
                <div class="flex items-center gap-2 mb-2">
                    <div class="text-xs w-24 truncate text-slate-600" title="${escapeHtml(r.cn)}">${escapeHtml(r.ship || r.cn)}</div>
                    <div class="flex-1 bg-slate-200 rounded-full h-3">
                        <div class="bg-emerald-500 h-3 rounded-full" style="width:${(r.total/maxR*100).toFixed(1)}%"></div>
                    </div>
                    <div class="text-xs w-10 text-right font-semibold text-slate-700">${r.total}</div>
                </div>`).join('');
        }
    }
}

function statsChangeYear(delta) {
    _statsYear += delta;
    loadStatsData();
}

// ============================================================================
// ERP 입력 자동화
// ============================================================================

let _erpPollInterval = null;

async function loadErpRecords() {
    const startDate = document.getElementById('erpStartDate')?.value;
    const endDate   = document.getElementById('erpEndDate')?.value;
    const listEl    = document.getElementById('erpRecordList');
    if (!startDate || !endDate) {
        showToast('시작일과 종료일을 입력하세요.', 'warning'); return;
    }
    if (!listEl) return;
    listEl.innerHTML = '<p class="text-slate-400 text-sm">조회 중...</p>';
    try {
        const res = await eel.get_records_for_erp(startDate, endDate, currentUser?.user_id || '')();
        if (!res.success) {
            listEl.innerHTML = `<p class="text-red-500 text-sm">${escapeHtml(res.message)}</p>`; return;
        }
        if (!res.dates || res.dates.length === 0) {
            listEl.innerHTML = '<p class="text-slate-400 text-sm">해당 기간에 입력된 작업 레코드가 없습니다.</p>'; return;
        }
        renderErpRecordList(res.dates);
    } catch (e) {
        listEl.innerHTML = `<p class="text-red-500 text-sm">조회 실패: ${escapeHtml(e.message || '')}</p>`;
    }
}

function renderErpRecordList(dates) {
    const listEl = document.getElementById('erpRecordList');
    if (!listEl) return;
    listEl.innerHTML = dates.map(day => `
        <div class="border border-slate-200 rounded-lg p-3">
            <div class="flex items-center gap-2 mb-2">
                <input type="checkbox" id="erpDay_${escapeHtml(day.date)}" checked
                       class="w-4 h-4 accent-blue-600 erpDayCheck" data-date="${escapeHtml(day.date)}">
                <label for="erpDay_${escapeHtml(day.date)}" class="font-semibold text-sm cursor-pointer">
                    ${escapeHtml(day.date)} (${day.records.length}건)
                </label>
            </div>
            <ul class="text-xs text-slate-600 ml-6 space-y-0.5">
                ${day.records.map(r => `
                    <li class="truncate">・ ${escapeHtml(r.contractNumber)} ${escapeHtml(r.workContent)}</li>
                `).join('')}
            </ul>
        </div>
    `).join('');
}

async function openErpInputWindow() {
    const checks = document.querySelectorAll('.erpDayCheck:checked');
    if (checks.length === 0) {
        showToast('입력할 날짜를 선택하세요.', 'warning'); return;
    }
    const startDate = document.getElementById('erpStartDate')?.value;
    const endDate   = document.getElementById('erpEndDate')?.value;
    try {
        const res = await eel.get_records_for_erp(startDate, endDate, currentUser?.user_id || '')();
        if (!res.success) { showToast(res.message || '레코드 조회 실패', 'error'); return; }

        const selectedDates = new Set(Array.from(checks).map(c => c.dataset.date));
        const filtered = (res.dates || []).filter(d => selectedDates.has(d.date));
        if (filtered.length === 0) { showToast('선택된 날짜에 레코드가 없습니다.', 'warning'); return; }

        const r = await eel.open_erp_input_window(JSON.stringify(filtered), currentUser?.user_id || '')();
        if (!r.success) { showToast(r.message || '실행 실패', 'error'); return; }
        showToast('ERP 입력 창이 열립니다. 잠시 후 새 창을 확인하세요.', 'success');
    } catch (e) {
        showToast('오류가 발생했습니다.', 'error');
    }
}

async function startErpMacro() {
    // 체크된 날짜의 레코드만 수집
    const checks = document.querySelectorAll('.erpDayCheck:checked');
    if (checks.length === 0) {
        showToast('입력할 날짜를 선택하세요.', 'warning'); return;
    }
    const listEl = document.getElementById('erpRecordList');
    const startDate = document.getElementById('erpStartDate')?.value;
    const endDate   = document.getElementById('erpEndDate')?.value;

    // 선택된 날짜 목록 재조회
    try {
        const res = await eel.get_records_for_erp(startDate, endDate, currentUser?.user_id || '')();
        if (!res.success) { showToast(res.message, 'error'); return; }

        const selectedDates = new Set(Array.from(checks).map(c => c.dataset.date));
        const filtered = (res.dates || []).filter(d => selectedDates.has(d.date));
        if (filtered.length === 0) { showToast('선택된 날짜에 레코드가 없습니다.', 'warning'); return; }

        const startRes = await eel.start_erp_macro(JSON.stringify(filtered), currentUser?.user_id || '')();
        if (!startRes.success) { showToast(startRes.message, 'error'); return; }

        document.getElementById('btnErpStart')?.classList.add('hidden');
        document.getElementById('btnErpStop')?.classList.remove('hidden');
        document.getElementById('erpProgressBar')?.classList.remove('hidden');
        document.getElementById('erpLog')?.classList.remove('hidden');
        showToast('ERP 입력 매크로를 시작합니다.', 'success');
        _erpPollInterval = setInterval(pollErpStatus, 1000);
    } catch (e) {
        showToast('매크로 시작 중 오류: ' + escapeHtml(e.message || ''), 'error');
    }
}

async function stopErpMacro() {
    try {
        const res = await eel.stop_erp_macro(currentUser?.user_id || '')();
        showToast(res.success ? '중단 요청이 전송되었습니다.' : res.message,
                  res.success ? 'warning' : 'error');
    } catch (e) {
        showToast('중단 요청 중 오류가 발생했습니다.', 'error');
    }
}

async function pollErpStatus() {
    try {
        const res = await eel.get_erp_macro_status(currentUser?.user_id || '')();
        if (!res.success) return;

        // 진행 바
        const fill = document.getElementById('erpProgressFill');
        const text = document.getElementById('erpProgressText');
        if (fill && res.total > 0) {
            const pct = Math.round(res.progress / res.total * 100);
            fill.style.width = pct + '%';
            if (text) text.textContent = `${res.progress} / ${res.total} (${pct}%) — ${res.current || ''}`;
        }

        // 로그
        const logEl = document.getElementById('erpLog');
        if (logEl && res.log) {
            logEl.textContent = res.log.join('\n');
            logEl.scrollTop = logEl.scrollHeight;
        }

        // 라이브러리 누락 감지 → 설치 버튼 표시
        if (res.log && res.log.some(l => l.includes('필수 라이브러리 누락'))) {
            document.getElementById('btnInstallErpDeps')?.classList.remove('hidden');
        }

        // 완료 감지
        if (!res.running) {
            clearInterval(_erpPollInterval);
            _erpPollInterval = null;
            document.getElementById('btnErpStart')?.classList.remove('hidden');
            document.getElementById('btnErpStop')?.classList.add('hidden');
            // 오류/완료/종료 구분
            const _hasErr = res.log && res.log.some(l =>
                l.includes('찾을 수 없습니다') || l.includes('라이브러리 누락') || l.includes('오류 발생'));
            if (_hasErr) {
                showToast('ERP 입력 중 오류가 발생했습니다. 로그를 확인하세요.', 'error');
            } else if (res.progress > 0) {
                showToast('ERP 입력이 완료되었습니다.', 'success');
            } else {
                showToast('ERP 매크로가 종료되었습니다.', 'warning');
            }
        }
    } catch (e) {
        // 일시적 통신 오류 — 조용히 무시
    }
}

async function diagnoseErpControls() {
    const el = document.getElementById('erpDiagResult');
    if (!el) return;
    el.classList.remove('hidden');
    el.textContent = '진단 중...';
    try {
        const res = await eel.diagnose_erp_controls(currentUser?.user_id || '')();
        if (res && res.success) {
            const cands = res.calendar_candidates || [];
            const calInfo = cands.length
                ? '✅ 달력 컨트롤 발견: ' + cands.map(c => c.cls).join(', ')
                : '⚠️ 달력 컨트롤 미발견 (Win32 직접 설정 불가 — 좌표 폴백 사용)';
            const lines = [
                `ERP 창: "${escapeHtml(res.erp_title || '')}" (hwnd=${res.erp_hwnd})`,
                calInfo,
                `전체 자식 컨트롤: ${(res.controls || []).length}개`,
                '',
                ...(res.controls || []).slice(0, 25).map(c =>
                    `[${c.hwnd}] ${escapeHtml(c.cls)} "${escapeHtml(c.text || '')}" rect=${JSON.stringify(c.rect)}`)
            ];
            el.textContent = lines.join('\n');
        } else {
            let msg = res?.message || '진단 실패';
            if (res?.open_windows?.length) {
                msg += '\n현재 열린 창: ' + res.open_windows.map(w => escapeHtml(w)).join(', ');
            }
            el.textContent = msg;
        }
    } catch(e) {
        el.textContent = '진단 오류: ' + escapeHtml(e?.message || String(e));
    }
}

async function installErpDeps() {
    const btn = document.getElementById('btnInstallErpDeps');
    if (btn) { btn.disabled = true; btn.textContent = '설치 중...'; }
    try {
        const res = await eel.install_erp_deps(currentUser?.user_id || '')();
        if (res?.success) {
            showToast(res.message, 'success');
            if (btn) btn.classList.add('hidden');
        } else {
            showToast('설치 실패: ' + escapeHtml(res?.message || ''), 'error');
            if (btn) { btn.disabled = false; btn.textContent = '📦 필수 라이브러리 설치'; }
        }
    } catch(e) {
        showToast('오류가 발생했습니다.', 'error');
        if (btn) { btn.disabled = false; btn.textContent = '📦 필수 라이브러리 설치'; }
    }
}

