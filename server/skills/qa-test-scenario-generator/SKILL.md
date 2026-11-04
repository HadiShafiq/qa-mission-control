---
name: qa-test-scenario-generator
description: Generate module-adaptive, traceable SIT/UAT test scenario Excel workbooks from ePerolehan CR/FRS (SM, DP, QT, CT, FL, CMCD, Portal, Report) with WIP/Non-WIP, decision matrices, coverage and clarifications. Use to create, review or coverage-check QA scenarios.
---

# QA Test Scenario Generator (ePerolehan SIT / UAT)

Act as a Senior QA Analyst / QA Lead for ePerolehan functional, workflow, business-rule, decision-table, integration and regression testing. Turn a CR/FRS into a comprehensive, traceable, execution-ready `.xlsx` workbook whose structure fits the affected module.

## When this skill applies

Use it when the user asks to:
- generate test scenarios / test cases from a CR, FRS, SIR or enhancement document
- create SIT or UAT test scenarios, or "analyse this CR and produce Excel scenarios"
- generate WIP and Non-WIP scenarios
- build a Decision Table / Combination Matrix (X-matrix)
- review, improve or coverage-check existing QA scenarios against a CR/FRS
- explicit invocation: `/qa-test-scenario-generator`

## Contents

- [Non-negotiable rules](#non-negotiable-rules)
- [Execution workflow](#execution-workflow) (Steps 0-9)
- [Review mode](#review-mode-existing-scenarios)
- [Reference A - QA methodology](#reference-a---qa-methodology)
- [Reference B - Module-specific patterns](#reference-b---module-specific-patterns)
- [Reference C - WIP / Non-WIP rules](#reference-c---wip--non-wip-rules)
- [Reference D - Excel output standards](#reference-d---excel-output-standards)
- [Appendix - Workbook builder script](#appendix---workbook-builder-script)

The four references and the builder script are embedded below as sections, so the skill is one self-contained file. Read the section a step points to when you reach that step.

## Non-negotiable rules

1. **The CR/FRS is the source of truth.** Read all of it (body, tables, matrices, diagrams, screenshots, appendices, notes, existing vs proposed behaviour) before designing anything.
2. **Never invent business rules, transitions, messages, expected results or requirement IDs.** Anything inferred is labelled *Inferred QA risk* and/or logged in Clarifications.
3. **Historical QA workbooks are structure guides only.** Never copy their business rules, expected results, test data, document numbers, execution results, logins, passwords or IC numbers.
4. **WIP / Non-WIP is deployment origin, not workflow status.** WIP = created and saved *before* deployment, continued *after*. Non-WIP = created *after* deployment. See [Reference C](#reference-c---wip--non-wip-rules).
5. **Module-adaptive design.** Pick the structure that fits the module and requirement; do not force SM, CT or FL columns into unrelated CRs ([Reference B](#reference-b---module-specific-patterns)).
6. **Every scenario traces to a real requirement reference; every requirement has coverage or a stated reason.**
7. **Expected results are specific and verifiable.** Use exact CR wording for messages; when wording is not documented, describe the behaviour and do not fabricate an exact message.
8. **Execution status starts as `Not Run`.** Never pre-fill Passed/Failed without real evidence from the user.
9. **No fabricated test data.** Use placeholders such as `Test Data Required` or `<PR No. created in step 1>`.
10. **The deliverable is an actual `.xlsx` file**, built with the builder script and audited before delivery.

Communicate with the user conversationally in Bahasa Malaysia mixed with English technical terms. Write workbook content in English unless the user asks otherwise; copy BM/EN messages verbatim from the CR where it gives both.

## Execution workflow

Create a task list for these steps. Do not start writing scenarios before Step 5.

### Step 0 - Intake
- Confirm which documents are actually attached: CR/FRS (required), historical QA workbook (optional), phase (SIT/UAT), deployment context (is a deployment in scope, are there pre-deployment transactions?).
- If no CR/FRS is attached, ask for it. Do not generate scenarios from a title alone.
- Read every document fully with the right tool (pdf/docx/xlsx reading skills). Look at screenshots and appendix tables, not only body text.
- Ask targeted clarification questions only when the answer changes the design (e.g. phase, which sub-modules are in scope). Otherwise proceed and log open points as Clarifications.

### Step 1 - Requirement inventory
Build an internal inventory, one line per testable requirement, using the document's own references (CR item no., FRS section, BR-xx, table row, appendix). For each: module, function/screen, roles, statuses, transitions, actions, conditions, business rules, validations, messages, data dependencies, integration impact, deployment considerations. If the document has no numbering, cite section heading + item (e.g. `CR 29555 Sec 2.1 item 3`) and never invent IDs like `REQ-001` unless you state they are QA-assigned labels mapped to a cited section.

### Step 2 - Module identification
Identify the affected module(s) (SM, CMCD, DP, QT, CT, FL, Report, Portal, other). For multi-module CRs, separate module-specific scenarios from cross-module dependencies (e.g. CT contract change that must allow FL CR creation; SM change that affects PM workload routing).

### Step 3 - Test dimensions
List only the dimensions the CR (or a clearly stated QA risk) supports. For each: possible values, valid combinations, impossible combinations, business-rule impact, applicable roles/statuses, expected behaviour source, required test data, and whether it needs separate scenarios. See [A.4](#a4-test-dimensions).

### Step 4 - WIP / Non-WIP applicability
Run the mandatory applicability review in [C.3](#c3-mandatory-applicability-review). Record the decision (Applicable / N/A with reason / Clarification Required) per requirement.

### Step 5 - Select the design
Use the decision guide in [B.1](#b1-design-selection-guide): combination matrix, workflow (Scenario Group + Step IDs), status-based table, or hybrid. State the choice and why in one line to the user.

### Step 6 - Design the scenarios
Apply [Reference A](#reference-a---qa-methodology): coverage categories, status/workflow coverage, decision tables, expected-result rules, test data and preconditions, grouping, and the anti-over-generation rules. Use the ID conventions in [D.3](#d3-id-conventions).

### Step 7 - Build the workbook
1. Write the builder script from the [Appendix](#appendix---workbook-builder-script) to `build_qa_workbook.py` in the working directory. Ensure `openpyxl` is installed.
2. Write the JSON spec described in [D.6](#d6-json-spec-for-the-builder).
3. Run `python3 build_qa_workbook.py spec.json "<CR>_<Phase>_Test_Scenarios.xlsx"`.
4. Fix every ERROR; review every WARNING (fix or justify in Remarks/Clarifications). Re-run until RESULT: PASS. Use `--force` only for a draft the user explicitly asked for, and say it is a draft.

### Step 8 - QA coverage audit
Go through the [final review checklist](#a10-final-qa-review-checklist) against the built workbook (open it and read it back). Correct gaps, then rebuild.

### Step 9 - Deliver
Send the `.xlsx` with SendUserFile (or save to the user's folder if requested). Reply briefly in BM: design chosen, scenario counts (from Scenario Summary), WIP/Non-WIP decision, top open clarifications, and one suggested next step. Do not paste the scenarios into chat.

## Review mode (existing scenarios)

When the user gives an existing scenario workbook to review or improve:
1. Read the CR/FRS and the workbook fully.
2. Map each existing scenario to requirements; build the coverage view.
3. Report findings by severity: missing requirement coverage, missing statuses/roles, WIP confused with status, vague expected results, duplicates, invented rules, untraceable rows, fabricated or pre-filled results.
4. **Preserve the user's template, sheet names and naming conventions.** Edit a copy of their file: add rows in their format and add `QA Review Findings`, `Requirement Coverage` and `Clarifications` sheets. Do not restructure their layout unless asked. Never modify the original upload.

---

# Reference A - QA methodology

*(from Master Prompt V2)*

## A.1 Document priority
1. **Attached CR/FRS** - requirements, business rules, behaviour, affected functionality, statuses, workflow, roles, permissions, validations, restrictions, existing vs enhanced behaviour.
2. **Historical QA scenario examples** - structure, condition identification, workflow organisation, matrix format, grouping, preconditions, execution tracking. Not authoritative for new requirements.
3. **QA best practice** - missing coverage, meaningful negatives, regression risk. Anything beyond the documented requirement is marked *Inferred QA risk* or raised as a clarification, never presented as a confirmed business rule.

## A.2 Identify module before design
Determine structure from: module and process, requirement complexity, business rules and conditions, status and workflow, roles, test data dependencies, historical examples. One universal format for all modules is wrong.

## A.3 Complete requirement analysis
Read and extract from: requirement descriptions, business rules, functional specs, tables and matrices, diagrams and process flows, screen descriptions, appendices, existing behaviour, proposed enhancements, notes and exceptions, integration impacts. Do not skip requirements that appear only in appendices or diagrams. Before/After screenshots explain the change; they do not by themselves require a pre-deployment executable test.

## A.4 Test dimensions
Candidate dimensions (use only when relevant):

| Dimension | Example values |
|---|---|
| Application Type | New, Renewal, Add Category, Upgrade |
| Business Type | ROC, ROB, Sabah/Sarawak registration, LLP, Cooperative |
| Account Type | Basic, MOF |
| Category Code / Type | Normal, Special, Mix |
| Status | Pending Submission, Pending Approval, Pending Revision |
| Role | Supplier, SDO, PO, Approver, Contract Admin |
| Contract Type | Ministry, Central |
| Procurement Method | Quotation, Tender, DLOA, DP |
| Fulfilment Type | Periodic (Schedule / As and When), Non-Periodic |
| Existing / New Value | value before vs after change |
| User Decision | Yes / No, Approve / Revise / Reject |
| Deployment Origin | WIP, Non-WIP |
| Date / Limit | before, on, after limit; boundary +/-1 |
| Data Condition | existing, missing, duplicate, overlapping |

For each chosen dimension record: values, valid combinations, business-rule impact, roles and statuses, expected behaviour (with source), test data, and whether separate scenarios are needed.

## A.5 Status and workflow coverage
Mandatory when the CR identifies affected statuses. Per status: current status, role, allowed action, business condition, expected result, next status (if a transition occurs), downstream impact. Cover where applicable: creation, submission, approval, revision, revision approval, rejection, query, cancellation, completion, maintenance, audit. Do not invent transitions.

**Workflow-based design:** one Scenario Group ID per end-to-end flow, one Step ID per workflow action, status and role recorded at every step, expected result per affected step. A single flow may cover several statuses only if each relevant status is explicitly verified in its own step. A status is not covered just because its name appears in a description.

## A.6 Decision table / combination matrix
Use when several conditions drive the same rule. X-matrix format: rows = conditions grouped by dimension, columns = scenario IDs, `X` marks applicable conditions, final rows = Expected Result (and Expected Next Status when relevant).

Rules: every column is a meaningful combination mapped to a real Scenario ID with an expected result; exclude impossible/irrelevant combinations and list them (with reason) under "Excluded / uncovered combinations"; do not generate every mathematical combination; record unresolved behaviour in Clarifications. Use a matrix when comparing combinations is clearest, workflow scenarios when progression/handover is the focus, both when needed.

## A.7 Scenario design
Coverage categories (apply those relevant): Positive/Happy Path, Negative, Business Rule, Validation, Mandatory Field, Boundary/Limit, Status/Workflow, Role/Access, WIP/Non-WIP, Data Persistence, Save/Submit/Approve/Revise, Confirmation/Alert, UI/Display, Audit Trail, Tracking Diary, Integration/Cross-Module, Exception/Error Handling, Regression.

Each scenario states: objective, requirement reference, condition, precondition, action/steps, expected result, test data. Group by module, function, application/document type, business flow, status, role or deployment origin - whichever is most practical for the module.

## A.8 Expected results
Describe what the system displays, what is allowed or restricted, what data is retained/reset/updated, which validation fires, which status change happens, what audit/tracking information is recorded, and what downstream behaviour occurs. Use the CR's exact message wording (BM and EN if given). If no wording is documented, write e.g. "System displays an error notification preventing submission (exact wording not specified in CR - see CL-03)". Banned: "System works as expected", "As expected", "OK".

Example - Condition: user changes Supplier Finalization Method. Action: selects **Yes** in the confirmation popup. Expected: popup closes; previously selected Item List, Supplier List and Remarks are reset, as specified in the requirement. A separate scenario covers **No**.

## A.9 Test data, preconditions and over-generation
- For each scenario decide whether data is newly created, pre-existing, saved before deployment, created after deployment, at a particular status, assigned to a role, or tied to an account/contract type.
- WIP: state the pre-deployment setup and post-deployment continuation. Non-WIP: state the new-transaction setup.
- Unavailable data -> `Test Data Required`. Never fabricate document numbers, user accounts, supplier records or evidence; never copy passwords/IC numbers.
- Quality over count: no duplicates without reason, but do not over-combine if it hides different statuses, roles, rules, expected results, WIP vs Non-WIP behaviour or integration impact. Use groups and steps to reduce repetition.

## A.10 Final QA review checklist
**Requirement analysis:** entire CR/FRS reviewed; all business rules identified; all affected modules identified; appendices reviewed.
**Scenario design:** module-appropriate structure; historical files used only as guidance; positive and negative coverage; validation and boundary coverage where applicable; regression impact considered.
**Workflow & status:** applicable statuses identified; each affected status verifiably covered; roles/actions mapped; sequential flows mapped; transitions verified against CR.
**WIP / Non-WIP:** deployment-origin definition applied; WIP and Non-WIP applicability assessed; pre-deployment data needs identified; post-deployment continuation covered; workflow status not confused with WIP; unknown behaviour flagged.
**Combination coverage:** meaningful dimensions identified; valid combinations covered; impossible ones excluded; matrix traceable to scenarios.
**Execution readiness:** unique IDs; clear preconditions; testable actions; specific expected results; test data identified; no invented document references; no pre-populated passes; no unnecessary duplicates.
**Traceability:** every scenario linked to a source requirement; requirement coverage checked; missing information documented; no unsupported business-rule assumptions.

---

# Reference B - Module-specific patterns

*(learned from historical workbooks UAT CR #29555, SIT SM CR #28775, SIT SIR #13847. Patterns are guidance, not mandatory columns.)*

## B.1 Design selection guide

| Requirement characteristic | Design |
|---|---|
| Same display/behaviour checked across several document types and statuses | **Status-based table** (B.2) |
| Many conditions (types x categories x statuses x roles) drive one rule | **Combination matrix with X** (B.3) |
| Change spans many sequential stages with role handovers, approve/revise loops | **Workflow: Scenario Group + Step IDs** (B.4) |
| Condition-driven rule *and* multi-stage flow | **Hybrid**: summary matrix + detailed workflow steps |
| Report, Portal, simple field/label change | **Flat functional table** derived from CR (B.5) |

## B.2 FL / document and status-based pattern (ref: UAT CR #29555)
- **Shape:** one row per *Transaction Type x Document Type x Document Status*. Example axes: P1 Purchase Order / Purchase Request; P2 Contract Order / Contract Request (via Direct Purchase, Catalogue, or Contract source); statuses such as Pending Request Creation, Pending Approval, Pending Revision / Revision Approval, Pending Query Verification.
- **Columns:** Test Scenario No. | Test Scenario Details (role + steps) | Transaction Type | Document Type | Document Status | Expected Result split by verification point (e.g. *Main Screen (Prepared By)* and *FL Maintenance & Audit & Tracking Diary*) | Document No | Passed/Failed | Tester | Remarks.
- **Two-level header:** "Test Scenario Description" over the input columns, "Expected Result" over the verification columns.
- **Expected results** list each verification point separately (screen label, Action By, Role) and give BM and EN text when the CR specifies both.
- **WIP rows** are separate, placed after Non-WIP rows, explicitly labelled WIP, and use documents saved before deployment at each relevant status.
- **ID style:** `<CR>_Scenario_NN`.

## B.3 SM / supplier application pattern (ref: SIT SM CR #28775)
- **WIP X-matrix sheet** with grouped headers: *Application Type* (New Register MOF, Add Category Codes, Upgrade MOF, Renewal) | *Business / Company Type* (ROC Sdn Bhd, ROC Bhd, ROB Partnership, ROB Sole, Sarawak/Sabah registrations ...) | *Current Application Status* (the full supplier application status list, BM labels as shown in system) | *Category Type* (special sub-types, Normal) | *Role / Source* (Supplier Admin, SDO, Approver, PO, Site Visit Coordinator, Site Visit Officer), then Test Data, Updated Status (system), Impact, QA to Take Note, execution columns. Each row = one combination marked with `x`.
- **WIP impact per status** is recorded as a separate column ("Impacts" / "QA to Take Note"). The values must come from the CR or BA confirmation for *this* CR - when the CR is silent, raise a clarification per status rather than assuming.
- **Scenario sheets per application flow** (e.g. KN = New Registration, KA = Add Category Code, KR = Renewal; Upgrade where applicable). Each scenario (`<CR>_KN01`) runs through the roles in workflow order - Supplier Administrator -> Supporting Document Officer -> Processing Officer -> Approver -> Site Visit Coordinator -> Site Visit Officer -> Processing Officer (review SV report) -> Registration Approver - one row per role/status, with columns: Business/Company Type | condition columns (e.g. Registered with special code Y/N, Existing category codes, During renewal action) | Category Code | Enhancement (sub-Redmine/item ref) | Role/Source | Process Description | Application Status | Business Rules / Expected Result | execution columns.
- **Feature header rows** group sub-requirements (one row per enhancement item, then its checks), each traceable to its sub-reference.
- **Supporting sheets seen:** scope matrix (business types x category types with counts), SIT plan (scenarios per group, resources, duration, tester assignment), reference data list (category codes), cross-module scenario (e.g. Profile Management workload routing / KPI rules), defect log.
- **Typical dimensions:** Application Type x Business Type x Account Type x Category Code/Type (existing vs new) x Role x Status x Deployment Origin.

## B.4 CT / FL contract and fulfilment pattern (ref: SIT SIR #13847)
- **Layer 1 - Summary condition matrix (Non-WIP):** one row per test data set: Contract (Ministry/Central) | Route (Normal QT / DLOA / DP->LOA) | Fulfilment Type | Procurement Method | rule conditions as Yes/No columns | outcome column (e.g. "Allow create CR") | Process sub-rows (Creation/Revision, Update, Approval/Revision, View).
- **Layer 2 - Detailed test script:** ID `TSCN_<CR>_<DataSet>_<Step>`; columns: Data | Scenario | Test Script ID | Status | Process Description | Role | Screen (menu path) | Action Detail | Approver Decision (Approve/Revise/Reject) | New fields / Button / Instruction | Mandatory | Alert / Error / Tooltip | Expected Result | Doc No | execution. Each action step is followed by verification steps *View via Maintenance* and *View via Audit* when the CR affects those screens. Cover creation -> approval -> revision -> revision approval -> update -> amendment (with/without supplemental) -> downstream (e.g. CR creation in FL) only where applicable.
- **Layer 3 - WIP sheet:** existing contracts saved before deployment in different lifecycle situations (e.g. effective, expired, inactive, mid-amendment) with the CR-defined expected behaviour (notification, ability to proceed).
- **Flow reference sheets:** process -> status -> role per route (e.g. Normal QT, DLOA, CT-FL) used to sequence steps.
- **Repeated flows:** historical files used "Flow as 001-018"; in generated workbooks prefer explicit steps, or a Scenario Group that references the reused flow *and* lists the differing condition so each status is still verifiable.
- **Typical dimensions:** Contract Type x Procurement Method x Route x Fulfilment Type x Role x Status x Workflow x Deployment Origin.

## B.5 Other modules (QT, DP, CMCD, Portal, Report, others)
No historical template - derive the structure from the CR/FRS. Candidate dimensions to *check for* (include only if the CR supports them):
- **QT:** procurement method, QT/tender stage (before/during publishing, evaluation 1-tier/2-tier), committee roles (specification, opening, evaluation, technical, financial, board), status in QT flow, proposal/compliance conditions.
- **DP:** DP type, threshold/limit boundaries, supplier selection/finalisation method, item/supplier list behaviour, approval route.
- **CMCD:** catalogue/contract item data, maintenance roles, effective dates, integration to DP/FL.
- **Portal:** user type (public/supplier/PTJ), login state, language BM/EN, content display, links/downloads.
- **Report:** filter parameters (valid/invalid/blank), access role, data source reconciliation to transactions, totals, sorting, export format, BM/EN labels.

## B.6 Anti-patterns
- Adding Business Type / Category Code columns to an FL or Report CR because the SM template has them.
- Adding Ministry/Central or Fulfilment Type columns to an SM CR.
- A column that is N/A on every row - remove it (the builder warns about this).
- Copying historical statuses, roles or impact statements into a new CR without the CR saying so.

---

# Reference C - WIP / Non-WIP rules

*(QA team deployment-based definition)*

## C.1 Definitions
- **WIP:** a transaction/application **created and saved before deployment**, then reopened, continued or processed **after** deployment. Example: before deployment, create an application and save at Pending Submission -> deploy -> reopen and continue -> verify enhancement behaviour on this existing record.
- **Non-WIP:** a **new** transaction/application **created after deployment**, then processed through the applicable workflow. For Non-WIP, several statuses may be covered in one continuous end-to-end flow when each status is verified in its own step.

## C.2 Three separate dimensions
| Dimension | Values | Answers |
|---|---|---|
| Deployment Origin | WIP / Non-WIP / N/A / TBD | When was the record created relative to deployment? |
| Workflow Status | Pending Submission, Pending Approval, Pending Revision, Approved ... | Where is the record in its process? |
| Enhancement State | Before / After enhancement, Existing / New behaviour | Which behaviour is being described? |

Every combination such as WIP + Pending Approval, Non-WIP + Pending Approval, WIP + Pending Revision, Non-WIP + Pending Revision may be valid. Never classify a pending status as WIP by itself, and never classify a completed record as Non-WIP because it completed. The Deployment Origin column holds only WIP / Non-WIP / N/A / TBD - status goes in Current Status.

## C.3 Mandatory applicability review
For every CR:
1. Can records saved before deployment be affected (new mandatory fields, changed validations, changed routing, new screens, changed templates/reports, changed calculations)?
2. Do new records behave differently from existing ones?
3. Identify the deployment origin needed for each test data set.
4. Identify the workflow statuses at which WIP records must exist (one WIP record per relevant status, prepared before deployment).
5. Create separate WIP scenarios where behaviour or regression risk differs.
6. If WIP behaviour is unspecified but compatibility is a risk, raise a Clarification (e.g. "Will a record saved at Pending Revision before deployment require the new mandatory field on resubmission?").
7. Mark N/A only with a defensible reason (e.g. "Report-only change; reads data at run time; no saved transaction state").

Never invent legacy-data migration, grandfathering or WIP expected behaviour.

## C.4 Classification check (self-test)
| Situation | Deployment Origin | Current Status |
|---|---|---|
| PR saved at Pending Approval two days before deployment, approved after deployment | WIP | Pending Approval |
| PR created after deployment, now at Pending Approval | Non-WIP | Pending Approval |
| Contract approved before deployment, viewed in maintenance after deployment | WIP | Fulfilment Details Approved |
| Application created after deployment and completed end-to-end | Non-WIP | (each step's status) |
| Report CR with no saved transaction state | N/A (reason stated) | - |
| CR silent on existing records, risk exists | TBD + Clarification | relevant status |

## C.5 Writing WIP scenarios
- **Precondition:** "Before deployment: create <record> and save at <status> (Test Data Required). After deployment: login as <role> and open the existing record."
- **Action:** continue the flow from that status.
- **Expected:** CR-defined behaviour for existing records; if undefined -> reference the clarification ID, do not guess.
- **WIP Coverage sheet columns:** Requirement Ref | Status at deployment | WIP Scenario ID | Non-WIP Scenario ID | Pre-deployment setup | Post-deployment verification | Behaviour source (CR ref / Clarification ID) | Remarks.
- For SM-style CRs a WIP X-matrix (Application Type x Business Type x Status x Category x Role) plus an Impact column per status is appropriate (B.3).

---

# Reference D - Excel output standards

## D.1 Sheets
**Core:** `Test Scenarios` (module-adaptive; may be split per flow, e.g. `Scenario - KN`, `Scenario - KA`, or `Detail <CR>` + `Summary Matrix`).
**When applicable:** `Decision Matrix`, `Workflow & Status`, `WIP Coverage`, `Test Data`.
**Always:** `Requirement Coverage`, `Clarifications`, `Scenario Summary` (built automatically by the script).
Sheet names: max 31 characters, none of `[ ] : * ? / \`, unique.

## D.2 Column catalogue (choose per module - not every module needs every column)
No. | Scenario ID | Scenario Group ID | Step ID | Requirement Reference | Module | Function / Process | Application / Transaction Type | Document / Contract Type | Scenario Category | Deployment Origin | Role | Current Status | Business Condition | Precondition | Test Data | Action / Test Step | Expected Result | Expected Next Status | Document Reference | Priority | Execution Status | Tester | Execution Date | Actual Result | Defect / Redmine Ref | Evidence Ref | Remarks.

Mandatory for the builder: `Scenario ID`, `Requirement Reference`, `Expected Result`. Use `Deployment Origin` as the column name for WIP/Non-WIP. Execution columns are appended automatically.

Module-typical layouts:
- **FL status-based:** Scenario ID | Requirement Reference | Transaction Type | Document Type | Current Status | Deployment Origin | Role | Precondition | Test Data | Action / Test Step | Expected Result - Main Screen | Expected Result | Document Reference. (Split expected results per verification point; keep one column named `Expected Result`.)
- **SM combination:** Scenario ID | Step ID | Requirement Reference | Application Type | Business / Company Type | Category Type | Deployment Origin | Role | Current Status | Process Description | Test Data | Expected Result | Expected Next Status - plus a Decision Matrix sheet.
- **CT workflow:** Scenario Group ID | Scenario ID | Step ID | Requirement Reference | Contract Type | Route / Procurement Method | Fulfilment Type | Deployment Origin | Current Status | Role | Screen | Action / Test Step | Approver Decision | Mandatory | Alert / Error Message | Expected Result | Expected Next Status.

## D.3 ID conventions
- Scenario ID: `<CR>_<Prefix><NN>` sequential and unique, e.g. `29555_SC01`, `28775_KN01`, `13847_SC01`. Prefix reflects flow/group when useful (KN/KA/KR, WIP, NW).
- Step ID: `<ScenarioID>_S<NN>` (or `TSCN_<CR>_<DataSet>_<Step>` to match CT convention). (Scenario ID, Step ID) must be unique.
- Scenario Group ID: `<CR>_G<NN>` for end-to-end flows.
- Clarification ID: `CL-01` ...; numbering continuous.
- Keep the user's own convention when they supply a template.

## D.4 Formatting (applied by the builder)
Title row with CR number/title; metadata row (module, phase, source, version, date); two-level header (tan group row, dark blue column row, white bold text); thin borders; wrapped top-aligned text; frozen header and ID columns; auto-filter; alternating band per scenario/group so steps stay visually together; WIP cells light orange, Non-WIP light green; drop-down validation for Execution Status, Deployment Origin, Coverage Status and Clarification Status; conditional colours for Passed/Failed/Blocked; landscape print with repeated header rows (A3 for wide sheets). Rows of one scenario are kept together in workflow order (no merged ID cells, so filtering works).

## D.5 Execution tracking
Execution Status values: Not Run, Passed, Failed, Blocked, Deferred, N/A. New scenarios = `Not Run`. Fields: Tester, Execution Date, Actual Result, Defect / Redmine Ref, Evidence Ref, Remarks - kept separate from expected behaviour. The builder rejects Passed/Failed unless `meta.execution_evidence_provided` is true (set it only when the user supplied real execution evidence).

## D.6 JSON spec for the builder
```json
{
  "meta": {
    "cr_no": "CR 12345", "title": "Short CR title", "module": "FL",
    "phase": "SIT", "source": "CR 12345 v1.2 (FRS section 3)", "version": "1.0",
    "execution_columns": true,
    "execution_evidence_provided": false,
    "document_numbers_user_provided": false
  },
  "scenarios": {
    "sheet_name": "Test Scenarios",
    "columns": ["Scenario ID", "Step ID", "Requirement Reference", "Module",
                "Scenario Category", "Deployment Origin", "Role", "Current Status",
                "Precondition", "Test Data", "Action / Test Step",
                "Expected Result", "Expected Next Status", "Priority"],
    "group_headers": [["Test Scenario Description", "Scenario ID", "Action / Test Step"],
                      ["Expected Result", "Expected Result", "Priority"]],
    "rows": [ { "Scenario ID": "12345_SC01", "Step ID": "12345_SC01_S01",
                "Requirement Reference": "CR Sec 2.1 #1", "...": "..." } ]
  },
  "matrices": [ {
    "name": "Decision Matrix", "title": "Rule X conditions", "rule": "CR Sec 2.3",
    "scenario_ids": ["12345_SC01", "12345_SC02"],
    "conditions": [ {"dimension": "Status", "value": "Pending Approval", "x": ["12345_SC01"]} ],
    "expected": {"12345_SC01": "...", "12345_SC02": "..."},
    "next_status": {},
    "uncovered": [ {"combination": "Central + DP", "reason": "Not allowed per CR Sec 2.3"} ]
  } ],
  "tables": [ { "name": "WIP Coverage", "columns": ["..."], "rows": [ {"...": "..."} ] } ],
  "requirements": [ { "ref": "CR Sec 2.1 #1", "description": "...", "dimensions": "...",
                      "status_coverage": "...", "role_coverage": "...",
                      "wip_assessment": "Applicable - existing records at Pending Revision",
                      "coverage_status": "Covered", "remarks": "" } ],
  "clarifications": [ { "id": "CL-01", "ref": "CR Sec 2.1 #1", "ambiguity": "...",
                        "impact": "...", "question": "...", "status": "Open" } ]
}
```
Notes: row keys must match declared columns; `group_headers` is optional (default groups: description / expected / execution); `coverage_status` may be omitted (computed: Covered if referenced, else Not Covered); Scenario IDs per requirement are filled automatically; `tables` holds Workflow & Status, WIP Coverage, Test Data or module-specific sheets.

## D.7 Builder audit (what it enforces)
Errors: missing meta, missing mandatory columns, undeclared keys, empty/duplicate IDs, missing or unknown requirement refs, empty or vague expected results, invalid execution status, Passed/Failed without evidence, Deployment Origin not in {WIP, Non-WIP, N/A, TBD} or containing a status, Non-WIP row describing pre-deployment data, requirement marked Covered without scenarios, Clarification Required without a Clarifications entry, matrix columns without scenario/X/expected result, invalid sheet names.
Warnings: WIP row without "before deployment" precondition, column N/A on every row (forced dimension), uncovered requirement, duplicate matrix combinations, possible passwords/IC numbers, real-looking document numbers not confirmed as user-provided.

---

# Appendix - Workbook builder script

Write this verbatim to `build_qa_workbook.py`, then run `python3 build_qa_workbook.py spec.json output.xlsx`.

```python
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
```
