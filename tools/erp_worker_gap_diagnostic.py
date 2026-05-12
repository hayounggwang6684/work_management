"""ERP worker-field gap diagnostics.

Scans work_records, runs the ERP macro worker formatter offline, and emits
test bundles/checklists so blank worker-field issues can be separated into:

1. data / formatter problems (`workers_str` becomes empty or suspiciously short)
2. ERP focus / paste timing problems (offline output looks fine, ERP is blank)

Usage examples:
    python tools/erp_worker_gap_diagnostic.py
    python tools/erp_worker_gap_diagnostic.py --db "C:\\Users\\admin\\Desktop\\work_management.db"
    python tools/erp_worker_gap_diagnostic.py --start-date 2026-04-01 --end-date 2026-05-31
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = REPO_ROOT / "artifacts" / "erp_worker_diagnostics"
DEFAULT_DB_CANDIDATES = [
    Path(r"C:\Users\admin\Desktop\work_management.db"),
    REPO_ROOT / "db" / "work_management.db",
    REPO_ROOT / "work_management.db",
]


def _load_formatter():
    import sys

    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))
    from src.utils.erp_macro import ERPMacro

    return ERPMacro()


FORMATTER = _load_formatter()
VENDOR_CONTRACT_RE = re.compile(r"[^()\[\],]+\([^)]+\)")
VENDOR_DAILY_RE = re.compile(r"[^()\[\],]+\[[^\]]+\]")
HTML_TAG_RE = re.compile(r"<[^>]+>")
VISIBLE_CHAR_RE = re.compile(r"[A-Za-z0-9가-힣]")


@dataclass
class RecordCase:
    source: str
    date: str
    record_number: int
    contract_number: str
    leader: str
    teammates: str
    workers_str: str
    category: str
    has_markup: bool
    suspicious_empty: bool
    suspicious_short: bool
    raw_visible_length: int
    formatted_length: int


def pick_default_db_path() -> Path:
    for candidate in DEFAULT_DB_CANDIDATES:
        if candidate.exists():
            return candidate
    return DEFAULT_DB_CANDIDATES[0]


def strip_markup(text: str) -> str:
    cleaned = HTML_TAG_RE.sub("", str(text or ""))
    cleaned = cleaned.replace("*", "")
    return cleaned.strip()


def has_markup(leader: str, teammates: str) -> bool:
    joined = f"{leader or ''} {teammates or ''}"
    return "<i>" in joined.lower() or "*" in joined


def detect_category(leader: str, teammates: str) -> str:
    leader_clean = strip_markup(leader)
    teammates_clean = strip_markup(teammates)
    has_contract = bool(VENDOR_CONTRACT_RE.search(teammates_clean))
    has_daily = bool(VENDOR_DAILY_RE.search(teammates_clean))
    has_irregular_count = bool(re.search(r"\d+\s*명", teammates_clean))

    remaining = teammates_clean
    remaining = VENDOR_CONTRACT_RE.sub("", remaining)
    remaining = VENDOR_DAILY_RE.sub("", remaining)
    plain_parts = [part.strip() for part in remaining.split(",") if part.strip()]

    if leader_clean and not teammates_clean:
        return "leader_only"
    if not leader_clean and plain_parts and not has_contract and not has_daily:
        return "teammates_only"
    if has_contract and not has_daily and not leader_clean and not plain_parts:
        return "vendor_contract_only"
    if has_daily and not has_contract and not leader_clean and not plain_parts:
        return "vendor_daily_only"
    if has_irregular_count and not has_contract and not has_daily:
        return "irregular_count_text"
    if has_markup(leader, teammates):
        return "markup"
    if has_contract or has_daily or leader_clean or plain_parts:
        return "mixed"
    return "empty"


def visible_source_text(leader: str, teammates: str) -> str:
    return " ".join(part for part in [strip_markup(leader), strip_markup(teammates)] if part).strip()


def is_suspicious_short(leader: str, teammates: str, workers_str: str) -> bool:
    visible = visible_source_text(leader, teammates)
    if not visible or not workers_str:
        return False

    formatted = strip_markup(workers_str)
    visible_len = len(visible)
    formatted_len = len(formatted)
    contains_structured_source = any(token in visible for token in [",", "(", "[", "]", ")"])
    has_visible_chars = bool(VISIBLE_CHAR_RE.search(formatted))

    if contains_structured_source and formatted_len < 2:
        return True
    if visible_len >= 8 and formatted_len <= max(1, visible_len // 5):
        return True
    if not has_visible_chars:
        return True
    return False


def analyze_records(db_path: Path, start_date: str, end_date: str) -> list[RecordCase]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT date, record_number, contract_number, leader, teammates
            FROM work_records
            WHERE date >= ? AND date <= ?
              AND (COALESCE(leader, '') != '' OR COALESCE(teammates, '') != '')
            ORDER BY date, work_type, record_number
            """,
            (start_date, end_date),
        ).fetchall()
    finally:
        conn.close()

    cases: list[RecordCase] = []
    for row in rows:
        leader = row["leader"] or ""
        teammates = row["teammates"] or ""
        workers_str = FORMATTER._format_workers(leader, teammates)
        visible = visible_source_text(leader, teammates)
        formatted = strip_markup(workers_str)
        category = detect_category(leader, teammates)
        empty_flag = bool(visible) and not formatted
        cases.append(
            RecordCase(
                source="db",
                date=row["date"] or "",
                record_number=int(row["record_number"] or 0),
                contract_number=row["contract_number"] or "",
                leader=leader,
                teammates=teammates,
                workers_str=workers_str,
                category=category,
                has_markup=has_markup(leader, teammates),
                suspicious_empty=empty_flag,
                suspicious_short=is_suspicious_short(leader, teammates, workers_str),
                raw_visible_length=len(visible),
                formatted_length=len(formatted),
            )
        )
    return cases


