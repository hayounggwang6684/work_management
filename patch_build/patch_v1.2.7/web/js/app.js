// ============================================================================
// 금일작업현황 관리 시스템 - 작업 관리 JavaScript
// ============================================================================

// 전역 변수 (auth.js와 공유)
// currentUser, currentDate는 auth.js에서 정의됨
let workRecords = [];
let vacationData = { '연차': '', '반차': '', '공가': '' };

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
    const btnDaily = document.getElementById('btnDaily');
    const btnReport = document.getElementById('btnReport');
    const btnSearch = document.getElementById('btnSearch');
    const btnDashboard = document.getElementById('btnDashboard');
    const btnSettings = document.getElementById('btnSettings');
    const dailyView = document.getElementById('dailyView');
    const reportView = document.getElementById('reportView');
    const searchView = document.getElementById('searchView');
    const dashboardView = document.getElementById('dashboardView');
    const settingsView = document.getElementById('settingsView');
    
    if (!btnDaily || !btnReport || !dailyView || !reportView) return;
    
    // 모든 버튼 초기화
    btnDaily.className = 'px-4 py-2 rounded-lg bg-slate-200';
    btnReport.className = 'px-4 py-2 rounded-lg bg-slate-200';
    if (btnSearch) btnSearch.className = 'px-4 py-2 rounded-lg bg-slate-200';
    if (btnDashboard) btnDashboard.className = 'px-4 py-2 rounded-lg bg-slate-200';
    if (btnSettings) btnSettings.className = 'px-4 py-2 rounded-lg bg-slate-200';
    
    // 모든 뷰 숨기기
    dailyView.classList.add('hidden');
    reportView.classList.add('hidden');
    if (searchView) searchView.classList.add('hidden');
    if (dashboardView) dashboardView.classList.add('hidden');
    if (settingsView) settingsView.classList.add('hidden');
    
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
    }
}

// ============================================================================
// 날짜 관리
// ============================================================================

function updateDateInput() {
    if (!currentDate) {
        currentDate = new Date();
    }
    const dateStr = formatDateForInput(currentDate);
    const dateInput = document.getElementById('dateInput');
    if (dateInput) {
        dateInput.value = dateStr;
    }
}

function formatDateForInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function changeDate(days) {
    currentDate.setDate(currentDate.getDate() + days);
    updateDateInput();
    loadWorkRecords();
}

