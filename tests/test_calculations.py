# tests/test_calculations.py - 인원 계산 로직 테스트

import sys
from pathlib import Path

# 프로젝트 루트를 경로에 추가
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.business.calculations import (
    calculate_leader_manpower,
    calculate_teammates_manpower,
    calculate_record_manpower
)


def test_leader_manpower():
    """작업자 인원 계산 테스트"""
    # 일반
    assert calculate_leader_manpower("대리 홍길동") == 1.0
    assert calculate_leader_manpower("차장 김철수") == 1.0
    
    # 기울임체
    assert calculate_leader_manpower("*대리 박명수*") == 0.5
    assert calculate_leader_manpower("대리 *박명수*") == 0.5
    
    # 빈 값
    assert calculate_leader_manpower("") == 0.0
    assert calculate_leader_manpower(None) == 0.0
    
    print("✅ 작업자 인원 계산 테스트 통과")


def test_teammates_internal():
    """본사 소속 동반자 테스트"""
    # 기본
    assert calculate_teammates_manpower("홍길동") == 1.0
    assert calculate_teammates_manpower("홍길동, 박명수") == 2.0
    assert calculate_teammates_manpower("홍길동, 박명수, 김철수") == 3.0
    
    # 기울임체
    assert calculate_teammates_manpower("*홍길동*") == 0.5
    assert calculate_teammates_manpower("홍길동, *박명수*") == 1.5
    assert calculate_teammates_manpower("*홍길동*, *박명수*") == 1.0
    
    print("✅ 본사 소속 동반자 테스트 통과")


def test_teammates_contract():
    """외주 도급 테스트"""
    # 기본
    assert calculate_teammates_manpower("ABC업체(홍길동)") == 1.0
    assert calculate_teammates_manpower("ABC업체(홍길동, 박명수)") == 1.0
    assert calculate_teammates_manpower("ABC업체(홍길동, 박명수, 김철수)") == 1.0
    
    print("✅ 외주 도급 테스트 통과")


def test_teammates_daily():
    """외주 일당 테스트"""
    # 기본
    assert calculate_teammates_manpower("ABC업체[홍길동]") == 1.0
    assert calculate_teammates_manpower("ABC업체[홍길동, 박명수]") == 2.0
    assert calculate_teammates_manpower("ABC업체[홍길동, 박명수, 김철수]") == 3.0
    
    # 기울임체
    assert calculate_teammates_manpower("ABC업체[*홍길동*]") == 0.5
    assert calculate_teammates_manpower("ABC업체[홍길동, *박명수*]") == 1.5
    assert calculate_teammates_manpower("ABC업체[*홍길동*, *박명수*]") == 1.0
    
    print("✅ 외주 일당 테스트 통과")


def test_teammates_mixed():
    """본사 + 외주 혼합 테스트"""
    # 본사 + 도급
    assert calculate_teammates_manpower("홍길동, 박명수, ABC업체(김철수, 이영희)") == 3.0
    assert calculate_teammates_manpower("반규석, 아다한, 성진(정동진, 이덕윤)") == 3.0
    
    # 본사 + 일당
    assert calculate_teammates_manpower("홍길동, ABC업체[박명수, 김철수]") == 3.0
    assert calculate_teammates_manpower("조각상, 개인[김영언, 이정훈]") == 3.0
    
    # 본사 + 도급 + 일당
    result = calculate_teammates_manpower(
        "홍길동, 박명수, ABC업체(김철수), DEF업체[이영희, 정민수]"
    )
    assert result == 5.0  # 홍길동(1) + 박명수(1) + ABC(1) + DEF[2](2) = 5
    
    # 기울임체 혼합
    result = calculate_teammates_manpower(
        "*홍길동*, 박명수, ABC업체(김철수), DEF업체[이영희, *정민수*]"
    )
    assert result == 4.0  # *홍길동*(0.5) + 박명수(1) + ABC(1) + 이영희(1) + *정민수*(0.5) = 4.0
    
    print("✅ 혼합 입력 테스트 통과")


def test_record_manpower():
    """레코드 전체 인원 계산 테스트"""
    # 기본
    result = calculate_record_manpower("대리 홍길동", "박명수, 김철수")
    assert result == 3.0
    
    # 기울임체
    result = calculate_record_manpower("*대리 홍길동*", "*박명수*, 김철수")
    assert result == 2.0  # 0.5 + 0.5 + 1.0
    
    # 외주 포함
    result = calculate_record_manpower("차장 이영희", "홍길동, ABC업체(박명수, 김철수)")
    assert result == 3.0  # 1 + 1 + 1
    
    result = calculate_record_manpower("차장 이영희", "홍길동, ABC업체[박명수, 김철수]")
    assert result == 4.0  # 1 + 1 + 2
    
    print("✅ 레코드 전체 인원 계산 테스트 통과")


def run_all_tests():
    """모든 테스트 실행"""
    print("\n" + "="*60)
    print("인원 계산 로직 테스트 시작")
    print("="*60 + "\n")
    
    try:
        test_leader_manpower()
        test_teammates_internal()
        test_teammates_contract()
        test_teammates_daily()
        test_teammates_mixed()
        test_record_manpower()
        
        print("\n" + "="*60)
        print("✅ 모든 테스트 통과!")
        print("="*60 + "\n")
        return True
        
    except AssertionError as e:
        print(f"\n❌ 테스트 실패: {e}\n")
        return False
    except Exception as e:
        print(f"\n❌ 오류 발생: {e}\n")
        return False


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