def build_synthetic_cases() -> list[RecordCase]:
    synthetic_rows = [
        ("leader_only", "차장 이주호", ""),
        ("teammates_only", "", "박보성, 전정운"),
        ("vendor_contract_only", "", "금보(김순배, 김순용, 김민형)"),
        ("vendor_daily_only", "", "개인[김영언, 이정훈]"),
        ("mixed", "대리 하영광", "반규석, 개인[김영언, 이정훈], 우성(최종백)"),
        ("markup", "<i>과장 허종회</i>", "<i>전정운</i>, 금보[<i>김순용</i>]"),
        ("irregular_count_text", "대리 하영광", "반규석, 씨엠텍코리아 3명"),
        ("delimiter_only", "", ", ,"),
        ("whitespace_only", "   ", "   "),
    ]
    cases: list[RecordCase] = []
    for idx, (category, leader, teammates) in enumerate(synthetic_rows, start=1):
        workers_str = FORMATTER._format_workers(leader, teammates)
        visible = visible_source_text(leader, teammates)
        formatted = strip_markup(workers_str)
        cases.append(
            RecordCase(
                source="synthetic",
                date="2099-01-01",
                record_number=idx,
                contract_number=f"TEST-{idx:03d}",
                leader=leader,
                teammates=teammates,
                workers_str=workers_str,
                category=category,
                has_markup=has_markup(leader, teammates),
                suspicious_empty=bool(visible) and not formatted,
                suspicious_short=is_suspicious_short(leader, teammates, workers_str),
                raw_visible_length=len(visible),
                formatted_length=len(formatted),
            )
        )
    return cases


def choose_representative_db_cases(cases: list[RecordCase], limit_per_category: int = 2) -> list[RecordCase]:
    chosen: list[RecordCase] = []
    seen = Counter()
    for case in cases:
        key = case.category
        if seen[key] >= limit_per_category:
            continue
        chosen.append(case)
        seen[key] += 1
    return chosen


def make_record_payload(case: RecordCase) -> dict[str, Any]:
    return {
        "recordNumber": case.record_number,
        "contractNumber": case.contract_number,
        "workContent": f"[{case.category}] worker-field diagnostic",
        "leader": case.leader,
        "teammates": case.teammates,
    }


def build_mock_sequences(rep_cases: list[RecordCase]) -> dict[str, Any]:
    if not rep_cases:
        return {"single_record_batches": [], "three_record_batch": [], "position_batches": []}

    single_batches = []
    for idx, case in enumerate(rep_cases[:6], start=1):
        single_batches.append(
            {
                "name": f"single_{idx}_{case.category}",
                "dates_records": [
                    {
                        "date": f"2099-02-{idx:02d}",
                        "records": [make_record_payload(case)],
                    }
                ],
            }
        )

    three_record_source = (rep_cases * 3)[:3]
    three_record_batch = [
        {
            "date": "2099-03-01",
            "records": [make_record_payload(case) for case in three_record_source],
        }
    ]

    position_batches = []
    if len(rep_cases) >= 3:
        focus = rep_cases[0]
        before = rep_cases[1]
        after = rep_cases[2]
        position_batches = [
            {
                "name": "focus_first",
                "dates_records": [{"date": "2099-04-01", "records": [make_record_payload(focus), make_record_payload(before), make_record_payload(after)]}],
            },
            {
                "name": "focus_middle",
                "dates_records": [{"date": "2099-04-02", "records": [make_record_payload(before), make_record_payload(focus), make_record_payload(after)]}],
            },
            {
                "name": "focus_last",
                "dates_records": [{"date": "2099-04-03", "records": [make_record_payload(before), make_record_payload(after), make_record_payload(focus)]}],
            },
        ]

    return {
        "single_record_batches": single_batches,
        "three_record_batch": three_record_batch,
        "position_batches": position_batches,
    }


