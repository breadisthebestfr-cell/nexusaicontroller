# Getting Started — first time using Nexus

A friendly, click-by-click walkthrough. The app also shows this as an **in-app tour** the first time you
open it (and you can reopen it anytime with the **?** button, top-right).

---

## Build & run it from source (local)

Nexus isn't published as a prebuilt download yet — you run it from the source. One-time setup:

1. **Install [Node.js](https://nodejs.org) (LTS).** Confirm in a terminal: `node -v` and `npm -v` should
   each print a version.
2. **Get the code.** Either clone the branch (recommended — updates are one command later):
   ```bash
   git clone -b claude/windows-ollama-controller-gfzzp2 https://github.com/breadisthebestfr-cell/localaiconnection.git nexus
   cd nexus
   ```
   …or download the ZIP of that branch from GitHub (**branch dropdown → `claude/windows-ollama-controller-gfzzp2`
   → Code ▾ → Download ZIP**) and extract it. ⚠️ Grab the *branch*, not `main`.
3. **Install dependencies:** `npm install` (a few minutes the first time).

Then, from the project folder:

- **Run it live (fastest):** `npm run dev` — the Nexus window opens and hot-reloads as you edit.
- **Build a double-clickable installer:** `npm run dist` → find `release/Nexus-<version>-setup.exe`.
- **Sanity checks (optional):** `npm test` (should say 113 passing) and `npm run build`.

> On Windows, open the folder in File Explorer, click the address bar, type `powershell`, and press Enter to
> get a terminal already in the right place.

---

## 0. Before you open the app

**On each machine that runs Ollama** (your PC, your server):

1. Install Ollama and pull at least one model, e.g. `ollama pull qwen2.5-coder:7b`.
2. To let *other* machines reach it over WiFi, make Ollama listen on the network:
   - **Windows:** run `setx OLLAMA_HOST 0.0.0.0`, then fully quit Ollama (tray) and reopen it. Allow it
     through the firewall:
     `New-NetFirewallRule -DisplayName "Ollama LAN" -Direction Inbound -Protocol TCP -LocalPort 11434 -Action Allow`
   - **Linux/mac server:** run `OLLAMA_HOST=0.0.0.0 ollama serve`.
   - Your *own* machine's Ollama needs none of this — it's found automatically.

> If a machine keeps Ollama on the default `localhost`, no app (including this one) can see it from another
> computer. That's Ollama's design, not a bug.

**No Ollama yet and just want to look around?** From the repo you can run a fake one:
`npm run mock -- 11434 11435` then scan/add `127.0.0.1`.

---

## 1. Instances — find your AIs  *(first tab)*

- Click **Scan WiFi** to sweep your network, or use **Add a host manually** with an `IP:port`
  (e.g. `192.168.1.20:11434`).
- Each found instance shows a **green dot** (online) and its installed models.
- The list **auto-refreshes**; **seen Xs ago** tells you how fresh it is.

## 2. Chat — try one model  *(Chat tab)*

- Pick an instance + model and send a message. This confirms a model actually responds before you put it
  to work. (This is 1-on-1; teamwork is the next tab.)

## 2b. Arena — compare models  *(Arena tab)*

- Type one prompt and pick up to **4 models** (local or cloud). They all answer side-by-side with speed
  stats, so you can see which is best for a kind of task before committing to it.

## 2c. Jarvis — your desktop assistant  *(Jarvis tab)*

- The first time you open it, accept the short **at-your-own-risk** notice.
- Type (or hear spoken replies from) **Jarvis**. Ask it to *"open Firefox"*, *"open a notepad and write a day
  routine plan"*, or *"search the weather"* — it acts on your PC. The glowing **orb** reacts as it listens,
  thinks, and talks.
- **Safety mode** (top of the tab): **🔒 Allowlist** asks before risky actions (commands, unknown apps);
  **⚡ Trust** runs everything without asking. Start on Allowlist.
- Set its **name**, **known apps**, and safety mode in **Settings → Jarvis**. Cloud models are preferred for
  it by default (they pick actions more reliably), but a capable local model works too.
- *Not built yet:* full mouse/keyboard/screen control (Stage 2).

## 3. Project — make them build something  *(Project tab → "Single run")*

1. **Choose…** a project folder (where files will be written).
2. Assign roles: **planner**, **coder**, **reviewer**. Don't want to choose? Pick
   **🤖 Auto — best available** and it uses your strongest model (coder-optimized).
   - *Coder* is required. Add a *reviewer* to turn on the review-and-fix loop.
3. Type a **task** (e.g. "Make a Minecraft mod scaffold with a basic block").
4. **Run collaboration ▶** — watch each agent stream live. Files appear in the list and in your folder.
   Click a file to view it.

## 4. Continuous — let them keep going  *(Project tab → "Continuous")*

- Switch to the **Continuous** sub-tab, set a **goal**, press **Start continuous ▶**.
- The AIs work in **cycles**: a lead picks the next small step, the coder does it, the reviewer checks, and
  **every cycle is committed to git** (so you can undo anything). Progress is remembered between cycles in a
  hidden `.localai/` folder.
- It stops when the goal is reported done, you press **Stop**, it **stalls**, or it hits the cycle cap.
- Best for slowly building something with smaller models. Small models aren't geniuses — the git history and
  stop button are your safety net.

## 5. History — review past runs  *(History tab)*

- Every run and every continuous cycle is saved. Click one to reopen its full transcript and files, or
  **delete** it. **Clear all** empties the list.

## 6. Settings — tune it & get notified  *(Settings tab)*

- **Scan settings:** ports, timeout, and the **health re-poll interval**.
- **Agent helper (for small models):** per-role **temperature** (lower = more focused) and optional
  **prompt overrides**. Leave a prompt blank to use the tuned default.
- **Continuous mode:** max cycles, delay, stall threshold, and git auto-commit.
- **Jarvis:** the assistant's **name**, **safety mode**, and its **known apps** list (`Name = command`).
- **Cloud providers (optional):** paste **OpenAI / Anthropic / xAI API keys** to use hosted models alongside
  local ones. Keys stay on your machine. If a model 404s, update its id here (ids change often).
- **Discord notifications:** paste a **webhook URL** (see below) and press **Test**. Add your **Discord user
  ID** to get an actual phone ping.
- **Theme** (top-right of the app): Dark, Light, Terminal, or High-contrast.

---

## Optional: get notified on Discord

1. In your Discord channel: **Edit Channel → Integrations → Webhooks → New Webhook → Copy URL**.
2. Paste it into **Settings → Discord notifications** and press **Test**. That's it — no coding.
3. Want it to **ping your phone**? Turn on Discord **Developer Mode** (User Settings → Advanced), right-click
   your name → **Copy User ID**, and paste it into the user-ID field in Settings.

You can also test a webhook from a terminal: `npm run notify:test -- "<webhook-url>" "hello"`.

## Optional: control the AIs from Discord (bot)

This needs a real bot token (kept only on your machine — never share it).

1. <https://discord.com/developers/applications> → **New Application** → **Bot** → **Reset Token** (copy it).
2. Enable **Message Content Intent** (Bot → Privileged Gateway Intents).
3. **OAuth2 → URL Generator** → scopes `bot` + permission **Send Messages** → open the URL → invite it.
4. Copy your channel's ID (Developer Mode → right-click channel → Copy ID).
5. Run it (on your PC):
   ```
   LOCALAI_DISCORD_TOKEN=your_token LOCALAI_PROJECT=/path/to/project \
   LOCALAI_DISCORD_CHANNEL_ID=your_channel_id npm run bot
   ```
6. In that channel: `!start build a snake game`, `!status`, `!stop`, `!help`.

## Optional: let Claude Code drive them (MCP)

Register the MCP server so Claude Code can list your models, ask one a question, or run a full team task:

```
claude mcp add localai -- npx -y tsx /ABS/PATH/localaiconnection/src/mcp/index.ts
```

Set `LOCALAI_DISCORD_WEBHOOK` on it and Claude can even message your Discord via the `notify` tool.

---

**That's everything.** The honest bit: local models (especially ~7–14B) are much weaker than Claude at
coding, so keep tasks small and lean on the reviewer + git checkpoints — and use the Claude/MCP path for the
hard stuff.
