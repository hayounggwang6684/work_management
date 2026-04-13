
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

function extractOutsourcedWorkerNames(teammates) {
    const names = [];
    const text = String(teammates || '').trim();
    if (!text) return names;

    const addNames = (blob) => {
        String(blob || '').split(',').forEach(part => {
            const cleanName = stripRank(part);
            if (cleanName) names.push(cleanName);
        });
    };

    const contractRegex = /([^,]+?)\(([^)]+)\)/g;
    let match;
    while ((match = contractRegex.exec(text)) !== null) {
        addNames(match[2]);
    }

    const dailyRegex = /([^,]+?)\[([^\]]+)\]/g;
    while ((match = dailyRegex.exec(text)) !== null) {
        addNames(match[2]);
    }

    return names;
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
    if (!reportDate?.value) {
        const today = new Date();
        reportDate.value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
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
    const reportDateEl = document.getElementById('reportDate');
    if (!reportDateEl) return;
    const reportDate = reportDateEl.value;
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
            const _tn = new Date();
            const todayStr = `${_tn.getFullYear()}-${String(_tn.getMonth()+1).padStart(2,'0')}-${String(_tn.getDate()).padStart(2,'0')}`;
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
            r.company || r.shipName || r.workContent || r.leader || r.teammates
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
            dateLabel: '-', workContent: '', shipName: ''
        }));

        // 작업 레코드가 있으면 이름 매핑으로 종료시간·작업내용 채우기
        if (validRecords.length > 0) {
            const nameWorkMap = new Map();
            validRecords.forEach(record => {
                const { inHouse } = separateWorkers(record.leader, record.teammates);
                const outsourcedNames = extractOutsourcedWorkerNames(record.teammates);
                const workContent = [record.engineModel, record.workContent].filter(Boolean).join(' ');
                const endTime = record.endTime || '-';
                const shipName = record.shipName || '';
                if (inHouse && inHouse !== '-') {
                    inHouse.split(',').map(n => n.trim()).filter(Boolean).forEach(name => {
                        nameWorkMap.set(stripRank(name), { workContent, shipName, endTime });
                    });
                }
                outsourcedNames.forEach(name => {
                    nameWorkMap.set(name, { workContent, shipName, endTime });
                });
            });
            _nightReportEntries.forEach(entry => {
                const work = nameWorkMap.get(entry.name);
                if (work) { entry.dateLabel = work.endTime; entry.workContent = work.workContent; entry.shipName = work.shipName || ''; }
            });
            // 명단에 없는 외부 작업자 추가
            nameWorkMap.forEach((work, name) => {
                if (!_nightReportEntries.some(e => e.name === name)) {
                    _nightReportEntries.push({ dept: '외주', rank: '', name, dateLabel: work.endTime, workContent: work.workContent, shipName: work.shipName || '' });
                }
            });
        }

        renderNightReportTable();
    } catch (e) {
        console.error('야간 보고 로드 실패:', e);
        _nightReportEntries = [];
        renderNightReportTable();
        showCustomAlert('오류', '야간 보고를 불러오지 못했습니다.', 'error');
    }
}

