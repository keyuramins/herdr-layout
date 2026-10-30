# Studio

Studio dresses Herdr as a desktop agent app. A quiet sidebar lists every
project with its threads. Each thread shows a spinner while its agent works,
an "Awaiting approval" pill when the agent needs you, and a blue dot when it
finished while you looked away. The thread fills the middle with its live
terminal. Under it sits a rounded composer that sends follow-ups to the
agent, and a review panel on the right opens on the diff. Studio has a light
theme and a dark theme, and a switch in the sidebar cycles System, Light and
Dark.

![Studio](preview.png)

## What you see

Left to right, at zoom 1:

- **Sidebar** (300px, 220–440 drag, `chrome`: `#1f1f1f` dark, `#f4f4f4` light).
  - **Top strip** (52px, drags the window): room for the macOS traffic lights
    (84px) and a fold button (`panel-left`, 16px).
  - **Nav**: New thread (`square-pen`), Search (`search`) and Shortcuts
    (`keyboard`). Rows are 32px tall with 13.5px text, 8px radius and a
    `hover` background.
  - **Pinned threads**, shown only when something is pinned.
  - **Threads** header (12.5px, `dim`), with Add project (`folder-plus`) and
    Organize (`list-filter`) on the right. Organize opens an inline card with
    By project and Chronological.
  - **By project**: one row per space (`folder` or `folder-open`, its name,
    "Home" for `~`, and a machine badge for remote spaces). Its threads sit
    under it, one per tab. A thread row has a 16px status slot, then the
    title (`muted`; `foreground` and medium weight when it is open or needs
    you), then the green/red diff `+N -M` (12px, `ansi2`/`ansi1`), then the
    age (`now`, `5m`, `2h`, `3d`). The open thread gets the `selected`
    background.
  - **Chronological**: every open thread newest first, each with its
    project name.
  - **Add project** row, then **Archived (n)**, a folded list of settled tabs.
  - **Footer** (48px): Settings, and a theme switch (`sun-moon`, `sun` or
    `moon`).
- **Work column** (`background`: `#181818` dark, `#ffffff` light).
  - **Header** (52px, drags the window). On the left: the thread title (14px
    semibold), the project (13.5px `dim`), and `···`. On the right: a split
    **Open** button (`code-xml` "Open" plus a chevron, 28px, 1px `border`,
    8px radius), **Commit** (`git-commit-horizontal`), a 1×18 divider, the
    terminal toggle (`square-terminal`) and the diff counter (`file-diff`
    `+N -M`). On Linux and Windows, the window buttons come last.
  - **Thread**: the active tab's live terminals with terminal padding
    `[28, 14]` and 10px side padding. A lone pane has no frame. Split panes
    become cards with 10px radius, a `border` outline and `input` on focus.
  - **Composer** (150px). A box up to 780px wide, centered, with 18px radius,
    `popover` background and a 1px `border` (`input` when focused). Inside:
    an input with the placeholder "Ask for follow-up changes" (14.5px), then
    a row with `+`, the agent chip (program icon and name), a status pill,
    and a 30px round button: send (`arrow-up`, `solid` when there is text)
    or stop (a square) while the agent works. Under the box: Local or
    Worktree (`laptop` or `git-fork`), a machine chip for remote threads,
    and on the right the branch (`git-branch`).
- **Review panel** (hidden at first; 540px, 340–1100, behind a 1px `border`
  divider). Its head (44px) has Review (`file-diff`) and Files
  (`folder-tree`) tabs and a close button. Below the head is a stack of
  Herdr's own `changes` panel (the diff, stage or revert, and the commit
  box) and its `files` tree.

The colors are two theme files, `studio-dark` and `studio-light`. The status
colors are working (gray `#a3a3a3` or `#8a8a8a`), blocked (green `#5fc77a` or
`#1a7f37`, the "Awaiting approval" pill on a 14% tint) and done (blue
`#6ea8fe` or `#2f7af5`). The icons are Lucide at a 1.6 stroke.

## How it behaves

- **working**: a spinning ring (`spinner.svg`, `.spin(900)`) in the thread's
  slot. The composer shows "Working 1m 15s", ticking each second, and its
  button becomes Stop (`hc interrupt <agent>`).
- **blocked**: a still gray ring and a green "Awaiting approval" pill, which
  hides the diff and project label. The title stays bright.
- **done**: a blue 7px dot and a bright title. Herdr turns it idle once you
  look.
- **idle**: an empty slot and a muted title.
- **Clicks on the sidebar:**
  - A thread selects its tab (`tab.select`). An archived thread unsettles it.
    Right-click opens Herdr's tab menu (`menu`, `{tab: "tab"}`).
  - Hovering a thread swaps the diff and age for Pin and Archive
    (`tab.settle`). Pins are this layout's own (shared `studio.pins`).
  - A project row folds and unfolds (shared `studio.collapsed`). On hover it
    shows `···` (the space menu) and New thread. Right-click opens the space
    menu.
  - New thread opens Herdr's `new-menu` popup (terminal, installed agents,
    new space or worktree). Search runs `mod.open picker`. Shortcuts runs
    `app.help`. Settings runs `app.settings`.
  - Add project opens the system folder picker, then `space.new {folder}`.
  - The theme switch cycles System, Light, Dark. It writes only
    `appearance` in `settings.json` (removing it for System), and Herdr
    shows `studio-light` or `studio-dark` from the layout's theme pair.
