// studio: a desktop-agent-app look for Herdr. One mod, five parts picked by
// props().part, the way the layout places them:
//   side-top     the strip over the sidebar (window buttons' room, fold)
//   sidebar      New thread / Search / Shortcuts, pins, projects and threads,
//                Settings and the light/dark switch
//   header       the thread's title bar: Open, Commit, terminal, diff
//   composer     the box to write to the thread's agent
//   review-head  Review / Files tabs over the review panel
//   open-menu    the Open chevron's popup (opened by header)

import { View, div } from "gpui-kit";
import { props, theme } from "herdr";
import { SideTop, Sidebar } from "./sidebar.js";
import { Header, OpenMenu } from "./header.js";
import { Composer } from "./composer.js";
import { ReviewHead } from "./review.js";

const PARTS = {
  "side-top": SideTop,
  sidebar: Sidebar,
  header: Header,
  composer: Composer,
  "review-head": ReviewHead,
  "open-menu": OpenMenu,
};

export default class Studio extends View {
  init(_props, cx) {
    const Part = PARTS[props()?.part];
    this.part = Part ? new Part() : null;
    this.part?.init?.(cx);
  }

  render(cx) {
    if (!this.part) return div().size_full().p(8).text_size(12).text_color(theme().dim).child(`studio: unknown part "${props()?.part}"`);
    return this.part.render(cx);
  }
}
