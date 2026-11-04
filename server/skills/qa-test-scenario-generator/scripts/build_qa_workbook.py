#!/usr/bin/env python3
"""
build_qa_workbook.py - Build and audit an ePerolehan QA test scenario workbook (.xlsx)
from a JSON specification produced by the qa-test-scenario-generator skill.

Usage:
    python3 build_qa_workbook.py spec.json output.xlsx [--force]

The script:
  1. Validates the spec (IDs, traceability, WIP/Non-WIP values, execution status,
     matrix mapping, sheet names, vague expected results, sensitive data).
  2. Builds the workbook: Test Scenarios (module-adaptive columns), optional
     Decision Matrix / Workflow & Status / WIP Coverage / Test Data sheets, and the
     mandatory Requirement Coverage, Clarifications and Scenario Summary sheets.
  3. Prints a QA audit report. Exits 1 when blocking errors exist (unless --force).

Requires: openpyxl
"""
import json
import re
import sys
from collections import Counter, OrderedDict
from datetime import date

try:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.datavalidation import DataValidation
    from openpyxl.formatting.rule import FormulaRule
except ImportError:  # pragma: no cover
    sys.exit("openpyxl is required: pip install openpyxl")

# ----------------------------------------------------------------------------
# Constants
# ----------------------------------------------------------------------------
EXEC_STATUSES = ["Not Run", "Passed", "Failed", "Blocked", "Deferred", "N/A"]
DEPLOYMENT_ORIGINS = ["WIP", "Non-WIP", "N/A", "TBD"]
COVERAGE_STATUSES = ["Covered", "Partially Covered", "Not Covered",
                     "Clarification Required", "N/A"]
CLARIFICATION_STATUSES = ["Open", "Answered", "Closed", "Deferred"]
DEFAULT_EXEC_COLUMNS = ["Execution Status", "Tester", "Execution Date",
                        "Actual Result", "Defect / Redmine Ref",
                        "Evidence Ref", "Remarks"]
ORIGIN_COL_NAMES = ["Deployment Origin", "WIP / Non-WIP", "WIP/Non-WIP"]
STATUS_WORDS = re.compile(r"\b(pending|menunggu|approved|draft|submitted|revision|"
                          r"query|rejected|completed|cancel)", re.I)
VAGUE = re.compile(r"^\s*(system\s+)?(works?|work|function(s)?|behaves?)\s+"
                   r"(as\s+expected|correctly|properly|normally)\.?\s*$|"
                   r"^\s*(as\s+expected|ok|pass(ed)?|success(ful)?)\.?\s*$", re.I)
SENSITIVE = [
    (re.compile(r"p@ss|password\s*[:=]|kata\s*laluan\s*[:=]", re.I), "possible password"),
    (re.compile(r"\b\d{6}-?\d{2}-?\d{4}\b"), "possible MyKad / IC number"),
]
REAL_DOC_NO = re.compile(r"\b(PR|RN|CR|CT|LA|QT|SQ|DO|PO|KN|KA|KR)[- ]?\d{6,}\b")
INVALID_SHEET_CHARS = re.compile(r"[\[\]\:\*\?\/\\]")

THIN = Side(style="thin", color="808080")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
FILL_TITLE = PatternFill("solid", fgColor="FFFFFF")
FILL_GROUP = PatternFill("solid", fgColor="C4BD97")   # tan, as in historical SM/CT files
FILL_HEAD = PatternFill("solid", fgColor="1F4E78")
FILL_BAND = PatternFill("solid", fgColor="F2F2F2")
FILL_WIP = PatternFill("solid", fgColor="FCE4D6")
FILL_NONWIP = PatternFill("solid", fgColor="E2EFDA")
FILL_X = PatternFill("solid", fgColor="FFF2CC")
FILL_LABEL = PatternFill("solid", fgColor="DDEBF7")
FONT_HEAD = Font(bold=True, color="FFFFFF", name="Calibri", size=10)
FONT_GROUP = Font(bold=True, name="Calibri", size=10)
FONT_BODY = Font(name="Calibri", size=10)
FONT_TITLE = Font(bold=True, name="Calibri", size=14)
WRAP_TOP = Alignment(wrap_text=True, vertical="top")
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)

