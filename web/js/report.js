
// ========================================
// 직급 제거 헬퍼
// ========================================

const _REPORT_RANKS = [
    '사장', '부사장', '전무', '상무', '이사',
    '부장', '차장', '과장', '대리', '주임', '사원',
    '팀장', '반장', '수석', '선임', '책임', '연구원', '기사'
];

function stripRank(name) {
    // HTML 태그 및 * 제거
    let n = name.replace(/<[^>]+>/g, '').replace(/\*/g, '').trim();
    // 앞 직급: '과장 홍길동' → '홍길동'
    for (const rank of _REPORT_RANKS) {
        if (n.startsWith(rank) && n.length > rank.length) {
            const candidate = n.slice(rank.length).trim();
            if (candidate) { n = candidate; break; }
        }
    }
    // 뒤 직급: '홍길동 과장' → '홍길동'
    for (const rank of _REPORT_RANKS) {
        if (n.endsWith(rank) && n.length > rank.length) {
            const candidate = n.slice(0, n.length - rank.length).trim();
            if (candidate) { n = candidate; break; }
        }
    }
    return n;
}

// ========================================
// 본사/외주 분리 함수
// ========================================

function separateWorkers(leader, teammates) {
    const inHouseList = [];
    const outsourcedList = [];

    // 작업자(팀장) 처리 — 직급 제거 후 이름만
    if (leader && leader.trim()) {
        const cleanLeader = stripRank(leader);
        if (cleanLeader) {
            inHouseList.push(cleanLeader);
        }
    }

    // 동반자 처리
    if (teammates && teammates.trim()) {
        let remaining = teammates;

        // 1. 도급 패턴 추출: 업체명(직원명들) — 원문 그대로
        const contractRegex = /([^,]+?)\(([^)]+)\)/g;
        let match;
        while ((match = contractRegex.exec(teammates)) !== null) {
            const fullMatch = match[0].trim().replace(/<i>/gi, '').replace(/<\/i>/gi, '').replace(/\*/g, ''); // "업체명(직원명들)"
            if (fullMatch) {
                outsourcedList.push(fullMatch);
            }
            // 해당 부분을 remaining에서 제거
            remaining = remaining.replace(match[0], '');
        }

        // 2. 일당 패턴 추출: 업체명[직원명들] — 원문 그대로
        const dailyRegex = /([^,]+?)\[([^\]]+)\]/g;
        while ((match = dailyRegex.exec(remaining)) !== null) {
            const fullMatch = match[0].trim().replace(/<i>/gi, '').replace(/<\/i>/gi, '').replace(/\*/g, ''); // "업체명[직원명들]"
            if (fullMatch) {
                outsourcedList.push(fullMatch);
            }
            // 해당 부분을 remaining에서 제거
            remaining = remaining.replace(match[0], '');
        }

        // 3. 남은 부분에서 본사 직원 추출 — 직급 제거 후 이름만
        const parts = remaining.split(',').map(p => p.trim()).filter(p => p && p.length > 0);
        parts.forEach(part => {
            const cleanName = stripRank(part);
            if (cleanName) {
                inHouseList.push(cleanName);
            }
        });
    }

    return {
        inHouse: inHouseList.length > 0 ? inHouseList.join(', ') : '-',
        outsourced: outsourcedList.length > 0 ? outsourcedList.join(', ') : '-'
    };
}

// ========================================
// 보고서 탭 전환
// ========================================

