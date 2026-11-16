# Install Verbally

These steps are for a coding agent (Claude Code) that works in the user's project. A person can follow them too.

Verbally puts a voice bar on top of a running web app. The user points at an element, says a change, and the source file changes.

## 1. Check the machine

- macOS or Linux. Windows is not supported: stop and tell the user.
- `claude --version` must work. Verbally uses the Claude Code CLI as its engine.
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

- Ports 8787 and 5180 must be free. To use another port for the app: `verbally <app folder> 5190`.
- Verbally starts the app's own Vite dev server on that port, with the app's config. The user's usual dev server can run at the same time.
- If the app needs environment variables or a backend to show its pages, start it the same way as the user's `dev` script does.
- The browser opens `http://localhost:5180` by itself. Check the output: it must show the `Local:` address and no error.

Do not change the app's files, config or `package.json`. Verbally needs no change in the project.

## 6. Tell the user

Give the user these lines:

- The app is open at `http://localhost:5180` with a small bar in the corner.
- Hold `⌥ Option` and say a change, for example "make this heading bigger". Chrome asks for the microphone once: allow it.
- Move the mouse while you hold `⌥ Option` to point at an element.
- `⌘Z` puts a change back.
- Verbally writes into the source files. Commit your work first.
- The engine runs Claude Code with all tools allowed and no questions. Details: `docs/DETAILS.md` in the repository.

## Remove

```sh
rm ~/.local/bin/verbally
rm -rf ~/.verbally
```
