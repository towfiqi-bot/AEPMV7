"""Build time-series JSON files for the Trends tab.

Input:
  - APO-Productivity-Database-2025v1-1.xlsx (or same-structure workbook)

Output (written into ./data/):
  - data/ts_meta.json
  - data/ts/<ECON_ABBR>.json (one file per economy sheet)

Usage:
  python tools/build_timeseries_json.py /path/to/APO-Productivity-Database.xlsx

Notes:
  - This script does NOT touch data.js (snapshot indicators). It only feeds the Trends view.
  - It writes numeric values as int where possible, otherwise rounded to 4 decimals; missing values become null.
"""

from __future__ import annotations

import json
import os
import re
import sys
from collections import Counter

import numpy as np
import pandas as pd


def clean_text(x):
    if pd.isna(x):
        return ""
    return str(x).strip()


def clean_group(x):
    if pd.isna(x):
        return None
    s = str(x).strip()
    return s or None


def to_num_or_none(v):
    if v is None or pd.isna(v) or v == "":
        return None
    try:
        fv = float(v)
        if abs(fv - round(fv)) < 1e-9:
            return int(round(fv))
        return round(fv, 4)
    except Exception:
        return None


def main(xlsx_path: str) -> int:
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_data_dir = os.path.join(base_dir, "data")
    out_ts_dir = os.path.join(out_data_dir, "ts")
    os.makedirs(out_ts_dir, exist_ok=True)

    xl = pd.ExcelFile(xlsx_path)
    sheets = [s for s in xl.sheet_names if s != "Information"]

    # years (assumed common across sheets)
    tmp = pd.read_excel(xlsx_path, sheet_name=sheets[0], header=3, nrows=1)
    year_cols = [c for c in tmp.columns if isinstance(c, (int, float)) and 1900 < c < 2100]
    years = list(range(int(min(year_cols)), int(max(year_cols)) + 1))

    # economy name map from Information sheet (best-effort)
    info = pd.read_excel(xlsx_path, sheet_name="Information", header=None)
    econ_rows = []
    for i in range(4, info.shape[0]):
        country = info.iloc[i, 0]
        abbr = info.iloc[i, 4] if info.shape[1] > 4 else None
        if pd.isna(country) or str(country).strip() == "":
            break
        econ_rows.append(
            (
                clean_text(country),
                clean_text(info.iloc[i, 3]) if info.shape[1] > 3 else "",
                clean_text(abbr),
            )
        )
    econ_map = {abbr: {"short": country, "name": fullname} for country, fullname, abbr in econ_rows if abbr}

    indicator_meta = {}
    group_pos = {}
    pos = 0

    for s in sheets:
        df = pd.read_excel(xlsx_path, sheet_name=s, header=3)
        df = df.dropna(how="all")
        if "Code" not in df.columns:
            continue

        # group ordering
        if "Group" in df.columns:
            for g in df["Group"].tolist():
                g = clean_group(g)
                if not g:
                    continue
                if g not in group_pos:
                    group_pos[g] = pos
                    pos += 1

        keep = [c for c in (['Group','Code','Variable','Unit'] + years + (['Note'] if 'Note' in df.columns else [])) if c in df.columns]
        df = df[keep]

        series = {}
        for _, row in df.iterrows():
            code = row.get("Code")
            if pd.isna(code) or str(code).strip() == "":
                continue
            code = str(code).strip()

            grp = clean_group(row.get("Group"))
            var = clean_text(row.get("Variable"))
            unit = clean_text(row.get("Unit"))
            note = clean_text(row.get("Note")) if "Note" in df.columns else ""

            vals = [to_num_or_none(row.get(y)) for y in years]
            series[code] = vals

            if code not in indicator_meta:
                indicator_meta[code] = {"code": code, "label": var, "unit": unit, "group": grp, "note": note}
            else:
                if not indicator_meta[code].get("label") and var:
                    indicator_meta[code]["label"] = var
                if not indicator_meta[code].get("unit") and unit:
                    indicator_meta[code]["unit"] = unit
                if not indicator_meta[code].get("group") and grp:
                    indicator_meta[code]["group"] = grp

        out_path = os.path.join(out_ts_dir, f"{s}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump({"economy": s, "series": series}, f, ensure_ascii=False)

    groups = [g for g, _ in sorted(group_pos.items(), key=lambda x: x[1])]

    # stable ordering for indicator list
    def code_key(c: str):
        try:
            return float(c)
        except Exception:
            return c

    meta = {
        "years": years,
        "economies": [
            {"abbr": abbr, "short": econ_map.get(abbr, {}).get("short", abbr), "name": econ_map.get(abbr, {}).get("name", "")}
            for abbr in sheets
        ],
        "indicators": [indicator_meta[c] for c in sorted(indicator_meta.keys(), key=code_key)],
        "groups": groups,
    }

    with open(os.path.join(out_data_dir, "ts_meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)

    print(f"Wrote {len(sheets)} economy files to {out_ts_dir}")
    print(f"Wrote ts_meta.json with {len(meta['indicators'])} indicators")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python tools/build_timeseries_json.py /path/to/APO-Productivity-Database.xlsx")
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1]))
