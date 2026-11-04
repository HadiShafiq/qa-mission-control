# Test results

## Phase 2 — CR Analysis — 2026-11-02

Environment: **Windows 11 Pro** (10.0.26200), Node.js 24.18, Playwright 1.64 (Chromium). No Anthropic API key configured.

| Check | Command | Result |
|---|---|---|
| TypeScript (server + web) | `npm run typecheck` | ✅ no errors |
| API & unit tests | `npm test` | ✅ 81 / 81 passed (5 files: 44 from Phase 1 + 37 new) |
| Browser UI tests | `npm run test:e2e` | ✅ 21 / 21 passed (11 Phase 1 + 10 Phase 2) |
| Production build | `npm run build` | ✅ built (same harmless chunk-size warning as Phase 1) |
| Migration | `prisma migrate dev --name phase2_cr_analysis` | ✅ applied to dev DB; also applied by every test run from scratch |
| Visual review | Screenshots of the analysis page at 1440 px light and dark, 390 px mobile, and the requirement dialog | ✅ no layout problems found |
| Stability | `test/analysis.test.ts` run 5 times in a row | ✅ 18 / 18 each time (after the race fix below) |
| **Live AI extraction on a real CR** | — | ⏳ **Not run.** No API key is configured. See "What is not verified yet" |

### API & unit tests added

`server/test/extract-ai.test.ts` (real files generated in the test, no mocks for parsing)
- PDF: one segment per page with `Page N` references
- PDF without a text layer → "no text layer / OCR not supported" warning, no segments
- Corrupt PDF → readable warning, no crash
- DOCX: text grouped by heading (`Section "2.1 …"`), tables kept as `Row N: | … |`, text before the first heading kept
- XLSX: one segment per row with cell addresses, sheet names with spaces quoted (`'Business Rules'!A2:B2`), empty rows skipped
- Image → sent to the model as an image, with a warning
- Source verification: quote found at the cited page → verified; wrong page → corrected to the real page; spreadsheet cell kept when in the matching row; quote not in any document → unverified; quotes under 8 characters don't count
- Anthropic client (real SDK, fake `fetch`, no network): request uses `stream`, `thinking: adaptive`, `output_config.format = json_schema`, effort, `max_tokens`, `fallbacks: "default"` and the `server-side-fallback-2026-07-01` beta header
- Over-budget input (`count_tokens` > `AI_MAX_INPUT_TOKENS`) is refused before the analysis request is sent
- `max_tokens` stop → TRUNCATED, `refusal` → REFUSAL, schema mismatch → INVALID_OUTPUT, all with no data returned
- 401 → clear "API key was rejected" message
- The `AnalysisSchema` converts to a JSON schema accepted by the request

`server/test/analysis.test.ts` (real migrated SQLite, real storage; the AI is a scripted test double)
- No key: `POST /analyse` → 409 `AI_NOT_CONNECTED`, no task and no requirement created; `POST /settings/ai/test` → 409
- No key: extraction preview still works
- Manual requirement: code `CR777-REQ-001`, origin MANUAL, unverified; invalid input → 400
- PDF + DOCX + XLSX analysed together: 5 requirements, codes `CR30045-REQ-001…005`; 3 verified with exact references (`spec.pdf (v1) › Page 2`, `notes.docx (v1) › Section "3.1 Notifications"`, `rules.xlsx (v1) › Rules!B2`); a made-up quote stays unverified; clarification item starts as CLARIFICATION_REQUIRED; CR becomes ANALYSED; 5 CREATED audit entries plus task COMPLETED in CR history
- The prompt marks documents as untrusted, and an injected "Ignore previous instructions" line in the PDF stays inside `<documents>`
- AI failure (rate limit) → task FAILED with the reason, nothing saved, CR status unchanged
- Schema-invalid output → FAILED, nothing saved
- Scanned PDF → FAILED with "No text could be extracted … no text layer", **model not called**
- Second analysis continues numbering (`-REQ-002`), is shown the existing requirements, and leaves earlier ones untouched
- Duplicate concurrent analysis → 409; cancel → CANCELLED, nothing saved; cancelling again → 409
- Task left RUNNING by a "crashed" server → FAILED with a reason on the next start
- Edit → revision 2 with field-level audit changes; hand-edited reference clears `sourceVerified`; no-op edit adds no revision
- Approve / clarification (with comment) / invalid status → 400; editing an approved requirement resets it to PENDING
- Bulk review of 2 → both approved; unknown id → 404
- Export: `CR70000_Requirements_v1.xlsx`, then v2, and `CR70000_Approved_Requirements_v1.xlsx` (separate version series); download is byte-identical (SHA-256); workbook re-opened: sheets Information / Requirements / Analysis Notes, header, values, frozen header, autofilter, Risk dropdown, landscape print; approved-only file has 2 rows
- Export with no requirements → 400
- Dashboard: 3 requirements, pending approvals = 1
- Archived CR: edit → 409, analyse → 409

