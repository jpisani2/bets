/* Claim a seat. The roster is the only way in: tapping an existing name is
   what prevents duplicates, since typing is what creates them. */

import { state, takeSeat, addPlayer } from "../store.js";
import { esc } from "../format.js";

export function view() {
  return `<div class="center">
    <h1 class="cond">Who are you?</h1>
    <p>Tap your name — same name every week, on any device. That's what keeps
       your record in one piece.</p>
    ${state.error ? `<div class="err">${esc(state.error)}</div>` : ""}
    <div class="namegrid">
      ${state.players.map(p =>
        `<button class="namebtn" data-seat="${p.id}">${esc(p.name)}</button>`).join("")}
    </div>
    <div style="margin-top:18px">
      <label class="flabel">Not on the list?</label>
      <input class="field" id="newname" placeholder="First name is plenty" autocomplete="off">
      <div class="warn" id="similar"></div>
      <button class="btn wide" id="add">Add and start</button>
    </div>
  </div>`;
}

export function wire(root) {
  root.querySelectorAll("[data-seat]").forEach(btn => {
    btn.onclick = () => takeSeat(btn.dataset.seat);
  });

  const input = root.querySelector("#newname");
  const warning = root.querySelector("#similar");

  input.oninput = () => {
    const typed = input.value.trim().toLowerCase();
    const near = typed && state.players.find(p => {
      const name = p.name.toLowerCase();
      return name === typed || name.startsWith(typed) || typed.startsWith(name);
    });
    warning.textContent = near
      ? `${near.name} is already on the list — tap it above if that's you.` : "";
  };

  root.querySelector("#add").onclick = () => {
    if (input.value.trim()) addPlayer(input.value);
  };
}
