"""엑셀 '작업내용 / 장소' 분리 회귀 테스트 — python tests/test_excel_split.py

깨지면 안 되는 것: G/E, M/E, O/H, F/W 같은 기술 약어가 장소로 잘려 나가지 않을 것.
실데이터 1,914건 중 1,270건이 슬래시를 포함하므로 오작동 시 피해가 크다.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.web.api import _split_work_content_and_location as split


def test_splits_on_spaced_slash():
    assert split('엔진오버홀/ 부산') == ('엔진오버홀', '부산')
    assert split('엔진오버홀 /부산') == ('엔진오버홀', '부산')
    assert split('엔진 오버홀 / 부산조선') == ('엔진 오버홀', '부산조선')
    assert split('엔진 오바홀 작업 / 통영, 공장') == ('엔진 오바홀 작업', '통영, 공장')


def test_keeps_attached_slash_abbreviations():
    """붙여 쓴 슬래시는 기술 약어다. 자르면 데이터가 망가진다."""
    for text in ['NO.2 G/E 오버홀', 'PORT M/E 청수펌프 수리', 'NO.1 F/W COOLER 정비',
                 'T/C 정비', 'S/W 펌프 교환', 'HEAD O/H']:
        assert split(text) == (text, ''), text


def test_mixed_abbreviation_and_location():
    """약어와 장소가 함께 있으면 장소만 떼어낸다."""
    assert split('NO.1 F/W COOLER 정비 & NO.2 HEAD O/H / 울산') == \
        ('NO.1 F/W COOLER 정비 & NO.2 HEAD O/H', '울산')


def test_last_separator_wins():
    """장소는 맨 뒤에 온다."""
    assert split('A / B / 부산') == ('A / B', '부산')


def test_degenerate_input_is_left_alone():
    """한쪽이 비면 자르지 않는다."""
    assert split('') == ('', '')
    assert split('작업내용만') == ('작업내용만', '')
    assert split('엔진 오바홀 작업 /') == ('엔진 오바홀 작업 /', '')
    assert split('  / 부산') == ('/ 부산', '')
    assert split(None) == ('', '')


if __name__ == '__main__':
    for fn in [test_splits_on_spaced_slash, test_keeps_attached_slash_abbreviations,
               test_mixed_abbreviation_and_location, test_last_separator_wins,
               test_degenerate_input_is_left_alone]:
        fn()
        print(f'  OK  {fn.__name__}')
    print('통과')
