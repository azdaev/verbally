# Verbally

**Point at your app. Say the change. Watch the code change.**

![Point at a heading, say "make this heading huge and orange", and the source file changes](docs/demo.gif)

<sub>Real speed, no cuts. Two phrases, two edits in `src/App.tsx`.</sub>

You look at a button and think "bigger, and not that blue". Now you just say it.

Hold `⌥`, point, talk. About 3 seconds later the change is in your source file. No prompt box. No "the third card in the second row, no, the other one".

## Get started

Paste this into Claude Code, in your project:

```
Install Verbally here and start it: https://raw.githubusercontent.com/azdaev/verbally/main/INSTALL.md
```

That is all. Claude installs it, starts it, and opens your app with a small bar in the corner.

## Say things like

- "make this heading bigger"
- "this ① must look like that ②" (stop the mouse for a moment to drop a mark)
- "show me three versions of this card"
- "сделай кнопку зелёной". Russian works too.
- `⌘Z`, when it gets you wrong.

## Good to know

- **It runs on your Claude Code subscription.** No API key, no extra bill.
- **Vite + React, macOS and Linux** today. The rest is in [LIMITATIONS.md](LIMITATIONS.md).
- **It writes into your real files.** Commit first.
- **The engine is Claude Code with every tool allowed and no questions.** Nobody can click "approve" while they talk. Use it on projects that you trust.
- **No project yet?** `verbally` with no folder builds a new page from nothing, by voice.

Settings, security and the install by hand: [docs/DETAILS.md](docs/DETAILS.md). License: [MIT](LICENSE).
