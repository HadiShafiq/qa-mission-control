# QA Mission Control

An AI-assisted QA engineering platform that manages the testing lifecycle, from CR documents through requirements, scenarios, test cases, SITCR / UAT Evidence Packs, Playwright automation, evidence, defects and traceability.

**Current status: Phase 1 (Foundation) complete.** See [PROJECT_STATUS.md](PROJECT_STATUS.md).

---

## Requirements (Windows)

| Tool | Version | Get it |
|---|---|---|
| Node.js | 20.11 or newer (22 LTS recommended) | https://nodejs.org (choose **LTS**, keep "Add to PATH" ticked) |
| VS Code | any recent | https://code.visualstudio.com |
| Git | optional | https://git-scm.com |

No database server is needed. Phase 1 uses SQLite (a single file).

Check Node is installed: open **PowerShell** or the **VS Code terminal** (`Ctrl + ``) and run:

```powershell
node -v
npm -v
```

## First-time setup

Open the `qa-mission-control` folder in VS Code (**File → Open Folder…**), open a terminal (`Ctrl + ``) and run:

```powershell
npm run setup
```

This one command:
1. Installs all packages for the server and the web app (`npm install`).
2. Creates `server/.env` from `server/.env.example` (if it doesn't exist).
3. Creates the SQLite database `server/prisma/dev.db` and applies migrations.

Optional demo data (one clearly labelled sample project):

```powershell
npm run db:seed
```

## Run the app (development)

```powershell
npm run dev
```

Then open **http://localhost:5173** in your browser.

- `api` (cyan) logs: the backend on http://127.0.0.1:4000
- `web` (magenta) logs: the dashboard on http://localhost:5173

Stop both with `Ctrl + C`.

## Run as a single app (production-style)

```powershell
npm start
```

Builds everything and serves the dashboard and API together on **http://127.0.0.1:4000**.

## Tests

| Command | What it runs |
|---|---|
| `npm test` | API and unit tests (Vitest), against a real migrated SQLite database |
| `npm run test:e2e` | Browser UI tests (Playwright) against isolated servers on ports 4100/5174 with a throw-away database |
| `npm run typecheck` | TypeScript checks for server and web |
| `npm run test:all` | All of the above |

Before the first `npm run test:e2e` on a new machine, install the test browser once:

```powershell
npx playwright install chromium
```

Or use the Chrome / Edge already installed:

```powershell
$env:PW_CHANNEL="chrome"; npm run test:e2e
$env:PW_CHANNEL="msedge"; npm run test:e2e
```

UI tests never touch your real data. They use `.e2e/`, which is recreated every run.

## Useful commands

| Command | Purpose |
|---|---|
| `npm run db:studio` | Browse the database in Prisma Studio |
| `npm run db:migrate` | Create a new migration after editing `server/prisma/schema.prisma` |
| `npm run build` | Build server (`server/dist`) and web (`web/dist`) |

## Configuration

All settings are in `server/.env` (never commit this file). See `server/.env.example` for every option.

| Setting | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `file:./dev.db` | SQLite file in `server/prisma/` |
| `PORT` | `4000` | API port |
| `STORAGE_DIR` | `./storage` | Where uploaded files are stored (`server/storage/`) |
| `MAX_UPLOAD_MB` | `25` | Max size per uploaded file |
| `ANTHROPIC_API_KEY` | empty | Needed for the CR Analyst. Empty means the app shows "AI not connected" and never produces AI results |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Model used by AI agents |
| `AI_EFFORT` | `high` | `low` \| `medium` \| `high` \| `xhigh` \| `max`. Higher is more thorough and uses more tokens |
| `AI_MAX_INPUT_TOKENS` | `300000` | Input budget per request. Larger inputs are refused, never truncated |
| `AI_MAX_OUTPUT_TOKENS` | `64000` | Output limit per request. A cut-off response is reported as an error and nothing is saved |
| `AI_MAX_RETRIES` | `2` | Retries for rate limits, overload and network errors |
| `AI_TIMEOUT_SECONDS` | `900` | Timeout per AI request |

| `AI_PROVIDER` | `auto` | `auto`: API key if set → otherwise the **Claude Code CLI** on this PC (uses your Claude subscription, no API credit) → otherwise an `ant auth login` profile. Force one with `anthropic-api` or `claude-code` |
| `PYTHON_PATH` | `py` (Windows) / `python3` | Python that runs the QA skill's `build_qa_workbook.py`. Needs openpyxl: `py -m pip install openpyxl` |
| `CLAUDE_CODE_PATH` | `claude.exe` | Path to the Claude Code CLI, if it isn't on PATH |

**Using your Claude subscription (no API credit):** if Claude Code is installed and signed in on this PC, the app runs `claude -p` for each analysis. It runs with no tools, no MCP servers and no saved session, in an empty temporary folder, so document content cannot make it run commands or read files. Images can't be analysed this way (text documents only). Usage counts toward your subscription limits.

**Signing in instead of using a key:** if `ANTHROPIC_API_KEY` is empty, the app uses an Anthropic CLI login profile when one exists (`ant auth login`, stored under `%APPDATA%Anthropic`). Settings shows which one is in use. The tests and UI tests ignore your login, so they always run as "not connected".

After changing `server/.env` or signing in, restart `npm run dev`. Use **Settings → Test connection** to check it works.

## Backing up your data

Everything lives in two places. Copy both while the app is stopped:

- `server/prisma/dev.db` (database)
- `server/storage/` (uploaded files)

## Troubleshooting

| Problem | Fix |
|---|---|
| `'npm' is not recognized` | Node.js isn't on PATH. Reinstall Node LTS with "Add to PATH" ticked, then **restart VS Code**. |
| `running scripts is disabled on this system` (PowerShell) | Run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or switch the VS Code terminal to **Command Prompt**. |
| `Port 5173 is already in use` / `EADDRINUSE :4000` | Another copy is running. Close the other terminal, or find it with `netstat -ano \| findstr :4000` and end it with `taskkill /PID <pid> /F`. |
| Dashboard says **"Cannot reach the QA Mission Control server"** | The backend isn't running or crashed. Check the `api` lines in the terminal. |
| `Invalid configuration (check server/.env)` | A value in `server/.env` is wrong. Compare with `server/.env.example`. |
| `npm install` fails behind a company proxy | Set `npm config set proxy http://proxy:port` and `npm config set https-proxy http://proxy:port`, or ask IT to allow `registry.npmjs.org` and `binaries.prisma.sh`. |
| Prisma error "Query engine library ... could not be found" | Run `npm run db:generate -w server`. |
| Start again with an empty database | Stop the app, delete `server/prisma/dev.db` and `server/storage/`, then run `npm run db:deploy -w server`. **This deletes all data.** |
| `EPERM: operation not permitted, rename … query_engine-windows.dll.node` during `npm install` | The running dev server holds the Prisma engine file. Stop `npm run dev`, then install again. |
| Analysis fails with "API key was rejected" or "model was not found" | Check `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` in `server/.env`, restart, then Settings → Test connection. |
| Analysis says a PDF has no text layer | It's a scanned PDF. OCR isn't supported yet. Upload a text PDF or the source DOCX. |
| Playwright: "Executable doesn't exist" | Run `npx playwright install chromium`, or set `PW_CHANNEL=chrome` (see Tests). |

## Project documents

| File | Contents |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Rules and conventions for anyone (or any AI) working on the code |
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | Current phase, what's done, what's pending, known issues |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, data model, data flow, metric formulas |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | All 10 phases with acceptance criteria |
| [TEST_RESULTS.md](TEST_RESULTS.md) | Tests executed and their results |
