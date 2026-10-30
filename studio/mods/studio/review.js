// The top of the review panel: Review (Herdr's `changes` panel: the diff,
// stage, revert, commit) and Files (Herdr's `files` tree) as tabs that pick
// the child of the layout's "review-body" stack, and close.

import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run, theme, layout } from "herdr";
import { icon, findNode } from "./lib.js";

const SURFACES = [
  ["changes", "Review", "file-diff"],
  ["files", "Files", "folder-tree"],
];

export class ReviewHead {
  render() {
    const t = theme();
    const active = findNode(layout(), "review-body")?.active ?? "changes";
    return h_flex()
      .size_full()
      .px(12)
      .gap(2)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .children(
        SURFACES.map(([id, label, name]) =>
          h_flex()
            .id(`sr-${id}`)
            .h(28)
            .px(10)
            .gap(6)
            .items_center()
            .rounded(8)
            .text_size(13)
            .text_color(id === active ? t.foreground : t.muted)
            .when(id === active, (el) => el.bg(t.selected))
            .cursor_pointer()
            .hover((s) => s.text_color(t.foreground))
            .on_click(() => run("layout.select", { stack: "review-body", child: id }))
            .child(svg(icon(name)).size(15))
            .child(label),
        ),
      )
      .child(div().flex_1())
      .child(
        div()
          .id("sr-close")
          .p(6)
          .rounded(8)
          .text_color(t.dim)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Close")
          .on_click(() => run("layout.hide", { id: "review" }))
          .child(svg(icon("x")).size(15)),
      );
  }
}
