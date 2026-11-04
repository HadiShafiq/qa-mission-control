# Architecture

## Components (Phases 1–2)

```
Browser (React SPA, :5173 in dev)
   │  /api/*  (Vite dev proxy; same origin in production)
   ▼
Fastify API (:4000)  ──►  Prisma ORM  ──►  SQLite  server/prisma/dev.db
   │
   ├──►  Storage service  ──►  server/storage/projects/<projectId>/crs/<crId>/{documents,artifacts}/…
   ├──►  Document extractors (pdfjs-dist, mammoth, exceljs) — text + page/section/cell refs
   ├──►  Task runner (in-process)  ──►  CR Analyst agent
   └──►  AI client (@anthropic-ai/sdk)  ──►  Anthropic Messages API (only when ANTHROPIC_API_KEY is set)
```

| Layer | Tech | Location |
|---|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, shadcn-style components, Radix Dialog, TanStack Query + Table, Lucide, Sonner | `web/` |
| API | Node.js, Fastify 5, zod validation, @fastify/multipart | `server/src/` |
| Database | Prisma 6, SQLite (PostgreSQL-ready) | `server/prisma/` |
| File storage | Local disk, SHA-256 integrity | `server/storage/` |
| Document parsing | pdfjs-dist (PDF), mammoth (DOCX), exceljs (XLSX read + write) | `server/src/lib/extract.ts`, `server/src/exports/` |
| AI | @anthropic-ai/sdk: streaming, structured outputs (JSON schema), adaptive thinking, server-side refusal fallback | `server/src/lib/ai.ts` |
| Tests | Vitest (API/unit), Playwright (UI) | `server/test/`, `web/e2e/` |

### Planned additions (later phases)