function renderNightReportTable() {
    const tbody = document.getElementById('nightReportTable');
    const totalEl = document.getElementById('nightReportTotal');
    const workingTotalEl = document.getElementById('nightReportWorkingTotal');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (_nightReportEntries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="border border-gray-900 p-3 text-center text-slate-500">작업 내역이 없습니다.</td></tr>';
        if (totalEl) totalEl.textContent = '0';
        if (workingTotalEl) workingTotalEl.textContent = '0';
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
            <td class="border border-gray-900 p-2 text-center text-sm text-blue-700 font-medium whitespace-nowrap w-20" style="max-width:80px">
                ${escapeHtml(entry.shipName || '-')}
            </td>
            <td class="border border-gray-900 p-0 align-top w-40" style="min-width:160px">
                <input type="text" value="${escapeHtml(entry.workContent||'')}" class="w-full px-1 py-1 border-0 focus:bg-yellow-50 text-sm text-center"
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

    const workingCount = _nightReportEntries.filter(entry => {
        const timeText = String(entry.dateLabel || '').trim();
        const shipText = String(entry.shipName || '').trim();
        const workText = String(entry.workContent || '').trim();
        return (timeText && timeText !== '-') || !!shipText || !!workText;
    }).length;

    if (totalEl) totalEl.textContent = _nightReportEntries.length;
    if (workingTotalEl) workingTotalEl.textContent = String(workingCount);
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
    _nightReportEntries.push({ dept: '', rank: '', name: '', dateLabel: '-', workContent: '', shipName: '' });
    renderNightReportTable();
}

// ========================================
// 휴일 보고 — 로컬 상태
// ========================================

let _holidayEntries = [];
let _holidayPeriodDates = {};

function _createHolidayDefaultEntry(base = {}) {
    return {
        department: base.dept || base.department || '',
        rank: base.rank || '',
        name: base.name || '',
        friWork: '-',
        satWork: '-',
        sunWork: '-',
        workContent: '',
        contractNumber: '',
        ownerCompany: '',
        vendorCompany: '',
        shipName: '',
    };
}

function _addHolidayMetaCandidate(metaMap, rawName, meta) {
    const cleanName = stripRank(String(rawName || '').replace(/\*/g, '').trim());
    if (!cleanName) return;
    const normalizedMeta = {
        contractNumber: String(meta.contractNumber || '').trim(),
        ownerCompany: String(meta.ownerCompany || '').trim(),
        vendorCompany: String(meta.vendorCompany || '').trim(),
        shipName: String(meta.shipName || '').trim(),
        workContent: String(meta.workContent || '').trim(),
        workerType: String(meta.workerType || '').trim(),
    };
    const signature = JSON.stringify(normalizedMeta);
    if (!metaMap.has(cleanName)) {
        metaMap.set(cleanName, new Map());
    }
    const candidateMap = metaMap.get(cleanName);
    if (!candidateMap.has(signature)) candidateMap.set(signature, normalizedMeta);
}

function _resolveHolidayMetaCandidate(metaMap, rawName) {
    const cleanName = stripRank(String(rawName || '').replace(/\*/g, '').trim());
    if (!cleanName || !metaMap.has(cleanName)) return null;
    const candidateMap = metaMap.get(cleanName);
    if (!candidateMap || candidateMap.size !== 1) return null;
    return [...candidateMap.values()][0];
}

function _buildHolidayMetaMapFromRecords(records) {
    const metaMap = new Map();
    (records || []).forEach(rec => {
        const contractNumber = rec.contractNumber || rec.contract_number || '';
        const shipName = rec.shipName || rec.ship_name || '';
        const ownerCompany = rec.company || '';
        const workContent = rec.workContent || rec.work_content || '';
        const leader = rec.leader || '';
        const teammates = rec.teammates || '';
        const inHouseMeta = {
            contractNumber,
            ownerCompany,
            vendorCompany: '',
            shipName,
            workContent,
            workerType: 'inhouse',
        };

        _addHolidayMetaCandidate(metaMap, leader, inHouseMeta);

        let remaining = teammates;
        const contractRegex = /([^,\[\]()\n]+?)\(([^)]+)\)/g;
        let match;
        while ((match = contractRegex.exec(teammates)) !== null) {
            const vendorCompany = match[1].replace(/<[^>]+>/g, '').replace(/\*/g, '').trim();
            match[2].split(',').forEach(name => {
                _addHolidayMetaCandidate(metaMap, name, {
                    contractNumber,
                    ownerCompany,
                    vendorCompany,
                    shipName,
                    workContent,
                    workerType: 'vendor',
                });
            });
            remaining = remaining.replace(match[0], '');
        }

        const dailyRegex = /([^,\[\]()\n]+?)\[([^\]]+)\]/g;
        while ((match = dailyRegex.exec(remaining)) !== null) {
            const vendorCompany = match[1].replace(/<[^>]+>/g, '').replace(/\*/g, '').trim();
            match[2].split(',').forEach(name => {
                _addHolidayMetaCandidate(metaMap, name, {
                    contractNumber,
                    ownerCompany,
                    vendorCompany,
                    shipName,
                    workContent,
                    workerType: 'vendor',
                });
            });
            remaining = remaining.replace(match[0], '');
        }

        remaining.split(',').forEach(name => {
            _addHolidayMetaCandidate(metaMap, name, inHouseMeta);
        });
    });
    return metaMap;
}

