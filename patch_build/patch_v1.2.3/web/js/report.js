// ========================================
// XSS 방어용 HTML 이스케이프 헬퍼
// ========================================

function escapeHtmlReport(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
}

// ========================================
// 본사/외주 분리 함수
// ========================================

function separateWorkers(leader, teammates) {
    const inHouseList = [];
    const outsourcedList = [];
    
    // 작업자(팀장) 처리
    if (leader && leader.trim()) {
        // 기울임체 제거 (*제거)
        const cleanLeader = leader.replace(/\*/g, '').trim();
        if (cleanLeader) {
            inHouseList.push(cleanLeader);
        }
    }
    
    // 동반자 처리
    if (teammates && teammates.trim()) {
        let remaining = teammates;
        
        // 1. 도급 패턴 추출: 업체명(직원명들)
        const contractRegex = /([^,]+?)\(([^)]+)\)/g;
        let match;
        while ((match = contractRegex.exec(teammates)) !== null) {
            const fullMatch = match[0].trim(); // "업체명(직원명들)"
            if (fullMatch) {
                outsourcedList.push(fullMatch);
            }
            // 해당 부분을 remaining에서 제거
            remaining = remaining.replace(match[0], '');
        }
        
        // 2. 일당 패턴 추출: 업체명[직원명들]
        const dailyRegex = /([^,]+?)\[([^\]]+)\]/g;
        while ((match = dailyRegex.exec(remaining)) !== null) {
            const fullMatch = match[0].trim(); // "업체명[직원명들]"
            if (fullMatch) {
                outsourcedList.push(fullMatch);
            }
            // 해당 부분을 remaining에서 제거
            remaining = remaining.replace(match[0], '');
        }
        
        // 3. 남은 부분에서 본사 직원 추출
        const parts = remaining.split(',').map(p => p.trim()).filter(p => p && p.length > 0);
        parts.forEach(part => {
            // 기울임체 제거
            const cleanName = part.replace(/\*/g, '').trim();
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
    const dailyTab = document.getElementById('dailyReportTab');
    const monthlyTab = document.getElementById('monthlyReportTab');
    const btnDaily = document.getElementById('btnReportDaily');
    const btnMonthly = document.getElementById('btnReportMonthly');

    if (tab === 'daily') {
        dailyTab.classList.remove('hidden');
        monthlyTab.classList.add('hidden');
        btnDaily.classList.remove('bg-slate-200');
        btnDaily.classList.add('bg-blue-600', 'text-white');
        btnMonthly.classList.remove('bg-blue-600', 'text-white');
        btnMonthly.classList.add('bg-slate-200');
        
        // 일일 보고 로드 - 날짜 기본값 설정
        const reportDate = document.getElementById('reportDate');
        if (!reportDate.value) {
            // 오늘 날짜로 설정
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const day = String(today.getDate()).padStart(2, '0');
            reportDate.value = `${year}-${month}-${day}`;
        }
        loadDailyReport();
    } else {
        dailyTab.classList.add('hidden');
        monthlyTab.classList.remove('hidden');
        btnDaily.classList.remove('bg-blue-600', 'text-white');
        btnDaily.classList.add('bg-slate-200');
        btnMonthly.classList.remove('bg-slate-200');
        btnMonthly.classList.add('bg-blue-600', 'text-white');
        
        // 월간 보고 로드 - 날짜 기본값 설정
        const reportMonth = document.getElementById('reportMonth');
        if (!reportMonth.value) {
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            reportMonth.value = `${year}-${month}`;
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
        alert('날짜를 선택해주세요.');
        return;
    }

    try {
        const records = await eel.load_work_records(reportDate)();
        
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
        
        if (validRecords.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="border p-4 text-center text-slate-500">작업 내역이 없습니다.</td></tr>';
            return;
        }
        
        // 계약번호 또는 선박별 시작일 가져오기 (병렬 처리)
        const projectDates = {};
        await Promise.all(validRecords.map(async (record) => {
            const contractNumber = record.contract_number || record.contractNumber || '';
            const shipName = record.ship_name || record.shipName || '';
            const key = contractNumber || shipName; // 계약번호 우선, 없으면 선박명
            
            console.log(`레코드: 계약번호=${contractNumber}, 선박명=${shipName}, key=${key}`);
            
            if (key && !projectDates[key]) {
                let startDate = '';
                if (contractNumber) {
                    // 계약번호가 있으면 계약번호 기준
                    startDate = await eel.get_project_start_date_by_contract(contractNumber)();
                    console.log(`계약번호 ${contractNumber} 시작일: ${startDate}`);
                }
                if (!startDate && shipName) {
                    // 계약번호로 찾지 못했으면 선박명 기준
                    startDate = await eel.get_project_start_date(shipName)();
                    console.log(`선박명 ${shipName} 시작일: ${startDate}`);
                }
                projectDates[key] = startDate || '';
            }
        }));
        
        console.log('projectDates:', projectDates);
        
        // 보고일 (현재 선택한 날짜)
        const reportMonth = dateObj.getMonth() + 1;
        const reportDay = dateObj.getDate();
        const reportDateStr = `${reportMonth}/${reportDay}`;
        
        validRecords.forEach((record, index) => {
            // 담당공무(본사)와 협력업체(외주) 분리
            const { inHouse, outsourced } = separateWorkers(record.leader, record.teammates);
            
            // Python에서 snake_case로 오기 때문에 둘 다 지원
            const shipName = record.ship_name || record.shipName || '-';
            const engineModel = record.engine_model || record.engineModel || '';
            const workContent = record.work_content || record.workContent || '';
            
            // 공사기간: "시작일 ~ 보고일" 형식
            const contractNumber = record.contract_number || record.contractNumber || '';
            const key = contractNumber || shipName;
            const startDate = projectDates[key];
            const projectPeriod = startDate ? `${startDate} ~ ${reportDateStr}` : reportDateStr;
            
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
                <td class="border border-gray-900 p-2 text-center">${index + 1}</td>
                <td class="border border-gray-900 p-2 text-center">${escapeHtmlReport(record.company || '-')}</td>
                <td class="border border-gray-900 p-2 text-center">${escapeHtmlReport(shipName)}</td>
                <td class="border border-gray-900 p-2 text-center">${escapeHtmlReport(projectPeriod)}</td>
                <td class="border border-gray-900 p-2 text-center">${escapeHtmlReport(record.location || '-')}</td>
                <td class="border border-gray-900 p-2 text-left">${escapeHtmlReport(fullWorkContent)}</td>
                <td class="border border-gray-900 p-2 text-center">${escapeHtmlReport(inHouse)}</td>
                <td class="border border-gray-900 p-2 text-center">${escapeHtmlReport(outsourced)}</td>
            `;
            tbody.appendChild(row);
        });
        
    } catch (error) {
        console.error('일일 보고 로드 실패:', error);
        alert('데이터를 불러오는데 실패했습니다.');
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
        showCustomAlert('오류', '캡쳐에 실패했습니다: ' + error.message, 'error');
    }
}

// ========================================
// 월간 보고 로드
// ========================================

async function loadMonthlyReport() {
    const reportMonth = document.getElementById('reportMonth').value;
    if (!reportMonth) {
        showCustomAlert('오류', '월을 선택해주세요.', 'error');
        return;
    }

    try {
        showLoading(true, '월간 보고 로드 중...');
        
        const [year, month] = reportMonth.split('-');
        console.log(`월간 보고 로드: ${year}년 ${month}월`);

        // 월간 보고 제목 업데이트
        const monthlyTitleEl = document.getElementById('monthlyReportTitle');
        if (monthlyTitleEl) {
            monthlyTitleEl.textContent = `${parseInt(month)}월 월간 작업 현황`;
        }

        // 디버깅: 데이터 확인
        const debugData = await eel.debug_check_data(parseInt(year), parseInt(month))();
        console.log('디버깅 데이터:', debugData);
        
        const monthlyData = await eel.load_monthly_report_grouped(parseInt(year), parseInt(month))();
        console.log('월간 보고 데이터:', monthlyData);
        console.log('데이터 개수:', monthlyData ? monthlyData.length : 0);
        
        showLoading(false);
        
        // 테이블 생성
        const tbody = document.getElementById('monthlyReportTable');
        if (!tbody) {
            console.error('월간 보고 테이블을 찾을 수 없습니다.');
            return;
        }
        
        tbody.innerHTML = '';
        
        if (!monthlyData || monthlyData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="border p-4 text-center text-slate-500">작업 내역이 없습니다.</td></tr>';
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
                <td class="border border-gray-900 p-2 text-center">${index + 1}</td>
                <td class="border border-gray-900 p-2 text-center">${escapeHtmlReport(ship.company || '-')}</td>
                <td class="border border-gray-900 p-2 text-center">${escapeHtmlReport(ship.ship_name || ship.shipName || '-')}</td>
                <td class="border border-gray-900 p-2 text-center">${escapeHtmlReport(ship.project_period || '-')}</td>
                <td class="border border-gray-900 p-2 text-center">${escapeHtmlReport(ship.location || '-')}</td>
                <td class="border border-gray-900 p-2 text-left">${escapeHtmlReport(ship.work_content || ship.workContent || '-')}</td>
                <td class="border border-gray-900 p-2 text-center">${escapeHtmlReport(inHouseDisplay)}</td>
                <td class="border border-gray-900 p-2 text-center">${escapeHtmlReport(outsourced)}</td>
                <td class="border border-gray-900 p-2 text-center">${ship.total_manpower.toFixed(1)}</td>
            `;
            tbody.appendChild(row);
        });
        
    } catch (error) {
        console.error('월간 보고 로드 실패:', error);
        showLoading(false);
        showCustomAlert('오류', '데이터를 불러오는데 실패했습니다: ' + error.message, 'error');
    }
}