### Browser UI tests added (`web/e2e/phase2.spec.ts`, no API key)
1. Upload a real text PDF on the CR page → "Analyse requirements" opens the CR Analysis Studio
2. "AI is not connected" banner, run button disabled with the reason, no task card, "No requirements yet"
3. Extracted text preview shows `Page 2` and the PDF text
4. Add two requirements by hand → `CR88001-REQ-001/002`, counts show 2 pending
5. Edit → revision 2; Revisions tab compare highlights exactly one changed row (old and new description); Approve → badge Approved
6. Copy → toast and the clipboard contains the requirement text and status
7. Bulk "Needs clarification"; status filter and search filter the table
8. Export all → downloads `CR88001_Requirements_v1.xlsx`, parsed in the test: correct sheets, IDs, edited text, statuses; a second export downloads v2 and both are listed
9. Studio list → CR → analysis page; CR history shows the approval and the export; Overview shows "1 item(s) need review"
10. 390 px mobile: no horizontal overflow

Phase 1 test 9 ("unbuilt modules say so honestly") now checks Test Scenario Studio (phase 3), because CR Analysis Studio is built.

### Failures found and fixed during Phase 2

| Issue | Found by | Fix |
|---|---|---|
| `npm install` failed with `EPERM … query_engine-windows.dll.node` | Installing while `npm run dev` was running | Stopped the dev server first; added to README troubleshooting |
| `pdfjs-dist` v6 removed `isEvalSupported` and `PDFDocumentProxy.destroy()` | Typecheck | Use the loading task's `destroy()`; v6 doesn't evaluate PDF code |
| SDK auto-parsed structured output and threw on truncated or refused responses before our checks ran | API test with fake `fetch` | Send the JSON schema without the SDK parser; check `stop_reason` first, then parse and validate |
| Race: cancelling a task in the moment between dequeue and RUNNING let it run anyway (and overwrote CANCELLED) | Intermittent failure (1 in ~3 full runs) | Atomic `QUEUED → RUNNING` and `QUEUED → CANCELLED` updates (`updateMany` with a status condition) |
| Model in `server/.env` was `claude-sonnet-5-5` (copied from the old template default) | Visual review | Default changed to `claude-opus-5-5` in `config.ts`, `.env.example` and your `server/.env` (model line only) |

### Follow-up on 2026-11-02 (login support and your real FRS)

