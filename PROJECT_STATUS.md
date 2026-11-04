# Project status

**Current phase:** Phase 2 — CR Analysis ✅ built and tested on Windows 11 (2026-11-02). One acceptance check is still open: running the analysis on a real CR with the live model, which needs your Anthropic API key. Waiting for `NEXT` to start Phase 3.

## Completed in Phase 2

- **QA test scenario workbook (2026-11-04):** "Generate test scenarios" on the CR Analysis page runs the user's own QA prompt (verbatim) and produces a checked, versioned Excel: Test Scenarios, Decision Table, Requirement Coverage, Clarification Required, Scenario Summary, WIP-Transaction Coverage, Enhancement Coverage, Test Dimensions, QA Self-Review. Live run on CR3657: 45 scenarios, 39 decision-table combinations, 14 clarifications in about 13 minutes. Pictures in DOCX files (before/after screens) are sent to the AI too.

- **Runs on your Claude subscription (2026-11-04):** with no API key, the app uses the Claude Code CLI on this PC (`claude -p`, locked down, no tools). **Analyse documents** asks which documents to analyse. A live run on FL30753 v1.8 produced 99 requirements with 99/99 verified quotes in about 4.5 minutes (CR `FL30753-AI`).

- **Document extraction with references** (Node, no Python needed): PDF → `Page N`, DOCX → `Section "heading"` (tables as rows), XLSX → `Sheet!A5:F5` with cell labels, images sent to the model as images. Scanned, password-protected and corrupt files are reported, not guessed at.
- **Extraction preview**: "Show what the analyst reads" shows the exact text and reference labels per document. Works without an API key.
- **Anthropic client** (`@anthropic-ai/sdk`): model, effort, token budgets, retries and timeout from `server/.env`; JSON-schema structured output validated again with zod; input-token budget checked before sending; truncated, refused or invalid responses are errors and nothing is saved; server-side refusal fallback on Opus/Sonnet 5.x; Settings → **Test connection**.
- **CR Analyst agent**: extracts functional and non-functional requirements, business rules, roles, validations, flows, exceptions, integrations and clarifications. Each one is classified explicit / inferred / assumption / clarification required, with risk, rationale, module, feature and source. It also returns a CR summary, impacted modules and regression impact. Documents are treated as untrusted data. Re-runs see existing requirements and don't renumber or touch them.
- **Source verification**: every quote is looked up in the extracted text. The stored reference is where the quote really is. Anything not found is flagged **not verified** in the table, dialog and workbook.
- **Background tasks**: `AgentTask` with progress, model, token usage, output and error; live progress bar; cancel; one analysis per CR at a time; tasks interrupted by a restart are marked failed.
- **Requirement review**: table with search, status and classification filters, counts, multi-select bulk approve / clarification / reject; dialog to edit, approve, reject, mark clarification (with comment), go back to pending, copy to clipboard, and compare any two revisions field by field. Manual "Add requirement". Every change is a new revision plus an audit entry; editing an approved requirement sends it back to review.
- **Requirements workbook export**: "Export all" / "Export approved only" → validated, editable XLSX (Information, Requirements, Analysis Notes), frozen header, filters, dropdowns, borders, A4 landscape print setup, saved as a versioned `GeneratedArtifact` (`CR30045_Requirements_v2.xlsx`) and downloadable again later.
- CR Analysis Studio page lists all CRs. The CR page links to it, CR history includes requirement, task and export events, and the dashboard counts pending reviews.

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

## To finish the Phase 2 acceptance check (needs you)

1. Sign in with `ant auth login` (the Anthropic CLI), or put a key in `server/.env`: `ANTHROPIC_API_KEY=sk-ant-...`. Remove anything from the CR you're not allowed to send to an external AI API.
2. Restart `npm run dev`, then Settings → **Test connection**.
3. Open a CR with a real document → CR Analysis Studio → **Analyse documents**.
4. Review the "not verified" items first, spot-check a few verified references against the document, then export the workbook.
5. Tell me what was wrong or missing. Prompt and extraction issues are best fixed now, before Phase 3 builds scenarios on top.

## Pending (next phases)

Next is **Phase 3: Test Scenario Studio** (scenario generation from approved requirements, completeness check, scenario review, RTM links, four-sheet Excel export). See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Known issues and limitations

| Item | Detail |
|---|---|
| Live AI extraction not yet verified | See above. All code around the model is tested with a scripted client and a fake HTTP layer. |
| No OCR | Scanned PDFs are detected and reported. Upload a text PDF or the DOCX. Images can be uploaded directly; the model reads them as images. |
| One AI task at a time | The in-process runner queues tasks across all CRs. A persistent, parallel queue comes in Phase 9. Tasks still running when the server stops are marked failed, not resumed. |
| Embedded DOCX images skipped | Only document text is analysed; a warning says how many images were skipped. |
| Re-analysis can still produce near-duplicates | The model is shown existing requirements and told not to repeat them, but this isn't guaranteed. Reject duplicates in review. |
| Large documents | Inputs over `AI_MAX_INPUT_TOKENS` (default 300,000) are refused with a clear message. Time and cost on very large CRs not yet measured. |
| No login / single user | Everything is recorded as `local-user`. The server binds to 127.0.0.1 only. Roles and auth are planned for Phase 10. |
| No permanent delete | By design. Archive and restore only. Requirements are rejected, not deleted. |
| Search is case-insensitive on SQLite only | On PostgreSQL, add `mode: 'insensitive'` to search queries. |
| Environment credentials not stored | Deliberate. A secure store comes with Phase 5. |
| Frontend bundle ~600 KB | Vite chunk-size warning. Harmless for a local tool. |
| `npm audit`: 13 findings (10 moderate, 3 high) | Was 6 before Phase 2. The 7 new ones are transitive dependencies of `exceljs` 4.4.0 (old `uuid`, and `glob`/`minimatch` via `archiver`), plus `deepmerge-ts` via Prisma's config. None are fixed by a compatible upgrade; `npm audit fix --force` would make breaking changes. The app only feeds these libraries server-generated data or uploads that already passed validation, and it runs on 127.0.0.1. Review before any shared deployment (Phase 10 security pass), or earlier if you want. |
| Not yet created | ScenarioRevision, TemplateMapping (as table), ScriptVersion, ExecutionStep, AgentRun, TestDataSet. Added in their phases. |