function onDateChange() {
    const dateInput = document.getElementById('dateInput');
    if (dateInput && dateInput.value) {
        currentDate = new Date(dateInput.value + 'T00:00:00');
        loadWorkRecords();
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
    const statusTab = document.getElementById('statusSearchTab');
    const workTab = document.getElementById('workSearchTab');
    const btnStatus = document.getElementById('btnSearchStatus');
    const btnWork = document.getElementById('btnSearchWork');

    if (tab === 'status') {
        statusTab.classList.remove('hidden');
        workTab.classList.add('hidden');
        btnStatus.classList.remove('bg-slate-200');
        btnStatus.classList.add('bg-blue-600', 'text-white');
        btnWork.classList.remove('bg-blue-600', 'text-white');
        btnWork.classList.add('bg-slate-200');
    } else if (tab === 'work') {
        statusTab.classList.add('hidden');
        workTab.classList.remove('hidden');
        btnStatus.classList.remove('bg-blue-600', 'text-white');
        btnStatus.classList.add('bg-slate-200');
        btnWork.classList.remove('bg-slate-200');
        btnWork.classList.add('bg-blue-600', 'text-white');
    }
}

// ============================================================================
// 조회 탭 초기 기본값: DB 최신 계약번호 설정
// ============================================================================

async function initSearchTabDefaults() {
    try {
        const latest = await eel.get_latest_contract_number()();
        if (latest) {
            const match = latest.match(/^SH-(\d{4})-(\d{3})-T$/i);
            if (match) {
                const yearEl = document.getElementById('contractYear');
                const seqEl = document.getElementById('contractSeq');
                if (yearEl) yearEl.value = match[1];
                if (seqEl) seqEl.value = match[2];
            }
        }
    } catch(e) {
        // 오류 시 기본값 유지
    }
}

// ============================================================================
// 차트/보드 → 현황 조회 이동 (더블클릭)
// ============================================================================

function navigateToSearch(contractNumber) {
    if (!contractNumber) return;
    // 1. 조회 탭으로 이동
    showView('search');
    // 2. 현황 조회 서브탭 활성화
    showSearchTab('status');
    // 3. 계약번호 파싱 (SH-YYYY-NNN-T)
    const match = contractNumber.match(/^SH-(\d{4})-(\d{3})-T$/);
    if (match) {
        document.getElementById('contractYear').value = match[1];
        document.getElementById('contractSeq').value = match[2];
    }
    // 4. 자동 검색
    searchByContract();
}

// ============================================================================
// 대시보드 탭 전환
// ============================================================================

function showDashboardTab(tab) {
    const chartTab = document.getElementById('chartTab');
    const boardTab = document.getElementById('boardTab');
    const btnChart = document.getElementById('btnDashboardChart');
    const btnBoard = document.getElementById('btnDashboardBoard');

    if (tab === 'chart') {
        chartTab.classList.remove('hidden');
        boardTab.classList.add('hidden');
        btnChart.classList.remove('bg-slate-200');
        btnChart.classList.add('bg-blue-600', 'text-white');
        btnBoard.classList.remove('bg-blue-600', 'text-white');
        btnBoard.classList.add('bg-slate-200');
        loadGanttChart();
    } else if (tab === 'board') {
        chartTab.classList.add('hidden');
        boardTab.classList.remove('hidden');
        btnChart.classList.remove('bg-blue-600', 'text-white');
        btnChart.classList.add('bg-slate-200');
        btnBoard.classList.remove('bg-slate-200');
        btnBoard.classList.add('bg-blue-600', 'text-white');
        loadKanbanBoard();
    }
}

// ============================================================================
// 한국 공휴일 데이터 (config/holidays.json 에서 동적 로드)
// ============================================================================

let KOREAN_HOLIDAYS = {};

async function loadHolidays() {
    try {
        const data = await eel.get_holidays()();
        if (data && typeof data === 'object') {
            KOREAN_HOLIDAYS = data;
        }
    } catch (e) {
        console.warn('공휴일 데이터 로드 실패, 빈 데이터로 진행:', e);
    }
}

// ============================================================================
// 간트 차트
// ============================================================================

let ganttYear = new Date().getFullYear();
let ganttMonth = new Date().getMonth() + 1;

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

async function loadGanttChart() {
    try {
        // 월 표시 업데이트
        const display = document.getElementById('ganttMonthDisplay');
        if (display) display.textContent = `${ganttYear}년 ${ganttMonth}월`;

        const projects = await eel.get_gantt_data(ganttYear, ganttMonth)();
        const table = document.getElementById('ganttTable');
        const emptyDiv = document.getElementById('ganttEmpty');

        if (!projects || projects.length === 0) {
            table.innerHTML = '';
            if (emptyDiv) emptyDiv.classList.remove('hidden');
            return;
        }
        if (emptyDiv) emptyDiv.classList.add('hidden');

        // 해당 월 일수 계산
        const daysInMonth = new Date(ganttYear, ganttMonth, 0).getDate();
        const weekdays = ['일', '월', '화', '수', '목', '금', '토'];

        // 테이블 생성
        let html = '<thead>';

        // 1행: 날짜
        html += '<tr class="bg-slate-50">';
        html += '<th rowspan="2" class="border p-2 text-center bg-slate-100 sticky left-0 z-10 min-w-32">선사/선명</th>';
        html += '<th rowspan="2" class="border p-2 text-center bg-slate-100 min-w-28">작업내용</th>';
        html += '<th rowspan="2" class="border p-2 text-center bg-slate-100 min-w-20">기간</th>';

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(ganttYear, ganttMonth - 1, day);
            const dow = date.getDay(); // 0=일, 6=토
            const dateStr = `${ganttYear}-${String(ganttMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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
            const date = new Date(ganttYear, ganttMonth - 1, day);
            const dow = date.getDay();
            const dateStr = `${ganttYear}-${String(ganttMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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
            // 공휴일이면 공휴일명 첫 글자 표시
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

            html += `<tr class="hover:bg-slate-50 cursor-pointer" ondblclick="navigateToSearch('${safeCn}')">`;
            // 고정 열
            html += `<td class="border p-2 text-xs sticky left-0 bg-white z-10 whitespace-nowrap">
                <div class="font-semibold">${escapeHtml(project.company || '')}</div>
                <div class="text-slate-500">${escapeHtml(project.shipName || '')}</div>
            </td>`;

            // 작업내용 (엔진모델 + 작업내용)
            let workDesc = '';
            if (project.engineModel && project.workContent) {
                workDesc = `${project.engineModel} ${project.workContent}`;
            } else {
                workDesc = project.engineModel || project.workContent || '';
            }
            html += `<td class="border p-2 text-xs">${escapeHtml(workDesc)}</td>`;

            // 기간
            html += `<td class="border p-2 text-xs text-center whitespace-nowrap">${project.startMD}~${project.endMD}</td>`;

            // 날짜 셀
            for (let day = 1; day <= daysInMonth; day++) {
                const dateStr = `${ganttYear}-${String(ganttMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const isWorkDate = workDatesSet.has(dateStr);

                // 프로젝트 기간 내인지 확인
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
        html += '</tbody>';

        table.innerHTML = html;

    } catch (error) {
        console.error('간트 차트 로드 실패:', error);
    }
}

// ============================================================================
// 칸반 보드
// ============================================================================

async function loadKanbanBoard() {
    try {
        const data = await eel.get_kanban_data()();

        const receptionCards = document.getElementById('receptionCards');
        const startedCards = document.getElementById('startedCards');
        const doneCards = document.getElementById('doneCards');
        const archiveCards = document.getElementById('archiveCards');
        const receptionCount = document.getElementById('receptionCount');
        const startedCount = document.getElementById('startedCount');
        const doneCount = document.getElementById('doneCount');
        const archiveCount = document.getElementById('archiveCount');

        if (!receptionCards || !startedCards || !doneCards) return;

        receptionCards.innerHTML = '';
        startedCards.innerHTML = '';
        doneCards.innerHTML = '';
        if (archiveCards) archiveCards.innerHTML = '';

        if (receptionCount) receptionCount.textContent = (data.reception || []).length;
        if (startedCount) startedCount.textContent = (data.started || []).length;
        if (doneCount) doneCount.textContent = (data.done || []).length;
        if (archiveCount) archiveCount.textContent = (data.archive || []).length;

        // 접수 카드 렌더링 (계약번호 없음, board_projects 기반)
        function renderReceptionCard(project) {
            let workDesc = '';
            if (project.engineModel && project.workContent) {
                workDesc = `${project.engineModel} ${project.workContent}`;
            } else {
                workDesc = project.engineModel || project.workContent || '';
            }
            const safeCompany = escapeHtml(project.company || '');
            const safeShipName = escapeHtml(project.shipName || '');
            const safeTitle = escapeHtml(`${project.company || ''} ${project.shipName || ''}`);
            return `
                <div class="bg-white rounded-lg shadow-sm p-3 border-l-4 border-yellow-400 hover:shadow-md transition-shadow">
                    <div class="flex justify-between items-start">
                        <div class="font-bold text-sm">${safeCompany} ${safeShipName}</div>
                        <div class="flex gap-1">
                            <button onclick="promptStartProject(${project.id})" class="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200" title="착수 전환">착수 ▶</button>
                            <button onclick="deleteBoardProject(${project.id})" class="text-xs px-1 py-0.5 bg-red-100 text-red-600 rounded hover:bg-red-200" title="삭제">✕</button>
                        </div>
                    </div>
                    <div class="text-xs mt-1 text-slate-700">${escapeHtml(workDesc)}</div>
                    <div class="flex justify-between items-center mt-1">
                        <div class="text-xs text-slate-400">접수 대기</div>
                        <button onclick="event.stopPropagation(); openCommentModal('', ${project.id}, '${safeTitle}')" class="text-slate-400 hover:text-blue-500 text-sm" title="댓글">💬</button>
                    </div>
                </div>
            `;
        }

        // 착수/준공/아카이브 카드 렌더링
        function renderCard(project, borderColor) {
            let workDesc = '';
            if (project.engineModel && project.workContent) {
                workDesc = `${project.engineModel} ${project.workContent}`;
            } else {
                workDesc = project.engineModel || project.workContent || '';
            }
            const cn = project.contractNumber || '';
            const safeCn = escapeHtml(cn);
            const currentStatus = project.status || '';
            const safeCompany = escapeHtml(project.company || '');
            const safeShipName = escapeHtml(project.shipName || '');
            const safeTitle = escapeHtml(`${project.company || ''} ${project.shipName || ''}`);

            // 상태 드롭다운 옵션
            let statusSelect = '';
            if (currentStatus !== '아카이브') {
                statusSelect = `
                    <select onchange="changeKanbanStatus('${safeCn}', this.value)" class="text-xs border rounded px-1 py-0.5 bg-slate-50">
                        <option value="착수" ${currentStatus === '착수' ? 'selected' : ''}>착수</option>
                        <option value="준공" ${currentStatus === '준공' ? 'selected' : ''}>준공</option>
                    </select>`;
            }

            return `
                <div class="bg-white rounded-lg shadow-sm p-3 border-l-4 ${borderColor} hover:shadow-md transition-shadow cursor-pointer"
                     ondblclick="navigateToSearch('${safeCn}')">
                    <div class="flex justify-between items-start">
                        <div class="font-bold text-sm">${safeCompany} ${safeShipName}</div>
                        ${statusSelect}
                    </div>
                    <div class="text-xs text-slate-500 mt-0.5">${safeCn}</div>
                    <div class="text-xs mt-1 text-slate-700">${escapeHtml(workDesc)}</div>
                    <div class="flex justify-between mt-2 text-xs text-slate-500">
                        <span>${escapeHtml(project.startMD || '')} ~ ${escapeHtml(project.endMD || '')}</span>
                        <span class="font-semibold text-blue-600">${project.totalManpower || 0}공</span>
                    </div>
                    <div class="flex justify-between items-center mt-1">
                        <div class="text-xs text-slate-400">${project.workDays || 0}일 작업</div>
                        <button onclick="event.stopPropagation(); openCommentModal('${safeCn}', null, '${safeTitle}')" class="text-slate-400 hover:text-blue-500 text-sm" title="댓글">💬</button>
                    </div>
                </div>
            `;
        }

        // 접수
        (data.reception || []).forEach(p => {
            receptionCards.innerHTML += renderReceptionCard(p);
        });
        // 착수
        (data.started || []).forEach(p => {
            startedCards.innerHTML += renderCard(p, 'border-blue-500');
        });
        // 준공
        (data.done || []).forEach(p => {
            doneCards.innerHTML += renderCard(p, 'border-green-500');
        });
        // 아카이브
        if (archiveCards) {
            (data.archive || []).forEach(p => {
                archiveCards.innerHTML += renderCard(p, 'border-slate-400');
            });
        }

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
    }
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
            loadKanbanBoard();
        }
    } catch (error) {
        console.error('상태 변경 실패:', error);
    }
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
    }
}

// ============================================================================
// 댓글 시스템
// ============================================================================

function openCommentModal(contractNumber, boardProjectId, title) {
    document.getElementById('commentContractNumber').value = contractNumber || '';
    document.getElementById('commentBoardProjectId').value = boardProjectId || '';
    document.getElementById('commentTitle').textContent = `💬 ${title || '프로젝트'} 댓글`;
    document.getElementById('commentInput').value = '';
    document.getElementById('commentReplyToId').value = '';
    document.getElementById('replyIndicator').classList.add('hidden');
    document.getElementById('commentModal').classList.remove('hidden');
    loadComments();
}

function closeCommentModal() {
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
    const userId = currentUser ? currentUser.user_id : '';
    const isOwner = comment.userId === userId;
    const indent = isReply ? 'ml-6 border-l-2 border-slate-200 pl-3' : '';
    const time = comment.createdAt ? formatCommentTime(comment.createdAt) : '';
    const safeUserName = escapeHtml(comment.userName || '익명');

    let actions = `<button onclick="setReplyTo(${comment.id}, ${JSON.stringify(safeUserName)})" class="text-xs text-blue-500 hover:text-blue-700">답글</button>`;
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
    div.textContent = text;
    return div.innerHTML;
}

function setReplyTo(commentId, userName) {
    document.getElementById('commentReplyToId').value = commentId;
    document.getElementById('replyToName').textContent = userName;
    document.getElementById('replyIndicator').classList.remove('hidden');
    document.getElementById('commentInput').focus();
}

function cancelReply() {
    document.getElementById('commentReplyToId').value = '';
    document.getElementById('replyIndicator').classList.add('hidden');
}

async function submitComment() {
    const input = document.getElementById('commentInput');
    const content = input.value.trim();
    if (!content) return;

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
            loadComments();
        } else {
            showCustomAlert('오류', result.message, 'error');
        }
    } catch (error) {
        console.error('댓글 등록 실패:', error);
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

async function calculateManpowerInstant(index) {
    const leader = workRecords[index].leader || '';
    const teammates = workRecords[index].teammates || '';
    
    let manpower = 0;
    
    // 작업자
    if (leader.trim()) {
        const hasItalic = leader.includes('<i>') || leader.includes('</i>');
        manpower += hasItalic ? 0.5 : 1;
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
                    const hasItalic = name.includes('<i>') || name.includes('</i>');
                    manpower += hasItalic ? 0.5 : 1;
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
                const hasItalic = name.includes('<i>') || name.includes('</i>');
                manpower += hasItalic ? 0.5 : 1;
            }
        });
    }
    
    workRecords[index].manpower = manpower;
    updateManpowerDisplay(index, manpower);
}

function updateManpowerDisplay(index, manpower) {
    const tbody = document.getElementById('workRecordsTable');
    if (tbody && tbody.rows[index]) {
        const manpowerCell = tbody.rows[index].cells[8];
        if (manpowerCell) {
            manpowerCell.textContent = manpower > 0 ? manpower : '';
        }
    }
    updateTotalManpower();
}

function updateTotalManpower() {
    const total = workRecords.reduce((sum, record) => sum + (record.manpower || 0), 0);
    const tbody = document.getElementById('workRecordsTable');
    if (tbody && tbody.rows.length > 0) {
        const lastRow = tbody.rows[tbody.rows.length - 1];
        if (lastRow && lastRow.cells.length > 8) {
            lastRow.cells[8].textContent = total;
        }
    }
}

// ============================================================================
// 데이터 관리
// ============================================================================

function updateVacation(category, value) {
    vacationData[category] = value;
}

async function loadWorkRecords() {
    try {
        const dateStr = formatDateForInput(currentDate);
        showLoading(true);
        
        const records = await eel.load_work_records(dateStr)();
        workRecords = records || [];

        renderTable();

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
    } catch (error) {
        console.error('데이터 로드 오류:', error);
        alert('데이터 로드 중 오류가 발생했습니다.');
        showLoading(false);
    }
}

async function saveWorkRecords() {
    try {
        if (!currentUser || !currentUser.full_name) {
            showCustomAlert('오류', '로그인 정보가 없습니다.', 'error');
            return;
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
            showCustomAlert('성공', '저장되었습니다.', 'success');
            // 저장 후 재로드 제거 (이미 workRecords 배열에 저장됨)
        } else {
            showCustomAlert('실패', '저장 실패: ' + result.message, 'error');
        }
    } catch (error) {
        console.error('저장 오류:', error);
        showLoading(false);
        showCustomAlert('오류', '저장 중 오류가 발생했습니다.', 'error');
    }
}

async function loadYesterdayRecords() {
    try {
        const dateStr = formatDateForInput(currentDate);
        showLoading(true);
        
        const records = await eel.load_yesterday_records(dateStr)();
        workRecords = records || [];
        
        renderTable();
        showLoading(false);
        
        alert('어제 작업을 불러왔습니다.');
    } catch (error) {
        console.error('어제 작업 로드 오류:', error);
        alert('어제 작업 로드 중 오류가 발생했습니다.');
        showLoading(false);
    }
}

// ============================================================================
// 테이블 렌더링
// ============================================================================

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
        const row = createTableRow(record, index);
        tbody.appendChild(row);
        totalManpower += record.manpower || 0;
    });
    
    const totalRow = createTotalRow(totalManpower);
    tbody.appendChild(totalRow);
    
    setupKeyboardListeners();
}

function createTableRow(record, index) {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-blue-50';

    const displayLeader = (record.leader || '').replace(/<i>/g, '*').replace(/<\/i>/g, '*');
    const displayTeammates = (record.teammates || '').replace(/<i>/g, '*').replace(/<\/i>/g, '*');

    // value를 비워두고 innerHTML 생성 (특수문자 깨짐 방지)
    tr.innerHTML = `
        <td class="border p-2 text-center">${index + 1}</td>
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

    return tr;
}

function createTotalRow(totalManpower) {
    const tr = document.createElement('tr');
    tr.className = 'bg-green-100 font-bold';
    
    tr.innerHTML = `
        <td colspan="8" class="border p-3 text-right text-lg">총 인원</td>
        <td class="border p-3 text-center text-blue-600 text-xl">${totalManpower}</td>
        <td class="border p-3 text-center">저장</td>
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

function autoExpandContractNumber(index, input) {
    const val = input.value.trim();
    if (/^\d{1,3}$/.test(val)) {  // 숫자 1~3자리만 입력 → 올해 기준 자동 완성
        const currentYear = new Date().getFullYear();
        const padded = val.padStart(3, '0');
        const expanded = `SH-${currentYear}-${padded}-T`;
        input.value = expanded;
        updateRecord(index, 'contractNumber', expanded);
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
    const displayValue = input.value;
    const storedValue = displayValue.replace(/\*(.*?)\*/g, '<i>$1</i>');
    updateRecord(index, 'teammates', storedValue);
    calculateManpowerInstant(index);
}

// ============================================================================
// 키보드 이벤트 (Ctrl+I)
// ============================================================================

function setupKeyboardListeners() {
    const leaderInputs = document.querySelectorAll('[id^="leader_"]');
    const teammatesInputs = document.querySelectorAll('[id^="teammates_"]');
    
    [...leaderInputs, ...teammatesInputs].forEach(input => {
        input.removeEventListener('keydown', handleItalicShortcut);
        input.addEventListener('keydown', handleItalicShortcut);
    });
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
    if (workRecords[index]) {
        workRecords[index][field] = value;
    }
}

// ============================================================================
// Excel 내보내기
// ============================================================================

async function exportToExcel() {
    try {
        const dateStr = formatDateForInput(currentDate);
        showLoading(true);
        
        const result = await eel.export_to_excel(dateStr)();
        
        if (result.success) {
            alert('Excel 파일이 저장되었습니다.\n위치: ' + result.path);
        } else {
            alert('Excel 내보내기 실패: ' + result.message);
        }
        
        showLoading(false);
    } catch (error) {
        console.error('Excel 내보내기 오류:', error);
        alert('Excel 내보내기 중 오류가 발생했습니다.');
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
    messageEl.textContent = message;
    
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
        el.value = String((parseInt(el.value) || 2025) + delta);
    } else if (part === 'seq') {
        const el = document.getElementById('contractSeq');
        let val = (parseInt(el.value) || 1) + delta;
        if (val < 1) val = 1;
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

function toggleOutsourceDetail(company) {
    const el = document.getElementById('outsource-detail-' + company);
    if (el) {
        el.classList.toggle('hidden');
    }
}

function renderSearchResults(records, container, searchTerm, searchType) {
    if (!records || records.length === 0) {
        container.innerHTML = `<p class="text-slate-500">${searchType} "${searchTerm}"에 대한 작업 내역이 없습니다.</p>`;
        return;
    }

    // 총 인원 합계
    const totalManpower = records.reduce((sum, r) => sum + (r.manpower || 0), 0);

    // 외주 업체별 공수 집계 (인원별 상세 포함)
    const outsourceMap = calculateOutsourceManpower(records);
    const outsourceEntries = Object.entries(outsourceMap);

    let outsourceHtml = '';
    if (outsourceEntries.length > 0) {
        const outsourceItems = outsourceEntries.map(([company, data]) =>
            `<span class="font-semibold text-orange-600 cursor-pointer hover:underline" onclick="toggleOutsourceDetail('${company}')">${company}</span>: ${data.total}공`
        ).join(' &nbsp;|&nbsp; ');

        const detailSections = outsourceEntries.map(([company, data]) => {
            const personItems = Object.entries(data.persons)
                .sort((a, b) => b[1] - a[1])
                .map(([name, count]) => `<span class="text-slate-700">${name} <b class="text-orange-600">${count}공</b></span>`)
                .join(', ');
            return `<div id="outsource-detail-${company}" class="hidden ml-6 mb-1 text-xs text-slate-500">
                └ <span class="font-semibold">${company}</span> 상세: ${personItems}
            </div>`;
        }).join('');

        outsourceHtml = `
        <div class="mb-1 text-sm text-slate-600 flex items-center gap-2">
            <span class="bg-orange-100 text-orange-700 px-2 py-0.5 rounded font-semibold text-xs">외주 공수</span>
            ${outsourceItems}
            <span class="text-xs text-slate-400">(클릭하면 상세)</span>
        </div>
        ${detailSections}`;
    }

    let html = `
        <div class="mb-1 text-sm text-slate-600">
            <span class="font-semibold">${searchType}: ${searchTerm}</span> |
            총 <span class="font-semibold text-blue-600">${records.length}</span>건 |
            총 인원 <span class="font-semibold text-blue-600">${totalManpower.toFixed(1)}</span>공
        </div>
        ${outsourceHtml}
        <div class="overflow-x-auto">
            <table class="w-full border-collapse border">
                <thead>
                    <tr class="bg-indigo-100">
                        <th class="border p-2 text-center w-24">작업일</th>
                        <th class="border p-2 text-center w-20">선사</th>
                        <th class="border p-2 text-center w-20">선명</th>
                        <th class="border p-2 text-center w-28">엔진모델</th>
                        <th class="border p-2 text-center">작업내용</th>
                        <th class="border p-2 text-center w-24">작업자</th>
                        <th class="border p-2 text-center w-12">인원</th>
                        <th class="border p-2 text-center">동반자</th>
                    </tr>
                </thead>
                <tbody>`;

    records.forEach(record => {
        // 날짜 포맷: YYYY-MM-DD → M/D
        let dateDisplay = record.date || '';
        if (dateDisplay) {
            const d = new Date(dateDisplay + 'T00:00:00');
            dateDisplay = `${d.getMonth() + 1}/${d.getDate()}`;
        }

        // 기울임체 태그 제거 후 XSS 방어
        const leader = escapeHtml((record.leader || '-').replace(/<i>/g, '').replace(/<\/i>/g, ''));
        const teammates = escapeHtml((record.teammates || '-').replace(/<i>/g, '').replace(/<\/i>/g, ''));

        html += `
                    <tr class="hover:bg-blue-50">
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

    html += `
                </tbody>
            </table>
        </div>`;

    container.innerHTML = html;
}

// ============================================================================
// 사용자 설정
// ============================================================================

function loadUserSettings() {
    // 현재 사용자의 기본 화면 설정 로드
    const defaultView = currentUser.default_view || 'dashboard';
    const selectEl = document.getElementById('defaultViewSelect');
    if (selectEl) {
        selectEl.value = defaultView;
    }
    // 텔레그램 연결 상태 로드
    loadTelegramStatus();
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

        if (!botStatus.enabled) {
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
            const deepLink = document.getElementById('telegramDeepLink');
            if (result.deepLink) {
                deepLink.href = result.deepLink;
                deepLink.textContent = `텔레그램에서 연결하기 (코드: ${result.code})`;
            } else {
                deepLink.href = '#';
                deepLink.textContent = `코드: ${result.code} (봇에게 /start ${result.code} 전송)`;
            }
        } else {
            showCustomAlert('오류', result.message || '코드 생성 실패', 'error');
        }
    } catch (error) {
        console.error('텔레그램 코드 생성 오류:', error);
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

async function saveUserSettings() {
    const selectEl = document.getElementById('defaultViewSelect');
    if (!selectEl) return;
    
    const defaultView = selectEl.value;
    
    try {
        showLoading(true, '설정 저장 중...');
        
        // localStorage에 저장
        currentUser.default_view = defaultView;
        localStorage.setItem('userDefaultView', defaultView);
        
        showLoading(false);
        showCustomAlert('성공', '기본 화면이 설정되었습니다.', 'success');
    } catch (error) {
        showLoading(false);
        showCustomAlert('오류', '설정 저장에 실패했습니다: ' + error.message, 'error');
    }
}
