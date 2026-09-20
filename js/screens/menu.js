/* Everything that isn't the board: the other screens, and the theme picker.
   Kept behind one link so the room header stays a board and not a navbar. */

import { state, goto, openMenu } from "../store.js";
import { esc } from "../format.js";
import { THEMES, current, apply } from "../theme.js";
import * as settle from "./settle.js";
import * as stats from "./stats.js";
import * as roster from "./roster.js";
import * as closeout from "./closeout.js";
import * as setup from "./setup.js";

export function view() {
  const theme = current();
  return `<div class="sheet" id="menusheet"><div class="sheetbody">
    <div class="sheettop">
      <strong>Menu</strong>
      <button class="btn sm" id="closemenu">Close</button>
    </div>

    <div class="menulist">
      <button class="menuitem" id="m-settle">Settle up
        <span>balances, transfers, payment log</span></button>
      <button class="menuitem" id="m-stats">Stats
        <span>lifetime, season, categories, export</span></button>
      <button class="menuitem" id="m-roster">Roster
        <span>merge, rename, move a stray pick</span></button>
      <button class="menuitem" id="m-admin">${state.game ? "Close out the night" : "Set up a game"}
        <span>admin${state.admin ? "" : " — needs the PIN"}</span></button>
    </div>

    <div class="sechead"><span>Theme</span><span class="rule"></span></div>
    <div class="themegrid">
      ${THEMES.map(t => `<button class="themebtn" data-theme-id="${t.id}"
        data-on="${theme === t.id ? 1 : 0}">
        <span class="swatches" data-swatch="${t.id}"><i></i><i></i><i></i></span>
        <span class="themename">${esc(t.name)}</span>
        <span class="themenote">${esc(t.note)}</span>
      </button>`).join("")}
    </div>
    <div class="hint" style="margin-top:10px">
      This device only. Nobody else's screen changes.
    </div>
  </div></div>`;
}

export function wire(root) {
  const $ = sel => root.querySelector(sel);
  const close = () => openMenu(false);

  $("#menusheet").onclick = e => { if (e.target.id === "menusheet") close(); };
  $("#closemenu").onclick = close;

  $("#m-settle").onclick = () => { close(); settle.reset(); goto("settle"); };
  $("#m-stats").onclick  = () => { close(); stats.reset();  goto("stats"); };
  $("#m-roster").onclick = () => { close(); roster.reset(); goto("roster"); };
  $("#m-admin").onclick  = () => {
    close();
    if (state.game) { closeout.reset(); goto("closeout"); }
    else { setup.reset(); goto("setup"); }
  };

  root.querySelectorAll("[data-theme-id]").forEach(el => {
    el.onclick = () => { apply(el.dataset.themeId); openMenu(true); };
  });
}
