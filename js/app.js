/* ===========================================================================
   Entry point. Picks a screen, renders it, wires it. Nothing else.
   =========================================================================== */

import { state, onChange, boot } from "./store.js";
import { esc } from "./format.js";
import { restore } from "./theme.js";
import * as join from "./screens/join.js";
import * as seat from "./screens/seat.js";
import * as room from "./screens/room.js";
import * as setup from "./screens/setup.js";
import * as closeout from "./screens/closeout.js";
import * as settle from "./screens/settle.js";
import * as stats from "./screens/stats.js";
import * as idle from "./screens/idle.js";
import * as roster from "./screens/roster.js";

const root = document.getElementById("app");
const dot = document.getElementById("live");

const SCREENS = { join, seat, room, setup, closeout, settle, stats, idle, roster };

const STATIC = {
  loading: () => `<div class="center"><p>Connecting…</p></div>`,

  unconfigured: () => `<div class="center">
    <h1 class="cond">Almost there</h1>
    <p>Open <code>js/config.js</code> and paste your Supabase publishable key in,
       replacing PASTE_YOUR_PUBLISHABLE_KEY_HERE.</p>
    ${state.error ? `<div class="err">${esc(state.error)}</div>` : ""}
  </div>`,


};

function render() {
  dot.dataset.live = state.live ? "1" : "0";

  const screen = SCREENS[state.screen];
  if (screen) {
    root.innerHTML = screen.view();
    screen.wire(root);
  } else {
    root.innerHTML = (STATIC[state.screen] ?? STATIC.loading)();
  }
}

restore();
onChange(render);
boot();