WIDTH_HINTS = [
    (re.compile(r"(^|\s)id$|^no\.?$|priority|date$|tester|decision|mandatory", re.I), 18),
    (re.compile(r"expected|action|step|precondition|scenario details|test scenario|"
                r"business rule|condition|description|ambiguity|impact|question|"
                r"actual result|remarks|screen", re.I), 45),
    (re.compile(r"test data|status|role|function|process|type|origin|reference|"
                r"dimension", re.I), 22),
]

# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------

def s(v):
    return "" if v is None else str(v)


def split_refs(v):
    return [r.strip() for r in re.split(r"[,;\n]+", s(v)) if r.strip()]


def width_for(col):
    for rx, w in WIDTH_HINTS:
        if rx.search(col):
            return w
    return 18


class Audit:
    def __init__(self):
        self.errors, self.warnings, self.info = [], [], []

    def e(self, m):
        self.errors.append(m)

    def w(self, m):
        self.warnings.append(m)

    def i(self, m):
        self.info.append(m)

    def report(self):
        out = ["", "=" * 70, "QA WORKBOOK AUDIT", "=" * 70]
        for title, items in (("ERRORS (blocking)", self.errors),
                             ("WARNINGS (review)", self.warnings),
                             ("INFO", self.info)):
            out.append(f"{title}: {len(items)}")
            out += [f"  - {m}" for m in items]
        out.append("RESULT: " + ("FAIL" if self.errors else "PASS"))
        return "\n".join(out)


def check_sheet_name(name, audit, seen):
    if not name or len(name) > 31:
        audit.e(f"Sheet name '{name}' is empty or longer than 31 characters.")
    if INVALID_SHEET_CHARS.search(name or ""):
        audit.e(f"Sheet name '{name}' contains an invalid character []:*?/\\.")
    if name.lower() in seen:
        audit.e(f"Duplicate sheet name '{name}'.")
    seen.add(name.lower())


def scan_sensitive(text, where, audit):
    for rx, label in SENSITIVE:
        if rx.search(text):
            audit.w(f"{where}: {label} detected - remove credentials/personal identifiers.")

# ----------------------------------------------------------------------------
# Validation
# ----------------------------------------------------------------------------

