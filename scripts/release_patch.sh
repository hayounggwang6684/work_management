#!/usr/bin/env bash
set -euo pipefail

# GitHub Release + patch asset 업로드 스크립트
# 요구사항
# - gh CLI 설치/로그인 (GH_TOKEN 환경변수 권장)
# - patch 디렉토리에 patch.json 포함
#
# 사용 예시:
#   GH_TOKEN=... ./scripts/release_patch.sh \
#     --version 1.1.7 \
#     --patch-dir ./patches/patch-v1.1.7 \
#     --notes-file ./docs/releases/v1.1.7.md

usage() {
  cat <<'EOF'
Usage:
  release_patch.sh --version <semver> --patch-dir <dir> [--repo <owner/name>] [--title <text>] [--notes-file <md>]

Options:
  --version     릴리즈 버전 (예: 1.1.7, 자동으로 태그 v1.1.7 생성)
  --patch-dir   patch.json이 포함된 패치 디렉토리 경로
  --repo        GitHub 저장소 (기본값: hayounggwang6684/work_management)
  --title       릴리즈 제목 (기본값: v<version>)
  --notes-file  릴리즈 노트 markdown 파일 경로
EOF
}

REPO="hayounggwang6684/work_management"
VERSION=""
PATCH_DIR=""
TITLE=""
NOTES_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --patch-dir)
      PATCH_DIR="${2:-}"
      shift 2
      ;;
    --repo)
      REPO="${2:-}"
      shift 2
      ;;
    --title)
      TITLE="${2:-}"
      shift 2
      ;;
    --notes-file)
      NOTES_FILE="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$VERSION" || -z "$PATCH_DIR" ]]; then
  echo "--version, --patch-dir는 필수입니다." >&2
  usage
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI가 필요합니다. https://cli.github.com/ 에서 설치하세요." >&2
  exit 1
fi

if [[ ! -d "$PATCH_DIR" ]]; then
  echo "패치 디렉토리를 찾을 수 없습니다: $PATCH_DIR" >&2
  exit 1
fi

if [[ ! -f "$PATCH_DIR/patch.json" ]]; then
  echo "patch.json이 없습니다: $PATCH_DIR/patch.json" >&2
  exit 1
fi

if [[ -n "$NOTES_FILE" && ! -f "$NOTES_FILE" ]]; then
  echo "릴리즈 노트 파일을 찾을 수 없습니다: $NOTES_FILE" >&2
  exit 1
fi

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "GH_TOKEN 환경변수를 설정하세요. (repo 권한 PAT)" >&2
  exit 1
fi

if [[ -z "$TITLE" ]]; then
  TITLE="v$VERSION"
fi

TAG="v$VERSION"
PATCH_BASENAME="$(basename "$PATCH_DIR")"
ZIP_NAME="${PATCH_BASENAME}.zip"
ZIP_PATH="/tmp/${ZIP_NAME}"

# zip 생성 (최상위 폴더 포함)
PARENT_DIR="$(cd "$(dirname "$PATCH_DIR")" && pwd)"
PATCH_FOLDER_NAME="$(basename "$PATCH_DIR")"
(
  cd "$PARENT_DIR"
  rm -f "$ZIP_PATH"
  zip -r "$ZIP_PATH" "$PATCH_FOLDER_NAME" >/dev/null
)

echo "패치 zip 생성: $ZIP_PATH"

# release 생성 (이미 있으면 실패하지 않음)
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "기존 릴리즈가 존재합니다: $TAG"
else
  if [[ -n "$NOTES_FILE" ]]; then
    gh release create "$TAG" \
      --repo "$REPO" \
      --title "$TITLE" \
      --notes-file "$NOTES_FILE"
  else
    gh release create "$TAG" \
      --repo "$REPO" \
      --title "$TITLE" \
      --notes "Patch release $TAG"
  fi
  echo "릴리즈 생성 완료: $TAG"
fi

# asset 업로드 (동일 이름 있으면 덮어쓰기)
gh release upload "$TAG" "$ZIP_PATH" \
  --repo "$REPO" \
  --clobber

echo "asset 업로드 완료: $TAG / $ZIP_NAME"