def render_checklist() -> str:
    return """# ERP Worker Field Checklist

1. Run offline scan first.
   - If `suspicious_empty` exists, check formatter/data before touching ERP.
2. Run `single_record_batches` against Mock ERP.
   - If worker field is blank here, the issue is formatter or navigation order.
3. Run `position_batches` against Mock ERP.
   - If only first/middle/last position fails, the issue is navigation timing.
4. Run the same batch in real ERP.
   - If offline + Mock ERP are good but real ERP is blank, the issue is ERP focus/paste timing.
5. Prioritize these patterns in real ERP:
   - leader_only
   - teammates_only
   - vendor_daily_only (`개인[...]`)
   - vendor_contract_only (`업체명(...)`)
   - mixed
"""


def write_report(
    output_dir: Path,
    db_path: Path,
    start_date: str,
    end_date: str,
    db_cases: list[RecordCase],
    synthetic_cases: list[RecordCase],
) -> dict[str, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)

    suspicious_empty = [case for case in db_cases if case.suspicious_empty]
    suspicious_short = [case for case in db_cases if case.suspicious_short]
    rep_cases = choose_representative_db_cases(db_cases)
    sequences = build_mock_sequences(rep_cases[:6] + synthetic_cases[:3])

    report = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "db_path": str(db_path),
        "filters": {"start_date": start_date, "end_date": end_date},
        "summary": {
            "total_db_cases": len(db_cases),
            "suspicious_empty_count": len(suspicious_empty),
            "suspicious_short_count": len(suspicious_short),
            "category_counts": dict(Counter(case.category for case in db_cases)),
        },
        "suspicious_empty": [asdict(case) for case in suspicious_empty],
        "suspicious_short": [asdict(case) for case in suspicious_short],
        "representative_db_cases": [asdict(case) for case in rep_cases],
        "synthetic_cases": [asdict(case) for case in synthetic_cases],
        "mock_sequences": sequences,
    }

    report_path = output_dir / "erp_worker_gap_report.json"
    checklist_path = output_dir / "erp_worker_test_checklist.md"
    mock_bundle_path = output_dir / "erp_worker_mock_sequences.json"

    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    checklist_path.write_text(render_checklist(), encoding="utf-8")
    mock_bundle_path.write_text(json.dumps(sequences, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "report": report_path,
        "checklist": checklist_path,
        "mock_sequences": mock_bundle_path,
    }


def print_console_summary(db_cases: list[RecordCase]) -> None:
    suspicious_empty = [case for case in db_cases if case.suspicious_empty]
    suspicious_short = [case for case in db_cases if case.suspicious_short]

    print("ERP worker-field diagnostics")
    print("=" * 40)
    print(f"DB cases scanned:       {len(db_cases)}")
    print(f"Suspicious empty:       {len(suspicious_empty)}")
    print(f"Suspicious short:       {len(suspicious_short)}")
    print("Category counts:")
    for category, count in Counter(case.category for case in db_cases).most_common():
        print(f"  - {category}: {count}")

    if suspicious_empty:
        print("\nSuspicious empty examples:")
        for case in suspicious_empty[:10]:
            print(
                f"  {case.date} #{case.record_number} {case.contract_number} | "
                f"leader={case.leader!r} teammates={case.teammates!r}"
            )

    if suspicious_short:
        print("\nSuspicious short examples:")
        for case in suspicious_short[:10]:
            print(
                f"  {case.date} #{case.record_number} {case.contract_number} | "
                f"workers_str={case.workers_str!r}"
            )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Diagnose ERP worker-field blank cases.")
    parser.add_argument("--db", default=str(pick_default_db_path()), help="SQLite DB path")
    parser.add_argument("--start-date", default="2026-04-01", help="Inclusive start date (YYYY-MM-DD)")
    parser.add_argument("--end-date", default=datetime.now().strftime("%Y-%m-%d"), help="Inclusive end date (YYYY-MM-DD)")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Directory for report artifacts")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    db_path = Path(args.db)
    if not db_path.exists():
        print(f"DB not found: {db_path}")
        return 1

    db_cases = analyze_records(db_path, args.start_date, args.end_date)
    synthetic_cases = build_synthetic_cases()
    paths = write_report(Path(args.output_dir), db_path, args.start_date, args.end_date, db_cases, synthetic_cases)
    print_console_summary(db_cases)
    print("\nArtifacts:")
    for name, path in paths.items():
        print(f"  - {name}: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