- **The header:**
  - Open runs the last-picked target on the thread's folder. On macOS that
    is `open -a "Visual Studio Code" | Cursor | Zed | Terminal`, or `open`
    for Finder. Linux uses `code`, `cursor`, `zed` or `xdg-open`. Windows
    uses `code` or `cursor` through `cmd /c`, or `explorer.exe`. The chevron
    picks another (shared `studio.editor`). A failure posts a toast. Remote
    threads only get a toast.
  - Commit selects `changes` in `review-body` and shows `review`.
  - The diff counter toggles the review panel. The terminal toggle splits a
    shell under the agent the first time, then zooms the agent to hide or
    show it.
- **The composer:** Enter or the send button runs `hc send <agent> <text>`,
  which pastes the text and presses Enter. It goes to the focused terminal's
  agent, else the thread's agent, else its first terminal. `+` opens
  `new-menu`. The agent chip runs `agent.next`. Local or Worktree opens
  Herdr's `worktree` dialog (`action: "new"`), and the branch chip opens it
  with `action: "open"`.
- **Keys** (`keys.json`, section `layout:studio`): `cmd-j` or `ctrl-shift-j`
  toggles the terminal, and `cmd-shift-r` or `ctrl-shift-r` toggles review.
  Herdr's `cmd-b` or `ctrl-shift-b` folds the sidebar, because the node is
  named `sidebar`.
- **Refresh rates:** the diffs refresh every 6s in the sidebar and every 4s
  in the header, one `git diff --numstat HEAD` per folder. Ages redraw twice
  a minute.

## Built from

- `layouts/studio.json`. The root is a `row` with `titlebar: "none"`,
  `traffic_lights: [18, 18]`,
  `theme: {light: "studio-light", dark: "studio-dark"}`,
  `terminal_padding: [28, 14]` and `preview: "layouts/studio.png"`. It has
  two children:
  - `sidebar`, a column of 300px:
    - `side-top`, a block of 52px with `window_drag`.
    - `side`, a block.
  - `work`, a column:
    - `head`, a block of 52px with `window_drag`.
    - `body`, a row with a 1px `border` divider:
      - `thread`, a column holding `main` (`{tab: "active"}`, frameless when
        lone) and `composer` (150px).
      - `review`, a column, hidden, 540px. It holds `review-head` (44px) and
        `review-body`, a stack with `changes` (mod `changes`) and `files`
        (mod `files`).
- **One mod, `mods/studio/`** (`place: "none"`), picked by `props().part`:
  - `side-top`, `sidebar`, `header`, `composer` and `review-head` sit in the
    layout.
  - `open-menu` is opened as a popup by the header.
  - The code is split across `main.js` (dispatch), `sidebar.js`,
    `header.js`, `composer.js`, `review.js` and `lib.js` (helpers, git,
    appearance, theme install).
- **Shipped mods it uses:** `changes`, `files`, `new-menu`, `menu`, `picker`
  and `worktree`.
- **`herdr` calls:** `spaces`, `panes`, `agents`, `focused`, `layout`,
  `theme`, `window`, `shared` and `setShared`, `run`, `openOverlay` and
  `closeOverlay`, `notify`, `exec`, `hc`, `readTextFile` and
  `writeTextFile`, `appHome`, `pickFolder` and `nextCommand`.
- **Commands:** `tab.select`, `tab.settle`, `tab.unsettle`, `space.new`,
  `space.select`, `pane.split`, `pane.zoom`, `pane.focus`, `layout.show`,
  `layout.hide`, `layout.toggle`, `layout.select`, `agent.next`, `mod.open`,
  `app.help`, `app.settings` and `window.*`.
- **Programs it runs:**
  - `git` (`diff --numstat HEAD` and `rev-parse`).
  - `hc send` and `hc interrupt`.
  - The editors or file manager, only when you click Open.
- **Art:** Lucide icons in `mods/studio/icons/` (ISC, stroke 1.6) and
  `spinner.svg`. The two themes are in `mods/studio/themes/`.

## Watch out

- **The themes live inside the mod.** A shared layout folder carries only
  `layouts/` and `mods/`. On start, the `side-top` part copies
  `mods/studio/themes/studio-*.json` into the home's `themes/` when they're
  missing, and Herdr picks them up. Until then (the first second of the
  first run), the window shows graphite and `layout.error` mentions the
  missing theme. The copy never overwrites an existing file, so your edits
  stick.
- The theme switch changes `appearance` for the whole app, not only this
  layout, because that is where Herdr keeps light and dark.
- Diffs count tracked changes against HEAD, so new untracked files don't add
  to `+N`. When threads share a folder, only the open thread shows the
  diff, so the number isn't repeated down the list.
- Thread titles are the tab's name when someone named it. Otherwise the
  title is the terminal's title with leading symbols stripped, and when
  there's none, "Thread n".
- The composer is one line. It doesn't report a busy agent, and it can't
  attach images.
- Open can't reach folders on other machines. The app names on macOS are
  fixed: "Visual Studio Code", "Cursor", "Zed" and "Terminal".
- Every part takes `nextCommand()` keys, but only `header` acts on them.
  The others would toggle things five times.
- `mod.json` must stay `place: "none"`, or Herdr docks a stray copy into
  other layouts.

## Done when

- Switching to `studio` shows the sidebar, header, live terminal and
  composer. After the first start, `themes/studio-light.json` and
  `themes/studio-dark.json` exist.
- Spaces show as projects and tabs as threads. A working agent spins, a
  blocked one shows "Awaiting approval", and a finished one gets a blue dot.
- Typing in the composer and pressing Enter reaches the agent. While it
  works, Stop interrupts it.
- Commit and the diff counter open the review panel on Herdr's `changes`,
  and Files switches to the tree.
- The theme switch flips light and dark at once, and System follows the OS.
- `herdr-app check mods/studio` passes. `ctrl-shift-l` switches away and
  back.
