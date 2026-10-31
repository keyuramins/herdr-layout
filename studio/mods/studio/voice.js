// The composer's mic, on macOS. Herdr itself can't open the microphone (its
// app bundle doesn't ask for it), so Studio brings a tiny helper app,
// Studio Dictation (dictation/main.swift), that uses the newest speech
// recognition the Mac has: Apple's SpeechTranscriber on macOS 26 and later,
// else the older SFSpeechRecognizer. It picks by itself. The helper is built
// from source with this Mac's own Swift compiler the first time the mic is
// clicked, into mods/studio/.build/ (hidden: hot reload ignores it), and
// macOS asks once for the microphone and speech recognition in its name.
//
// Talking to it is files in .build/session/: it writes status, partial.txt
// and final.txt; a "stop" file stops it. Words appear in the composer as
// they're recognized, after whatever was typed already; nothing is sent
// until you press Enter. Dictated words stay in the box: an empty or
// shorter result never clears them.
//
// The mic shows only where this can work: macOS, with the helper built or a
// Swift compiler to build it (Xcode or `xcode-select --install`).

import { exec, appHome, readTextFile, writeTextFile, notify, window as win } from "herdr";
import { MOD } from "./lib.js";

const VERSION = "3"; // bump when dictation/ changes, so the helper is rebuilt
const BUILD_TIMEOUT = 240e3;
const START_TIMEOUT = 120e3; // a permission prompt can sit there a while
const DOWNLOAD_TIMEOUT = 600e3; // the new engine's language model, first time only
const FINISH_TIMEOUT = 6e3; // the helper gives itself 3s; this is the backstop
const DONE = ["done", "nothing", "denied-mic", "denied-speech", "unavailable", "no-microphone"];

const PROBLEMS = {
  "denied-mic": ["Studio can't use the microphone", "Allow Studio Dictation in System Settings → Privacy & Security → Microphone."],
  "denied-speech": ["Studio can't use speech recognition", "Allow Studio Dictation in System Settings → Privacy & Security → Speech Recognition."],
  unavailable: ["Speech recognition isn't available", "Check System Settings → Keyboard → Dictation, or your Mac's language."],
  "no-microphone": ["No microphone found", "Connect or choose a microphone in System Settings → Sound → Input."],
};

const paths = () => {
  const mod = `${appHome()}/mods/${MOD}`;
  const build = `${mod}/.build`;
  return { mod, build, app: `${build}/StudioDictation.app`, session: `${build}/session` };
};

export class Voice {
  // set(text): put text in the composer; get(): what's there now; focus(): the input.
  constructor({ set, get, focus }) {
    this.set = set;
    this.get = get;
    this.focus = focus;
    this.phase = "checking"; // checking | off | ready | preparing | listening | finishing
    this.why = "";
  }

  get available() {
    return !["checking", "off"].includes(this.phase);
  }

  get busy() {
    return ["preparing", "listening", "finishing"].includes(this.phase);
  }

  // Is this a Mac, with the helper built or a compiler to build it? On a
  // fresh start Herdr's window may not be up yet when this runs (window()
  // empty), so ask the system instead, and if even that gives no answer,
  // look again in a moment rather than hiding the mic for good.
  detect(cx, tries = 0) {
    cx.spawn(async (cx) => {
      let platform = win()?.platform;
      if (!platform) {
        const r = await exec("uname", ["-s"]).catch(() => null);
        platform = r?.code === 0 ? (r.stdout.trim() === "Darwin" ? "macos" : "other") : null;
      }
      if (!platform) {
        if (tries < 20) cx.timer.after(1500, (cx) => this.detect(cx, tries + 1));
        return;
      }
      if (platform !== "macos") {
        this.phase = "off";
        cx.notify();
        return;
      }
      const { app } = paths();
      const built =
        (await readTextFile(`${app}/Contents/Info.plist`).catch(() => null)) !== null ||
        (await exec("test", ["-x", `${app}/Contents/MacOS/StudioDictation`]).catch(() => ({ code: 1 }))).code === 0;
      const swift = built ? true : (await exec("xcrun", ["--find", "swiftc"]).catch(() => ({ code: 1 }))).code === 0;
      this.phase = built || swift ? "ready" : "off";
      if (!this.available) this.why = "Dictation needs Apple's Swift compiler: run xcode-select --install";
      cx.notify();
    });
  }

  // The mic button: start, or stop listening early.
  toggle(cx) {
    if (this.phase === "listening") return this.stop();
    if (this.phase !== "ready") return;
    this.base = this.get();
    this.skip = 0;
    cx.spawn(async (cx) => {
      const { build, app } = paths();
      const version = await readTextFile(`${build}/version`).catch(() => null);
      const built = (await readTextFile(`${app}/Contents/Info.plist`).catch(() => null)) !== null;
      if (built && version?.trim() === VERSION) return this.listen(cx);
      this.phase = "preparing";
      this.since = Date.now();
      cx.notify();
      const { mod } = paths();
      // In the background: building takes longer than one exec may run.
      await exec("sh", ["-c", 'nohup sh "$1/dictation/build.sh" "$1" >/dev/null 2>&1 &', "sh", mod]).catch(() => null);
    });
  }