function showReportTab(tab) {
    const tabs = {
        daily:   document.getElementById('dailyReportTab'),
        night:   document.getElementById('nightReportTab'),
        holiday: document.getElementById('holidayReportTab'),
        monthly: document.getElementById('monthlyReportTab'),
    };
    const btns = {
        daily:   document.getElementById('btnReportDaily'),
        night:   document.getElementById('btnReportNight'),
        holiday: document.getElementById('btnReportHoliday'),
        monthly: document.getElementById('btnReportMonthly'),
    };

    // 모든 탭 숨기고 버튼 초기화
    Object.entries(tabs).forEach(([key, el]) => {
        if (!el) return;
        if (key === tab) el.classList.remove('hidden');
        else el.classList.add('hidden');
    });
    Object.entries(btns).forEach(([key, el]) => {
        if (!el) return;
        if (key === tab) {
            el.classList.remove('bg-slate-200');
            el.classList.add('bg-blue-600', 'text-white');
        } else {
            el.classList.remove('bg-blue-600', 'text-white');
            el.classList.add('bg-slate-200');
        }
    });

    const todayStr = (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    })();

    if (tab === 'daily') {
        const reportDate = document.getElementById('reportDate');
        if (reportDate && !reportDate.value) reportDate.value = todayStr;
        loadDailyReport();
    } else if (tab === 'night') {
        const nightDate = document.getElementById('nightReportDate');
        if (nightDate && !nightDate.value) nightDate.value = todayStr;
        loadNightReport();
    } else if (tab === 'holiday') {
        const holidayInput = document.getElementById('holidayPeriodInput');
        if (holidayInput && !holidayInput.value) {
            // 기본값: 가장 가까운 이전 금요일
            eel.get_latest_friday()().then(fri => {
                if (fri) { holidayInput.value = fri; loadHolidayReport(); }
            }).catch(() => { holidayInput.value = todayStr; });
        } else {
            loadHolidayReport();
        }
    } else {
        const reportMonth = document.getElementById('reportMonth');
        if (reportMonth && !reportMonth.value) {
            const d = new Date();
            reportMonth.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        }
        loadMonthlyReport();
    }
}

// ========================================
// 일일 보고 날짜 이동
// ========================================

function changeReportDate(days) {
    const reportDate = document.getElementById('reportDate');
    if (!reportDate.value) {
        const today = new Date();
        reportDate.value = today.toISOString().split('T')[0];
    }
    const current = new Date(reportDate.value + 'T00:00:00');
    current.setDate(current.getDate() + days);
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    reportDate.value = `${year}-${month}-${day}`;
    loadDailyReport();
}

function onReportDateChange() {
    loadDailyReport();
}

function setupReportDateWheelNavigation() {
    const reportDate = document.getElementById('reportDate');
    if (reportDate) {
        reportDate.addEventListener('wheel', function(e) {
            e.preventDefault();
            if (e.deltaY < 0) {
                changeReportDate(1);  // 휠 위 = 다음날
            } else if (e.deltaY > 0) {
                changeReportDate(-1); // 휠 아래 = 이전날
            }
        }, { passive: false });
    }
}

// 초기화 시 호출
document.addEventListener('DOMContentLoaded', function() {
    setupReportDateWheelNavigation();
});

// ========================================
// 일일 보고 로드
// ========================================

