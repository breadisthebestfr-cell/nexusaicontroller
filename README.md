# Nexus

> A Windows command center for AI — discover and control your local (Ollama) and cloud models across your
> WiFi/LAN, orchestrate them on projects, run them autonomously, drive them from Claude Code (MCP) or
> Discord, and talk to **Jarvis**, your desktop assistant. _(The repo is still named `localaiconnection`
> from the project's first incarnation.)_

A Windows 11 desktop app to **discover and control AI models across your WiFi/LAN** — Ollama models on your
own PC and other machines, plus optional cloud models (OpenAI / Claude / Grok) — and put them to work
together on a project.

Built with Electron + React + TypeScript.

> **Checkpoint — v0.3.0.** Feature-complete for the plan so far, now rebranded to **Nexus** with a refreshed
> violet UI and the **Jarvis** desktop assistant (with a WebGL plasma orb). **113 tests pass**, typecheck +
> build clean. Everything below is implemented and verified against a bundled mock (no real Ollama, Windows,
> Discord, or cloud key needed to build/test). The remaining validation is a real run on the author's
> hardware — see **[GETTING_STARTED.md](./GETTING_STARTED.md)** to build and run it locally.

**At a glance**

| Area | What you get |
| --- | --- |
| **Discover** | Auto-scan the LAN for Ollama + manual add; live health polling; model management (pull with progress, size/quant, loaded marker); nicknames |
| **Chat** | Streaming single-model chat, concise style, tokens/sec, 🔊 voice out + 🎤 voice in, drag-drop a file, saved prompts |
| **Arena** | One prompt → up to 4 models side-by-side, with speed stats |
| **Jarvis** | Desktop assistant (Stage 1): type/talk, it opens apps, web pages, writes docs, runs a command; reactive WebGL orb; Allowlist/Trust safety modes |
| **Project** | planner → coder → reviewer collaboration writing files, small-model helper (tuned prompts, low temp, auto-repair), Auto best-model pick |
| **Continuous** | Autonomous multi-cycle mode with external memory, git checkpoints per cycle, stall guard, and per-cycle diffs |
| **Commands** | Optional agent shell commands — allowlist + Approve/Deny (off by default) |
| **Cloud** | Optional OpenAI / Anthropic / xAI models alongside local ones (keys stored locally) |
| **Integrations** | MCP server for Claude Code; Discord webhook + control bot + `notify` tool |
| **History** | Every run saved (transcript, files, status), searchable, exportable, with stats tiles |

See **[CHANGELOG.md](./CHANGELOG.md)** for the full build history.

---

**New here?** See **[GETTING_STARTED.md](./GETTING_STARTED.md)** for a click-by-click walkthrough — the app
also shows an in-app tour on first launch (reopen it anytime with the **?** button, top-right).

## What works now

- **Auto-detect Ollama over WiFi** — sweeps your local subnet(s), TCP-probes port `11434`, verifies each
  hit via Ollama's `/api/version`, and lists installed models via `/api/tags`.
- **Manual add** — for machines the scan misses (different subnet, non-standard port, or a hostname).
- **Live dashboard** — every instance with online/offline status, server version, and its models (with size,
  quantization, and a "loaded in memory" marker).
- **Model management** — pull a model onto any instance with live progress, right from the dashboard (uses
  Ollama's own API).
- **Cloud providers (optional)** — add API keys (Settings → Cloud providers) for **OpenAI, Anthropic (Claude),
  or xAI (Grok)**, and those hosted models appear alongside your local ones in Chat, the Model Arena, and as
  agent roles. Keys are stored only on your machine. Local stays the default; cloud is just extra participants.
- **Model Arena** — send one prompt to up to 4 models at once (local or cloud) and compare answers side-by-side.
- **Jarvis — desktop assistant (Stage 1)** — a **Jarvis** tab where you type (spoken replies via 🔊) and a
  model (local or cloud; cloud is preferred by default since it picks actions better) can act on your PC:
  **open apps** (from an editable known-apps list in Settings), **open web pages / searches**, **create and
  open documents** (saved to `~/Nexus/`), and **run a single shell command** (reuses the gated
  command runner). Two safety modes: **Allowlist** (opening an unknown app or running a command asks for your
  approval — the same modal as agent commands) and **Trust** (runs without asking). A one-time disclaimer on
  first use makes clear you use it at your own risk. **Stage 2** — native mouse/keyboard/screen control — is
  not in this build yet (it needs a real Windows desktop to develop against).
- **Single-model chat** — pick any online instance + model and chat with it, streamed token-by-token.
  Replies stay short and direct by default (editable in Settings → Chat style). **Voice mode:** a 🔊 toggle
  reads replies aloud (offline OS voices), and a 🎤 mic button dictates your message where the platform's
  speech recognition is available.
- **Multi-agent collaboration (V2)** — assign detected models to **planner / coder / reviewer** roles,
  point them at a project folder, and give a task. The planner drafts a plan, the coder writes real files
  into the folder, and the reviewer critiques; the coder/reviewer loop iterates until the reviewer approves
  or the round limit is hit. Every agent's output streams live in a transcript, and files the coder writes
  are listed and viewable in-app. Coder is required; planner and reviewer are optional (add a reviewer to
  enable the review/iterate loop).
- **Sandboxed writes** — agents can only read/write inside the folder you selected; path-traversal attempts
  are refused.
- **Small-model helper (V4)** — because local models (~7b–14b) are weak at autonomous coding, runs use
  system prompts tuned for small models (a shared "house rules" preamble + a few-shot `FILE:` example),
  a low sampling temperature for coder/reviewer, and an **auto-repair retry**: if the coder replies with
  prose and no parseable files, it gets one strict corrective nudge before the round counts. You can edit
  each role's prompt and temperature in **Settings**. (The MCP `run_multi_agent_task` benefits too.)
- **Continuous autonomous mode (V5)** — on the Project tab, switch to **Continuous**, set a goal, and the
  AIs work in **cycles**: a "lead" reads externalized memory (`.localai/goal.md`, `plan.md`, `progress.md`),
  picks the next small step, the coder writes it, the reviewer checks, and **each cycle is committed to git**
  as a revertible checkpoint. It runs until the goal is signaled complete, you stop it, it stalls (the coder
  produces nothing for N cycles), or a cycle cap is hit. Every cycle is saved to history. Run it headless
  with `npm run continuous -- <projectDir> "<goal>"`. Honest note: this genuinely inches a *small, well-scoped*
  project forward; on big/vague goals weak models spin or degrade code — which is why the git checkpoints and
  stall guard exist, and why Claude-via-MCP stays the heavy lifter.
- **Auto best-model selection (V5)** — any role dropdown (and continuous mode's coder by default) offers
  **"Auto — best available"**, which ranks your online models (coding-tuned names preferred, then larger
  parameter count) and picks the strongest. The MCP `run_multi_agent_task` accepts `"auto"` too.
- **Live health polling (V4)** — the dashboard re-checks known instances on an interval (Settings →
  "Health re-poll interval") and updates online/offline + models automatically; each shows "seen Xs ago".
- **Run history (V4)** — every collaboration run is saved (transcript, files, config, status). The
  **History** tab lists past runs and lets you reopen the full transcript + files or delete them.
- **Settings** — scan ports, connect timeout, concurrency, health-poll interval, plus per-role agent
  prompts and temperatures, all persisted.

---

## ⚠️ Important: make remote Ollama reachable

By default Ollama binds to `127.0.0.1` (localhost), which means **only its own machine can reach it** —
no app, including this one, can detect it over the network. That's Ollama's design, not a bug.

To let this app see Ollama on **another** machine, on that machine:

**Windows (PowerShell or CMD):**
```bat
setx OLLAMA_HOST 0.0.0.0
```
Then fully restart Ollama (quit it from the tray and relaunch), and allow it through the firewall:
```powershell
New-NetFirewallRule -DisplayName "Ollama LAN" -Direction Inbound -Protocol TCP -LocalPort 11434 -Action Allow
```

**Linux/macOS server:**
```bash
OLLAMA_HOST=0.0.0.0 ollama serve
# (or set Environment=OLLAMA_HOST=0.0.0.0 in the systemd unit)
```

Your own machine's local Ollama is always checked automatically (via `127.0.0.1`).

---

## Getting started

Prerequisite: **[Node.js](https://nodejs.org) LTS** (`node -v` should print a version). Then, from the repo
folder:

```bash
npm install        # first time only (installs dependencies)
npm run dev        # launch the app (Electron) with hot reload
```

To build a double-clickable Windows installer instead: `npm run dist` → `release/Nexus-<version>-setup.exe`.
See **[GETTING_STARTED.md](./GETTING_STARTED.md)** for a step-by-step local build walkthrough.

### Try it without real Ollama (mock mode)

No Ollama installed yet? A mock server implements the same API so you can exercise everything:

```bash
# Terminal A — simulate two "machines" on two ports:
npm run mock -- 11434 11435

# Terminal B — headless discovery check (no GUI needed):
npm run discover -- 11434 11435
```

In the app, either run **Scan WiFi** (finds the mock on `127.0.0.1:11434`) or use **Add a host manually**
with host `127.0.0.1` and port `11435`.

The mock is **role-aware**: when driven by the orchestrator it returns a plan, a couple of `FILE:` blocks
(as the coder), and `APPROVED` (as the reviewer) — so you can watch a full planner → coder → reviewer run
write files into a folder without any real model. On the **Project** tab, choose a folder, assign the mock's
models to the three roles, enter a task, and click **Run collaboration**.

## Use from Claude Code (MCP)

A standalone **MCP server** (`src/mcp/`) exposes your local models to Claude Code (or any MCP client), so
Claude can act as the smart orchestrator driving the weaker local models.

**Register it** (absolute path to this repo):

```
claude mcp add localai -- npx -y tsx /ABS/PATH/localaiconnection/src/mcp/index.ts
```

Optional environment variables (pass with `-e NAME=value`):

| Variable                 | Default | Purpose                                                         |
| ------------------------ | ------- | --------------------------------------------------------------- |
| `LOCALAI_OLLAMA_HOSTS`   | —       | Pinned hosts, e.g. `192.168.1.20:11434,192.168.1.30:11434`      |
| `LOCALAI_SCAN`           | `1`     | Set `0` to disable the LAN sweep and use only pinned hosts + local |
| `LOCALAI_CACHE_TTL_MS`   | `30000` | How long discovery results are cached                           |

**Tools exposed:**

- `list_instances` — discover Ollama instances (id, baseUrl, version, model count).
- `list_models` — every model across instances (gives you the `baseUrl` + `model` to use below).
- `ask_model` — one-shot a specific local model (`baseUrl`, `model`, `prompt`, optional `system`).
- `run_multi_agent_task` — run planner → coder → reviewer into a folder. Requires `task`, `projectRoot`,
  and `coder: {baseUrl, model}`; optional `planner`, `reviewer`, `maxRounds`. Writes are sandboxed to
  `projectRoot`. Returns a summary, the files written, and the full transcript.

**Example prompts to Claude Code once registered:**

> "List my local AI instances, then ask the qwen2.5-coder model on 192.168.1.20 to explain this error."

> "Using run_multi_agent_task with the coder on 192.168.1.20 and reviewer on my localhost, scaffold a
> Minecraft mod in ./mymod."

Run it directly for debugging: `npm run mcp` (logs go to stderr; stdout is the MCP channel).

## Discord (notifications + control)

Three pieces, use any subset:

**1. Webhook notifications (outbound, simplest).** In your Discord channel: *Edit Channel → Integrations →
Webhooks → New Webhook → Copy URL*. Paste it into **Settings → Discord notifications** (or set env
`LOCALAI_DISCORD_WEBHOOK` for headless/MCP). The app posts continuous-mode cycle updates, stalls, errors,
and completions there. Use the **Test** button to confirm it. Keep the URL private — anyone with it can post
to your channel. You never edit code for this — it's a runtime setting.

To actually get **pinged on your phone**, also set your Discord user ID (Settings field, or env
`LOCALAI_DISCORD_MENTION_USER_ID`) — notifications then `@`-mention you. Enable *Developer Mode* in Discord,
right-click your name → *Copy User ID*.

Test a webhook straight from a terminal without the GUI:

```
npm run notify:test -- "https://discord.com/api/webhooks/…" "hello"
```

**2. `notify` MCP tool (Claude → Discord).** With `LOCALAI_DISCORD_WEBHOOK` set on the MCP server, Claude
Code can post to your Discord itself (progress, questions, results) via the `notify` tool. This is the clean
Claude integration — Discord can't drive Claude Code back the other way.

**3. Control bot (Discord → your local AIs).** A `discord.js` bot that accepts commands so you can start/stop
continuous sessions while away:

```
LOCALAI_DISCORD_TOKEN=<bot token> \
LOCALAI_PROJECT=/abs/path/to/project \
LOCALAI_DISCORD_CHANNEL_ID=<channel id> \
LOCALAI_OLLAMA_HOSTS=192.168.1.20:11434 LOCALAI_SCAN=0 \
  npm run bot
```

Commands (in that channel): `!start <goal>`, `!stop`, `!status`, `!help`. The bot auto-picks the best coder
and streams cycle updates back to the channel.

Setup: create an application + bot at <https://discord.com/developers/applications>, copy the **bot token**,
enable the **Message Content Intent** (Bot → Privileged Gateway Intents), invite it to your server with
*Send Messages* permission, and pass the token + channel id as env vars above. The machine running `npm run
bot` must stay on and connected — Discord is only the relay. Never commit the token.

## Build a Windows installer

```bash
npm run dist       # electron-builder -> release/Nexus-<version>-setup.exe
```

---

## Scripts

| Command             | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `npm run dev`       | Run the app in development with hot reload                          |
| `npm run build`     | Typecheck + bundle main/preload/renderer into `out/`                |
| `npm test`          | Run the vitest suite (subnet math, TCP probe, tags parse, sandbox)  |
| `npm run mock`      | Start the mock Ollama server (`-- <port> <port> …`)                 |
| `npm run discover`  | Headless discovery check against loopback ports                     |
| `npm run mcp`       | Run the MCP server over stdio (for Claude Code)                      |
| `npm run continuous`| Headless continuous session: `-- <projectDir> "<goal>"`             |
| `npm run bot`       | Run the Discord control bot (needs a bot token + env, see below)    |
| `npm run notify:test` | Test a webhook from the terminal: `-- "<webhook-url>" "message"`  |
| `npm run dist`      | Produce a Windows installer via electron-builder                    |

---

## How it's built

```
src/
  shared/          types + IPC channel names shared across all processes
    types.ts          AppSettings/DEFAULT_SETTINGS, RunRecord, Jarvis types, etc.
    ipc.ts            IPC channel-name constants (single source of truth)
    modelRanking.ts   ranks models so "Auto" picks the best coder (pure, shared)
  main/            Electron main process (all networking, file IO, persistence)
    index.ts          window lifecycle + ALL IPC handlers + Electron-only glue
    chat.ts           routes cloud:<provider> vs Ollama; reads the store
    ollamaClient.ts   /api/version, /api/tags, streaming /api/chat
    providers.ts      cloud providers (OpenAI/Anthropic/xAI) streaming
    discovery.ts      subnet math, TCP probe, inspect + refreshInstances (health poll)
    fileTools.ts      ProjectFiles — sandboxed read/write inside the project folder
    store.ts          electron-store persistence (hosts, settings, folder; deep-merged)
    orchestrator.ts   planner → coder → reviewer loop (streaming, iterate; injectable ask)
    continuous.ts     autonomous cycle loop (memory files, git checkpoints, stall guard)
    git.ts            app-controlled per-cycle git commits (fixed args, project cwd)
    commands.ts       gated shell command runner (metachar reject, allowlist, timeout)
    prompts.ts        small-model-tuned prompts + auto-repair + lead next-step
    fileBlocks.ts     parses coder "FILE: path" + fenced blocks into file writes
    runStore.ts       persists run history (transcript, files, status) to disk
    notifier.ts       outbound Discord webhook posting (used by app, CLI, MCP)
    actions.ts        Jarvis ACTION: parsing + gating (Electron-free)
    desktop.ts        Jarvis action executors (open app/url, write doc) — Electron-bound
  preload/         contextBridge — the only surface the UI can call (no Node in renderer)
  renderer/        React UI
    App.tsx           tab shell + theme
    styles.css        the design system (tokens + components; violet identity)
    components/       InstancesPanel, ChatPanel, ArenaPanel, JarvisPanel, JarvisOrb,
                      ProjectPanel, ContinuousPanel, HistoryPanel, SettingsPanel,
                      TurnCard, ApprovalModal, Onboarding, Toaster
  mcp/             standalone MCP server (reuses discovery + orchestrator) for Claude Code
    tools.ts          list/ask/run/notify tool logic + cached discovery (transport-free)
    server.ts         McpServer + zod tool schemas
    index.ts          stdio entry point
  bot/             Discord control bot (discord.js) — start/stop/status the local AIs
    commands.ts       pure command dispatcher (testable)
    discordBot.ts     gateway wiring
scripts/
  mock-ollama.ts     role-aware stand-in Ollama API for tests + manual runs
  discover-cli.ts    headless discovery runner
  continuous-cli.ts  headless continuous runner
  discord-bot.ts     bot entry point
  notify-test.ts     one-shot webhook tester
  gen-icon.mjs       generates build/icon.png
```

**Security posture:** the renderer runs with `contextIsolation: true`, `nodeIntegration: false`, and
loads only local content. All privileged work (network, filesystem) happens in the main process and is
reached through a small typed preload bridge. Agent file access (V2) is sandboxed to the selected folder
with path-traversal protection (`fileTools.ts`).

---

## Roadmap

- **V2 — Multi-agent collaboration. ✅ Done.** Planner → coder → reviewer loop: models take turns, pass
  work forward, and write files into the selected project folder, with a live streaming transcript and a
  file viewer in the Project tab.
- **V3 — MCP server for Claude Code. ✅ Done.** `list_instances`, `list_models`, `ask_model`, and
  `run_multi_agent_task` exposed over MCP stdio so Claude Code can orchestrate your local models directly.
- **V4 — Health polling, run history, small-model helper. ✅ Done.**
- **V5 — Continuous autonomous mode + auto best-model selection. ✅ Done.**
- **V6 — Discord: webhook notifications + control bot + `notify` MCP tool. ✅ Done.**
- **V7 — Agent shell commands (allowlist + approval). ✅ Done.** Off by default. The coder can request a
  command via a `RUN: <cmd>` directive; single commands only (no chaining/piping/redirection). Allowlisted
  commands (Settings) auto-run; anything else prompts **Approve once / Approve &amp; always allow / Deny** in
  interactive runs, and is **skipped** in autonomous (continuous/bot) runs. Bounded by a timeout, run in the
  project folder, with output fed back to the coder/reviewer. ⚠️ This executes real commands with your OS
  privileges — enable it deliberately.
- **Cloud providers. ✅ Done.** Optional OpenAI / Anthropic / xAI models alongside local Ollama, keys stored
  only on your machine; they appear in Chat, Arena, and as agent roles.
- **Jarvis desktop assistant (Stage 1). ✅ Done.** Talk or type; it opens apps/URLs, writes documents, and
  runs a single gated command, with Allowlist/Trust safety modes and a reactive WebGL orb.
- **Nexus rebrand + UI refresh. ✅ Done.** New name (the app outgrew "LocalAIConnection") and a cohesive
  violet design system across all themes.
- **Next real milestone: a first run on real hardware** (local Ollama → a second machine over WiFi → one
  collaboration run → then cloud / Discord / MCP / Jarvis).
- **Jarvis Stage 2 (deferred):** native mouse/keyboard/screen control — needs a real Windows desktop to
  build against (untestable in the Linux dev sandbox).
- **Also on deck:** a signed Windows installer with a first-run "enable network access" helper, and
  per-model `num_ctx` tuning.

## Notes & honest limitations

- Small local models are far weaker than hosted frontier models at autonomous, multi-step coding. Expect
  best results from tool-calling-capable coder models (e.g. `qwen2.5-coder`, `llama3.1`). This is exactly
  why the V3 MCP bridge is worth having — Claude Code can drive the weaker locals.
- Discovery caps any scan to the host's `/24` (254 addresses) so a large subnet can't stall the sweep; use
  manual add for anything outside it.
