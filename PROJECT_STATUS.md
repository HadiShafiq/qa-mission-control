# Project status

**Current phase:** Phase 2 — CR Analysis ✅, reshaped on 2026-11-04 into **one function: QA test scenarios**. Built and tested on Windows 11. Waiting for your review of the generated workbooks, then `NEXT`.

## Scenario generation now uses your QA skill (2026-11-05)

**Generate test scenarios** follows your skill *qa-test-scenario-generator* exactly (`server/skills/qa-test-scenario-generator/`, never edited): module-adaptive design, WIP / Non-WIP as deployment origin, Step IDs, execution columns starting at "Not Run". Your `build_qa_workbook.py` builds and audits every Excel. A failed audit gets one automatic fix round; if it still fails, the file is saved as `_DRAFT` with the errors shown. Review in the app now edits each scenario's steps and columns, and exports go through your builder too. Requires Python + openpyxl (`PYTHON_PATH`, default `py`). Live CR3657 run: audit PASS first time, 32 scenarios, 13 clarifications, WIP applicable.

## The one CR analysis function (2026-11-04)

Upload a CR / FRS → **Generate test scenarios** (your QA prompt, word for word, through Claude Code on your subscription; pictures such as before/after screens included) → the scenarios are **saved in the app** → **review each one** (approve, reject, needs clarification, edit, add by hand, compare revisions, copy) → **Export Excel** (all, or approved only). Exports are rebuilt from the saved rows, so they include every edit and decision (Review Status / Review Comment columns).

- Workbook sheets: Test Scenarios, Decision Table, Requirement Coverage, Clarification Required, Scenario Summary, WIP-Transaction Coverage, Enhancement Coverage, Test Dimensions, QA Self-Review.
- Application checks on every run: consistent IDs (`CR3657-TS-001…`), cross-references remapped and checked, unreferenced scenarios listed, source quotes verified, summary counts calculated from rows, file re-opened and validated.
- Each run is a new workbook version; older runs stay selectable. Counts on the CR list and dashboard use the newest run.
- **New analysis** creates the CR from the FRS (CR number / title / version read from the document or filename) and can start generation straight away.
- **Removed** (at your request): requirement extraction, the Requirements table with approve / reject, and the requirements workbook. Their existing data (34 + 134 requirements, old exports) is kept, not deleted; the code is saved in git commit `ed92870`.

Live runs through Claude Code: CR3657 (41 scenarios saved, 15 clarifications, 2 decision tables, 13 min) and earlier FL30753 (72 scenarios, WIP applicable). FL30753 was generated before saving-in-app existed, so re-run it to review it in the app.

## Completed in Phase 1

- Monorepo: `server/` (Fastify 5 + Prisma 6 + SQLite) and `web/` (React 19 + Vite + Tailwind 4), one-command setup and dev start
- Full relational schema with migrations, including the traceability chain tables used by later phases
- Validated configuration (`server/.env`) with clear startup errors; AI connection status shown honestly
- Projects, environments (SIT, UAT, Local, Custom URL), change requests: create, view, edit, archive, restore, search, filter, sort, history
- Source documents: multi-file upload with type, content and size validation, versioning, byte-identical download, integrity verification, archive and restore
- Overview dashboard calculated from the database, with empty states instead of invented numbers
- 16-item sidebar; unbuilt modules show an honest "planned for phase N" page with no controls
- Light and dark mode, responsive down to 390 px, keyboard and screen-reader friendly
- Single-port production mode (`npm start`)
- Verified on Windows 11 on 2026-11-02

## What you need to do

1. Open CR3657 in the CR Analysis Studio and review the 41 scenarios (start with "not verified" and anything marked clarification).
2. For FL30753, click **Generate test scenarios** again so its scenarios are saved for review.
3. Export, check the Excel against the FRS, and tell me what to change. Your prompt text stays as you wrote it unless you ask.

## Pending (next phases)

Next is **Phase 3: scenario quality & RTM** (in-app views of the decision tables / coverage / clarifications, comparing two runs, links to test cases as they are built). See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Known issues and limitations

| Item | Detail |
|---|---|
| AI output varies between runs | Two CR3657 runs gave 45 and 41 scenarios. Review each run; older runs stay available to compare. |
| No OCR | Scanned PDFs are detected and reported. Upload a text PDF or the DOCX. Images can be uploaded directly; the model reads them as images. |
| One AI task at a time | The in-process runner queues tasks across all CRs. A persistent, parallel queue comes in Phase 9. Tasks still running when the server stops are marked failed, not resumed. |
| Embedded DOCX images skipped | Only document text is analysed; a warning says how many images were skipped. |
| Generation takes 10–16 minutes | A full FRS workbook is a large answer (about 100k output tokens). It counts toward your Claude subscription usage. |
| Large documents | Inputs over `AI_MAX_INPUT_TOKENS` (default 300,000) are refused with a clear message. Time and cost on very large CRs not yet measured. |
| No login / single user | Everything is recorded as `local-user`. The server binds to 127.0.0.1 only. Roles and auth are planned for Phase 10. |
| No permanent delete | By design. Archive and restore only. Scenarios are rejected, not deleted. |
| Search is case-insensitive on SQLite only | On PostgreSQL, add `mode: 'insensitive'` to search queries. |
| Environment credentials not stored | Deliberate. A secure store comes with Phase 5. |
| Frontend bundle ~600 KB | Vite chunk-size warning. Harmless for a local tool. |
| `npm audit`: 13 findings (10 moderate, 3 high) | Was 6 before Phase 2. The 7 new ones are transitive dependencies of `exceljs` 4.4.0 (old `uuid`, and `glob`/`minimatch` via `archiver`), plus `deepmerge-ts` via Prisma's config. None are fixed by a compatible upgrade; `npm audit fix --force` would make breaking changes. The app only feeds these libraries server-generated data or uploads that already passed validation, and it runs on 127.0.0.1. Review before any shared deployment (Phase 10 security pass), or earlier if you want. |
| Not yet created | ScenarioRevision, TemplateMapping (as table), ScriptVersion, ExecutionStep, AgentRun, TestDataSet. Added in their phases. |