def validate(spec, audit):
    meta = spec.get("meta", {})
    sc = spec.get("scenarios", {})
    cols = list(sc.get("columns", []))
    rows = sc.get("rows", [])
    reqs = spec.get("requirements", [])
    clar = spec.get("clarifications", [])
    evidence = bool(meta.get("execution_evidence_provided", False))

    for k in ("cr_no", "title", "module"):
        if not meta.get(k):
            audit.e(f"meta.{k} is missing.")
    for req_col in ("Scenario ID", "Requirement Reference", "Expected Result"):
        if req_col not in cols:
            audit.e(f"Scenario sheet must include column '{req_col}'.")
    if not rows:
        audit.e("No scenario rows supplied.")
    if not reqs:
        audit.e("Requirement Coverage list is empty - every CR needs traceability.")

    req_refs = OrderedDict((s(r.get("ref")).strip(), r) for r in reqs)
    if len(req_refs) != len(reqs):
        audit.e("Duplicate requirement references in 'requirements'.")

    origin_col = next((c for c in ORIGIN_COL_NAMES if c in cols), None)
    step_col = "Step ID" if "Step ID" in cols else None
    seen_keys = set()
    ids_in_order = []
    for n, row in enumerate(rows, 1):
        unknown = set(row) - set(cols) - set(DEFAULT_EXEC_COLUMNS)
        if unknown:
            audit.e(f"Row {n}: keys not declared in columns: {sorted(unknown)}")
        sid = s(row.get("Scenario ID")).strip()
        if not sid:
            audit.e(f"Row {n}: Scenario ID is empty.")
            continue
        key = (sid, s(row.get(step_col)).strip() if step_col else "")
        if key in seen_keys:
            audit.e(f"Row {n}: duplicate Scenario ID/Step ID {key}.")
        seen_keys.add(key)
        if sid not in ids_in_order:
            ids_in_order.append(sid)
        refs = split_refs(row.get("Requirement Reference"))
        if not refs:
            audit.e(f"{sid}: Requirement Reference is empty.")
        for r in refs:
            if r not in req_refs:
                audit.e(f"{sid}: Requirement Reference '{r}' not listed in requirements.")
        er = s(row.get("Expected Result"))
        if not er.strip():
            audit.e(f"{sid} {key[1]}: Expected Result is empty.")
        elif VAGUE.search(er):
            audit.e(f"{sid} {key[1]}: Expected Result is vague ('{er.strip()}').")
        ex = s(row.get("Execution Status") or "Not Run")
        if ex not in EXEC_STATUSES:
            audit.e(f"{sid}: Execution Status '{ex}' not in {EXEC_STATUSES}.")
        if ex in ("Passed", "Failed") and not evidence:
            audit.e(f"{sid}: Execution Status '{ex}' without execution evidence "
                    f"(set meta.execution_evidence_provided only when real evidence exists).")
        if origin_col:
            o = s(row.get(origin_col)).strip()
            if o not in DEPLOYMENT_ORIGINS:
                audit.e(f"{sid}: {origin_col} '{o}' must be one of {DEPLOYMENT_ORIGINS} "
                        f"(workflow status belongs in 'Current Status').")
            if STATUS_WORDS.search(o):
                audit.e(f"{sid}: {origin_col} contains a workflow status - WIP is deployment origin only.")
            pre = (s(row.get("Precondition")) + " " + s(row.get("Preconditions")) + " " +
                   s(row.get("Test Data"))).lower()
            if o == "WIP" and not re.search(r"before deployment|pre-deployment|sebelum deployment", pre):
                audit.w(f"{sid}: WIP row - precondition/test data should state the record "
                        f"was created and saved BEFORE deployment.")
            if o == "Non-WIP" and re.search(r"before deployment|pre-deployment", pre):
                audit.e(f"{sid}: Non-WIP row describes data created before deployment.")
        alltext = " ".join(s(v) for v in row.values())
        scan_sensitive(alltext, sid, audit)
        if REAL_DOC_NO.search(s(row.get("Test Data")) + " " + s(row.get("Document No"))) \
                and not meta.get("document_numbers_user_provided"):
            audit.w(f"{sid}: looks like a real document number - confirm it was provided, "
                    f"not fabricated (else use 'Test Data Required').")

    # Forced / irrelevant dimension detection
    for c in cols:
        if c in DEFAULT_EXEC_COLUMNS or c in ("Remarks",):
            continue
        vals = {s(r.get(c)).strip().upper() for r in rows}
        if rows and vals <= {"", "N/A", "NA", "-"}:
            audit.w(f"Column '{c}' is empty/N/A in every row - remove it if the dimension "
                    f"does not apply to this CR.")

    # Requirement coverage
    covered = {r: [] for r in req_refs}
    for row in rows:
        for r in split_refs(row.get("Requirement Reference")):
            if r in covered and s(row.get("Scenario ID")) not in covered[r]:
                covered[r].append(s(row.get("Scenario ID")))
    for r, info in req_refs.items():
        st = info.get("coverage_status") or ("Covered" if covered[r] else "Not Covered")
        info["coverage_status"] = st
        if st not in COVERAGE_STATUSES:
            audit.e(f"Requirement {r}: coverage_status '{st}' invalid.")
        if st in ("Covered", "Partially Covered") and not covered[r]:
            audit.e(f"Requirement {r} marked '{st}' but no scenario references it.")
        if st == "Not Covered":
            audit.w(f"Requirement {r} has no coverage - justify or add scenarios.")
        if st == "Clarification Required" and not any(
                r in split_refs(c.get("ref")) for c in clar):
            audit.e(f"Requirement {r} needs clarification but no Clarifications entry references it.")
        info["_scenarios"] = covered[r]

    # Clarifications
    cids = [s(c.get("id")) for c in clar]
    if len(cids) != len(set(cids)):
        audit.e("Duplicate Clarification IDs.")
    for c in clar:
        if c.get("status", "Open") not in CLARIFICATION_STATUSES:
            audit.e(f"Clarification {c.get('id')}: invalid status.")

    # Matrices
    all_ids = set(ids_in_order)
    for m in spec.get("matrices", []):
        mids = m.get("scenario_ids", [])
        for mid in mids:
            if mid not in all_ids:
                audit.e(f"Matrix '{m.get('name')}': column {mid} has no matching scenario.")
            marks = [c for c in m.get("conditions", []) if mid in c.get("x", [])]
            if not marks:
                audit.e(f"Matrix '{m.get('name')}': column {mid} has no X marker.")
            if not s(m.get("expected", {}).get(mid)).strip():
                audit.e(f"Matrix '{m.get('name')}': column {mid} has no expected result.")
        combos = [tuple(sorted((c["dimension"], c["value"]) for c in m.get("conditions", [])
                               if mid in c.get("x", []))) for mid in mids]
        dup = [k for k, v in Counter(combos).items() if v > 1]
        if dup:
            audit.w(f"Matrix '{m.get('name')}': {len(dup)} duplicate condition combination(s).")
        for c in m.get("conditions", []):
            for mid in c.get("x", []):
                if mid not in mids:
                    audit.e(f"Matrix '{m.get('name')}': X for {mid} outside scenario_ids.")

    audit.i(f"Scenario IDs: {len(ids_in_order)}; rows/steps: {len(rows)}; "
            f"requirements: {len(reqs)}; clarifications: {len(clar)}")
    if not origin_col:
        audit.i("No Deployment Origin column - confirm WIP/Non-WIP was assessed and recorded "
                "as N/A with reason in Requirement Coverage.")
    return ids_in_order, origin_col

