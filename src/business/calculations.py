# src/business/calculations.py - 인원 계산 로직

import re
from typing import List, Tuple


def extract_names(text: str) -> List[Tuple[str, bool]]:
    """
    텍스트에서 이름 추출 및 기울임체 여부 확인
    
    Args:
        text: 입력 텍스트 (쉼표로 구분된 이름들)
    
    Returns:
        List of (name, is_italic) tuples
    """
    if not text or not text.strip():
        return []
    
    parts = [p.strip() for p in text.split(',') if p.strip()]
    
    result = []
    for part in parts:
        is_italic = part.startswith('*') and part.endswith('*')
        name = part.strip('*').strip() if is_italic else part.strip()
        if name:
            result.append((name, is_italic))
    
    return result


def calculate_leader_manpower(leader_text: str) -> float:
    """
    작업자(팀장) 인원 계산
    
    Args:
        leader_text: 작업자 텍스트
    
    Returns:
        인원 수 (0, 0.5, 1.0)
    """
    if not leader_text or not leader_text.strip():
        return 0.0
    
    # 기울임체(*로 감싸진 경우) 체크
    is_italic = '*' in leader_text
    return 0.5 if is_italic else 1.0


def calculate_teammates_manpower(teammates_text: str) -> float:
    """
    동반자 인원 계산
    
    규칙:
    1. 본사 소속: 이름, 이름, 이름 -> 각 1공 (기울임체면 0.5공)
    2. 외주 도급: 업체명(이름, 이름) -> 1공
    3. 외주 일당: 업체명[이름, 이름] -> 인원수만큼 (기울임체면 0.5공)
    
    Args:
        teammates_text: 동반자 텍스트
    
    Returns:
        총 인원 수
    """
    if not teammates_text or not teammates_text.strip():
        return 0.0
    
    total = 0.0
    text = teammates_text.strip()
    matched_ranges = []
    
    # 도급: 업체명(이름, 이름)
    contract_pattern = re.compile(r'([^()\[\],]+)\(([^)]+)\)')
    for match in contract_pattern.finditer(text):
        total += 1.0  # 도급은 항상 1공
        matched_ranges.append((match.start(), match.end()))
    
    # 일당: 업체명[이름, 이름]
    daily_pattern = re.compile(r'([^()\[\],]+)\[([^\]]+)\]')
    for match in daily_pattern.finditer(text):
        names_in_bracket = match.group(2)
        names = extract_names(names_in_bracket)
        
        for name, is_italic in names:
            total += 0.5 if is_italic else 1.0
        
        matched_ranges.append((match.start(), match.end()))
    
    # 매칭되지 않은 부분 추출 (본사 소속)
    remaining_text = ""
    last_end = 0
    
    # 매칭 범위 정렬
    matched_ranges.sort()
    
    for start, end in matched_ranges:
        if last_end < start:
            remaining_text += text[last_end:start]
        last_end = end
    
    # 마지막 매칭 이후 텍스트
    if last_end < len(text):
        remaining_text += text[last_end:]
    
    # 본사 소속 직원 계산
    internal_names = extract_names(remaining_text)
    for name, is_italic in internal_names:
        total += 0.5 if is_italic else 1.0
    
    return total


def calculate_record_manpower(leader: str, teammates: str) -> float:
    """
    작업 레코드 전체 인원 계산
    
    Args:
        leader: 작업자 텍스트
        teammates: 동반자 텍스트
    
    Returns:
        총 인원 수
    """
    leader_count = calculate_leader_manpower(leader)
    teammates_count = calculate_teammates_manpower(teammates)
    return leader_count + teammates_count


def calculate_total_manpower(records: list) -> float:
    """
    모든 레코드의 총 인원 계산

    Args:
        records: 작업 레코드 리스트

    Returns:
        총 인원 수
    """
    total = 0.0
    for record in records:
        if hasattr(record, 'leader') and hasattr(record, 'teammates'):
            total += calculate_record_manpower(record.leader, record.teammates)
        elif isinstance(record, dict):
            leader = record.get('leader', '')
            teammates = record.get('teammates', '')
            total += calculate_record_manpower(leader, teammates)

    return total


def separate_workers(leader: str, teammates: str) -> tuple:
    """
    본사 직원 / 외주 인력 분리

    규칙:
    - 팀장(leader) 및 teammates 중 이름만 있는 경우 → 본사 직원
    - 업체명(이름들) 패턴 → 외주 도급
    - 업체명[이름들] 패턴 → 외주 일당

    Args:
        leader: 작업자 텍스트
        teammates: 동반자 텍스트

    Returns:
        (in_house: str, outsourced: str) - 각각 쉼표 구분 문자열, 없으면 '-'
    """
    in_house_list = []
    outsourced_list = []

    # 팀장 처리 (본사 직원)
    if leader and leader.strip():
        clean_leader = leader.replace('<i>', '').replace('</i>', '').replace('*', '').strip()
        if clean_leader:
            in_house_list.append(clean_leader)

    # 동반자 처리
    if teammates and teammates.strip():
        remaining = teammates

        # 1. 도급 패턴: 업체명(직원명들)
        contract_pattern = re.compile(r'([^,]+?)\(([^)]+)\)')
        for match in contract_pattern.finditer(teammates):
            full_match = match.group(0).strip()
            if full_match:
                outsourced_list.append(full_match)
            remaining = remaining.replace(match.group(0), '')

        # 2. 일당 패턴: 업체명[직원명들]
        daily_pattern = re.compile(r'([^,]+?)\[([^\]]+)\]')
        for match in daily_pattern.finditer(teammates):
            full_match = match.group(0).strip()
            if full_match:
                outsourced_list.append(full_match)
            remaining = remaining.replace(match.group(0), '')

        # 3. 남은 부분 → 본사 직원
        parts = [p.strip() for p in remaining.split(',') if p.strip()]
        for part in parts:
            clean_name = part.replace('<i>', '').replace('</i>', '').replace('*', '').strip()
            if clean_name:
                in_house_list.append(clean_name)

    in_house = ', '.join(in_house_list) if in_house_list else '-'
    outsourced = ', '.join(outsourced_list) if outsourced_list else '-'

    return in_house, outsourced
