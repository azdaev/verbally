# Verbally: the details

The short story is in the [README](../README.md). This page has the rest.

## Install by hand

macOS and Linux:

```sh
mkdir -p ~/.local/bin
curl -fsSL "https://github.com/azdaev/verbally/releases/latest/download/verbally-$(uname -s | tr A-Z a-z)-$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')" -o ~/.local/bin/verbally
chmod +x ~/.local/bin/verbally
verbally doctor
```

With Go: `go install github.com/azdaev/verbally@latest`.

You need:

- Claude Code or Codex CLI, signed in. Select the engine in Settings → Model.
- Chrome, or a browser built on it.
- Node, for code mode.

## Use

### Code mode: change your own app

```sh
verbally path/to/your/app
```

Verbally starts the app's own Vite dev server on port 5180, with the bar on top. Your `vite.config` stays as it is.

- **Talk:** hold `⌥ Option` and speak. Release the key when you are done.
- **Point:** move the mouse while you hold `⌥ Option`. Stop on a place for a moment to set a mark ①. Say "make this ① like that ②".
- **Many versions:** say "show me three versions of this card", then pick one.
- **Undo and redo:** `⌘Z` and `⇧⌘Z`, or the buttons on the bar. Undo puts the file back.
- **Cancel:** the `×` on a task card.

Code mode works with **Vite + React** today. See [LIMITATIONS.md](../LIMITATIONS.md) for other stacks.

Commit your work before a session. Verbally writes into your source files; git is your safety net.

### Page mode: make a new page by voice

```sh
verbally
```

An empty page opens at `http://127.0.0.1:8787`. Say "a landing page for a coffee roaster", then go on: "add prices", "make the whole site darker", "a photo of beans here". The page is a list of sections; each phrase goes to the section that you name, point at or look at.

## Update

```sh
verbally update
```

It gets the newest release and puts it in the place of the old one. Your data in `~/.verbally` stays. A Verbally that runs keeps the old version until you start it again.

Verbally never updates by itself. At start it asks GitHub for the number of the newest release, and tells you in the terminal and once on the bar when a newer one is out. `VERBALLY_NO_UPDATE_CHECK=1` switches that question off. A build from source updates with `go install github.com/azdaev/verbally@latest`.

## Speech: who listens

Verbally needs your words as text. There are three ways, and it picks one by itself:

1. **Your dictation app.** If Hex, Handy, Wispr Flow, Superwhisper or VoiceInk runs, it listens with its own local model and pastes the text. Verbally takes the pasted text as the phrase. `⌥ Option` only points then; the microphone of Verbally stays off. Use the key of your dictation app. With Hex, Verbally reads that key from the settings of Hex and names it: on the bar at start and in `verbally doctor`. If it is one `⌥` (for example the right one), that key points and talks. The other `⌥` only points, and the bar says so.
2. **Soniox**, with `SONIOX_API_KEY`: the words show while you talk.
3. **The recognizer of Chrome**: no key, weaker, and the audio goes to Google.

No pointing with `⌥`? Then the phrase is about the element under the mouse.

The gear on the bar opens the settings: who listens, the language for the recognizer of Chrome, the engine and its model, and the keys. A choice stays in the browser. `verbally doctor` tells which one is in use. `VERBALLY_SPEECH=mic` or `VERBALLY_SPEECH=dictation` sets it by hand, and so does `?speech=mic` in the address. A click on the microphone of the bar always starts Verbally's own microphone.

Tested with Hex. The other apps are found by name and paste in the same way; tell us when one does not work.

## Settings

All keys are optional. Set them as environment variables before you start `verbally`.