  async listen(cx) {
    const { app, session } = paths();
    await exec("rm", ["-rf", session]).catch(() => null);
    await exec("mkdir", ["-p", session]).catch(() => null);
    const r = await exec("open", ["-g", "-n", app, "--args", session]).catch((e) => ({ code: 1, stderr: String(e) }));
    if (r.code !== 0) {
      this.phase = "ready";
      notify({ title: "Couldn't start dictation", body: (r.stderr || "").trim().split("\n")[0], level: "error" });
      cx.notify();
      return;
    }
    this.phase = "listening";
    this.since = Date.now();
    this.shown = null;
    this.helper = "starting";
    cx.notify();
  }

  stop() {
    if (this.phase !== "listening") return;
    this.phase = "finishing";
    writeTextFile(`${paths().session}/stop`, "stop\n", null).catch(() => null);
  }

  // You typed or deleted while listening: what's in the box now is the new
  // start, and words heard before the edit aren't added again.
  edited(value) {
    if (!this.busy || value === this.lastSet) return;
    this.base = value;
    this.skip = (this.shown ?? "").trim().split(/\s+/).filter(Boolean).length;
  }

  // The box: what was there (typed, or kept after an edit), then the words
  // heard since.
  join(words) {
    const base = (this.base ?? "").replace(/\s+$/, "");
    const w = (words ?? "").trim().split(/\s+/).filter(Boolean).slice(this.skip ?? 0).join(" ");
    return base && w ? `${base} ${w}` : base || w;
  }

  put(text) {
    this.lastSet = text;
    this.set(text);
  }

  // Called every 250 ms by the composer; does nothing unless a build or a
  // listen is under way.
  poll(cx) {
    if (!this.busy || this.polling) return;
    this.polling = true;
    cx.spawn(async (cx) => {
      try {
        if (this.phase === "preparing") await this.pollBuild(cx);
        else await this.pollListen(cx);
      } finally {
        this.polling = false;
      }
    });
  }

  async pollBuild(cx) {
    const { build } = paths();
    const status = await readTextFile(`${build}/build.status`).catch(() => null);
    if (status === null) {
      if (Date.now() - this.since > BUILD_TIMEOUT) {
        this.phase = "ready";
        notify({ title: "Setting up dictation took too long", body: `See ${build}/build.log`, level: "error" });
        cx.notify();
      }
      return;
    }
    if (status.trim() !== "0") {
      const log = (await readTextFile(`${build}/build.log`).catch(() => null)) ?? "";
      const line = log.split("\n").find((l) => /error/i.test(l)) ?? log.trim().split("\n").pop() ?? "";
      this.phase = "ready";
      notify({ title: "Couldn't set up dictation", body: line.slice(0, 200), level: "error" });
      cx.notify();
      return;
    }
    await writeTextFile(`${build}/version`, `${VERSION}\n`, await readTextFile(`${build}/version`).catch(() => null)).catch(() => null);
    await this.listen(cx);
  }

  async pollListen(cx) {
    const { session } = paths();
    const status = ((await readTextFile(`${session}/status`).catch(() => null)) ?? "").trim();
    const partial = await readTextFile(`${session}/partial.txt`).catch(() => null);
    let changed = false;
    // Only ever more words: an empty file (just rewritten) changes nothing.
    if (partial !== null && partial.trim() && partial !== this.shown) {
      this.shown = partial;
      this.put(this.join(partial));
      changed = true;
    }
    if (status === "finishing" && this.helper !== "finishing") this.finishingSince = Date.now();
    if (status && status !== this.helper) {
      this.helper = status; // starting (permission prompts), downloading (first use of the new engine), listening
      changed = true;
    }
    // A helper stuck finishing: end the session here, keeping what was heard.
    const stuck = status === "finishing" && Date.now() - (this.finishingSince ?? Date.now()) > FINISH_TIMEOUT;
    if (stuck) exec("pkill", ["-f", "StudioDictation.app/Contents/MacOS/StudioDictation"]).catch(() => null);
    if (DONE.includes(status) || stuck) {
      // What was heard stays in the box; only a longer final replaces it.
      const final = await readTextFile(`${session}/final.txt`).catch(() => null);
      if (final !== null && final.trim() && final.trim().length >= (this.shown ?? "").trim().length) this.put(this.join(final));
      this.phase = "ready";
      const p = PROBLEMS[status];
      if (p) notify({ title: p[0], body: p[1], level: "warning", timeout: 8000 });
      this.focus();
      cx.notify();
      return;
    }
    const waited = Date.now() - this.since;
    if (((status === "" || status === "starting") && waited > START_TIMEOUT) || (status === "downloading" && waited > DOWNLOAD_TIMEOUT)) {
      this.phase = "ready";
      changed = true;
    }
    if (changed) cx.notify();
  }
}
