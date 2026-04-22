# src/utils/patch_system.py - 패치 시스템

import json
import re
import shutil
from pathlib import Path
from typing import Dict, List
from packaging import version
from .logger import logger
from .config import config


class PatchSystem:
    """
    패치 시스템

    patches/ 폴더에서 패치를 찾아 자동으로 적용
    """

    def __init__(self):
        self.app_root = Path(__file__).parent.parent.parent
        self.patches_dir = self.app_root / "patches"
        self.current_version = config.version
        self.applied_patches_file = self.app_root / "data" / "applied_patches.json"

        # 패치 디렉토리 생성
        self.patches_dir.mkdir(parents=True, exist_ok=True)
        self.applied_patches_file.parent.mkdir(parents=True, exist_ok=True)

        # 구버전 patch_system이 settings.json 미갱신 시 대비: 시작 시 버전 자동 보정
        self._correct_version_from_applied_patches()
        # 구버전 patch_system이 미정리한 패치 디렉토리 정리
        self._cleanup_old_patch_dirs()

    def _correct_version_from_applied_patches(self):
        """applied_patches.json 기반 버전 보정 (구버전 patch_system 호환)"""
        try:
            latest_applied = self._get_latest_applied_version()
            if latest_applied is None:
                return
            current_ver = version.parse(self.current_version)
            update_ver = version.parse(str(config.get('update.current_version', self.current_version)))
            effective_current = max(current_ver, update_ver)
            if latest_applied > effective_current or current_ver != update_ver:
                new_ver = str(max(latest_applied, effective_current))
                logger.info(
                    f"버전 자동 보정: app={self.current_version}, "
                    f"update={update_ver} → {new_ver} (적용된 패치 기반)"
                )
                self._sync_config_version(new_ver)
        except Exception as e:
            logger.warning(f"버전 보정 실패 (무시): {e}")

    def _get_latest_applied_version(self):
        """applied_patches.json에 기록된 최신 패치 버전 반환"""
        versions = []
        for patch_id in self.get_applied_patches():
            m = re.search(r'(\d+\.\d+\.\d+)', str(patch_id))
            if m:
                try:
                    versions.append(version.parse(m.group(1)))
                except Exception:
                    pass
        return max(versions) if versions else None

    def _sync_config_version(self, new_ver: str):
        """앱 표시 버전과 업데이트 기준 버전을 항상 함께 저장"""
        config.set('app.version', new_ver)
        config.set('update.current_version', new_ver)
        config.save()
        self.current_version = new_ver

    def _cleanup_old_patch_dirs(self):
        """현재 버전 이하 패치 디렉토리 정리 (재다운로드 루프 방지)"""
        try:
            current_ver = version.parse(self.current_version)
            for patch_dir in self.patches_dir.iterdir():
                if not patch_dir.is_dir():
                    continue
                patch_json = patch_dir / "patch.json"
                if not patch_json.exists():
                    continue
                try:
                    with open(patch_json, 'r', encoding='utf-8') as f:
                        info = json.load(f)
                    patch_ver = version.parse(str(info.get('version', '0.0.0')))
                    if patch_ver <= current_ver:
                        shutil.rmtree(patch_dir)
                        logger.info(f"구버전 패치 디렉토리 정리: {patch_dir.name}")
                except Exception:
                    pass
        except Exception as e:
            logger.warning(f"패치 디렉토리 정리 실패 (무시): {e}")
    
    def get_applied_patches(self) -> List[str]:
        """적용된 패치 목록 가져오기"""
        try:
            if self.applied_patches_file.exists():
                with open(self.applied_patches_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    return data.get('patches', [])
        except Exception as e:
            logger.error(f"적용된 패치 목록 로드 실패: {e}")
        
        return []
    
    def save_applied_patch(self, patch_id: str):
        """적용된 패치 기록"""
        applied = self.get_applied_patches()
        if patch_id not in applied:
            applied.append(patch_id)
            
        data = {
            'patches': applied,
            'last_updated': self.current_version
        }
        
        try:
            with open(self.applied_patches_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"적용된 패치 저장 실패: {e}")
    
    def find_available_patches(self) -> List[Dict]:
        """적용 가능한 패치 찾기"""
        available_patches = []
        applied = self.get_applied_patches()
        current_ver = version.parse(self.current_version)
        
        # patches/ 폴더 스캔
        if not self.patches_dir.exists():
            return []
        
        for patch_dir in self.patches_dir.iterdir():
            if not patch_dir.is_dir():
                continue
            
            patch_json = patch_dir / "patch.json"
            if not patch_json.exists():
                continue
            
            try:
                with open(patch_json, 'r', encoding='utf-8') as f:
                    patch_info = json.load(f)
                    patch_id = patch_info.get('id', patch_dir.name)
                    
                    # 이미 적용된 패치는 제외
                    if patch_id in applied:
                        continue

                    patch_version_text = str(patch_info.get('version', '0.0.0'))
                    patch_version = version.parse(patch_version_text)

                    # 현재 버전 이하 패치는 건너뜀
                    if patch_version <= current_ver:
                        continue

                    patch_info['id'] = patch_id
                    patch_info['path'] = patch_dir
                    patch_info['_parsed_version'] = patch_version
                    available_patches.append(patch_info)
                    
            except Exception as e:
                logger.error(f"패치 정보 읽기 실패 ({patch_dir}): {e}")
        
        # 버전 순서로 정렬
        available_patches.sort(key=lambda x: x.get('_parsed_version', version.parse('0.0.0')))
        
        return available_patches
    
    def apply_patch(self, patch_info: Dict) -> bool:
        """패치 적용"""
        patch_id = patch_info['id']
        patch_dir = patch_info['path']

        logger.info(f"패치 적용 시작: {patch_id} - {patch_info.get('description', '')}")

        try:
            # 백업 생성 (실패 시 패치 중단 — 롤백 불가 방지)
            try:
                self._create_backup()
            except Exception as be:
                logger.error(f"백업 생성 실패, 패치 중단: {be}")
                return False

            # 파일 복사
            files = patch_info.get('files', [])
            files_copied = 0
            for file_info in files:
                # files 항목이 문자열인 경우 dict로 정규화
                if isinstance(file_info, str):
                    file_info = {'source': file_info, 'target': file_info}

                source_path = patch_dir / file_info['source']
                target_path = self.app_root / file_info['target']

                if not source_path.exists():
                    logger.warning(f"패치 파일을 찾을 수 없음: {source_path}")
                    continue

                # 타겟 디렉토리 생성
                target_path.parent.mkdir(parents=True, exist_ok=True)

                # 파일 복사
                shutil.copy2(source_path, target_path)
                logger.info(f"파일 복사: {file_info['source']} → {file_info['target']}")
                files_copied += 1

            # 파일이 하나도 복사 안 됐으면 패치 실패 (applied 기록 안 함)
            if files and files_copied == 0:
                logger.error(f"패치 파일을 하나도 복사하지 못함: {patch_id}")
                return False

            # ① settings.json 버전 갱신 — 적용 이력 저장 전에 먼저 맞춰 last_updated도 최신화
            try:
                new_ver = str(patch_info.get('version', self.current_version))
                self._sync_config_version(new_ver)
                logger.info(f"버전 갱신 완료: {new_ver}")
            except Exception as ve:
                logger.warning(f"버전 갱신 실패 (무시): {ve}")

            # 패치 적용 기록
            self.save_applied_patch(patch_id)
            logger.info(f"패치 적용 완료: {patch_id}")

            # ② 패치 디렉토리 정리 — 재다운로드 무한 루프 방지
            try:
                shutil.rmtree(patch_dir)
                logger.info(f"패치 디렉토리 정리: {patch_dir}")
            except Exception as ce:
                logger.warning(f"패치 디렉토리 정리 실패 (무시): {ce}")

            return True

        except Exception as e:
            logger.error(f"패치 적용 실패 ({patch_id}): {e}")
            return False
    
    def _create_backup(self):
        """백업 생성"""
        from datetime import datetime

        backup_dir = self.app_root / "backups" / f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        backup_dir.mkdir(parents=True, exist_ok=True)

        # src 폴더 백업 (__pycache__ / .pyc 제외)
        src_dir = self.app_root / "src"
        if src_dir.exists():
            shutil.copytree(
                src_dir,
                backup_dir / "src",
                dirs_exist_ok=True,
                ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.pyo'),
            )

        logger.info(f"백업 생성: {backup_dir}")
    
    def check_and_apply_patches(self) -> int:
        """패치 확인 및 자동 적용"""
        available_patches = self.find_available_patches()
        
        if not available_patches:
            logger.info("적용 가능한 패치가 없습니다.")
            return 0
        
        applied_count = 0
        for patch in available_patches:
            min_required = patch.get('min_version')
            current_ver = version.parse(self.current_version)
            if min_required and current_ver < version.parse(str(min_required)):
                logger.warning(
                    f"패치 {patch.get('id')} 스킵: 최소 버전 {min_required} 필요 (현재 {self.current_version})"
                )
                continue

            if self.apply_patch(patch):
                applied_count += 1
                # 최신 적용 버전으로 내부 상태 갱신 (런타임 기준)
                self.current_version = str(patch.get('version', self.current_version))
        
        if applied_count > 0:
            logger.info(f"총 {applied_count}개의 패치가 적용되었습니다.")
        
        return applied_count


# 싱글톤 인스턴스
patch_system = PatchSystem()
