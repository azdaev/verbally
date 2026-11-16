# What keeps Verbally from working for everyone

Lessons from real use. Each item: what breaks, and the fix that is done or open.

## Code mode

Tested on a new Vite 8 + React 19 app and on a larger Vite 8 + React 18 app with Tailwind: "make this heading red" → one edit block in the source file in about 3 s, the dev server showed it, undo put the file back.

- **Vite and React only.** `code/dev.mjs` runs the app's own Vite and writes a `data-vsrc="file:line"` mark into every JSX element. Next.js, Svelte, Vue and server templates have no marks, so pointing finds no source.
  Open: find the file with a text search, see "A locator without marks" below.
- **A second dev server.** Verbally starts its own copy of the app's dev server on port 5180. An app that depends on its port (OAuth callbacks, CORS lists) can fail there.
  Open: put the bar on the dev server that the user already runs: a plugin line in the app's config, or a script tag.
- **Vite 7 and older need `@babel/core` in the app.** Vite 8 has a parser of its own. Both paths give the same marks.
- **Shared components.** A mark points to the file that writes the HTML element. A `<Button>` used on 20 pages leads to `Button.tsx`. The model also gets the next file up and is told to prefer it for a change of one place.
- **No check of the result.** A change that breaks the build shows as Vite's error screen. Undo (`⌘Z`) puts the file back.
  Open: read Vite's error and retry once with it.
- **State is lost on reload.** A change inside an open dialog may close it.
- **No source map for the marks.** Line numbers stay right. The columns of a marked line shift in the debugger.
- **Class names on the app's elements.** While the user points, Verbally adds the classes `point` and `glow` to elements of the app. An app with its own classes of these names gets their styles for that time.
- **Only `localhost`.** The server answers only when the page's host is a name of this machine. An app opened through a custom dev domain or from another device gets no answer.

### A locator without marks (experiment)

Question: can a plain text search find the source file of an element, with no build plugin?

Method: one real app with marks, 92 elements on 5 pages. For each element, search the source for its class string, then for its own text. The mark is the right answer.

| Locator | Right file, first choice |
|---|---|
| The element alone | 64% (17% more: the right file is one of several) |
| The element, its children and 1 parent vote | 87% |
| The element, its children and 3 parents vote | 92% |

Over all 3674 elements of the source, the class string or the text of one element alone names exactly one file for 32%.

Result: the element alone is not enough; with its neighbours the search is close to the marks. The sample is small and is one app. A locator like this would open code mode to every stack that keeps class names or text in its source. It fails for CSS-in-JS and component libraries (the classes are made at run time) and for text that comes from a CMS, a database or translation files.

## Page mode

- **Only static sites import.** `VERBALLY_SITE=folder` + `?import=1` reads `index.html`. A React, Next or Vite site has an empty `index.html` until its scripts run.
  Open: import the rendered DOM of a running address, taken through the user's browser.
- **Edits do not go back to the source.** The changed page lives in the browser's storage and in `~/.verbally/pages/`, not in the site's files.
  Open: an export that writes the sections back into the site's `index.html`.
- **Two style systems on one page.** An imported site has its own CSS classes. The model writes new parts in Tailwind, so new parts can look foreign.
  Done: the model is told to reuse the classes of the sections. Open: send the class names of the stylesheet too.
- **A site needs its own scripts.** Done: the import loads the site's script files after its sections and fires `DOMContentLoaded` once more. Inline scripts (analytics) stay out.
  Open: a script keeps the elements that it found at start. An element that the model replaces loses its behaviour until a reload.

## Every mode

- **A dictation app: three rough edges.** Any `⌘V` outside a text field counts as speech while a dictation app runs (up to 1000 letters). The marks ① ② get no number in the words, because the text arrives after the speech. Only Hex is tested.
- **Voice only.** The bar has no text field. In an office or a café the user cannot talk.
- **macOS only: the pictures for the model.** "This looks bad" and the pointer marks send a part of the screen (`screencapture`, `swiftc`). On Linux the model gets the HTML and the speech, no picture.
- **Windows: not supported.** The engine code uses Unix process groups.
- **Chrome.** Without a Soniox key the speech recognizer of Chrome works; Firefox has none.
- **Jev (the Typesafe key) is optional, but without it routing is weaker.** The key-word rules know few languages. Open: let the design model itself choose the place of the change.
- **The engine runs Claude Code with all tools and no questions.** See "Security and privacy" in docs/DETAILS.md. Open: an engine without tools for code mode, where the model only writes edit blocks.
- **Pinterest needs the Playwriter extension.** The engine adds the browser lines to its prompt only when `playwriter` is installed. `pinterest.sh` reads Pinterest through the user's own browser; check that site's terms for your use.
- **The default model is Opus.** A Claude plan with a small Opus limit runs out fast. Use `?model=claude-sonnet-5-5`.
