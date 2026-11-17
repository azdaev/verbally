# Install Verbally

These steps are for a coding agent (Claude Code or Codex) that works in the user's project. A person can follow them too.

Verbally puts a voice bar on top of a running web app. The user points at an element, says a change, and the source file changes.

## 1. Check the machine

- macOS or Linux. Windows is not supported: stop and tell the user.
- `claude --version` or `codex --version` must work. Sign in to the selected CLI.
- `node --version` must work for code mode.

## 2. Get the program

```sh
mkdir -p ~/.local/bin
curl -fsSL "https://github.com/azdaev/verbally/releases/latest/download/verbally-$(uname -s | tr A-Z a-z)-$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')" -o ~/.local/bin/verbally
chmod +x ~/.local/bin/verbally
```

If `~/.local/bin` is not on `PATH`, use the full path `~/.local/bin/verbally` in the next steps, and tell the user to add the folder to `PATH`.

## 3. Check the install

```sh
verbally doctor
```

It must end with `Ready`. A line that starts with `MISSING` names what to install. Lines that start with `no` are optional parts: do not install them unless the user asks.

Read the `dictation` line. It tells who will listen to the user:

- `ok dictation <app> runs`: Verbally uses that app. Tell the user in step 6.
- `no dictation`: ask the user one question: "Install Hex for speech (free, a local model, about 700 MB), or use the recognizer of Chrome (no install, weaker)?" Only on a yes: `brew install --cask anomalyco/tap/hex` on macOS, then the user opens Hex once and lets it download its model.

## 4. Find the app

Code mode needs a **Vite + React** app: a folder whose `package.json` lists `vite` and `react`, with `node_modules` installed.

- One such folder: use it.
- Several (a monorepo): ask the user which app.
- None: tell the user that code mode does not support this project yet (see LIMITATIONS.md in the repository). Offer page mode: `verbally` with no folder makes a new page by voice.

## 5. Start it

Run this in the background, and keep it running:

```sh
verbally <app folder>
```

- Ports 8787 and 5180 must be free. If a Verbally runs already for another project, start this one on other ports: `VERBALLY_PORT=8788 verbally <app folder> 5190`.
- Verbally starts the app's own Vite dev server on that port, with the app's config. The user's usual dev server can run at the same time.
- If the app needs environment variables or a backend to show its pages, start it the same way as the user's `dev` script does.
- The browser opens `http://localhost:5180` by itself. Check the output: it must show the `Local:` address and no error.

Do not change the app's files, config or `package.json`. Verbally needs no change in the project.

## 6. Tell the user

Give the user these lines:

- The app is open at `http://localhost:5180` with a small bar in the corner.
- With a dictation app (step 3): put the mouse on an element, hold the key of that app (the `dictation` line of `verbally doctor` names it for Hex) and say a change, for example "make this heading bigger". Hold `⌥ Option` and move the mouse to point at several elements.
- Without one: hold `⌥ Option` and say the change. Chrome asks for the microphone once: allow it. Move the mouse while you hold `⌥ Option` to point at an element.
- `⌘Z` puts a change back.
- Verbally writes into the source files. Commit your work first.
- Claude Code runs with all tools allowed. Codex CLI runs read-only. Details: `docs/DETAILS.md` in the repository.

## Update

```sh
verbally update
```

Then stop the running Verbally and start it again. A version before v0.2.2 has no `update`: repeat step 2 there.

## Remove

```sh
rm ~/.local/bin/verbally
rm -rf ~/.verbally
```

## Select Codex CLI

Use a current Codex CLI and run `codex login` first.
Select **Settings → Model → Engine → Codex CLI** in Verbally.
Leave the model field empty to use the Codex default.

To set the default before opening the app, run:

```sh
VERBALLY_ENGINE=codex verbally path/to/app
```

The address parameter `?engine=codex` overrides the saved browser choice.
A saved browser choice overrides `VERBALLY_ENGINE`.