| Variable | What it gives |
|---|---|
| `SONIOX_API_KEY` | Faster and more exact speech recognition ([Soniox](https://soniox.com)). Without it the recognizer of Chrome works. |
| `TYPESAFE_API_KEY` | Jev, a fast yes/no model from [Typesafe](https://typesafe.ai). It drops filler ("uh, okay") and sends each phrase to the right section. Without it key-word rules work. |
| `OPENROUTER_API_KEY` | An optional engine for page mode: add `?engine=openrouter` to the address. Faster, weaker HTML. |
| `VERBALLY_ENGINE` | Default engine: `claude`, `codex`, or `openrouter`. The browser choice can override it. |
| `VERBALLY_WORKERS` | How many engine processes may work at the same time. Default 4. |
| `VERBALLY_SPEECH` | `mic` or `dictation`: who listens. Default: `dictation` when a dictation app runs. See "Speech" above. |
| `VERBALLY_NO_UPDATE_CHECK` | `1`: do not ask GitHub for a newer release at start. |
| `VERBALLY_PORT` | The port of the Verbally server. Default 8787. Set it when that port is taken, or to run a second Verbally. |
| `VERBALLY_HOME` | Where Verbally keeps its files. Default `~/.verbally`. |
| `BROWSER=none` | Do not open the browser at start. |

Settings in the address of the page: `?model=claude-sonnet-5-5` (default `claude-opus-5-5`; with Codex, a Codex model ID), `?effort=medium` (default `low`), `?terms=Word,Word` (names that the speech recognizer must know).

To give Claude Code your own MCP servers, put them in `~/.verbally/engine-mcp.json`, in the format of Claude Code's `--mcp-config`.

## Security and privacy

Read this before you run it.

- **Claude Code runs with every tool allowed and no questions** (`--permission-mode bypassPermissions`). This keeps a voice session fluent: nobody can approve a prompt while they talk. The prompt tells the model not to change files by itself, but a prompt is not a wall. Use Verbally on projects and pages that you trust.
- **The server listens on `127.0.0.1:8787` only**, and it answers only to pages of your own machine. A web site that you have open cannot call it (`local.go`).
- **In code mode the server reads and writes files inside the app folder that you named**, nowhere else.
- **Your speech leaves the machine**: the audio goes to Soniox or to Chrome's recognizer, the text goes to the selected model provider, and to Typesafe when you set that key.
- **At start Verbally asks GitHub for the number of the newest release.** It sends nothing about you. `VERBALLY_NO_UPDATE_CHECK=1` switches it off.
- **`~/.verbally/telemetry.jsonl` holds the text of your speech and timings.** It stays on your machine. `python3 stats.py ~/.verbally/telemetry.jsonl` gives a summary. Delete the file when you want.

## Work on Verbally

```sh
git clone https://github.com/azdaev/verbally && cd verbally
VERBALLY_DEV=1 go run .                # page mode, with the files of this folder
VERBALLY_DEV=1 go run . path/to/app    # code mode
go test ./...
```

The code is small and has no build step: Go for the server, plain JavaScript for the page. `main.go` starts with a map of the files. `LIMITATIONS.md` lists what is not done.

## License

MIT. See [LICENSE](../LICENSE). `lib/glimm.js` is MIT too, see `lib/glimm.LICENSE`.

## Develop the interface

The controls use React and shadcn/ui. They run inside a Shadow DOM in both modes.
The engine scripts keep ownership of speech, requests, page changes, and code changes.
The interface store connects those scripts to React.

Install Node 22 or newer. Build the interface before a Go build:

```sh
npm ci
npm run build
npm test
go test ./...
go vet ./...
VERBALLY_DEV=1 go run .
```

Edit components in `ui/`. Rebuild after each change, then reload Chrome.
Commit `js/ui.js` and its license file with the source changes.
These generated files let `go install` work without Node during installation.
The release script builds the interface before it builds the programs.

Run the browser fixtures:

```sh
npm run test:ui
```

Open `http://127.0.0.1:18788/` in visible Chrome and press **Run checks**.
Then open `http://127.0.0.1:18788/code` and run its checks.
The fixtures cover settings, style isolation, task states, versions, cancellation, and history.
They use deterministic replies and an in-memory code file.
They do not verify speech recognition or model quality.

## Codex CLI engine

Select **Settings → Model → Engine → Codex CLI**.
Use a current Codex CLI and sign in with `codex login`.
Verbally uses that saved login. It does not request a separate API key.

The engine choice works in page mode and code mode. OpenRouter works only in page mode; code mode falls back to Claude Code.
Each engine keeps its own model choice.
Leave the Codex model field empty to use the CLI default, or enter a model ID.

```sh
VERBALLY_ENGINE=codex verbally path/to/app
```

The address parameter takes priority, then the saved browser choice, then the server default.
Without a choice, Verbally prefers Claude Code when installed, then Codex CLI.
It detects installation, not account access. Select Codex when Claude cannot answer.

Codex uses `exec --json --ephemeral` with a read-only sandbox.
Verbally sends only its final response to the editor.
The completed reply appears at once; Codex token streaming is not part of this adapter.
Verbally applies edits and keeps preview, cancellation, and undo under its own control.
Screenshots become temporary image files. Verbally removes them when the request ends.

The adapter ignores `~/.codex/config.toml` (plugins, MCP servers, providers, profiles, effort) for predictable requests.
It keeps the saved CLI login and the top-level `model` of that file: an empty model field uses it. The model field and `?effort=` control each request.
The two engines share the `VERBALLY_WORKERS` limit.

The protocol follows the [Codex non-interactive documentation](https://learn.chatgpt.com/docs/non-interactive-mode).
