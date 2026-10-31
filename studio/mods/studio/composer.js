// The composer under the thread: a rounded box to write to the thread's
// agent. Enter (or the round button) pastes the text into the agent's
// terminal and presses Enter (`hc send`); while the agent works the button
// turns into Stop (`hc interrupt`). The row inside shows + (start another
// thread), the agent with its icon, and what it's doing. Under the box:
// Local or Worktree (where the thread's checkout is; opens the worktree
// dialog to hand the work to a new worktree), the machine if it isn't this
// one, and the branch (opens the worktree list).
//
// On macOS the box also has a mic (voice.js): click it and talk, the words
// appear in the box, click again or pause to stop, then Enter sends.
// The layout's "studio.dictate" key (cmd-shift-m) does the same.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, theme, hc, notify, openOverlay, panes, nextCommand } from "herdr";
import { icon, alpha, glyph, duration, activeSpace, activeTab, lead, threadAgent, machineOf, checkout } from "./lib.js";
import { Voice } from "./voice.js";

export class Composer {
  init(cx) {
    this.text = "";
    this.focused = false;
    this.kind = null; // "local" | "worktree" | null (not git)
    this.kindKey = null;
    this.input = InputState.new({ placeholder: "Ask for follow-up changes" });
    this.input.on("change", (_e, cx) => {
      const had = Boolean(this.text.trim());
      this.text = this.input.value();
      if (had !== Boolean(this.text.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.send(cx));
    this.input.on("focus", (_e, cx) => {
      this.focused = true;
      cx.notify();
    });
    this.input.on("blur", (_e, cx) => {
      this.focused = false;
      cx.notify();
    });
    // "Working 12s" ticks while it shows seconds, else every half minute.
    this.ticks = 0;
    cx.timer.every(1000, (cx) => {
      const a = threadAgent();
      if (a?.status === "working" || ++this.ticks % 30 === 0) cx.notify();
    });

    // The mic: words go into the box as they're heard.
    this.voice = new Voice({
      set: (text) => {
        this.text = text;
        this.input.set_value(text);
      },
      get: () => this.text,
      focus: () => this.input.focus(),
    });
    this.voice.detect(cx);
    cx.timer.every(250, (cx) => this.voice.poll(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "dictate" && this.voice.available) {
          this.voice.toggle(cx);
          cx.notify();
        }
      }
    });
  }

  mic(t) {
    const v = this.voice;
    if (!v.available) return null;
    const on = v.phase === "listening";
    const tip = { ready: "Dictate (⌘⇧M)", preparing: "Setting up dictation, first time only…", listening: "Stop dictating", finishing: "Finishing…" }[v.phase];
    return div()
      .id("sc-mic")
      .size(30)
      .rounded(15)
      .flex()
      .items_center()
      .justify_center()
      .when(on, (el) => el.bg(alpha(t.ansi1, 0.16)).text_color(t.ansi1))
      .when(!on, (el) => el.text_color(v.busy ? t.foreground : t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .cursor_pointer()
      .tooltip(tip ?? "Dictate")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        v.toggle(cx);
        cx.notify();
      })
      .child(
        v.phase === "preparing" || v.phase === "finishing"
          ? svg(icon("spinner")).size(15).spin(900)
          : on
            ? svg(icon("mic")).size(16).loop("opacity", { from: 0.45, to: 1, period: 1100 })
            : svg(icon("mic")).size(16),
      );
  }

  // The terminal the composer writes to: the thread's agent, else its lead terminal.
  target() {
    const a = threadAgent();
    if (a) return { address: a.address, agent: a };
    const tab = activeTab();
    const p = tab ? lead(tab.id) : null;
    return p?.terminal ? { address: p.terminal, agent: null } : null;
  }

  send(cx) {
    const text = this.text.trim();
    const to = this.target();
    if (!text) return;
    if (!to) {
      notify({ title: "No terminal in this thread", body: "Start one with New thread.", level: "info" });
      return;
    }
    this.text = "";
    this.input.set_value("");
    cx.notify();
    cx.spawn(async () => {
      const r = await hc(["send", to.address, text]).catch((e) => ({ code: 1, stderr: String(e) }));
      if (r.code !== 0) notify({ title: "Couldn't send", body: (r.stderr || "").trim().split("\n")[0], level: "error" });
    });
  }

  stop(address) {
    hc(["interrupt", address]);
  }

  // Local or Worktree for the thread's folder, asked of git when it changes.
  checkoutKind(cx, cwd, on) {
    const key = JSON.stringify([on, cwd]);
    if (key === this.kindKey) return this.kind;
    this.kindKey = key;
    this.kind = null;
    cx.spawn(async (cx) => {
      const k = await checkout(cwd, on).catch(() => null);
      if (this.kindKey === key) {
        this.kind = k;
        cx.notify();
      }
    });
    return null;
  }

  chip(t, id, children, onClick, tip) {
    return h_flex()
      .id(id)
      .h(26)
      .px(8)
      .gap(6)
      .items_center()
      .rounded(7)
      .text_size(12.5)
      .text_color(t.muted)
      .when(Boolean(onClick), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(onClick))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .children(children);
  }

  render(cx) {
    const t = theme();
    const space = activeSpace();
    const tab = activeTab();
    const p = tab ? lead(tab.id, panes()) : null;
    const to = this.target();
    const a = to?.agent ?? null;
    const on = machineOf(p?.terminal) ?? space?.machine ?? null;
    const kind = p?.cwd ? this.checkoutKind(cx, p.cwd, on) : null;
    const working = a?.status === "working";
    const ready = Boolean(this.text.trim()) && Boolean(to);
    const name = a?.program?.name ?? p?.program?.name ?? "terminal";
    const v = this.voice;
    const state =
      v.phase === "listening"
        ? { label: v.helper === "downloading" ? "Getting speech model…" : v.helper === "starting" ? "Starting mic…" : "Listening…", color: t.ansi1 }
        : v.phase === "preparing"
          ? { label: "Setting up dictation…", color: t.muted }
          : a?.status === "working"
        ? { label: `Working${tab?.working_since ? ` ${duration(tab.working_since)}` : ""}`, color: t.muted }
        : a?.status === "blocked"
          ? { label: "Awaiting approval", color: t.blocked }
          : a?.status === "done"
            ? { label: "Done", color: t.done }
            : null;
    const worktreeDialog = (action) =>
      openOverlay({ mod: "worktree", kind: "dialog", width: action === "open" ? 560 : 460, height: action === "open" ? 480 : 280, props: { space: space?.id, folder: p?.cwd ?? undefined, action } });

    return v_flex()
      .size_full()
      .items_center()
      .px(24)
      .pt(6)
      .pb(8)
      .child(
        v_flex()
          .id("sc-box")
          .w_full()
          .max_w(780)
          .flex_1()
          .min_h(0)
          .rounded(18)
          .bg(t.popover)
          .border_1()
          .border_color(this.focused ? t.input : t.border)
          .px(16)
          .pt(12)
          .pb(9)
          .gap(6)
          .cursor_text()
          .on_click(() => this.input.focus())
          .child(div().flex_1().min_h(0).child(Input.new(this.input).w_full().h(32).text_size(14.5).text_color(t.foreground)))
          .child(
            h_flex()
              .h(30)
              .gap(2)
              .items_center()
              .child(this.chip(t, "sc-new", [svg(icon("plus")).size(16)], () => openOverlay({ mod: "new-menu", kind: "popup", width: 280 }), "New thread"))
              .child(
                this.chip(
                  t,
                  "sc-agent",
                  [
                    ...(a?.program?.icon || p?.program?.icon ? [glyph(a?.program ?? p.program, 14, t.foreground)] : []),
                    div().text_color(t.foreground).child(name),
                  ],
                  () => run("agent.next", {}),
                  "Next agent",
                ),
              )
              .when(Boolean(state), (el) =>
                el.child(
                  h_flex()
                    .h(22)
                    .px(8)
                    .gap(6)
                    .items_center()
                    .rounded(6)
                    .bg(alpha(state.color, 0.12))
                    .text_size(12)
                    .text_color(state.color)
                    .when(working && !v.busy, (el) => el.child(svg(icon("spinner")).size(12).spin(900)))
                    .child(state.label),
                ),
              )
              .child(div().flex_1())
              .child(this.mic(t) ?? div())
              .child(
                working && !ready
                  ? div()
                      .id("sc-stop")
                      .size(30)
                      .rounded(15)
                      .bg(t.solid)
                      .flex()
                      .items_center()
                      .justify_center()
                      .text_color(t.solid_foreground)
                      .cursor_pointer()
                      .tooltip("Stop")
                      .on_click((_e, cx) => {
                        cx.stop_propagation();
                        this.stop(to.address);
                      })
                      .child(div().size(10).rounded(2).bg(t.solid_foreground))
                  : div()
                      .id("sc-send")
                      .size(30)
                      .rounded(15)
                      .bg(ready ? t.solid : t.selected)
                      .flex()
                      .items_center()
                      .justify_center()
                      .text_color(ready ? t.solid_foreground : t.dim)
                      .when(ready, (el) => el.cursor_pointer())
                      .tooltip("Send")
                      .on_click((_e, cx) => {
                        cx.stop_propagation();
                        this.send(cx);
                      })
                      .child(svg(icon("arrow-up")).size(16)),
              ),
          ),
      )
      .child(
        h_flex()
          .w_full()
          .max_w(780)
          .h(30)
          .pt(4)
          .px(6)
          .gap(4)
          .items_center()
          .when(kind !== null, (el) =>
            el.child(
              this.chip(
                t,
                "sc-checkout",
                [svg(icon(kind === "worktree" ? "git-fork" : "laptop")).size(14), div().child(kind === "worktree" ? "Worktree" : "Local"), svg(icon("chevron-down")).size(12)],
                () => worktreeDialog("new"),
                "Hand off to a new worktree",
              ),
            ),
          )
          .when(Boolean(on), (el) => el.child(this.chip(t, "sc-machine", [div().child(on)], null, "Runs on this machine")))
          .child(div().flex_1())
          .when(Boolean(p?.branch), (el) =>
            el.child(this.chip(t, "sc-branch", [svg(icon("git-branch")).size(14), div().child(p.branch), svg(icon("chevron-down")).size(12)], () => worktreeDialog("open"), "Worktrees")),
          ),
      );
  }
}

