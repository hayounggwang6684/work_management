// 서비스레포트 첫 장의 헤더 항목 정의 — 편집기(sr_editor.js)와 출력(sr_print.js)이 공유한다.
// 한 줄에 [라벨, 헤더 키] 1개(전체 폭) 또는 2개(좌/우). 양식(GL2030)의 표 순서와 동일.
const SR_ROWS = [
    [['Name of vessel', 'vesselName'], ['IMO No.', 'imoNo']],
    [['Engine Type', 'engineType'], ['S/N', 'serialNo']],
    [['Model', 'model'], ['Date', 'date']],
    [['Order No.', 'orderNo'], ['Reported by', 'reportedBy']],
    [['Customer', 'customer']],
    [['Requested by', 'requestedBy']],
    [['Location', 'location']],
    [['Period', 'period']],
    [['Subject', 'subject']],
];
