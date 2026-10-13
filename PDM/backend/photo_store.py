"""사진 슬롯 저장소. 슬롯 = 문서 안의 순서 번호(slot_index, 0부터).

빈칸은 행이 없는 번호다 (사진이 없는 slot_index). 페이지/행·열 배치는 화면(출력)이 정한다.
"""
import json
from contextlib import contextmanager
from typing import Any, Dict, Iterator, List, Optional, Sequence

from PDM.backend.pdm_db import PdmDb
from PDM.backend.photo_service import ProcessedImage

MAX_SLOTS = 600  # 문서당 사진칸 상한 (이상 입력 방어)


class SlotOccupied(Exception):
    """이미 사진이 들어 있는 칸에 입력하려 함."""


class PhotoStore:
    def __init__(self, db: PdmDb):
        self.db = db

    @contextmanager
    def _tx(self):
        """쓰기 트랜잭션 — BEGIN IMMEDIATE 로 동시 입력 경합을 직렬화."""
        with self.db.connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            yield conn

    @staticmethod
    def _check_slot(slot_index: int) -> None:
        if not 0 <= slot_index < MAX_SLOTS:
            raise ValueError(f'사진칸 번호가 범위를 벗어났습니다: {slot_index}')

    def add_photo(self, doc_id: int, slot_index: int, img: ProcessedImage) -> int:
        self._check_slot(slot_index)
        with self._tx() as conn:
            if conn.execute('SELECT 1 FROM pdm_photos WHERE doc_id=? AND slot_index=?',
                            (doc_id, slot_index)).fetchone():
                raise SlotOccupied(slot_index)
            cur = conn.execute(
                'INSERT INTO pdm_photos (doc_id, slot_index, image_blob, thumb_blob, width, height) '
                'VALUES (?,?,?,?,?,?)', (doc_id, slot_index, img.image, img.thumb, img.width, img.height))
            return int(cur.lastrowid)

    def list_photos(self, doc_id: int) -> List[Dict[str, Any]]:
        with self.db.connect() as conn:
            rows = conn.execute(
                'SELECT id, slot_index, caption, width, height, original_blob IS NOT NULL AS edited '
                'FROM pdm_photos WHERE doc_id=? ORDER BY slot_index', (doc_id,)).fetchall()
        return [{'id': r['id'], 'slotIndex': r['slot_index'], 'caption': r['caption'],
                 'width': r['width'], 'height': r['height'], 'edited': bool(r['edited'])} for r in rows]

    def get_thumbs(self, ids: Sequence[int]) -> Dict[int, bytes]:
        if not ids:
            return {}
        marks = ','.join('?' * len(ids))
        with self.db.connect() as conn:
            rows = conn.execute(f'SELECT id, thumb_blob FROM pdm_photos WHERE id IN ({marks})', list(ids)).fetchall()
        return {r['id']: r['thumb_blob'] for r in rows}

    def get_image(self, photo_id: int) -> bytes:
        with self.db.connect() as conn:
            row = conn.execute('SELECT image_blob FROM pdm_photos WHERE id=?', (photo_id,)).fetchone()
        if row is None:
            raise KeyError(photo_id)
        return row['image_blob']

    def get_original(self, doc_id: int, photo_id: int):
        """편집 전 원본 (편집한 적 없으면 None)."""
        with self.db.connect() as conn:
            row = conn.execute('SELECT original_blob FROM pdm_photos WHERE id=? AND doc_id=?',
                               (photo_id, doc_id)).fetchone()
        return row['original_blob'] if row else None

    def replace_image(self, doc_id: int, photo_id: int, img: ProcessedImage) -> bool:
        """편집본으로 교체. 처음 편집할 때만 기존 이미지를 original_blob 에 보존한다."""
        with self._tx() as conn:
            return bool(conn.execute(
                'UPDATE pdm_photos SET original_blob = COALESCE(original_blob, image_blob), '
                'image_blob=?, thumb_blob=?, width=?, height=? WHERE id=? AND doc_id=?',
                (img.image, img.thumb, img.width, img.height, photo_id, doc_id)).rowcount)

    def restore_original(self, doc_id: int, photo_id: int, thumb: bytes, width: int, height: int) -> bool:
        """편집 전 원본으로 복원 (썸네일/크기는 호출자가 원본에서 계산해 전달). 편집 이력이 없으면 False."""
        with self._tx() as conn:
            return bool(conn.execute(
                'UPDATE pdm_photos SET image_blob=original_blob, original_blob=NULL, '
                'thumb_blob=?, width=?, height=? WHERE id=? AND doc_id=? AND original_blob IS NOT NULL',
                (thumb, width, height, photo_id, doc_id)).rowcount)

    def set_caption(self, doc_id: int, photo_id: int, caption: str) -> bool:
        """해당 문서의 사진만 수정 (다른 문서 사진 id 를 넘겨도 무시). 바뀌었으면 True."""
        with self.db.connect() as conn:
            return bool(conn.execute('UPDATE pdm_photos SET caption=? WHERE id=? AND doc_id=?',
                                     (caption, photo_id, doc_id)).rowcount)

    # end_slot: 이 번호 앞까지만 당기거나 민다 (None = 문서 끝까지). 소제목 구간(섹션)이 뒤 구간을 밀어내지 않도록 구간 끝을 넘겨 준다.
    def remove(self, doc_id: int, slot_index: int, pull: bool, end_slot: Optional[int] = None) -> bool:
        """사진 제거. pull=True 면 뒤 사진(end_slot 앞까지)을 한 칸씩 당기고, False 면 빈칸으로 둔다. 없던 칸이면 False."""
        limit = MAX_SLOTS if end_slot is None else end_slot
        with self._tx() as conn:
            deleted = conn.execute('DELETE FROM pdm_photos WHERE doc_id=? AND slot_index=?',
                                   (doc_id, slot_index)).rowcount
            if deleted and pull:
                conn.execute('UPDATE pdm_photos SET slot_index = slot_index - 1 '
                             'WHERE doc_id=? AND slot_index > ? AND slot_index < ?', (doc_id, slot_index, limit))
            return bool(deleted)

    def insert_blank(self, doc_id: int, slot_index: int, end_slot: Optional[int] = None) -> None:
        """slot_index 에 빈칸을 끼우고 그 이후 사진(end_slot 앞까지)을 한 칸씩 뒤로 민다.
        end_slot 이 있으면 구간 마지막 칸(end_slot-1)에 사진이 없어야 한다 — 있으면 ValueError (먼저 페이지를 늘려야 함)."""
        self._check_slot(slot_index)
        limit = MAX_SLOTS if end_slot is None else end_slot
        with self._tx() as conn:
            last = conn.execute('SELECT MAX(slot_index) FROM pdm_photos WHERE doc_id=? AND slot_index < ?', (doc_id, limit)).fetchone()[0]
            if last is None or last < slot_index:
                return
            if end_slot is not None and last + 1 >= end_slot:
                raise ValueError('이 구간의 마지막 칸까지 차 있어 밀 수 없습니다. 먼저 페이지를 추가하세요.')
            if last + 1 >= MAX_SLOTS:
                raise ValueError('더 이상 사진칸을 추가할 수 없습니다.')
            conn.execute('UPDATE pdm_photos SET slot_index = slot_index + 1 '
                         'WHERE doc_id=? AND slot_index >= ? AND slot_index < ?', (doc_id, slot_index, limit))

    def insert_page(self, doc_id: int, before_page: int, per_page: int) -> Dict[str, str]:
        """before_page 앞에 빈 페이지를 끼운다: 그 페이지 이후의 사진을 한 페이지(per_page 칸)씩 뒤로 밀고,
        저장된 페이지 제목(header.pageTitles)도 같이 민다. 앞 구간(소제목 묶음)이 커질 때 뒤 구간을 통째로 밀어내는 데 쓴다.
        반환: 밀린 뒤의 pageTitles."""
        if per_page not in (4, 6) or before_page < 0:
            raise ValueError('페이지 정보가 올바르지 않습니다.')
        from_slot = before_page * per_page
        with self._tx() as conn:
            last = conn.execute('SELECT MAX(slot_index) FROM pdm_photos WHERE doc_id=?', (doc_id,)).fetchone()[0]
            if last is not None and last >= from_slot:
                if last + per_page >= MAX_SLOTS:
                    raise ValueError('더 이상 페이지를 추가할 수 없습니다.')
                conn.execute('UPDATE pdm_photos SET slot_index = slot_index + ? WHERE doc_id=? AND slot_index >= ?',
                             (per_page, doc_id, from_slot))
            row = conn.execute('SELECT header_json FROM pdm_documents WHERE id=?', (doc_id,)).fetchone()
            if row is None:
                raise KeyError(doc_id)
            header = json.loads(row['header_json'])
            titles = {str(int(k) + 1 if int(k) >= before_page else int(k)): v for k, v in (header.get('pageTitles') or {}).items() if str(k).isdigit()}
            header['pageTitles'] = titles
            conn.execute('UPDATE pdm_documents SET header_json=? WHERE id=?', (json.dumps(header, ensure_ascii=False), doc_id))
            return titles