async function loadHolidayReport() {
    const periodKey = document.getElementById('holidayPeriodInput')?.value;
    if (!periodKey) return;

    try {
        _holidayPeriodDates = await eel.get_holiday_period_dates(periodKey)() || {};
        _holidayEntries = await eel.load_holiday_work_entries(periodKey)() || [];

        // 저장된 엔트리가 없으면 고정 명단으로 초기화
        if (_holidayEntries.length === 0) {
            _holidayEntries = _NIGHT_REPORT_DEFAULT_ROSTER.map(r => _createHolidayDefaultEntry(r));
        } else {
            _holidayEntries = _holidayEntries.map(e => ({
                ..._createHolidayDefaultEntry(e),
                ...e,
                contractNumber: e.contractNumber || '',
                ownerCompany: e.ownerCompany || '',
                vendorCompany: e.vendorCompany || e.company || '',
                shipName: e.shipName || '',
            }));
        }

        // 금/토/일 work_records 조회해 이름→프로젝트 메타 구성
        const holidayMetaMap = new Map();
        try {
            const friDate = periodKey;
            const friD = new Date(friDate + 'T00:00:00');
            const satDate = new Date(friD); satDate.setDate(friD.getDate() + 1);
            const sunDate = new Date(friD); sunDate.setDate(friD.getDate() + 2);
            const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            const [friRecs, satRecs, sunRecs] = await Promise.all([
                eel.load_work_records(friDate, 'day')(),
                eel.load_work_records(fmt(satDate), 'day')(),
                eel.load_work_records(fmt(sunDate), 'day')()
            ]);
            const mergedRecords = [...(friRecs || []), ...(satRecs || []), ...(sunRecs || [])];
            const inferredMap = _buildHolidayMetaMapFromRecords(mergedRecords);
            inferredMap.forEach((value, key) => {
                if (!holidayMetaMap.has(key)) holidayMetaMap.set(key, value);
            });
        } catch (_se) { /* 선명 조회 실패 시 무시 */ }

        _holidayEntries.forEach(entry => {
            const meta = _resolveHolidayMetaCandidate(holidayMetaMap, entry.name);
            if (!meta) return;
            const ownerCompany = String(meta.ownerCompany || '').trim();
            const currentVendorCompany = String(entry.vendorCompany || '').trim();
            if (!entry.ownerCompany) entry.ownerCompany = ownerCompany;
            if (meta.workerType === 'inhouse') {
                if (!currentVendorCompany || (ownerCompany && currentVendorCompany === ownerCompany)) {
                    entry.vendorCompany = '';
                }
            } else if (!entry.vendorCompany || (ownerCompany && currentVendorCompany === ownerCompany)) {
                entry.vendorCompany = meta.vendorCompany || '';
            }
            if (!entry.contractNumber) entry.contractNumber = meta.contractNumber || '';
            if (!entry.shipName) entry.shipName = meta.shipName || '';
            if (!entry.workContent) entry.workContent = meta.workContent || '';
        });

        _holidayEntries.forEach(entry => {
            if (!entry.contractNumber) entry.contractNumber = '';
            if (!entry.ownerCompany) entry.ownerCompany = '';
            if (!entry.vendorCompany) entry.vendorCompany = '';
            if (!entry.shipName) entry.shipName = '';
            if (!entry.workContent) entry.workContent = '';
        });

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
        showCustomAlert('오류', '휴일 보고를 불러오지 못했습니다.', 'error');
    }
}

