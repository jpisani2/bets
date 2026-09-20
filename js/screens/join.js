/* Room password. Gates a device that hasn't been here before. */

import { state, submitPassword, render } from "../store.js";
import { esc } from "../format.js";
import { THEMES, current, apply } from "../theme.js";

export function view() {
  return `<div class="center">
    <h1 class="cond">Bet Room</h1>
    <p>Enter the room password.</p>
    ${state.error ? `<div class="err">${esc(state.error)}</div>` : ""}
    <input class="field" id="pw" placeholder="Room password" autocomplete="off">
    <button class="btn primary wide" id="join">Join</button>
    <div class="themerow">${THEMES.map(t => `<button class="dotbtn" data-theme-id="${t.id}"
      data-on="${current() === t.id ? 1 : 0}" data-swatch="${t.id}"
      title="${t.name}" aria-label="${t.name}"></button>`).join("")}</div>
  </div>`;
}

export function wire(root) {
  const input = root.querySelector("#pw");
  const go = () => submitPassword(input.value.trim());
  root.querySelector("#join").onclick = go;
  input.onkeydown = e => { if (e.key === "Enter") go(); };
  input.focus();

  root.querySelectorAll("[data-theme-id]").forEach(el => {
    el.onclick = () => { apply(el.dataset.themeId); render(); };
  });
}
