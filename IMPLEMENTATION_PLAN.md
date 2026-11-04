# Implementation plan

Each phase ends with: run the app, test, fix, update docs, report, then **stop** until the user says `NEXT`.

| Phase | Name | Status |
|---|---|---|
| 1 | Foundation | ✅ Complete (2026-11-02) |
| 2 | CR Analysis | ✅ Built and tested (2026-11-02). Real-document AI extraction awaits an API key |
| 3 | Test Scenario Studio | Not started |
| 4 | Test Case & Template Engine | Not started |
| 5 | Playwright Automation Studio | Not started |
| 6 | Self-Healing Engine | Not started |
| 7 | Evidence Management | Not started |
| 8 | Execution, Defects & Coverage | Not started |
| 9 | AI Multi-Agent Orchestration | Not started |
| 10 | Final Integration & Validation | Not started |

## Phase 1 — Foundation ✅

Built: architecture, full relational schema, Fastify API, React dashboard shell, 16-item sidebar, overview from real data, project / CR / environment management with archive, restore and history, secure versioned file upload and download, artifact storage service, config validation, docs, tests.

Acceptance criteria, all verified (see TEST_RESULTS.md):
- [x] Application starts (`npm run dev` and `npm start`)
- [x] Frontend talks to backend (Vite proxy in dev, same origin in production)
- [x] Database persists records (SQLite via Prisma migrations)
- [x] Projects and CRs can be created and retrieved
- [x] Files upload securely (type, content, size, path checks) and download byte-identical
- [x] Implemented features are tested (44 API/unit + 11 UI tests)

## Phase 2 — CR Analysis ✅ (one acceptance item pending your API key)

Status of the acceptance criteria below (details in TEST_RESULTS.md):
- [ ] Upload a real CR → actual requirements extracted with correct source references. **Not yet run against the live model**: no API key is configured. The full pipeline is tested with a scripted AI client and a fake HTTP layer, and extraction is tested on real PDF/DOCX/XLSX files.
- [x] Edit and approve; revisions retained
- [x] Download an editable, valid requirements workbook
- [x] Without an API key, the UI says AI is not connected and no fake results appear

Build (as planned; Node parsers were sufficient, so no Python service):
- Node document extraction (pdfjs-dist, mammoth, exceljs) for PDF, DOCX and XLSX text **with page, section and cell references**; images go to the model as images. No OCR (scanned PDFs are reported)
- Anthropic client: model from config, JSON-schema validated output, token budget per request, retry limits, clear "not connected" behaviour
- CR Analyst agent: requirement extraction with classification (explicit / inferred / assumption / clarification required), source references, risk. Uploaded content treated as untrusted data
- `AgentTask` tracking with progress, plus a simple background runner
- Requirement review UI: table, edit, approve, reject, mark clarification, revision compare (`RequirementRevision`)
- Requirements XLSX export saved as a versioned `GeneratedArtifact`

Acceptance:
- Upload a real CR → actual requirements extracted with correct source references
- Edit and approve; revisions retained
- Download an editable, valid requirements workbook
- Without an API key, the UI says AI is not connected and no fake results appear

## Phase 3 — Test Scenario Studio
Scenario generation from approved requirements; `CR30045-TS-001` numbering; second-pass completeness check (missing negatives, roles, transitions, duplicates, unsupported assumptions); scenario editor with approval; RTM links; four-sheet professional XLSX export (Information, Test Scenarios, RTM, Review Summary) with frozen headers, filters, dropdowns and print setup.

## Phase 4 — Test Case & Template Engine
Template library (upload, inspect sheets, styles, formulas, merged cells and images; suggest and save field mapping; versioning). Test case generation from approved scenarios. SITCR and UAT Evidence Pack generation **into the user's own template**, preserving formatting and formulas. Workbook validation before download.

## Phase 5 — Playwright Automation Studio
Script generation (TS, POM, fixtures, stable locators, no fixed sleeps), editor, copy, download (file and project ZIP), execution in headed and headless mode across browsers and environments, execution safety modes, secure credential handling, logs, screenshots and traces.

## Phase 6 — Self-Healing Engine
Failure capture (error, screenshot, trace, DOM), classification into the 10 categories, minimal repair candidates, isolated verification, approval, full version and repair history. Never weakens assertions.

## Phase 7 — Evidence Management
Evidence upload, extraction from PDF and DOCX, contextual screenshot-to-scenario matching with confidence (Review Required when unsure), manual correction, insertion into the UAT Attachment sheet following the template, saved as a new workbook version, evidence ZIP.

## Phase 8 — Execution, Defects & Coverage
Manual execution recording (append-only history), automated run history, defect lifecycle, RTM with bidirectional traceability and the documented formulas, coverage reports, exports.

## Phase 9 — AI Multi-Agent Orchestration
Agent Workbench chat, orchestrator, job queue with dependencies, cancellation, retries and resource locks, 3 isolated Playwright workers by default, approval workflows, progress tracking, recovery.

## Phase 10 — Final Integration & Validation
Full E2E, export and template integrity tests, security review (incl. authentication and roles if shared), performance, documentation, feature completion matrix.