function renderHolidayTable() {
    const tbody = document.getElementById('holidayReportTable');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (_holidayEntries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="border border-gray-900 p-3 text-center text-slate-500">입력된 내역이 없습니다.</td></tr>';
        return;
    }

    // 부서 rowspan 계산
    const deptSpans = [];
    for (let i = 0; i < _holidayEntries.length; i++) {
        const dept = _holidayEntries[i].department || '';
        const prevDept = i > 0 ? (_holidayEntries[i-1].department || '') : null;
        if (dept !== '' && dept === prevDept) {
            deptSpans.push(0);
        } else {
            let span = 1;
            if (dept !== '') {
                for (let j = i + 1; j < _holidayEntries.length; j++) {
                    if ((_holidayEntries[j].department || '') === dept) span++;
                    else break;
                }
            }
            deptSpans.push(span);
        }
    }

    _holidayEntries.forEach((entry, i) => {
        const isFirst = i === 0;
        const isLast = i === _holidayEntries.length - 1;
        const tr = document.createElement('tr');
        const span = deptSpans[i];
        const deptCell = span > 0
            ? `<td class="border border-gray-900 p-2 text-center align-middle text-sm font-medium" rowspan="${span}">${escapeHtml(entry.department||'')}</td>`
            : '';
        tr.innerHTML = `
            <td class="border border-gray-900 p-2 text-center">${i + 1}</td>
            ${deptCell}
            <td class="border border-gray-900 p-0">
                <input type="text" value="${escapeHtml(entry.rank||'')}" class="w-full px-1 py-1 border-0 focus:bg-yellow-50 text-sm text-center"
                       onchange="_updateHolidayEntry(${i},'rank',this.value)">
            </td>
            <td class="border border-gray-900 p-0">
                <input type="text" value="${escapeHtml(entry.name||'')}" class="w-full px-1 py-1 border-0 focus:bg-yellow-50 text-sm text-center"
                       onchange="_updateHolidayEntry(${i},'name',this.value)">
            </td>
            <td class="border border-gray-900 p-0 w-20" style="max-width:80px">
                <input type="text" value="${escapeHtml(entry.friWork||'-')}" class="w-20 px-1 py-1 border-0 focus:bg-yellow-50 text-sm text-center"
                       onchange="_updateHolidayEntry(${i},'friWork',this.value)">
            </td>
            <td class="border border-gray-900 p-0 w-20" style="max-width:80px">
                <input type="text" value="${escapeHtml(entry.satWork||'-')}" class="w-20 px-1 py-1 border-0 focus:bg-yellow-50 text-sm text-center"
                       onchange="_updateHolidayEntry(${i},'satWork',this.value)">
            </td>
            <td class="border border-gray-900 p-0 w-20" style="max-width:80px">
                <input type="text" value="${escapeHtml(entry.sunWork||'-')}" class="w-20 px-1 py-1 border-0 focus:bg-yellow-50 text-sm text-center"
                       onchange="_updateHolidayEntry(${i},'sunWork',this.value)">
            </td>
            <td class="border border-gray-900 p-0 w-24" style="min-width:96px">
                <input type="text" value="${escapeHtml(entry.shipName||'')}" placeholder="선명"
                       class="w-full px-1 py-1 border-0 focus:bg-yellow-50 text-sm text-center text-blue-700"
                       onchange="_updateHolidayEntry(${i},'shipName',this.value)">
            </td>
            <td class="border border-gray-900 p-0 w-72" style="min-width:288px">
                <input type="text" value="${escapeHtml(entry.workContent||'')}" class="w-full px-1 py-1 border-0 focus:bg-yellow-50 text-sm text-center"
                       onchange="_updateHolidayEntry(${i},'workContent',this.value)">
            </td>
            <td class="border border-gray-900 p-1 text-center no-capture w-24" style="white-space:nowrap; min-width:96px">
                <button onclick="_moveHolidayRow(${i},-1)" ${isFirst ? 'disabled' : ''}
                        class="px-2 text-slate-500 hover:text-blue-600 disabled:opacity-30 text-xs">▲</button>
                <button onclick="_moveHolidayRow(${i},1)" ${isLast ? 'disabled' : ''}
                        class="px-2 text-slate-500 hover:text-blue-600 disabled:opacity-30 text-xs">▼</button>
                <button onclick="_deleteHolidayRow(${i})"
                        class="px-2 text-red-500 hover:bg-red-50 rounded text-xs">✕</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // 총 인원 행 (열별 카운트)
    const friCount = _holidayEntries.filter(e => e.friWork && e.friWork !== '-').length;
    const satCount = _holidayEntries.filter(e => e.satWork && e.satWork !== '-').length;
    const sunCount = _holidayEntries.filter(e => e.sunWork && e.sunWork !== '-').length;
    const totalTr = document.createElement('tr');
    totalTr.className = 'bg-amber-50 font-semibold';
    totalTr.innerHTML = `
        <td class="border border-gray-900 p-2 text-center" colspan="4">총 인 원</td>
        <td class="border border-gray-900 p-2 text-center text-red-600">${friCount || 0}</td>
        <td class="border border-gray-900 p-2 text-center text-red-600">${satCount || 0}</td>
        <td class="border border-gray-900 p-2 text-center text-red-600">${sunCount || 0}</td>
        <td class="border border-gray-900 p-2" colspan="3"></td>
    `;
    tbody.appendChild(totalTr);
}

function _updateHolidayEntry(index, field, value) {
    if (_holidayEntries[index]) {
        _holidayEntries[index][field] = value;
        if (field === 'shipName') renderHolidayTable();
    }
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
    _holidayEntries.push(_createHolidayDefaultEntry());
    renderHolidayTable();
}

function openDailyWorkInputForDate(dateStr) {
    if (!dateStr) return;
    if (typeof showView === 'function') showView('daily');
    if (typeof showWorkTab === 'function' && typeof currentWorkTab !== 'undefined' && currentWorkTab !== 'day') {
        showWorkTab('day');
    }
    if (typeof currentDate !== 'undefined') currentDate = new Date(dateStr + 'T00:00:00');
    if (typeof updateDateInput === 'function') updateDateInput();
    if (typeof loadWorkRecords === 'function') loadWorkRecords();
}

function openNightReportForDate(dateStr) {
    if (!dateStr) return;
    if (typeof showView === 'function') showView('report');
    if (typeof showReportTab === 'function') showReportTab('night');
    const dateEl = document.getElementById('nightReportDate');
    if (dateEl) dateEl.value = dateStr;
    if (typeof loadNightReport === 'function') loadNightReport();
}

function openHolidayReportForPeriod(periodKey) {
    if (!periodKey) return;
    if (typeof showView === 'function') showView('report');
    if (typeof showReportTab === 'function') showReportTab('holiday');
    const periodEl = document.getElementById('holidayPeriodInput');
    if (periodEl) periodEl.value = periodKey;
    if (typeof loadHolidayReport === 'function') loadHolidayReport();
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
// 자동 캡처 (Python 스케줄러 17:00 호출)
// ========================================

eel.expose(auto_capture_daily_report);
async function auto_capture_daily_report() {
    try {
        if (typeof showView === 'function') showView('report');
        if (typeof showReportTab === 'function') showReportTab('daily');

        const today = new Date().toISOString().split('T')[0];
        const dateEl = document.getElementById('reportDate');
        if (dateEl) dateEl.value = today;
        if (typeof loadDailyReport === 'function') await loadDailyReport();

        await new Promise(r => setTimeout(r, 1500));

        const element = document.getElementById('dailyReportCapture');
        if (!element) return;

        const replacements = [];
        element.querySelectorAll('input, textarea').forEach(inp => {
            const span = document.createElement('span');
            span.textContent = inp.value;
            span.style.cssText = `display:block;width:100%;text-align:${getComputedStyle(inp).textAlign};padding:2px 4px;font-size:${getComputedStyle(inp).fontSize};font-family:${getComputedStyle(inp).fontFamily};`;
            inp.parentNode.replaceChild(span, inp);
            replacements.push({ span, inp });
        });
        const noCapture = element.querySelectorAll('.no-capture');
        noCapture.forEach(el => { el.dataset.origDisplay = el.style.display; el.style.display = 'none'; });
        const restore = () => {
            replacements.forEach(({ span, inp }) => span.parentNode?.replaceChild(inp, span));
            noCapture.forEach(el => { el.style.display = el.dataset.origDisplay || ''; });
        };

        const canvas = await html2canvas(element, { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false });
        restore();

        const base64 = canvas.toDataURL('image/png').split(',')[1];
        await eel.save_auto_capture_image(base64, today)();
    } catch (e) {
        console.error('자동 캡처 실패:', e);
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

    // html2canvas는 input value를 렌더링 못하므로 캡처 전 span으로 교체
    const replacements = [];
    element.querySelectorAll('input, textarea').forEach(inp => {
        const span = document.createElement('span');
        span.textContent = inp.value;
        // 입력 셀과 동일한 정렬/패딩 유지
        span.style.cssText = `display:block; width:100%; text-align:${inp.style.textAlign || getComputedStyle(inp).textAlign}; padding:2px 4px; font-size:${getComputedStyle(inp).fontSize}; font-family:${getComputedStyle(inp).fontFamily};`;
        inp.parentNode.replaceChild(span, inp);
        replacements.push({ span, inp });
    });

    // no-capture 요소 숨기기
    const noCapture = element.querySelectorAll('.no-capture');
    noCapture.forEach(el => { el.dataset.origDisplay = el.style.display; el.style.display = 'none'; });

    const restore = () => {
        replacements.forEach(({ span, inp }) => span.parentNode?.replaceChild(inp, span));
        noCapture.forEach(el => { el.style.display = el.dataset.origDisplay || ''; });
    };

    try {
        const canvas = await html2canvas(element, {
            backgroundColor: '#ffffff',
            scale: 2,
            useCORS: true,
            logging: false
        });

        restore();

        canvas.toBlob(async (blob) => {
            try {
                await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                ]);
                showCustomAlert('성공', '클립보드에 이미지가 복사되었습니다.', 'success');
            } catch (clipError) {
                console.error('클립보드 복사 실패:', clipError);
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
        restore();
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