# ----------------------------------------------------------------------------
# Writers
# ----------------------------------------------------------------------------

def write_title(ws, meta, sheet_title, ncols):
    ws.cell(1, 1, f"{meta.get('cr_no', '')} - {meta.get('title', '')} | {sheet_title}").font = FONT_TITLE
    info = (f"Module: {meta.get('module', '')}   Phase: {meta.get('phase', '')}   "
            f"Source: {meta.get('source', '')}   Version: {meta.get('version', '1.0')}   "
            f"Generated: {meta.get('generated', date.today().isoformat())}")
    ws.cell(2, 1, info).font = Font(italic=True, size=9, color="595959")
    return 3


def write_table(ws, start_row, columns, rows, group_headers=None, band_key=None,
                origin_col=None, freeze_col=1):
    r = start_row
    if group_headers:
        for g in group_headers:
            label, c_from, c_to = g
            i1, i2 = columns.index(c_from) + 1, columns.index(c_to) + 1
            ws.cell(r, i1, label)
            if i2 > i1:
                ws.merge_cells(start_row=r, start_column=i1, end_row=r, end_column=i2)
            for ci in range(i1, i2 + 1):
                c = ws.cell(r, ci)
                c.fill, c.font, c.alignment, c.border = FILL_GROUP, FONT_GROUP, CENTER, BORDER
        r += 1
    head = r
    for ci, col in enumerate(columns, 1):
        c = ws.cell(r, ci, col)
        c.fill, c.font, c.alignment, c.border = FILL_HEAD, FONT_HEAD, CENTER, BORDER
        ws.column_dimensions[get_column_letter(ci)].width = width_for(col)
    ws.row_dimensions[r].height = 30
    band, last_key = False, object()
    for row in rows:
        r += 1
        if band_key:
            k = row.get(band_key) or row.get("Scenario ID")
            if k != last_key:
                band, last_key = not band, k
        for ci, col in enumerate(columns, 1):
            v = row.get(col, "")
            c = ws.cell(r, ci, v if v is not None else "")
            c.font, c.alignment, c.border = FONT_BODY, WRAP_TOP, BORDER
            if band_key and band:
                c.fill = FILL_BAND
            if origin_col and col == origin_col:
                c.alignment = CENTER
                if v == "WIP":
                    c.fill = FILL_WIP
                elif v == "Non-WIP":
                    c.fill = FILL_NONWIP
    last = max(r, head)
    ws.freeze_panes = ws.cell(head + 1, freeze_col + 1)
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A3 if len(columns) > 14 else ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = 1, 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = f"{start_row}:{head}"
    if rows:
        ws.auto_filter.ref = f"A{head}:{get_column_letter(len(columns))}{last}"
    return head, last


