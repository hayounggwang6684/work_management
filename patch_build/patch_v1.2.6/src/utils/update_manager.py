# src/utils/update_manager.py - GitHub Release 패치 ZIP 다운로드 관리자
#
# 흐름:
# 1. GitHub Release에서 패치 ZIP 파일(asset) 검색
# 2. 아직 다운로드/적용하지 않은 패치 ZIP 다운로드
# 3. patches/ 폴더에 압축 해제 (patch.json + 파일들)
# 4. patch_system.py가 시작 시 자동 적용

import requests
import json
import zipfile
import tempfile
from pathlib import Path
from typing import Dict, Any, Optional, List
from datetime import datetime
from packaging import version

from .logger import logger
from .config import config


class UpdateManager:
    """GitHub Release 패치 ZIP 기반 업데이트 관리자"""

    def __init__(self):
        # GitHub 저장소 정보
        self.github_repo_owner = "hayounggwang6684"
        self.github_repo_name = "work_management"
        self.api_base_url = "https://api.github.com"
        self.current_version = config.version

        # Private repo 토큰
        self.github_token = config.get('update.github_token', '')

        # 로컬 경로
        self.app_root = Path(__file__).parent.parent.parent
        self.patches_dir = self.app_root / "patches"
        self.data_dir = self.app_root / "data"
        self.update_cache_file = Path(config.db_path).parent / "update_cache.json"
        self.downloaded_patches_file = self.data_dir / "downloaded_patches.json"
        self.update_check_interval = 86400  # 24시간

        # 디렉토리 생성
        self.patches_dir.mkdir(parents=True, exist_ok=True)
        self.data_dir.mkdir(parents=True, exist_ok=True)

    def _get_headers(self, with_token: bool = True) -> Dict[str, str]:
        """GitHub API 요청 헤더"""
        headers = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'WorkManagement-UpdateChecker'
        }
        if with_token and self.github_token:
            headers['Authorization'] = f'token {self.github_token}'
        return headers

    def _get_downloaded_patches(self) -> List[str]:
        """이미 다운로드한 패치 파일 목록"""
        try:
            if self.downloaded_patches_file.exists():
                with open(self.downloaded_patches_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    return data.get('downloaded', [])
        except Exception as e:
            logger.error(f"다운로드 이력 로드 실패: {e}")
        return []

    def _save_downloaded_patch(self, asset_name: str):
        """다운로드 완료 기록"""
        downloaded = self._get_downloaded_patches()
        if asset_name not in downloaded:
            downloaded.append(asset_name)

        data = {
            'downloaded': downloaded,
            'last_updated': datetime.now().isoformat()
        }
        try:
            with open(self.downloaded_patches_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"다운로드 이력 저장 실패: {e}")

    def check_for_updates(self, force: bool = False) -> Dict[str, Any]:
        """
        업데이트 확인

        GitHub Release에서 패치 ZIP 파일이 있는지 확인.
        반환값은 기존 API와 호환되는 형식 유지.
        """
        try:
            # 캐시 확인
            if not force:
                cached = self._get_cached_update_info()
                if cached and not self._is_cache_expired(cached):
                    # 앱 버전이 바뀌었으면 캐시 무효화 (업데이트 후 스테일 캐시 방지)
                    cached_current = cached.get('data', {}).get('current_version', '')
                    if cached_current == self.current_version:
                        logger.info("캐시된 업데이트 정보 사용")
                        return cached['data']
                    logger.info("앱 버전 변경으로 캐시 무효화")

            logger.info("GitHub에서 패치 업데이트 확인 중...")

            # 모든 릴리스에서 미적용 패치 ZIP 검색
            new_patches = self._find_new_patch_assets()

            if not new_patches:
                # ZIP 에셋이 없어도 tag_name 버전 비교로 2차 판단
                latest_release = self._get_latest_release()
                if latest_release:
                    latest_ver = latest_release['tag_name'].lstrip('v')
                    try:
                        if version.parse(latest_ver) > version.parse(self.current_version):
                            result = {
                                'update_available': True,
                                'current_version': self.current_version,
                                'latest_version': latest_ver,
                                'release_name': f'v{latest_ver}',
                                'release_notes': latest_release.get('body', ''),
                                'patches': [],
                                'message': f'새 버전 v{latest_ver}이 있습니다. GitHub에서 다운로드하세요.',
                                'manual_download': True
                            }
                            self._cache_update_info(result)
                            logger.info(f"새 버전 발견 (에셋 없음): {latest_ver}")
                            return result
                    except Exception:
                        pass

                result = {
                    'update_available': False,
                    'current_version': self.current_version,
                    'message': '최신 버전입니다.',
                    'patches': []
                }
                self._cache_update_info(result)
                return result

            # 최신 릴리스 정보 가져오기
            latest_release = self._get_latest_release()
            latest_version = self.current_version
            release_notes = ''
            if latest_release:
                latest_version = latest_release['tag_name'].lstrip('v')
                release_notes = latest_release.get('body', '')

            result = {
                'update_available': True,
                'current_version': self.current_version,
                'latest_version': latest_version,
                'release_name': f"패치 {len(new_patches)}개 사용 가능",
                'release_notes': release_notes,
                'patches': [
                    {
                        'name': p['name'],
                        'size': p['size'],
                        'download_url': p['url'],
                        'release_tag': p['release_tag']
                    }
                    for p in new_patches
                ],
                'message': f'새로운 패치 {len(new_patches)}개가 있습니다.'
            }

            self._cache_update_info(result)
            logger.info(f"새 패치 {len(new_patches)}개 발견")
            return result

        except Exception as e:
            logger.error(f"업데이트 확인 실패: {e}")
            return {
                'update_available': False,
                'current_version': self.current_version,
                'error': str(e),
                'message': '업데이트 확인 중 오류가 발생했습니다.',
                'patches': []
            }

    def _find_new_patch_assets(self) -> List[Dict[str, Any]]:
        """GitHub Release에서 아직 다운로드하지 않은 패치 ZIP 찾기"""
        downloaded = self._get_downloaded_patches()
        new_patches = []

        try:
            # 최근 10개 릴리스 확인
            releases = self._get_all_releases(per_page=10)

            for release in releases:
                release_tag = release.get('tag_name', '')

                # 현재 버전 이하의 릴리스는 건너뜀 (이미 적용됐거나 더 낮은 버전)
                try:
                    release_ver = release_tag.lstrip('v')
                    if version.parse(release_ver) <= version.parse(self.current_version):
                        continue
                except Exception:
                    pass  # 버전 파싱 실패 시 포함 (안전한 기본값)

                assets = release.get('assets', [])

                for asset in assets:
                    name = asset['name']
                    # ZIP 파일이면 모두 패치 에셋으로 인식 (파일명 형식 무관)
                    if name.endswith('.zip'):
                        if name not in downloaded:
                            asset_id = asset['id']
                            api_download_url = (
                                f"{self.api_base_url}/repos/"
                                f"{self.github_repo_owner}/{self.github_repo_name}"
                                f"/releases/assets/{asset_id}"
                            )
                            new_patches.append({
                                'name': name,
                                'size': asset['size'],
                                'url': api_download_url,
                                'browser_url': asset.get('browser_download_url', ''),
                                'release_tag': release_tag,
                                'asset_id': asset_id
                            })

        except Exception as e:
            logger.error(f"패치 검색 실패: {e}")

        return new_patches

    def download_and_apply_patches(self) -> Dict[str, Any]:
        """
        모든 새 패치 ZIP 다운로드 + patches/ 폴더에 압축 해제

        patch_system.py가 나중에 자동 적용할 수 있도록 파일만 배치.
        """
        try:
            new_patches = self._find_new_patch_assets()

            if not new_patches:
                return {
                    'success': True,
                    'message': '적용할 패치가 없습니다.',
                    'applied_count': 0
                }

            applied_count = 0
            errors = []

            for patch_info in new_patches:
                try:
                    logger.info(f"패치 다운로드 중: {patch_info['name']}")

                    # ZIP 다운로드
                    zip_path = self._download_patch_zip(patch_info)
                    if not zip_path:
                        errors.append(f"{patch_info['name']}: 다운로드 실패")
                        continue

                    # patches/ 폴더에 압축 해제
                    extracted = self._extract_patch_zip(zip_path)
                    if not extracted:
                        errors.append(f"{patch_info['name']}: 압축 해제 실패")
                        continue

                    # 다운로드 완료 기록
                    self._save_downloaded_patch(patch_info['name'])
                    applied_count += 1

                    logger.info(f"패치 준비 완료: {patch_info['name']} → {extracted}")

                    # 임시 파일 삭제
                    try:
                        zip_path.unlink()
                    except Exception:
                        pass

                except Exception as e:
                    errors.append(f"{patch_info['name']}: {str(e)}")
                    logger.error(f"패치 처리 실패: {patch_info['name']} - {e}")

            # patch_system으로 실제 적용
            from .patch_system import patch_system
            patches_applied = patch_system.check_and_apply_patches()

            if applied_count > 0 and patches_applied == 0 and not errors:
                # 다운로드는 됐지만 patch.json 없어서 적용 파일 없음 → 최신 버전으로 처리
                message = f'v{self.current_version} 파일이 다운로드되었습니다. 이미 최신 상태입니다.'
            else:
                message = f'{applied_count}개 패치 다운로드, {patches_applied}개 적용 완료.'
                if errors:
                    message += f' 오류: {"; ".join(errors)}'

            if patches_applied > 0:
                message += ' 프로그램을 재시작하면 변경사항이 완전히 적용됩니다.'

            return {
                'success': True,
                'message': message,
                'downloaded_count': applied_count,
                'applied_count': patches_applied,
                'errors': errors,
                'needs_restart': patches_applied > 0
            }

        except Exception as e:
            logger.error(f"패치 적용 실패: {e}")
            return {
                'success': False,
                'message': f'패치 적용 중 오류: {str(e)}',
                'applied_count': 0
            }

    def _download_patch_zip(self, patch_info: Dict[str, Any]) -> Optional[Path]:
        """패치 ZIP 파일 다운로드 (Public repo: 토큰 없이 browser_download_url 우선 사용)"""
        temp_dir = Path(tempfile.gettempdir()) / "WorkManagement_Patches"
        temp_dir.mkdir(parents=True, exist_ok=True)
        zip_path = temp_dir / patch_info['name']

        # 시도할 URL 목록: browser_download_url(인증 불필요) → API URL(인증)
        attempts = []
        browser_url = patch_info.get('browser_url', '')
        if browser_url:
            attempts.append({'url': browser_url, 'headers': {'User-Agent': 'WorkManagement-UpdateChecker'}})
        attempts.append({'url': patch_info['url'],
                         'headers': {'Accept': 'application/octet-stream',
                                     'User-Agent': 'WorkManagement-UpdateChecker'}})
        if self.github_token:
            attempts.append({'url': patch_info['url'],
                             'headers': {'Accept': 'application/octet-stream',
                                         'Authorization': f'token {self.github_token}',
                                         'User-Agent': 'WorkManagement-UpdateChecker'}})

        for attempt in attempts:
            try:
                response = requests.get(attempt['url'], headers=attempt['headers'],
                                        stream=True, timeout=60, allow_redirects=True)
                if response.status_code == 200:
                    with open(zip_path, 'wb') as f:
                        for chunk in response.iter_content(chunk_size=8192):
                            if chunk:
                                f.write(chunk)
                    logger.info(f"패치 ZIP 다운로드 완료: {zip_path}")
                    return zip_path
                logger.warning(f"다운로드 실패 ({response.status_code}): {attempt['url'][:60]}")
            except Exception as e:
                logger.warning(f"다운로드 오류: {e}")

        logger.error(f"패치 ZIP 다운로드 최종 실패: {patch_info['name']}")
        return None

    def _extract_patch_zip(self, zip_path: Path) -> Optional[Path]:
        """
        패치 ZIP을 patches/ 폴더에 압축 해제

        ZIP 구조 예시:
        patch_v1.0.1_fix_login/
            patch.json
            src/web/api.py
            web/js/app.js

        → patches/patch_v1.0.1_fix_login/ 으로 해제
        """
        try:
            with zipfile.ZipFile(zip_path, 'r') as zf:
                # ZIP 내 최상위 폴더명 확인
                names = zf.namelist()
                if not names:
                    logger.error("빈 ZIP 파일")
                    return None

                # 최상위 폴더 추출 (모든 파일이 하나의 폴더 안에 있는지 확인)
                top_dirs = set()
                for name in names:
                    parts = name.split('/')
                    if parts[0]:
                        top_dirs.add(parts[0])

                if len(top_dirs) == 1:
                    # 하나의 폴더로 감싸져 있음 → 그대로 해제
                    patch_folder_name = top_dirs.pop()
                else:
                    # 여러 파일/폴더 → ZIP 파일명으로 폴더 생성
                    patch_folder_name = zip_path.stem

                extract_target = self.patches_dir / patch_folder_name

                # 이미 있으면 덮어쓰기
                if extract_target.exists():
                    import shutil
                    shutil.rmtree(extract_target)

                # 압축 해제
                zf.extractall(self.patches_dir)

                # patch.json 존재 확인 (없어도 경고만 출력하고 계속 진행)
                patch_json = extract_target / "patch.json"
                if not patch_json.exists():
                    logger.warning(f"patch.json이 없습니다 (소스 ZIP으로 간주): {extract_target}")
                    # patch.json 없는 소스 ZIP: 다운로드 완료 기록만 하고 정상 반환
                    # (patch_system.py가 적용할 파일이 없으면 건너뜀)

                logger.info(f"패치 압축 해제 완료: {extract_target}")
                return extract_target

        except zipfile.BadZipFile:
            logger.error(f"손상된 ZIP 파일: {zip_path}")
            return None
        except Exception as e:
            logger.error(f"압축 해제 실패: {e}")
            return None

    def _get_latest_release(self) -> Optional[Dict[str, Any]]:
        """GitHub에서 최신 릴리스 정보 가져오기 (토큰 만료 시 인증 없이 재시도)"""
        url = f"{self.api_base_url}/repos/{self.github_repo_owner}/{self.github_repo_name}/releases/latest"

        for with_token in (True, False):
            try:
                response = requests.get(url, headers=self._get_headers(with_token), timeout=10)
                if response.status_code == 200:
                    return response.json()
                if response.status_code in (401, 403):
                    logger.warning(f"GitHub 인증 실패 ({response.status_code}), 토큰 없이 재시도")
                    continue
                if response.status_code == 404:
                    logger.warning("릴리스를 찾을 수 없습니다.")
                    return None
                logger.error(f"GitHub API 오류: {response.status_code}")
                return None
            except requests.RequestException as e:
                logger.error(f"GitHub API 요청 실패: {e}")
                return None

        return None

    def _get_all_releases(self, page: int = 1, per_page: int = 10) -> list:
        """모든 릴리스 목록 가져오기 (토큰 만료 시 인증 없이 재시도)"""
        url = f"{self.api_base_url}/repos/{self.github_repo_owner}/{self.github_repo_name}/releases"
        params = {'page': page, 'per_page': per_page}

        for with_token in (True, False):
            try:
                response = requests.get(url, headers=self._get_headers(with_token),
                                        params=params, timeout=10)
                if response.status_code == 200:
                    return response.json()
                if response.status_code in (401, 403):
                    # 토큰 무효 → 인증 없이 재시도 (public repo인 경우 동작)
                    logger.warning(f"GitHub 인증 실패 ({response.status_code}), 토큰 없이 재시도")
                    continue
                logger.error(f"GitHub API 오류: {response.status_code}")
                return []
            except Exception as e:
                logger.error(f"릴리스 목록 가져오기 실패: {e}")
                return []

        return []

    def get_release_notes(self, version_tag: str) -> Optional[str]:
        """특정 버전의 릴리스 노트 가져오기"""
        try:
            url = f"{self.api_base_url}/repos/{self.github_repo_owner}/{self.github_repo_name}/releases/tags/{version_tag}"
            response = requests.get(url, headers=self._get_headers(), timeout=10)

            if response.status_code == 200:
                data = response.json()
                return data.get('body', '')
            return None

        except Exception as e:
            logger.error(f"릴리스 노트 가져오기 실패: {e}")
            return None

    def get_all_releases(self, page: int = 1, per_page: int = 10) -> list:
        """외부 호출용 릴리스 목록"""
        return self._get_all_releases(page, per_page)

    # --- 캐시 관리 ---

    def _cache_update_info(self, data: Dict[str, Any]):
        """업데이트 정보 캐시"""
        try:
            cache = {
                'timestamp': datetime.now().isoformat(),
                'data': data
            }
            self.update_cache_file.parent.mkdir(parents=True, exist_ok=True)
            with open(self.update_cache_file, 'w', encoding='utf-8') as f:
                json.dump(cache, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"캐시 저장 실패: {e}")

    def _get_cached_update_info(self) -> Optional[Dict[str, Any]]:
        """캐시된 업데이트 정보"""
        try:
            if not self.update_cache_file.exists():
                return None
            with open(self.update_cache_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"캐시 로드 실패: {e}")
            return None

    def _is_cache_expired(self, cache: Dict[str, Any]) -> bool:
        """캐시 만료 여부"""
        try:
            timestamp = datetime.fromisoformat(cache['timestamp'])
            elapsed = (datetime.now() - timestamp).total_seconds()
            return elapsed > self.update_check_interval
        except Exception:
            return True


# 싱글톤 인스턴스
update_manager = UpdateManager()
