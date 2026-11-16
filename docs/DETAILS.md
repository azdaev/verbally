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

- [Claude Code](https://claude.com/claude-code), signed in. This is the engine.
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

## Settings

All keys are optional. Set them as environment variables before you start `verbally`.

| Variable | What it gives |
|---|---|
| `SONIOX_API_KEY` | Faster and more exact speech recognition ([Soniox](https://soniox.com)). Without it the recognizer of Chrome works. |
| `TYPESAFE_API_KEY` | Jev, a fast yes/no model from [Typesafe](https://typesafe.ai). It drops filler ("uh, okay") and sends each phrase to the right section. Without it key-word rules for English and Russian work. |
| `OPENROUTER_API_KEY` | A second engine for page mode: add `?engine=openrouter` to the address. Faster, weaker HTML. |
| `VERBALLY_WORKERS` | How many Claude processes may work at the same time. Default 4. |
| `VERBALLY_PORT` | The port of the Verbally server. Default 8787. Set it when that port is taken, or to run a second Verbally. |
| `VERBALLY_HOME` | Where Verbally keeps its files. Default `~/.verbally`. |
| `BROWSER=none` | Do not open the browser at start. |

Settings in the address of the page: `?model=claude-sonnet-5-5` (default `claude-opus-5-5`), `?effort=medium` (default `low`), `?terms=Word,Word` (names that the speech recognizer must know).

To give the engine your own MCP servers, put them in `~/.verbally/engine-mcp.json`, in the format of Claude Code's `--mcp-config`.

## Security and privacy

Read this before you run it.

- **The engine runs Claude Code with every tool allowed and no questions** (`--permission-mode bypassPermissions`). This keeps a voice session fluent: nobody can approve a prompt while they talk. The prompt tells the model not to change files by itself, but a prompt is not a wall. Use Verbally on projects and pages that you trust.
- **The server listens on `127.0.0.1:8787` only**, and it answers only to pages of your own machine. A web site that you have open cannot call it (`local.go`).
- **In code mode the server reads and writes files inside the app folder that you named**, nowhere else.
- **Your speech leaves the machine**: the audio goes to Soniox or to Chrome's recognizer, the text goes to Claude, and to Typesafe when you set that key.
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