def add_validation(ws, columns, colname, options, head, last):
    if colname not in columns or last <= head:
        return
    letter = get_column_letter(columns.index(colname) + 1)
    dv = DataValidation(type="list", formula1='"' + ",".join(options) + '"', allow_blank=True)
    ws.add_data_validation(dv)
    dv.add(f"{letter}{head + 1}:{letter}{max(last, head + 200)}")


def build_scenarios(wb, spec, origin_col, audit):
    meta, sc = spec["meta"], spec["scenarios"]
    cols = list(sc["columns"])
    if meta.get("execution_columns", True):
        cols += [c for c in DEFAULT_EXEC_COLUMNS if c not in cols]
    rows = []
    for row in sc["rows"]:
        r = dict(row)
        r.setdefault("Execution Status", "Not Run")
        rows.append(r)
    ws = wb.active
    ws.title = sc.get("sheet_name", "Test Scenarios")
    start = write_title(ws, meta, ws.title, len(cols))
    groups = sc.get("group_headers")
    if not groups:
        exec_first = next((c for c in cols if c in DEFAULT_EXEC_COLUMNS), None)
        er_idx = cols.index("Expected Result")
        groups = [["Test Scenario Description", cols[0], cols[er_idx - 1]]] if er_idx > 0 else []
        end_exp = cols[cols.index(exec_first) - 1] if exec_first else cols[-1]
        groups.append(["Expected Result", "Expected Result", end_exp])
        if exec_first:
            groups.append(["Test Execution", exec_first, cols[-1]])
    band = "Scenario Group ID" if "Scenario Group ID" in cols else "Scenario ID"
    freeze_col = sc.get("freeze_col", min(cols.index("Scenario ID") + 1 +
                                          (1 if "Step ID" in cols else 0), 3))
    head, last = write_table(ws, start, cols, rows, groups, band, origin_col, freeze_col)
    add_validation(ws, cols, "Execution Status", EXEC_STATUSES, head, last)
    if origin_col:
        add_validation(ws, cols, origin_col, DEPLOYMENT_ORIGINS, head, last)
    if "Execution Status" in cols:
        L = get_column_letter(cols.index("Execution Status") + 1)
        rng = f"{L}{head + 1}:{L}{max(last, head + 200)}"
        ws.conditional_formatting.add(rng, FormulaRule(formula=[f'{L}{head + 1}="Passed"'],
                                      fill=PatternFill("solid", fgColor="C6EFCE")))
        ws.conditional_formatting.add(rng, FormulaRule(formula=[f'{L}{head + 1}="Failed"'],
                                      fill=PatternFill("solid", fgColor="FFC7CE")))
        ws.conditional_formatting.add(rng, FormulaRule(formula=[f'{L}{head + 1}="Blocked"'],
                                      fill=PatternFill("solid", fgColor="FFEB9C")))
    return rows, cols


def build_matrix(wb, meta, m):
    ws = wb.create_sheet(m.get("name", "Decision Matrix"))
    r = write_title(ws, meta, m.get("title", ws.title), 0)
    mids = m["scenario_ids"]
    if m.get("rule"):
        ws.cell(r, 1, "Business rule: " + m["rule"]).font = Font(italic=True, size=10)
        r += 1
    hdr = ["Dimension", "Condition Value"] + mids
    for ci, h in enumerate(hdr, 1):
        c = ws.cell(r, ci, h)
        c.fill, c.font, c.alignment, c.border = FILL_HEAD, FONT_HEAD, CENTER, BORDER
    head = r
    ws.column_dimensions["A"].width, ws.column_dimensions["B"].width = 24, 34
    for ci in range(3, len(hdr) + 1):
        ws.column_dimensions[get_column_letter(ci)].width = 14
    last_dim = None
    for cond in m["conditions"]:
        r += 1
        dim = cond["dimension"]
        ws.cell(r, 1, dim if dim != last_dim else "")
        last_dim = dim
        ws.cell(r, 2, cond["value"])
        for ci in (1, 2):
            c = ws.cell(r, ci)
            c.font, c.alignment, c.border, c.fill = FONT_GROUP if ci == 1 else FONT_BODY, WRAP_TOP, BORDER, FILL_LABEL
        for j, mid in enumerate(mids, 3):
            c = ws.cell(r, j, "X" if mid in cond.get("x", []) else "")
            c.alignment, c.border, c.font = CENTER, BORDER, Font(bold=True, size=10)
            if c.value:
                c.fill = FILL_X
    for label, src in (("Expected Result", m.get("expected", {})),
                       ("Expected Next Status", m.get("next_status", {}))):
        if label == "Expected Next Status" and not src:
            continue
        r += 1
        ws.cell(r, 1, label)
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=2)
        for ci in (1, 2):
            ws.cell(r, ci).fill, ws.cell(r, ci).font, ws.cell(r, ci).border = FILL_GROUP, FONT_GROUP, BORDER
        for j, mid in enumerate(mids, 3):
            c = ws.cell(r, j, src.get(mid, ""))
            c.alignment, c.border, c.font = WRAP_TOP, BORDER, FONT_BODY
        ws.row_dimensions[r].height = 90
    ws.freeze_panes = ws.cell(head + 1, 3)
    unc = m.get("uncovered", [])
    if unc:
        r += 2
        ws.cell(r, 1, "Excluded / uncovered combinations").font = FONT_GROUP
        for u in unc:
            r += 1
            ws.cell(r, 1, u.get("combination", ""))
            ws.cell(r, 2, u.get("reason", ""))
            for ci in (1, 2):
                ws.cell(r, ci).alignment, ws.cell(r, ci).border = WRAP_TOP, BORDER
    return len(mids)


