"""사진 슬롯 저장소. 슬롯 = 문서 안의 순서 번호(slot_index, 0부터).

빈칸은 행이 없는 번호다 (사진이 없는 slot_index). 페이지/행·열 배치는 화면(출력)이 정한다.
"""
from contextlib import contextmanager
from typing import Any, Dict, Iterator, List, Sequence

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

    def set_caption(self, doc_id: int, photo_id: int, caption: str) -> bool:
        """해당 문서의 사진만 수정 (다른 문서 사진 id 를 넘겨도 무시). 바뀌었으면 True."""
        with self.db.connect() as conn:
            return bool(conn.execute('UPDATE pdm_photos SET caption=? WHERE id=? AND doc_id=?',
                                     (caption, photo_id, doc_id)).rowcount)

    def remove(self, doc_id: int, slot_index: int, pull: bool) -> bool:
        """사진 제거. pull=True 면 뒤 사진을 한 칸씩 당기고, False 면 빈칸으로 둔다. 없던 칸이면 False."""
        with self._tx() as conn:
            deleted = conn.execute('DELETE FROM pdm_photos WHERE doc_id=? AND slot_index=?',
                                   (doc_id, slot_index)).rowcount
            if deleted and pull:
                conn.execute('UPDATE pdm_photos SET slot_index = slot_index - 1 '
                             'WHERE doc_id=? AND slot_index > ?', (doc_id, slot_index))
            return bool(deleted)

    def insert_blank(self, doc_id: int, slot_index: int) -> None:
        """slot_index 에 빈칸을 끼우고 그 이후 사진을 한 칸씩 뒤로 민다."""
        self._check_slot(slot_index)
        with self._tx() as conn:
            last = conn.execute('SELECT MAX(slot_index) FROM pdm_photos WHERE doc_id=?', (doc_id,)).fetchone()[0]
            if last is None or last < slot_index:
                return
            if last + 1 >= MAX_SLOTS:
                raise ValueError('더 이상 사진칸을 추가할 수 없습니다.')
            conn.execute('UPDATE pdm_photos SET slot_index = slot_index + 1 '
                         'WHERE doc_id=? AND slot_index >= ?', (doc_id, slot_index))