| Component | Phase | Purpose |
|---|---|---|
| Template-preserving Excel engine (exceljs; a Python/openpyxl service only if exceljs can't keep a real template intact) | 4 | Write SITCR / UAT packs into the user's own templates |
| Persistent job queue with dependencies, parallel workers and locks (replaces the in-process runner) | 9 | Multi-agent orchestration |
| Playwright runner with worker isolation | 5 / 9 | Automated execution, evidence capture |

## Backend structure

```
server/src/
  server.ts            entry point (listen, graceful shutdown)
  app.ts               buildApp(): plugins, error handler, routes, static UI in production
  config.ts            env loading + zod validation (fails fast with clear messages)
  context.ts           { db, storage, config, ai, runner } passed to routes
  domain/constants.ts  allowed status values, scenario types
  domain/scenarios.ts  scenario rows ↔ workbook, revision snapshots, newest-workbook helper
  agents/runner.ts     in-process task runner (one task at a time, cancel, restart recovery)
  agents/documents.ts  load task documents, lay them out for the model, verify source quotes
  agents/skillAnalyst.ts  QA skill analyst: SKILL.md + app note, spec schema, builder spec, fix round, save, export
  agents/scenarioAnalyst.ts  APP_V1 (pre-skill) workbook schema and summary, for old runs
  lib/workbookBuilder.ts  runs the skill's build_qa_workbook.py and parses its audit
  lib/ai.ts            Anthropic client wrapper (budget, retries, refusal/truncation handling)
  lib/extract.ts       PDF / DOCX / XLSX text + pictures, with references
  lib/claudeCode.ts    Claude Code CLI engine (user's subscription), locked down
  lib/crInfo.ts        CR number / title / version suggestions from a document
  exports/scenarioWorkbook.ts  QA test scenario workbook builder, validator, export
  lib/storage.ts       safe file storage, upload validation, Content-Disposition
  lib/audit.ts         audit log writer + field diff
  lib/validate.ts      zod helpers
  lib/errors.ts        AppError
  routes/              system, projects (+ environments), changeRequests, documents, dashboard,
                       analysis (extraction preview, generate-scenarios, tasks), scenarios, artifacts
```

## API

| Method & path | Purpose |
|---|---|
| `GET /api/health` | DB and storage health |
| `GET /api/settings` | Non-secret config, AI connection status |
| `GET /api/upload-rules` | Allowed extensions and max size |
| `GET/POST /api/projects` | List (search, `status=active\|archived\|all`) / create |
| `GET/PATCH /api/projects/:id` | Detail (with environments) / edit name, description |
| `POST /api/projects/:id/archive` · `/restore` | Soft archive / restore |
| `GET /api/projects/:id/history` | Audit log for the project and everything in it |
| `GET/POST /api/projects/:id/environments` | Environment configurations |
| `PATCH /api/environments/:id`, `POST /api/environments/:id/archive` | Edit / archive environment |
| `GET /api/crs` | List CRs (filters: `projectId`, `search`, `status`, `analysisStatus`) |
| `POST /api/projects/:id/crs` | Create CR |
| `GET/PATCH /api/crs/:id` | Detail / edit (title, description, version, statuses) |
| `POST /api/crs/:id/archive` · `/restore` | Soft archive / restore |
| `GET /api/crs/:id/history` | Review history (CR + its documents) |
| `GET/POST /api/crs/:id/documents` | List / multipart upload (field `files`, multiple) |
| `GET /api/documents/:id/download` | Stream the original bytes |
| `GET /api/documents/:id/verify` | Re-hash the file and compare with stored SHA-256 |
| `POST /api/documents/:id/archive` · `/restore` | Soft archive / restore |
| `GET /api/dashboard/summary` | All overview metrics |
| `GET /api/activity` | Recent audit entries |
| `POST /api/settings/ai/test` | One cheap API call (model lookup) to prove the key and model work |
| `GET /api/crs/:id/extraction` | Extracted text of each active document with the reference labels the analyst cites (works without AI) |
| `POST /api/crs/:id/generate-scenarios` | Queue a QA test scenario run (`documentIds` optional). 409 `AI_NOT_CONNECTED` without AI |
| `GET /api/crs/:id/scenario-workbooks` | Every run (workbook version) with scenario / approved / pending counts |
| `GET /api/scenario-workbooks/:id` | The other sheets: dimensions, decision tables, coverage, clarifications, checks |
| `GET /api/crs/:id/scenarios` | Scenarios of the newest (or `workbookId`) run; filters `reviewStatus`, `type`, `search` |
| `POST /api/scenario-workbooks/:id/scenarios` | Add a scenario by hand |
| `GET/PATCH /api/scenarios/:id`, `GET /api/scenarios/:id/revisions` | Detail / edit (new revision) / history |
| `POST /api/scenarios/:id/review`, `POST /api/scenario-workbooks/:id/review` | Approve / reject / clarification / back to pending, one or many |
| `POST /api/scenario-workbooks/:id/export` | `{ scope: all \| approved }` → Excel rebuilt from the stored rows, new artifact version |
| `GET /api/crs/:id/tasks`, `GET /api/tasks/:id`, `POST /api/tasks/:id/cancel` | Task progress, result and error; cancel a queued or running task |
| `GET /api/crs/:id/artifacts`, `GET /api/artifacts/:id/download` | List / download generated files |

## Data model

All tables exist from Phase 1 so that metrics read from real (empty) tables. Tables marked † are populated from later phases.

```
Project ─┬─< EnvironmentConfiguration ─< ExecutionRun†
         ├─< ChangeRequest ─┬─< SourceDocument
         │                  ├─< Requirement† ─< RequirementRevision†
         │                  │        └─< ScenarioRequirement† >─┐
         │                  ├─< TestScenario† ─────────────────┘
         │                  │        └─< TestCase† ─┬─< TestStep†
         │                  │                       ├─< AutomationScript†
         │                  │                       ├─< ExecutionRun† ─< Evidence†
         │                  │                       └─< Evidence†
         │                  ├─< GeneratedArtifact
         │                  └─< Defect†
         ├─< Template†, GeneratedArtifact, Defect†, AgentTask† ─< Approval†
         └─< AuditLog
User, AppSetting (standalone)
```

Key constraints:
- `Project.code` unique; `ChangeRequest (projectId, crNumber)` unique; `EnvironmentConfiguration (projectId, name)` unique.
- `SourceDocument.storageKey` unique; `version` increments per `(crId, originalName)`.
- `GeneratedArtifact (projectId, name, version)` unique, for versioned exports from Phase 2.
- `ScenarioRequirement` is many-to-many: one requirement can map to many scenarios and vice versa.
- `ExecutionRun` is append-only: many runs per test case.

Entities from the master prompt not yet created (added in their phase): ScenarioRevision, TemplateMapping (currently `Template.mapping` JSON), ScriptVersion, ExecutionStep, AgentRun, TestDataSet.

## Data flow: QA test scenarios with the user's skill (since 2026-11-05)

The user's own skill **qa-test-scenario-generator** is kept unchanged in `server/skills/qa-test-scenario-generator/`: `SKILL.md` (instructions) and `scripts/build_qa_workbook.py` (workbook builder + audit, Python + openpyxl).

1. Upload CR / FRS (or **New analysis**) → **Generate test scenarios** → pick documents. `POST /api/crs/:id/generate-scenarios` refuses up front when AI or the builder (Python + openpyxl) is missing.
2. Documents are extracted (text with page / section / row references; pictures as image blocks) and laid out as untrusted `<documents>` (`agents/documents.ts`).
3. The model's instructions are `SKILL.md` word for word plus `APP_NOTE` (`agents/skillAnalyst.ts`), which only says what the app does instead of the chat steps (no questions, no SendUserFile, the app runs the builder) and asks for per-row traceability (document, location, verbatim quote). The answer is the skill's D.6 spec as structured output (`SkillSpecSchema`; rows as {column, value} cells). Claude Code receives the 60 KB instructions through `--system-prompt-file` (the Windows command line is limited to 32 KB).
4. The app converts it to the builder's JSON spec, forces `execution_evidence_provided` / `document_numbers_user_provided` to false, verifies every quote, and adds Source Location / Source Verified / Review Status (/ Review Comment) columns.
5. `build_qa_workbook.py` runs on the spec in a temporary folder (`lib/workbookBuilder.ts`). On **FAIL**, the analyst gets one round with its previous spec and the builder's ERROR / WARNING list; if it still fails, the workbook is saved with `--force` as `…_DRAFT.xlsx` and the audit errors are shown.
6. Saved: a `ScenarioWorkbook` (format `SKILL_V1`, builder spec, columns, design, audit result and report) and one `TestScenario` per Scenario ID with its step rows (`steps` JSON), revision 1 and audit entries.
7. Review in the app edits the step rows; every export rebuilds the spec from the stored rows and runs the same builder (approved-only removes other scenarios from the matrices and lets the builder recompute coverage).

Runs saved before 2026-11-05 (format `APP_V1`, fixed columns) stay viewable, reviewable and exportable with the earlier Node builder.

## Scenario review rules

- Every edit and review decision increments `revision`, writes a `ScenarioRevision` snapshot and an audit entry with field-level changes. Nothing is overwritten or deleted.
- Editing an APPROVED scenario sets it back to PENDING; hand-editing the source reference clears `sourceVerified`.
- Scenarios can be added by hand (origin MANUAL, next ID in that workbook).
- Archived CRs / projects: scenarios are read-only and generation can't start; export still works.

## Removed on 2026-11-04

The separate requirement extraction (CR Analyst prompt), the Requirements table with approve / reject, and the requirements workbook were removed at the user's request; the QA test scenario workbook covers them (Requirement Coverage and Clarification Required sheets). The `Requirement` / `RequirementRevision` tables and their existing rows are kept untouched (no data deleted) but are no longer used. The code is in git commit `ed92870` if it is ever needed again.

## Data flow: document upload

1. Browser checks extension and size from `/api/upload-rules`, for fast feedback only.
2. Server streams each file to a server-generated path, hashing and size-counting as it goes.
3. Server rejects it if the extension isn't allowed, the first bytes don't match the type (PDF `%PDF-`, DOCX/XLSX ZIP `PK\x03\x04`, PNG, JPEG), the file is empty or it's over the limit. Partial files are removed.
4. In one transaction: create `SourceDocument` (next version for that name) and an `UPLOADED` audit entry.
5. Download streams the stored bytes with the original name (`_vN` suffix for versions after 1) and an `X-Content-SHA256` header.

## Metric definitions

Scope: non-archived CRs in non-archived projects. A percentage is `null` (shown as "No test cases yet") when there are no test cases.

| Metric | Formula |
|---|---|
| Total projects | count of projects where `archivedAt` is null |
| Total CRs | count of in-scope CRs |
| Approved scenarios | scenarios with `reviewStatus = APPROVED` |
| Passed / Failed / Blocked | test cases whose **latest** `ExecutionRun` has that status (retests don't double count) |
| Not run | test cases with no execution run |
| Automation coverage | test cases with ≥ 1 automation script ÷ test cases |
| Execution progress | test cases whose latest run is PASSED, FAILED, BLOCKED or NOT_APPLICABLE ÷ test cases |
| Evidence completion | test cases with ≥ 1 evidence record ÷ test cases |
| Open defects | defects with status OPEN, IN_PROGRESS, RETEST or REOPENED |
| Test scenarios / approved / need clarification | rows in each in-scope CR's **newest** scenario workbook |
| Pending approvals | those scenarios with review status PENDING or CLARIFICATION_REQUIRED, plus `Approval` rows with status PENDING |

## Agent responsibilities

| Agent | Phase | Input → output | Human checkpoint |
|---|---|---|---|
| QA Scenario Analyst (user skill) ✅ | 2 | CR / FRS documents (text + pictures) → the user's QA test scenario workbook: dimensions, scenarios, decision tables, requirement / WIP / enhancement coverage, clarifications, self-review | Approve, reject, mark clarification or edit each scenario (one at a time or in bulk); export |
| Test Case Generator | 4 | Approved scenarios → steps and expected results, SITCR / UAT in your template | Edit individual test cases |
| Automation Engineer | 5 | Approved test cases → Playwright TS | Approve before running against SIT/UAT |
| Self-Healing Engineer | 6 | Failure artefacts → classified diagnosis and minimal repair candidate | Approve significant repairs |
| Evidence Manager | 7 | Screenshots → scenario matches with confidence | Review uncertain matches |
| Defect Analyst, QA Validation, Orchestrator | 8–9 | — | Approval workflows |

## Security

- Input validation on every route (zod); request body limit 1 MB (uploads use multipart with their own limit).
- Upload allow-list, magic-byte check, size limit, sanitised filenames (Windows reserved names, `..`, separators, control chars).
- Storage keys generated server-side; `Storage.resolve` refuses anything outside the root.
- API key never returned; auth headers redacted from logs.
- Uploaded document content is untrusted: it is delimited in the prompt, the model is told not to follow embedded instructions, its output is schema-validated, and it has no tools, so it can only return data.
- PDFs are parsed for text only (no rendering, no font loading, no scripts).
- Over-budget AI requests are refused before sending. The API key is only read by `lib/ai.ts`.
- Server binds to `127.0.0.1` by default (local only). There is no login yet. Don't expose it on a network until role-based access exists (Phase 10).