def build_generic(wb, meta, t):
    ws = wb.create_sheet(t["name"])
    r = write_title(ws, meta, t.get("title", t["name"]), 0)
    if t.get("note"):
        ws.cell(r, 1, t["note"]).font = Font(italic=True, size=10)
        r += 1
    origin = next((c for c in ORIGIN_COL_NAMES if c in t["columns"]), None)
    write_table(ws, r, t["columns"], t.get("rows", []), t.get("group_headers"),
                None, origin, t.get("freeze_col", 1))


def build_coverage(wb, meta, reqs):
    cols = ["Requirement Reference", "Requirement Description", "Applicable Dimensions",
            "Scenario IDs", "Status Coverage", "Role Coverage",
            "WIP / Non-WIP Assessment", "Coverage Status", "Remarks"]
    rows = [{
        "Requirement Reference": r.get("ref"), "Requirement Description": r.get("description"),
        "Applicable Dimensions": r.get("dimensions", ""),
        "Scenario IDs": ", ".join(r.get("_scenarios", [])) or "-",
        "Status Coverage": r.get("status_coverage", ""), "Role Coverage": r.get("role_coverage", ""),
        "WIP / Non-WIP Assessment": r.get("wip_assessment", ""),
        "Coverage Status": r.get("coverage_status"), "Remarks": r.get("remarks", "")} for r in reqs]
    ws = wb.create_sheet("Requirement Coverage")
    start = write_title(ws, meta, "Requirement Coverage", len(cols))
    head, last = write_table(ws, start, cols, rows)
    add_validation(ws, cols, "Coverage Status", COVERAGE_STATUSES, head, last)


def build_clarifications(wb, meta, clar):
    cols = ["Clarification ID", "Requirement Reference", "Ambiguity", "Impact to Testing",
            "Question for BA / Client", "Status", "Raised Date", "Answer / Resolution"]
    rows = [{"Clarification ID": c.get("id"), "Requirement Reference": c.get("ref"),
             "Ambiguity": c.get("ambiguity"), "Impact to Testing": c.get("impact"),
             "Question for BA / Client": c.get("question"), "Status": c.get("status", "Open"),
             "Raised Date": c.get("raised", meta.get("generated", date.today().isoformat())),
             "Answer / Resolution": c.get("answer", "")} for c in clar]
    if not rows:
        rows = [{"Clarification ID": "-", "Ambiguity": "No open clarification identified.",
                 "Status": "Closed"}]
    ws = wb.create_sheet("Clarifications")
    start = write_title(ws, meta, "Clarifications", len(cols))
    head, last = write_table(ws, start, cols, rows)
    add_validation(ws, cols, "Status", CLARIFICATION_STATUSES, head, last)