- **Sign-in support:** the app now also accepts an `ant auth login` profile when `ANTHROPIC_API_KEY` is empty (the SDK's own credential chain). New test: with a profile present and no key → `authSource: ant-profile`; with a key → `api-key`. Unit and UI tests are isolated from your real login (`ANTHROPIC_CONFIG_DIR` points at an empty folder).
- **Real FRS extraction (local only, no AI call):** `Change Request-FL30753 … POCO Acknowledgement_V1.8.docx` first came out as **one** segment ("Document start"), because the form is built from tables with no Word heading styles, so every reference would have been useless. **Fixed:** each top-level Word table is now its own segment, titled by a single-cell first row: `Table 1`, `Table 2 "B. Change Request Details"` (14,091 chars), `Table 3 "C. Implementation Timeline"`, `Table 4 "D. Supporting Document…"`, `Table 5 "E. Recommendation / Approval"`, `Text after Table 5`. The model may cite `…, Row 5`, and that row reference is kept only when the quote is really in that row; otherwise it falls back to the table. 2 new tests.
- The FRS has **11 embedded images** that are skipped (only text is analysed). If they hold requirements (screen mock-ups, flow diagrams), those won't be extracted.
- Results: `npm test` 84 / 84; `npm run test:e2e` 21 / 21 on two consecutive full runs.
- **Intermittent UI test failures seen while the PC was low on memory:** the mobile overflow test failed in 1 of 3 full runs. Cause: it measured the page before the requirements had loaded. Fixed by waiting for the table, and it now lists the overflowing elements if it ever fails. Phase 1's upload test failed once (1.3 s in), then passed in 4 runs after it; not reproduced, so not fixed. Watch for it.

- **Live run attempt (FL30753):** signed in with `ant auth login` (profile "default", Hadi's Individual Org). Settings → Test connection succeeded (Claude Opus 5.5). The analysis was refused by Anthropic: *credit balance is too low*. Nothing was saved, as designed. The app now shows a clear BILLING message for this (1 new test; 85 / 85 pass).
- **FL30753 requirements entered from a Claude Code session instead** (at the user's request: subscription, no API credit): 34 items (26 explicit, 1 assumption, 7 clarifications), all marked **Manual**, each with a verbatim quote that was checked against the extracted text of the cited row before saving (34 / 34 found). Workbook exported: `FL30753_Requirements_v1.xlsx`. This does **not** test the app's CR Analyst, which still needs API credit.

### Claude Code engine and document picker — 2026-11-04

- New engine: the app runs the local Claude Code CLI (`claude -p`, v2.1.316) with the user's subscription login, so no API credit is needed. Locked down: no tools, no MCP, no saved session, empty temp folder, API-key env vars removed; documents on stdin, JSON schema enforced, result re-validated with zod.
- New "Which documents should be analysed?" dialog: **Analyse documents** now asks which documents to send (all ticked by default; images disabled under Claude Code). The source document upload box is also on the CR Analysis Studio page.
- Tests: `npm test` **98 / 98** (13 new in `test/claude-code.test.ts` with a fake CLI: exact locked-down arguments, documents never on the command line, full analysis schema, not-signed-in → AUTH, usage limit → RATE_LIMIT, execution error, non-JSON, missing / wrong structured output, truncation, refusal, images and over-budget refused before running, engine selection rules). `npm run test:e2e` **21 / 21**. The picker dialog itself is not covered by a UI test (the UI test server has no AI connected).
- **Live run on the real FRS (acceptance check):** Settings → Test connection succeeded ("Claude Code 2.1.316 (your Claude subscription)", Claude Opus 5.5). Separate CR `FL30753-AI` (to keep the manual set untouched), FRS v1.8 picked, analysis **completed in 262 s**: **99 requirements** (73 explicit, 7 inferred, 3 assumptions, 16 clarifications), **99 / 99 quotes verified** at the cited location (94 in Table 2 Row 5, the Resolution). Output tokens 35,606.
- Review notes on that output: very granular (EN and BM alert texts are separate items); 4 inferred "boundary test" items (#018, #028, #044, #054) assume "equal to threshold = no alert", which the CR does not state. Treat them as questions. The human review of all 99 items is still to be done by the user.

- **New analysis button (2026-11-04):** CR Analysis Studio has a **New analysis** dialog: choose FRS file(s), CR number / title / version are suggested from the filename (editable), pick or create a project, optionally start the analysis, then it opens the CR. UI test: file "Change Request-CR3657 - Approval workflow change_V2.0.pdf" → CR3657, title, version 2.0; new project; CR created and document uploaded; first requirement is CR3657-REQ-001; same CR number again → "already exists" error. Typecheck clean, `npm run test:e2e` **22 / 22**.

- **CR number and title read from the document (2026-11-04):** New analysis now reads the chosen file (validated like an upload, read from a temp folder, deleted, nothing stored) and fills CR number / title / version / project from labelled fields (CRF No., CR No., Change Request No., Redmine #, Title, Tajuk, Version, Project Name), falling back to the filename. Each field shows where its value came from; values the user typed are never overwritten. On the real FL30753 v1.8 FRS: CR number FL30753 (document "CRF No. : Redmine #30753", prefix from filename), title and version 1.8 from the filename (the form has no title field), project EPFL matched from "eP-FL". Tests: `npm test` **104 / 104** (6 new), `npm run test:e2e` **23 / 23** (1 new; one earlier run lost the browser at ~2 GB free memory, the re-run passed).

- **Pictures in documents are analysed (2026-11-04):** DOCX pictures are extracted in order and marked `[Image N]` where they appear (e.g. "Process : DO Creation [Image 7]"). PNG/JPEG/GIF/WEBP up to 5 MB go to the AI with the text; other formats (e.g. WMF icons) are listed in a warning, never silently skipped. Claude Code receives them through one `stream-json` user message (verified with a real red test image first; tools still off). The extraction preview shows the pictures; requirements taken from a picture are labelled "from a picture" (they cannot be text-verified). Tests: `npm test` **110 / 110** (7 new), `npm run test:e2e` **23 / 23**.
- **Live run with the 8 FL30753 screenshots** (Appendix A before / B after; the 3 WMF priority icons reported as unreadable): re-run on CR FL30753-AI with only the FRS ticked. Completed in 199 s, about 55k input tokens (about 10k without pictures). **35 new requirements** (19 inferred, 1 explicit, 15 clarifications) on top of the 99. Screen-only details were found: light-blue warning banner vs pink blocking banner with a close (x) icon, the screen and status each alert appears on, FRN No. staying N/A when blocked, and PTJ fields on screen raising a <<PTJ Name>> question. Note: several screen-derived items quote the Appendix caption text, so they show as "verified" against the caption; only 3 point at an Image reference.
- PDF-embedded pictures are not extracted yet (only DOCX pictures and standalone image files).

- **QA test scenario workbook from the user's prompt (2026-11-04):** new action "Generate test scenarios" runs the user's prompt word for word (`server/src/agents/scenarioPrompt.ts`) plus an output note. The app renumbers IDs (CR-TS-001…), remaps and checks every cross-reference, verifies source quotes, computes the Scenario Summary from rows, and validates the file before saving it as a versioned artifact. Tests: `npm test` **115 / 115** (5 new in `test/scenarios.test.ts`), `npm run test:e2e` **23 / 23**.
- **Live run on CR3657 (CR3657_Consolidated_FRS_Updated.docx) through Claude Code:** completed in 789 s, 104,570 output tokens. `CR3657_Test_Scenarios_v1.xlsx`: **45 scenarios** (14 positive, 18 negative, 13 business rule, 18 validation, 3 boundary, 2 role/access, 2 enhancement, 22 regression), **3 decision tables / 39 combinations** (31 covered, 8 TBD), **14 clarifications**, WIP judged N/A, enhancement applicable. App checks: all cross-references resolved; 2 of 45 scenario quotes not found in the text. Human review of the workbook by the user is still to be done.

### What is not verified yet

- **Extraction quality on a real CR with the live model.** Every code path around the model is tested, but whether the model extracts the *right* requirements from *your* documents can only be checked with a key and a real CR. To run it: add `ANTHROPIC_API_KEY` to `server/.env`, restart, Settings → Test connection, upload a CR, click "Analyse documents", then check the unverified items first.
- Large documents (100+ pages): the token budget check is tested, but analysis time and cost on a large real CR have not been measured.
- Scanned PDFs: OCR is not implemented. They are detected and reported.

## Phase 1 — 2026-11-02

Environment: Linux workspace, Node.js 22.23, Chrome 153 (Playwright 1.64, channel `chrome`). **Re-run on Windows 11 on 2026-11-02 before Phase 2: typecheck clean, 44 / 44 API tests, 11 / 11 UI tests passed.** `npm run setup` and `npm run dev` also worked on Windows.

| Check | Command | Result |
|---|---|---|
| TypeScript (server + web) | `npm run typecheck` | ✅ no errors |
| API & unit tests | `npm test` | ✅ 44 / 44 passed (3 files) |
| Browser UI tests | `npm run test:e2e` | ✅ 11 / 11 passed |
| Production build | `npm run build` | ✅ built (warning: JS chunk > 500 KB, harmless) |
| Production single-port start | `npm start` | ✅ UI at `/`, SPA routes load, `/api/health` ok, unknown `/api/*` → JSON 404 |
| Clean install from scratch | `npm run setup` in a fresh copy, then `npm test` | ✅ env file created, migration applied, 44 / 44 passed |
| Visual review | Screenshots at 1440 px light and dark, 390 px mobile | ✅ after fix (see below) |

### API & unit tests (Vitest, real migrated SQLite per test file)

`server/test/projects.test.ts`
- Health check reports database and storage healthy
- AI shown as not connected; API key never returned even when configured
- Unknown API route returns JSON 404
- Project created with code normalised to upper case
- Duplicate project code → 409
- Missing or invalid fields → 400 with field-level messages
- List and search projects
- Update records field-level `from → to` changes in history
- No-op update writes no history
- Environments: rejects `javascript:` URL, rejects duplicate name, archive frees the name
- Archive hides the project, blocks edits and new CRs; restore brings it back; history shows CREATED, UPDATED, ARCHIVED, RESTORED
- Missing project → 404

`server/test/crs-documents.test.ts`
- CR created with defaults (version 1.0, NOT_STARTED)
- Duplicate CR number rejected in the same project, allowed in another project
- List, search and filter CRs by analysis status
- Invalid status value → 400
- Update records version and status changes in review history
- Multi-file upload (PDF, XLSX, PNG), download is byte-identical, SHA-256 verify passes
- Same filename creates v2 (not overwritten); download name gets a `_v2` suffix
- `.exe` rejected
- Text file named `.pdf` rejected (magic-byte check)
- Empty file rejected
- File over the limit → 413, nothing left on disk or in the DB
- Path traversal filename `..\..\..\windows\evil.pdf` stored safely as `evil.pdf` inside the CR folder
- Document archive hides it from the default list, it stays downloadable, history records it
- Upload to an archived CR → 409
- Stored file deleted from disk → download returns 410 with a clear message
- Dashboard counts match records, percentages `null` with no test cases
- Dashboard counts only the **latest** execution per test case (FAILED then PASSED → 1 passed, 0 failed)
- Archived CRs excluded from dashboard metrics

`server/test/storage.test.ts`
- Filename sanitisation: path separators, Windows-forbidden characters, leading dots, reserved names (`CON`), empty
- Storage key resolution refuses `..`, absolute paths and null bytes
- Versioned download names and non-ASCII `Content-Disposition` encoding

### Browser UI tests (Playwright, isolated DB in `.e2e/`)

`web/e2e/phase1.spec.ts`
1. Empty dashboard shows empty states and zero counts, AI not connected
2. Create project via the dialog (code auto upper-cased), lands on project page with history; duplicate code shows the error
3. Environment: server rejects a non-http URL and the message shows under the field; valid URL added
4. Create CR → upload PDF → v1 listed; `.exe` refused in the browser; fake PDF refused by the server with a message; re-upload creates v2; download of v1 is byte-identical with the original filename; history shows the upload
5. Edit CR version and analysis status → review history shows the field changes
6. Dashboard shows 1 project, 1 CR, 2 source documents and the CR in "Active change requests"
7. CR search (no match / match) and analysis-status filter
8. Archive project → read-only banner, dashboard drops to 0, hidden from Active, found under Archived, restore brings back its CRs
9. Unbuilt module (CR Analysis Studio) shows "isn't built yet" and "Planned for phase 2"
10. Dark mode toggles and persists after reload; Settings shows AI not connected
11. Mobile (390 px): no horizontal overflow, navigation drawer opens and navigates

### Failures found and fixed during Phase 1

| Issue | Found by | Fix |
|---|---|---|
| Mobile pages overflowed horizontally (implicit grid columns sized to content) | Screenshot review at 390 px | Explicit `grid-cols-1` on page grids; UI test now asserts no overflow |
| Raw JSON server logs were hard to read in the terminal | Running `npm run dev` | `pino-pretty` in development mode only |

### Unresolved

- None for Phase 1. Windows run confirmed on 2026-11-02.
