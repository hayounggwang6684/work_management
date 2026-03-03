# src/utils/telegram_notifier.py - 텔레그램 봇 알림 및 답장 처리

import threading
import time
import requests
from typing import Optional, Dict, List, Any

from .logger import logger
from .config import config


class TelegramNotifier:
    """텔레그램 봇을 통한 댓글 알림 + 답장→댓글 양방향 연동"""

    def __init__(self):
        self.bot_token = config.get('telegram.bot_token', '')
        self.enabled = config.get('telegram.enabled', False)
        self.polling_interval = config.get('telegram.polling_interval', 2)

        self._last_update_id = 0
        self._polling_thread: Optional[threading.Thread] = None
        self._running = False
        self._bot_username = ''

    # =========================================================================
    # 폴링 관리
    # =========================================================================

    def start_polling(self):
        """텔레그램 봇 폴링 시작 (daemon 스레드)"""
        if not self.enabled or not self.bot_token:
            logger.info("텔레그램 비활성화 또는 토큰 미설정, 폴링 건너뜀")
            return

        # 봇 정보 가져오기 (username 캐시)
        self._fetch_bot_info()

        # 오래된 데이터 정리
        try:
            from ..database.auth_manager import auth_manager
            auth_manager.cleanup_old_telegram_data()
        except Exception as e:
            logger.error(f"텔레그램 데이터 정리 실패: {e}")

        self._running = True
        self._polling_thread = threading.Thread(
            target=self._poll_loop,
            name="telegram-poller",
            daemon=True
        )
        self._polling_thread.start()
        logger.info(f"텔레그램 폴링 시작 (@{self._bot_username})")

    def stop_polling(self):
        """폴링 중단"""
        self._running = False
        if self._polling_thread and self._polling_thread.is_alive():
            self._polling_thread.join(timeout=10)
        logger.info("텔레그램 폴링 중단")

    def reconfigure(self, bot_token: str, enabled: bool):
        """봇 설정 변경 시 폴링 재시작"""
        self.stop_polling()
        self.bot_token = bot_token
        self.enabled = enabled
        self._last_update_id = 0
        self._bot_username = ''
        if enabled and bot_token:
            self.start_polling()

    def get_bot_username(self) -> str:
        """캐시된 봇 username 반환 (없으면 재시도)"""
        if not self._bot_username and self.bot_token:
            logger.info("봇 username 미캐시, 재조회 시도")
            self._fetch_bot_info()
        if not self._bot_username:
            logger.warning(f"봇 username 조회 실패 (토큰 존재: {bool(self.bot_token)})")
        return self._bot_username

    def _fetch_bot_info(self):
        """getMe API로 봇 정보 가져오기"""
        if not self.bot_token:
            logger.warning("봇 토큰이 비어있어 getMe 호출 건너뜀")
            return

        try:
            url = f"https://api.telegram.org/bot{self.bot_token}/getMe"
            logger.info(f"getMe API 호출 중... (토큰 길이: {len(self.bot_token)})")
            resp = requests.get(url, timeout=10)
            logger.info(f"getMe 응답: status={resp.status_code}")
            if resp.status_code == 200:
                data = resp.json()
                if data.get('ok'):
                    self._bot_username = data['result'].get('username', '')
                    logger.info(f"텔레그램 봇: @{self._bot_username}")
                else:
                    logger.error(f"getMe API 실패: {data}")
            else:
                logger.error(f"getMe HTTP 오류: {resp.status_code} - {resp.text[:200]}")
        except Exception as e:
            logger.error(f"봇 정보 가져오기 실패: {e}")

    # =========================================================================
    # 폴링 루프
    # =========================================================================

    def _poll_loop(self):
        """백그라운드 폴링 루프"""
        while self._running:
            try:
                self._process_updates()
            except requests.exceptions.ConnectionError:
                logger.warning("텔레그램 연결 오류, 10초 후 재시도")
                time.sleep(10)
                continue
            except Exception as e:
                logger.error(f"텔레그램 폴링 오류: {e}")
                time.sleep(5)
                continue
            time.sleep(self.polling_interval)

    def _process_updates(self):
        """getUpdates 호출 및 업데이트 처리"""
        url = f"https://api.telegram.org/bot{self.bot_token}/getUpdates"
        params = {
            'offset': self._last_update_id + 1,
            'timeout': 5,
            'allowed_updates': ['message']
        }

        try:
            resp = requests.get(url, params=params, timeout=15)
        except Exception as e:
            logger.warning(f"getUpdates 요청 실패: {e}")
            return

        if resp.status_code != 200:
            return

        try:
            data = resp.json()
        except Exception as e:
            logger.warning(f"getUpdates JSON 파싱 실패: {e}")
            return

        if not data.get('ok'):
            return

        for update in data.get('result', []):
            update_id = update.get('update_id', 0)
            # update_id 먼저 갱신 → 파싱 오류 시 무한 재처리 방지
            if update_id > self._last_update_id:
                self._last_update_id = update_id

            message = update.get('message')
            if not message:
                continue

            # chat 구조 검증 (KeyError 방어)
            chat = message.get('chat')
            if not chat or 'id' not in chat:
                continue

            text = message.get('text', '')
            chat_id = chat['id']

            # /start 코드 → 계정 연결
            if text.startswith('/start'):
                self._handle_link(message)
            # 답장 → 댓글 등록
            elif message.get('reply_to_message'):
                self._handle_reply(message)

    # =========================================================================
    # 링크 처리
    # =========================================================================

    def _handle_link(self, message: Dict):
        """'/start 코드' 메시지 처리 → 계정 연결"""
        from ..database.auth_manager import auth_manager

        text = message.get('text', '')
        chat_id = message['chat']['id']
        parts = text.split()

        if len(parts) < 2:
            # /start만 보낸 경우
            self._send_message(chat_id,
                "안녕하세요! 금일작업현황 관리 알림 봇입니다.\n\n"
                "앱 설정에서 '텔레그램 연결하기'를 클릭하면 연결 링크가 생성됩니다.")
            return

        code = parts[1].strip()
        user_id = auth_manager.consume_link_code(code, chat_id)

        if user_id:
            # 사용자 이름 조회
            user_info = auth_manager.get_user_by_chat_id(chat_id)
            name = user_info['full_name'] if user_info else user_id
            self._send_message(chat_id,
                f"✅ 연결 완료!\n{name}님의 계정이 텔레그램과 연결되었습니다.\n\n"
                "이제 프로젝트 댓글 알림을 받게 됩니다.\n"
                "알림에 답장하면 해당 프로젝트에 댓글이 등록됩니다.")
        else:
            self._send_message(chat_id,
                "❌ 유효하지 않은 코드입니다.\n코드가 만료되었거나 이미 사용되었습니다.\n"
                "앱에서 새 코드를 생성해주세요.")

    # =========================================================================
    # 답장 → 댓글
    # =========================================================================

    def _handle_reply(self, message: Dict):
        """텔레그램 답장을 앱 댓글로 등록"""
        from ..database.auth_manager import auth_manager
        from ..database.db_manager import db

        chat_id = message['chat']['id']
        reply_text = message.get('text', '').strip()
        reply_to = message.get('reply_to_message', {})
        reply_msg_id = reply_to.get('message_id')

        if not reply_text or not reply_msg_id:
            return

        # 사용자 식별
        user_info = auth_manager.get_user_by_chat_id(chat_id)
        if not user_info:
            self._send_message(chat_id, "❌ 연결된 계정을 찾을 수 없습니다. 앱에서 다시 연결해주세요.")
            return

        # 프로젝트 매핑 조회
        project = auth_manager.get_project_by_reply(reply_msg_id, chat_id)
        if not project:
            self._send_message(chat_id, "❌ 이 메시지에 연결된 프로젝트를 찾을 수 없습니다.")
            return

        contract_number = project.get('contract_number', '')
        board_project_id = project.get('board_project_id')

        # 댓글 등록
        try:
            comment_id = db.add_comment(
                contract_number=contract_number,
                user_id=user_info['user_id'],
                user_name=user_info['full_name'],
                content=reply_text,
                parent_id=None,
                board_project_id=board_project_id
            )

            if comment_id:
                self._send_message(chat_id, "✅ 댓글이 등록되었습니다.")

                # 다른 사용자에게도 알림 발송
                ship_name = self._get_ship_name(contract_number, board_project_id)
                self.send_comment_notification(
                    contract_number=contract_number,
                    board_project_id=board_project_id,
                    commenter_user_id=user_info['user_id'],
                    commenter_name=user_info['full_name'],
                    comment_text=reply_text,
                    ship_name=ship_name
                )
            else:
                self._send_message(chat_id, "❌ 댓글 등록에 실패했습니다.")

        except Exception as e:
            logger.error(f"텔레그램 답장→댓글 변환 실패: {e}")
            self._send_message(chat_id, "❌ 댓글 등록 중 오류가 발생했습니다.")

    # =========================================================================
    # 알림 발송
    # =========================================================================

    def send_comment_notification(self, contract_number: str, board_project_id: int,
                                  commenter_user_id: str, commenter_name: str,
                                  comment_text: str, ship_name: str):
        """모든 연결 사용자에게 댓글 알림 발송 (작성자 제외)"""
        if not self.enabled or not self.bot_token:
            return

        from ..database.auth_manager import auth_manager

        linked_users = auth_manager.get_all_linked_chat_ids()
        if not linked_users:
            return

        # 알림 메시지 구성
        text = (
            f"💬 댓글 알림\n"
            f"━━━━━━━━━━━━━━\n"
            f"📌 선박: {ship_name or '(미지정)'}\n"
            f"👤 작성자: {commenter_name}\n"
            f"📝 {comment_text}\n"
            f"━━━━━━━━━━━━━━\n"
            f"이 메시지에 답장하면 댓글이 등록됩니다."
        )

        for user in linked_users:
            # 작성자 본인에게는 알림 안 보냄
            if user['user_id'] == commenter_user_id:
                continue

            chat_id = int(user['telegram_chat_id'])
            msg_id = self._send_message(chat_id, text)

            # 메시지 매핑 저장 (답장 시 프로젝트 식별용)
            if msg_id:
                auth_manager.save_message_mapping(
                    telegram_message_id=msg_id,
                    chat_id=chat_id,
                    contract_number=contract_number or '',
                    board_project_id=board_project_id
                )

    # =========================================================================
    # 유틸리티
    # =========================================================================

    def _send_message(self, chat_id: int, text: str) -> Optional[int]:
        """텔레그램 메시지 전송. 성공 시 message_id 반환"""
        try:
            url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"
            payload = {
                'chat_id': chat_id,
                'text': text,
                'parse_mode': 'HTML'
            }
            resp = requests.post(url, json=payload, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                if data.get('ok'):
                    return data.get('result', {}).get('message_id')
            else:
                logger.error(f"텔레그램 메시지 전송 실패: {resp.status_code}")
        except Exception as e:
            logger.error(f"텔레그램 메시지 전송 오류: {e}")
        return None

    def _get_ship_name(self, contract_number: str, board_project_id: int) -> str:
        """프로젝트의 선박명 조회"""
        try:
            from ..database.db_manager import db

            if board_project_id:
                with db.get_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT ship_name FROM board_projects WHERE id = ?', (board_project_id,))
                    row = cursor.fetchone()
                    if row:
                        return row['ship_name'] or ''

            if contract_number:
                with db.get_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute('SELECT ship_name FROM work_records WHERE contract_number = ? LIMIT 1',
                                   (contract_number,))
                    row = cursor.fetchone()
                    if row:
                        return row['ship_name'] or ''
        except Exception as e:
            logger.error(f"선박명 조회 실패: {e}")
        return ''


# 싱글톤 인스턴스
telegram_notifier = TelegramNotifier()