def build_summary(wb, meta, rows, cols, origin_col, reqs, clar, matrix_combos, ids):
    ws = wb.create_sheet("Scenario Summary")
    r = write_title(ws, meta, "Scenario Summary", 3)
    ws.column_dimensions["A"].width, ws.column_dimensions["B"].width = 42, 16
    ws.column_dimensions["C"].width = 16

    def block(title, counter, r):
        r += 1
        for ci, h in enumerate([title, "Scenario IDs", "Rows / Steps"], 1):
            c = ws.cell(r, ci, h)
            c.fill, c.font, c.border, c.alignment = FILL_HEAD, FONT_HEAD, BORDER, CENTER
        for k, (n_ids, n_rows) in counter.items():
            r += 1
            for ci, v in enumerate([k or "(blank)", n_ids, n_rows], 1):
                c = ws.cell(r, ci, v)
                c.border, c.font = BORDER, FONT_BODY
        return r + 1

    def count_by(col):
        if col not in cols:
            return None
        ids_by, rows_by = OrderedDict(), Counter()
        for row in rows:
            for v in split_refs(row.get(col)) or [""]:
                ids_by.setdefault(v, set()).add(s(row.get("Scenario ID")))
                rows_by[v] += 1
        return OrderedDict((k, (len(v), rows_by[k])) for k, v in ids_by.items())

    tot = OrderedDict([("Total Scenarios (unique Scenario IDs)", (len(ids), len(rows)))])
    r = block("Overview", tot, r)
    for title, col in (("By Module", "Module"), ("By Scenario Category", "Scenario Category"),
                       ("By Current Status", "Current Status"), ("By Role", "Role"),
                       ("By Deployment Origin (WIP / Non-WIP)", origin_col),
                       ("By Priority", "Priority"), ("By Execution Status", "Execution Status")):
        if col:
            cnt = count_by(col)
            if cnt:
                r = block(title, cnt, r)
    r += 1
    cov = Counter(x.get("coverage_status") for x in reqs)
    tbd = sum(1 for row in rows for v in row.values()
              if re.search(r"\bTBD\b|Clarification Required|Test Data Required", s(v)))
    facts = [("Total requirements", len(reqs))] + \
            [(f"Requirements - {k}", v) for k, v in cov.items()] + \
            [("Decision Matrix combinations", matrix_combos),
             ("Open clarifications", sum(1 for c in clar if c.get("status", "Open") == "Open")),
             ("Cells marked TBD / Clarification Required / Test Data Required", tbd)]
    for ci, h in enumerate(["Traceability & Open Items", "Count"], 1):
        c = ws.cell(r, ci, h)
        c.fill, c.font, c.border = FILL_HEAD, FONT_HEAD, BORDER
    for k, v in facts:
        r += 1
        ws.cell(r, 1, k).border = BORDER
        ws.cell(r, 2, v).border = BORDER

# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    spec_path, out_path, force = argv[1], argv[2], "--force" in argv
    with open(spec_path, encoding="utf-8") as fh:
        spec = json.load(fh)
    spec.setdefault("meta", {}).setdefault("generated", date.today().isoformat())
    audit = Audit()
    seen = set()
    names = [spec.get("scenarios", {}).get("sheet_name", "Test Scenarios")] + \
            [m.get("name", "Decision Matrix") for m in spec.get("matrices", [])] + \
            [t.get("name", "") for t in spec.get("tables", [])] + \
            ["Requirement Coverage", "Clarifications", "Scenario Summary"]
    for n in names:
        check_sheet_name(n, audit, seen)
    ids, origin_col = validate(spec, audit)
    print(audit.report())
    if audit.errors and not force:
        print("\nWorkbook NOT generated. Fix the errors above (or rerun with --force for a draft).")
        return 1
    wb = Workbook()
    rows, cols = build_scenarios(wb, spec, origin_col, audit)
    combos = sum(build_matrix(wb, spec["meta"], m) for m in spec.get("matrices", []))
    for t in spec.get("tables", []):
        build_generic(wb, spec["meta"], t)
    build_coverage(wb, spec["meta"], spec.get("requirements", []))
    build_clarifications(wb, spec["meta"], spec.get("clarifications", []))
    build_summary(wb, spec["meta"], rows, cols, origin_col, spec.get("requirements", []),
                  spec.get("clarifications", []), combos, ids)
    wb.save(out_path)
    print(f"\nWorkbook saved: {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