async function loadDailyReport() {
    const reportDate = document.getElementById('reportDate').value;
    if (!reportDate) {
        showCustomAlert('알림', '날짜를 선택해주세요.', 'info');
        return;
    }

    try {
        const records = await eel.load_work_records(reportDate, 'day')();
        
        // 날짜 표시 업데이트
        const dateObj = new Date(reportDate);
        const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
        const weekday = weekdays[dateObj.getDay()];
        const year = dateObj.getFullYear();
        const month = dateObj.getMonth() + 1;
        const day = dateObj.getDate();
        
        document.getElementById('reportDateDisplay').textContent = 
            `${year}. ${month}월 ${day}일 (${weekday}) 현재`;
        
        // 테이블 생성
        const tbody = document.getElementById('dailyReportTable');
        tbody.innerHTML = '';
        
        // 빈 레코드 필터링 (camelCase/snake_case 모두 지원)
        const validRecords = records.filter(record =>
            record.company || record.shipName || record.ship_name ||
            record.workContent || record.work_content
        );

        // 계약번호 오름차순 정렬 (없는 레코드는 맨 뒤)
        validRecords.sort((a, b) => {
            const cnA = (a.contract_number || a.contractNumber || '').trim();
            const cnB = (b.contract_number || b.contractNumber || '').trim();
            if (!cnA && !cnB) return 0;
            if (!cnA) return 1;
            if (!cnB) return -1;
            return cnA.localeCompare(cnB, 'ko');
        });
        
        if (validRecords.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="border border-gray-900 p-4 text-center text-slate-500">작업 내역이 없습니다.</td></tr>';
            return;
        }
        
        // 계약번호/선박명 수집 후 단일 배치 조회 (N+1 방지, Set으로 O(n) 중복 제거)
        const batchCnsSet = new Set();
        const batchSnsSet = new Set();
        validRecords.forEach(record => {
            const cn = (record.contract_number || record.contractNumber || '').trim();
            const sn = (record.ship_name || record.shipName || '').trim();
            if (cn) batchCnsSet.add(cn);
            else if (sn) batchSnsSet.add(sn);
        });
        const projectDates = await eel.get_project_start_dates_batch(
            Array.from(batchCnsSet),
            Array.from(batchSnsSet)
        )() || {};

        // 보고일 (현재 선택한 날짜) — 제로패딩 적용 (03/05 형식)
        const reportMonth = String(dateObj.getMonth() + 1).padStart(2, '0');
        const reportDay   = String(dateObj.getDate()).padStart(2, '0');
        const reportDateStr = `${reportMonth}/${reportDay}`;
        
        validRecords.forEach((record, index) => {
            // 담당공무(본사)와 협력업체(외주) 분리
            const { inHouse, outsourced } = separateWorkers(record.leader, record.teammates);
            
            // Python에서 snake_case로 오기 때문에 둘 다 지원
            const shipName = record.ship_name || record.shipName || '-';
            const engineModel = record.engine_model || record.engineModel || '';
            const workContent = record.work_content || record.workContent || '';
            
            // 공사기간: "시작일 ~ 보고일" 형식 (오늘 날짜면 "진행중" 표시)
            const contractNumber = record.contract_number || record.contractNumber || '';
            const key = contractNumber || shipName;
            const startDate = projectDates[key];
            const todayStr = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"
            const endDisplay = (reportDate === todayStr) ? '진행중' : reportDateStr;
            const projectPeriod = startDate ? `${startDate} ~ ${endDisplay}` : endDisplay;
            
            // 작업내용: "엔진모델 + 작업내용"
            let fullWorkContent = '';
            if (engineModel && workContent) {
                fullWorkContent = `${engineModel} ${workContent}`;
            } else if (engineModel) {
                fullWorkContent = engineModel;
            } else if (workContent) {
                fullWorkContent = workContent;
            } else {
                fullWorkContent = '-';
            }
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="border border-gray-900 p-2 text-center whitespace-nowrap">${index + 1}</td>
                <td class="border border-gray-900 p-2 text-center break-keep">${escapeHtml(record.company || '-')}</td>
                <td class="border border-gray-900 p-2 text-center whitespace-nowrap">${escapeHtml(shipName)}</td>
                <td class="border border-gray-900 p-2 text-center whitespace-nowrap">${escapeHtml(projectPeriod)}</td>
                <td class="border border-gray-900 p-2 text-center whitespace-nowrap">${escapeHtml(record.location || '-')}</td>
                <td class="border border-gray-900 p-2 text-left break-keep">${escapeHtml(fullWorkContent)}</td>
                <td class="border border-gray-900 p-2 text-center break-keep">${escapeHtml(inHouse)}</td>
                <td class="border border-gray-900 p-2 text-center break-keep">${escapeHtml(outsourced)}</td>
            `;
            tbody.appendChild(row);
        });
        
    } catch (error) {
        console.error('일일 보고 로드 실패:', error);
        const dailyTbody = document.getElementById('dailyReportTable');
        if (dailyTbody) dailyTbody.innerHTML = '';
        showCustomAlert('오류', '데이터를 불러오는데 실패했습니다.', 'error');
    }
}

// ========================================
// 야간 보고 날짜 이동
// ========================================

function changeNightReportDate(days) {
    const el = document.getElementById('nightReportDate');
    if (!el || !el.value) return;
    const d = new Date(el.value + 'T00:00:00');
    d.setDate(d.getDate() + days);
    el.value = d.toISOString().split('T')[0];
    loadNightReport();
}

// ========================================
// 야간 보고 로드
// ========================================

// 야간 보고 — 기본 직원 명단 (부서·직책·이름 고정)
const _NIGHT_REPORT_DEFAULT_ROSTER = [
    { dept: '관리부', rank: '대리', name: '나은진' },
    { dept: '관리부', rank: '대리', name: '함선옥' },
    { dept: '관리부', rank: '주임', name: '최영금' },
    { dept: '자재부', rank: '과장', name: '전용준' },
    { dept: '자재부', rank: '대리', name: '유승주' },
    { dept: '자재부', rank: '대리', name: '김태성' },
    { dept: '자재부', rank: '대리', name: '임요섭' },
    { dept: '기술부', rank: '팀장', name: '이태욱' },
    { dept: '기술부', rank: '차장', name: '이주호' },
    { dept: '기술부', rank: '과장', name: '허종희' },
    { dept: '기술부', rank: '과장', name: '조기상' },
    { dept: '기술부', rank: '대리', name: '이원종' },
    { dept: '기술부', rank: '대리', name: '하영광' },
    { dept: '기술부', rank: '대리', name: '전정운' },
    { dept: '기술부', rank: '대리', name: '이성찬' },
    { dept: '기술부', rank: '사원', name: '박보성' },
    { dept: '기술부', rank: '사원', name: '반규석' },
    { dept: '기술부', rank: '사원', name: '백나자르' },
    { dept: '기술부', rank: '사원', name: '산자르백' },
    { dept: '기술부', rank: '사원', name: '지마' },
];

// 야간 보고 — 로컬 상태
let _nightReportEntries = [];

async function loadNightReport() {
    const dateEl = document.getElementById('nightReportDate');
    const dateStr = dateEl?.value;
    if (!dateStr) return;

    const dispEl = document.getElementById('nightReportDateDisplay');

    try {
        const records = await eel.load_work_records(dateStr, 'night')() || [];
        const validRecords = records.filter(r =>
            r.company || r.shipName || r.workContent || r.leader
        );

        const d = new Date(dateStr + 'T00:00:00');
        const days = ['일', '월', '화', '수', '목', '금', '토'];
        if (dispEl) dispEl.textContent = `${d.getMonth()+1}월 ${d.getDate()}일 (${days[d.getDay()]})`;

        // 날짜 헤더 2단: 하단에 "목(4/2)" 형식 표시
        const headerEl = document.getElementById('nightReportDateHeader');
        if (headerEl) headerEl.textContent = `${days[d.getDay()]}(${d.getMonth()+1}/${d.getDate()})`;

        // 항상 기본 명단으로 시작, 야근시간 기본값 '-'
        _nightReportEntries = _NIGHT_REPORT_DEFAULT_ROSTER.map(r => ({
            dept: r.dept, rank: r.rank, name: r.name,
            dateLabel: '-', workContent: ''
        }));

        // 작업 레코드가 있으면 이름 매핑으로 종료시간·작업내용 채우기
        if (validRecords.length > 0) {
            const nameWorkMap = new Map();
            validRecords.forEach(record => {
                const { inHouse, outsourced } = separateWorkers(record.leader, record.teammates);
                const workContent = [record.engineModel, record.workContent].filter(Boolean).join(' ');
                const endTime = record.endTime || '-';
                if (inHouse && inHouse !== '-') {
                    inHouse.split(',').map(n => n.trim()).filter(Boolean).forEach(name => {
                        nameWorkMap.set(stripRank(name), { workContent: workContent || record.shipName || '', endTime });
                    });
                }
                if (outsourced && outsourced !== '-') {
                    outsourced.split(',').map(n => n.trim()).filter(Boolean).forEach(name => {
                        nameWorkMap.set(name, { workContent: workContent || record.shipName || '', endTime });
                    });
                }
            });
            _nightReportEntries.forEach(entry => {
                const work = nameWorkMap.get(entry.name);
                if (work) { entry.dateLabel = work.endTime; entry.workContent = work.workContent; }
            });
            // 명단에 없는 외부 작업자 추가
            nameWorkMap.forEach((work, name) => {
                if (!_nightReportEntries.some(e => e.name === name)) {
                    _nightReportEntries.push({ dept: '외주', rank: '', name, dateLabel: work.endTime, workContent: work.workContent });
                }
            });
        }

        renderNightReportTable();
    } catch (e) {
        console.error('야간 보고 로드 실패:', e);
        _nightReportEntries = [];
        renderNightReportTable();
    }
}

function renderNightReportTable() {
    const tbody = document.getElementById('nightReportTable');
    const totalEl = document.getElementById('nightReportTotal');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (_nightReportEntries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="border border-gray-900 p-3 text-center text-slate-500">작업 내역이 없습니다.</td></tr>';
        if (totalEl) totalEl.textContent = '0';
        return;
    }

    // 부서 rowspan 계산 (같은 부서가 연속될 때 첫 행에 rowspan 적용)
    const deptSpans = [];
    for (let i = 0; i < _nightReportEntries.length; i++) {
        const dept = _nightReportEntries[i].dept || '';
        const prevDept = i > 0 ? (_nightReportEntries[i-1].dept || '') : null;
        if (dept !== '' && dept === prevDept) {
            deptSpans.push(0); // 이전 행과 같은 부서 → td 생략
        } else {
            let span = 1;
            if (dept !== '') {
                for (let j = i + 1; j < _nightReportEntries.length; j++) {
                    if ((_nightReportEntries[j].dept || '') === dept) span++;
                    else break;
                }
            }
            deptSpans.push(span);
        }
    }

    _nightReportEntries.forEach((entry, i) => {
        const isFirst = i === 0;
        const isLast = i === _nightReportEntries.length - 1;
        const tr = document.createElement('tr');

        const span = deptSpans[i];
        const deptCell = span > 0
            ? `<td class="border border-gray-900 p-2 text-center align-middle text-sm font-medium" rowspan="${span}">${escapeHtml(entry.dept||'')}</td>`
            : '';

        tr.innerHTML = `
            <td class="border border-gray-900 p-2 text-center">${i + 1}</td>
            ${deptCell}
            <td class="border border-gray-900 p-0">
                <input type="text" value="${escapeHtml(entry.rank||'')}" class="w-full px-1 py-1 border-0 focus:bg-yellow-50 text-sm text-center"
                       onchange="_updateNightEntry(${i},'rank',this.value)">
            </td>
            <td class="border border-gray-900 p-0">
                <input type="text" value="${escapeHtml(entry.name||'')}" class="w-full px-1 py-1 border-0 focus:bg-yellow-50 text-sm text-center"
                       onchange="_updateNightEntry(${i},'name',this.value)">
            </td>
            <td class="border border-gray-900 p-0 w-20" style="max-width:80px">
                <input type="text" value="${escapeHtml(entry.dateLabel||'')}" class="w-20 px-1 py-1 border-0 focus:bg-yellow-50 text-sm text-center"
                       onchange="_updateNightEntry(${i},'dateLabel',this.value)">
            </td>
            <td class="border border-gray-900 p-0">
                <input type="text" value="${escapeHtml(entry.workContent||'')}" class="w-full px-1 py-1 border-0 focus:bg-yellow-50 text-sm"
                       onchange="_updateNightEntry(${i},'workContent',this.value)">
            </td>
            <td class="border border-gray-900 p-1 text-center no-capture" style="white-space:nowrap">
                <button onclick="_moveNightRow(${i},-1)" ${isFirst ? 'disabled' : ''}
                        class="px-1 text-slate-500 hover:text-blue-600 disabled:opacity-30 text-xs">▲</button>
                <button onclick="_moveNightRow(${i},1)" ${isLast ? 'disabled' : ''}
                        class="px-1 text-slate-500 hover:text-blue-600 disabled:opacity-30 text-xs">▼</button>
                <button onclick="_deleteNightRow(${i})"
                        class="px-1 text-red-500 hover:bg-red-50 rounded text-xs">✕</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    if (totalEl) totalEl.textContent = _nightReportEntries.length;
}

function _updateNightEntry(index, field, value) {
    if (_nightReportEntries[index]) _nightReportEntries[index][field] = value;
}

function _deleteNightRow(index) {
    _nightReportEntries.splice(index, 1);
    renderNightReportTable();
}

function _moveNightRow(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= _nightReportEntries.length) return;
    [_nightReportEntries[index], _nightReportEntries[target]] = [_nightReportEntries[target], _nightReportEntries[index]];
    renderNightReportTable();
}

function addNightRow() {
    _nightReportEntries.push({ dept: '', rank: '', name: '', dateLabel: '-', workContent: '' });
    renderNightReportTable();
}

// ========================================
// 휴일 보고 — 로컬 상태
// ========================================

let _holidayEntries = [];
let _holidayPeriodDates = {};

async function loadHolidayReport() {
    const periodKey = document.getElementById('holidayPeriodInput')?.value;
    if (!periodKey) return;

    try {
        _holidayPeriodDates = await eel.get_holiday_period_dates(periodKey)() || {};
        _holidayEntries = await eel.load_holiday_work_entries(periodKey)() || [];

        // 저장된 엔트리가 없으면 전체 직원 목록으로 초기화
        if (_holidayEntries.length === 0) {
            const allNames = await eel.get_employee_names_for_leave()() || [];
            _holidayEntries = allNames.map(name => ({
                department: '', rank: '', name: name,
                friWork: '-', satWork: '-', sunWork: '-', workContent: ''
            }));
        }

        // 날짜 헤더 업데이트
        const thFri = document.getElementById('thFri');
        const thSat = document.getElementById('thSat');
        const thSun = document.getElementById('thSun');
        if (thFri) thFri.textContent = _holidayPeriodDates.friLabel || '금';
        if (thSat) thSat.textContent = _holidayPeriodDates.satLabel || '토';
        if (thSun) thSun.textContent = _holidayPeriodDates.sunLabel || '일';

        renderHolidayTable();
    } catch (e) {
        console.error('휴일 보고 로드 실패:', e);
    }
}

function renderHolidayTable() {
    const tbody = document.getElementById('holidayReportTable');
    const totalEl = document.getElementById('holidayReportTotal');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (_holidayEntries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="border border-gray-900 p-3 text-center text-slate-500">입력된 내역이 없습니다.</td></tr>';
        if (totalEl) totalEl.textContent = '0';
        return;
    }

    _holidayEntries.forEach((entry, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="border border-gray-900 p-2 text-center">${i + 1}</td>
            <td class="border border-gray-900 p-0">
                <input type="text" value="${escapeHtml(entry.department||'')}" class="w-full px-1 py-1 border-0 focus:bg-yellow-50 text-sm"
                       onchange="_updateHolidayEntry(${i},'department',this.value)">
            </td>
            <td class="border border-gray-900 p-0">
                <input type="text" value="${escapeHtml(entry.rank||'')}" class="w-full px-1 py-1 border-0 focus:bg-yellow-50 text-sm"
                       onchange="_updateHolidayEntry(${i},'rank',this.value)">
            </td>
            <td class="border border-gray-900 p-0">
                <input type="text" value="${escapeHtml(entry.name||'')}" class="w-full px-1 py-1 border-0 focus:bg-yellow-50 text-sm"
                       onchange="_updateHolidayEntry(${i},'name',this.value)">
            </td>
            <td class="border border-gray-900 p-0">
                <input type="text" value="${escapeHtml(entry.friWork||'-')}" class="w-20 px-1 py-1 border-0 focus:bg-yellow-50 text-sm text-center"
                       onchange="_updateHolidayEntry(${i},'friWork',this.value)">
            </td>
            <td class="border border-gray-900 p-0">
                <input type="text" value="${escapeHtml(entry.satWork||'-')}" class="w-20 px-1 py-1 border-0 focus:bg-yellow-50 text-sm text-center"
                       onchange="_updateHolidayEntry(${i},'satWork',this.value)">
            </td>
            <td class="border border-gray-900 p-0">
                <input type="text" value="${escapeHtml(entry.sunWork||'-')}" class="w-20 px-1 py-1 border-0 focus:bg-yellow-50 text-sm text-center"
                       onchange="_updateHolidayEntry(${i},'sunWork',this.value)">
            </td>
            <td class="border border-gray-900 p-0">
                <input type="text" value="${escapeHtml(entry.workContent||'')}" class="w-full px-1 py-1 border-0 focus:bg-yellow-50 text-sm"
                       onchange="_updateHolidayEntry(${i},'workContent',this.value)">
            </td>
            <td class="border border-gray-900 p-1 text-center no-capture" style="white-space:nowrap">
                <button onclick="_moveHolidayRow(${i},-1)" ${i === 0 ? 'disabled' : ''}
                        class="px-1 text-slate-500 hover:text-blue-600 disabled:opacity-30 text-xs">▲</button>
                <button onclick="_moveHolidayRow(${i},1)" ${i === _holidayEntries.length - 1 ? 'disabled' : ''}
                        class="px-1 text-slate-500 hover:text-blue-600 disabled:opacity-30 text-xs">▼</button>
                <button onclick="_deleteHolidayRow(${i})"
                        class="px-1 text-red-500 hover:bg-red-50 rounded text-xs">✕</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // 총 인원 = 행 수 (각 행 = 1인)
    if (totalEl) totalEl.textContent = _holidayEntries.length;
}

function _updateHolidayEntry(index, field, value) {
    if (_holidayEntries[index]) _holidayEntries[index][field] = value;
}

function _deleteHolidayRow(index) {
    _holidayEntries.splice(index, 1);
    renderHolidayTable();
}

function _moveHolidayRow(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= _holidayEntries.length) return;
    [_holidayEntries[index], _holidayEntries[target]] = [_holidayEntries[target], _holidayEntries[index]];
    renderHolidayTable();
}

function addHolidayRow() {
    _holidayEntries.push({
        department: '', rank: '', name: '',
        friWork: '-', satWork: '-', sunWork: '-', workContent: ''
    });
    renderHolidayTable();
}

async function saveHolidayEntries() {
    const periodKey = document.getElementById('holidayPeriodInput')?.value;
    if (!periodKey) { showCustomAlert('알림', '금요일 날짜를 선택하세요.', 'info'); return; }
    if (!window.currentUser?.full_name) { showCustomAlert('오류', '로그인 정보가 없습니다.', 'error'); return; }
    try {
        const result = await eel.save_holiday_work_entries(periodKey, _holidayEntries, currentUser.full_name)();
        if (result.success) showToast('휴일 작업 명단이 저장되었습니다.', 'success');
        else showCustomAlert('실패', result.message || '저장 실패', 'error');
    } catch (e) {
        console.error('휴일 저장 오류:', e);
        showCustomAlert('오류', '저장 중 오류가 발생했습니다.', 'error');
    }
}

// ========================================
// 월간 보고 로드
// ========================================

// ========================================
// 보고서 캡쳐 (클립보드에 이미지 복사)
// ========================================

async function captureReport(elementId) {
    const element = document.getElementById(elementId);
    if (!element) {
        showCustomAlert('오류', '캡쳐 대상을 찾을 수 없습니다.', 'error');
        return;
    }

    try {
        const canvas = await html2canvas(element, {
            backgroundColor: '#ffffff',
            scale: 2,
            useCORS: true,
            logging: false
        });

        canvas.toBlob(async (blob) => {
            try {
                await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                ]);
                showCustomAlert('성공', '클립보드에 이미지가 복사되었습니다.', 'success');
            } catch (clipError) {
                console.error('클립보드 복사 실패:', clipError);
                // 폴백: 다운로드로 대체
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `report_${new Date().toISOString().split('T')[0]}.png`;
                a.click();
                URL.revokeObjectURL(url);
                showCustomAlert('알림', '클립보드 복사가 지원되지 않아 파일로 다운로드됩니다.', 'info');
            }
        }, 'image/png');
    } catch (error) {
        console.error('캡쳐 실패:', error);
        showCustomAlert('오류', '캡쳐에 실패했습니다.', 'error');
    }
}

// ========================================
// 월간 보고 로드
// ========================================

async function loadMonthlyReport() {
    const reportMonthEl = document.getElementById('reportMonth');
    if (!reportMonthEl || !reportMonthEl.value) {
        showCustomAlert('오류', '월을 선택해주세요.', 'error');
        return;
    }
    const reportMonth = reportMonthEl.value;

    try {
        showLoading(true, '월간 보고 로드 중...');
        
        const [year, month] = reportMonth.split('-');

        // 월간 보고 제목 업데이트
        const monthlyTitleEl = document.getElementById('monthlyReportTitle');
        if (monthlyTitleEl) {
            monthlyTitleEl.textContent = `${parseInt(month)}월 월간 작업 현황`;
        }

        const monthlyData = await eel.load_monthly_report_grouped(parseInt(year), parseInt(month))();
        
        showLoading(false);
        
        // 테이블 생성
        const tbody = document.getElementById('monthlyReportTable');
        if (!tbody) {
            console.error('월간 보고 테이블을 찾을 수 없습니다.');
            return;
        }
        
        tbody.innerHTML = '';
        
        if (!monthlyData || monthlyData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="border border-gray-900 p-4 text-center text-slate-500">작업 내역이 없습니다.</td></tr>';
            return;
        }
        
        monthlyData.forEach((ship, index) => {
            // 본사/외주 분리
            const { inHouse, outsourced } = separateWorkers(ship.leader, ship.teammates);

            // 월간보고 전용: "홍길동 외 N명" 형식
            const inHouseNames = inHouse === '-' ? [] : inHouse.split(',').map(n => n.trim()).filter(n => n);
            const inHouseDisplay = inHouseNames.length === 0 ? '-'
                : inHouseNames.length === 1 ? inHouseNames[0]
                : `${inHouseNames[0]} 외 ${inHouseNames.length - 1}명`;

            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="border border-gray-900 p-2 text-center whitespace-nowrap">${index + 1}</td>
                <td class="border border-gray-900 p-2 text-center break-keep">${escapeHtml(ship.company || '-')}</td>
                <td class="border border-gray-900 p-2 text-center whitespace-nowrap">${escapeHtml(ship.ship_name || ship.shipName || '-')}</td>
                <td class="border border-gray-900 p-2 text-center whitespace-nowrap">${escapeHtml(ship.project_period || '-')}</td>
                <td class="border border-gray-900 p-2 text-center whitespace-nowrap">${escapeHtml(ship.location || '-')}</td>
                <td class="border border-gray-900 p-2 text-left break-keep">${escapeHtml(ship.work_content || ship.workContent || '-')}</td>
                <td class="border border-gray-900 p-2 text-center break-keep">${escapeHtml(inHouseDisplay)}</td>
                <td class="border border-gray-900 p-2 text-center break-keep">${escapeHtml(outsourced)}</td>
                <td class="border border-gray-900 p-2 text-center whitespace-nowrap">${(ship.total_manpower ?? 0).toFixed(1)}</td>
            `;
            tbody.appendChild(row);
        });
        
    } catch (error) {
        console.error('월간 보고 로드 실패:', error);
        showLoading(false);
        const monthlyTbody = document.getElementById('monthlyReportTable');
        if (monthlyTbody) monthlyTbody.innerHTML = '';
        showCustomAlert('오류', '데이터를 불러오는데 실패했습니다.', 'error');
    }
}


