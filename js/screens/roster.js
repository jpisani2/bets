/* Admin: the roster.

   Merging reassigns rows and never touches a stored total, because there
   aren't any — so every stat recalculates on its own, and so does the undo. */

import { state, goto, unlockAdmin, loadRoster, loadHistory,
         renamePlayer, mergePlayers, removePlayer, undoRosterChange,
         clearFlag, reassignPick } from "../store.js";
import { esc, money } from "../format.js";
import { rollUp } from "../scoring.js";

let selected = [];
let keeping = null;
let editing = null;
let draftName = "";
let deleting = null;
let move = { bet: "", from: "", to: "" };

export function reset() {
  selected = []; keeping = null; editing = null;
  draftName = ""; deleting = null;
  move = { bet: "", from: "", to: "" };
}

const nameOf = id => state.players.find(p => p.id === id)?.name ?? "(gone)";

/* Lifetime totals, game by game, since the stake lives on the game. */
function lifetime() {
  const out = {};
  state.players.forEach(p => { out[p.id] = { net: 0, bets: 0, games: 0 }; });
  state.history.games.forEach(game => {
    const rolled = rollUp(
      state.history.bets.filter(b => b.game_id === game.id),
      state.players, Number(game.base_stake));
    Object.entries(rolled).forEach(([id, r]) => {
      if (!out[id]) return;
      out[id].net += r.net;
      out[id].bets += r.bets;
      if (r.bets) out[id].games += 1;
    });
  });
  return out;
}

function lastSeen() {
  const seen = {};
  const dateOf = gameId =>
    state.history.games.find(g => g.id === gameId)?.kickoff_date ?? "";
  state.history.bets.forEach(bet => {
    bet.picks.forEach(pick => {
      const d = dateOf(bet.game_id);
      if (d && (!seen[pick.player_id] || d > seen[pick.player_id])) {
        seen[pick.player_id] = d;
      }
    });
  });
  return seen;
}

export function view() {
  if (!state.admin) return pinView();
  if (!state.history.loaded || !state.roster.loaded) {
    return `<div class="center"><p>Loading the roster…</p></div>`;
  }

  const totals = lifetime();
  const seen = lastSeen();
  const dropping = selected.find(id => id !== keeping);

  return `<div class="page">
    <header class="head">
      <div>
        <h1 class="cond">Roster</h1>
        <div class="sub">Pick two people to merge them into one record. Every
          pick moves across and all the stats recalculate — including the ones
          from before the merge.</div>
      </div>
      <button class="btn sm" id="back">Back</button>
    </header>

    ${state.error ? `<div class="err">${esc(state.error)}</div>` : ""}

    ${state.roster.flags.length ? `
      <div class="sechead"><span class="flagged">Needs a look
        (${state.roster.flags.length})</span><span class="rule"></span></div>
      ${state.roster.flags.map(f => `<div class="logrow">
        <div>
          <div class="logline">${esc(nameOf(f.player_id))} and ${esc(nameOf(f.similar_to))}</div>
          <div class="lognote">${esc(f.reason)}</div>
        </div>
        <div class="rowbtns" style="margin:0">
          <button class="btn sm" data-setup-merge="${f.player_id}"
                  data-keep="${f.similar_to}">Set up merge</button>
          <button class="btn sm" data-clearflag="${f.id}">Different people</button>
        </div>
      </div>`).join("")}` : ""}

    <div class="sechead"><span>Everyone (${state.players.length})</span><span class="rule"></span></div>
    <table class="board num">
      <thead><tr>
        <th style="width:34px"></th><th>Player</th><th>Games</th><th>Bets</th>
        <th>Last seen</th><th>All-time net</th><th></th>
      </tr></thead>
      <tbody>${state.players.map(p => row(p, totals[p.id], seen[p.id])).join("")}</tbody>
    </table>

    ${selected.length === 2 ? mergeBox(totals, dropping) : ""}

    ${state.roster.changes.length ? `
      <div class="sechead"><span>Recent changes</span><span class="rule"></span></div>
      ${state.roster.changes.map(c => `<div class="logrow">
        <div>
          <div class="logline">${c.kind === "merge"
            ? `${esc(c.subject_name)} → ${esc(nameOf(c.target_id))}`
            : `Deleted ${esc(c.subject_name)}`}</div>
          <div class="lognote">${new Date(c.created_at).toLocaleDateString()}</div>
        </div>
        <button class="btn sm" data-undo="${c.id}">Undo</button>
      </div>`).join("")}` : ""}

    ${movePickSection()}
  </div>`;
}

function row(player, totals, seen) {
  const chosen = selected.includes(player.id);
  const isEditing = editing === player.id;
  const isDeleting = deleting === player.id;

  return `<tr class="${chosen ? "picked" : ""}">
    <td><button class="tick" data-on="${chosen ? 1 : 0}" data-select="${player.id}"
        aria-label="Select ${esc(player.name)}"></button></td>
    <td>${isEditing
      ? `<input class="field inline" id="rename" value="${esc(draftName)}">`
      : esc(player.name)}</td>
    <td>${totals.games}</td>
    <td>${totals.bets}</td>
    <td>${seen ?? "—"}</td>
    <td class="${totals.net > 0.005 ? "up" : totals.net < -0.005 ? "down" : ""}">${money(totals.net)}</td>
    <td class="nowrap">${isEditing
      ? `<button class="btn sm" data-saverename="${player.id}">Save</button>
         <button class="btn sm" data-cancelrename="1">Cancel</button>`
      : isDeleting
      ? `<button class="btn sm danger" data-reallydelete="${player.id}">Delete ${esc(player.name)}</button>
         <button class="btn sm" data-keepplayer="1">Keep</button>`
      : `<button class="btn sm" data-rename="${player.id}">Rename</button>
         <button class="btn sm" data-delete="${player.id}">Delete</button>`}</td>
  </tr>`;
}

function mergeBox(totals, dropping) {
  const gone = totals[dropping];
  return `<div class="mergebox">
    <div class="mergetitle">Which name should survive?</div>
    <div class="rowbtns">
      ${selected.map(id => `<button class="btn ${keeping === id ? "chosen" : ""}"
        data-keeping="${id}">${esc(nameOf(id))}</button>`).join("")}
    </div>
    <div class="hint" style="margin:12px 0">
      ${gone.bets} bet${gone.bets === 1 ? "" : "s"} move from ${esc(nameOf(dropping))}
      to ${esc(nameOf(keeping))}, worth <span class="num">${money(gone.net)}</span>.
      ${esc(nameOf(dropping))} disappears from the roster. Reversible.
    </div>
    <div class="rowbtns">
      <button class="btn primary" data-merge="1">Merge into ${esc(nameOf(keeping))}</button>
      <button class="btn" data-cancelmerge="1">Cancel</button>
    </div>
  </div>`;
}

/* Someone always taps in on the wrong phone. */
function movePickSection() {
  if (!state.game) return "";
  const bets = state.bets.slice(0, 25);
  const chosen = bets.find(b => b.id === move.bet);
  const inBet = chosen ? chosen.picks.map(p => p.player_id) : [];

  return `<div class="sechead"><span>Move one pick to someone else</span><span class="rule"></span></div>
    <div class="hint" style="margin-bottom:11px">
      For when someone taps in on the wrong phone. Touches only that one pick.
    </div>
    <div class="moverow">
      <select class="field" id="movebet">
        <option value="">Pick a bet from tonight…</option>
        ${bets.map(b => `<option value="${b.id}" ${move.bet === b.id ? "selected" : ""}>
          ${esc(b.body.slice(0, 60))}</option>`).join("")}
      </select>
      <select class="field" id="movefrom" ${chosen ? "" : "disabled"}>
        <option value="">from…</option>
        ${inBet.map(id => `<option value="${id}" ${move.from === id ? "selected" : ""}>
          ${esc(nameOf(id))}</option>`).join("")}
      </select>
      <select class="field" id="moveto" ${move.from ? "" : "disabled"}>
        <option value="">to…</option>
        ${state.players.filter(p => !inBet.includes(p.id))
          .map(p => `<option value="${p.id}" ${move.to === p.id ? "selected" : ""}>
            ${esc(p.name)}</option>`).join("")}
      </select>
      <button class="btn" id="domove" ${move.bet && move.from && move.to ? "" : "disabled"}>
        Move it</button>
    </div>`;
}

function pinView() {
  return `<div class="center">
    <h1 class="cond">Admin</h1>
    <p>Enter the shared PIN.</p>
    ${state.error ? `<div class="err">${esc(state.error)}</div>` : ""}
    <input class="field" id="pin" inputmode="numeric" autocomplete="off" placeholder="PIN">
    <button class="btn primary wide" id="unlock">Unlock</button>
    <button class="linkish" id="back" style="margin-top:14px">Back</button>
  </div>`;
}

export function wire(root) {
  const $ = sel => root.querySelector(sel);
  const redraw = () => goto("roster");

  if ($("#back")) $("#back").onclick = () => goto(state.game ? "room" : "idle");

  if (!state.admin) {
    const pin = $("#pin");
    const go = () => unlockAdmin(pin.value.trim());
    $("#unlock").onclick = go;
    pin.onkeydown = e => { if (e.key === "Enter") go(); };
    pin.focus();
    return;
  }

  if (!state.history.loaded) { loadHistory(); return; }
  if (!state.roster.loaded) { loadRoster(); return; }

  root.querySelectorAll("[data-select]").forEach(el => {
    el.onclick = () => {
      const id = el.dataset.select;
      selected = selected.includes(id)
        ? selected.filter(x => x !== id)
        : [...selected, id].slice(-2);
      keeping = selected[0] ?? null;
      redraw();
    };
  });

  root.querySelectorAll("[data-setup-merge]").forEach(el => {
    el.onclick = () => {
      selected = [el.dataset.keep, el.dataset.setupMerge];
      keeping = el.dataset.keep;
      redraw();
    };
  });
  root.querySelectorAll("[data-clearflag]").forEach(el => {
    el.onclick = () => clearFlag(el.dataset.clearflag);
  });

  root.querySelectorAll("[data-keeping]").forEach(el => {
    el.onclick = () => { keeping = el.dataset.keeping; redraw(); };
  });
  if ($("[data-merge]")) $("[data-merge]").onclick = () => {
    const dropping = selected.find(id => id !== keeping);
    mergePlayers(dropping, keeping);
    reset();
  };
  if ($("[data-cancelmerge]")) $("[data-cancelmerge]").onclick = () => {
    selected = []; keeping = null; redraw();
  };

  root.querySelectorAll("[data-rename]").forEach(el => {
    el.onclick = () => {
      editing = el.dataset.rename;
      draftName = nameOf(editing);
      redraw();
    };
  });
  const renameField = $("#rename");
  if (renameField) {
    renameField.focus();
    renameField.oninput = () => { draftName = renameField.value; };
    renameField.onkeydown = e => {
      if (e.key === "Enter") { renamePlayer(editing, draftName); editing = null; }
      if (e.key === "Escape") { editing = null; redraw(); }
    };
  }
  root.querySelectorAll("[data-saverename]").forEach(el => {
    el.onclick = () => { renamePlayer(el.dataset.saverename, draftName); editing = null; };
  });
  if ($("[data-cancelrename]")) $("[data-cancelrename]").onclick = () => {
    editing = null; redraw();
  };

  root.querySelectorAll("[data-delete]").forEach(el => {
    el.onclick = () => { deleting = el.dataset.delete; redraw(); };
  });
  if ($("[data-keepplayer]")) $("[data-keepplayer]").onclick = () => {
    deleting = null; redraw();
  };
  root.querySelectorAll("[data-reallydelete]").forEach(el => {
    el.onclick = () => { removePlayer(el.dataset.reallydelete); deleting = null; };
  });

  root.querySelectorAll("[data-undo]").forEach(el => {
    el.onclick = () => undoRosterChange(el.dataset.undo);
  });

  if ($("#movebet")) {
    $("#movebet").onchange = () => {
      move = { bet: $("#movebet").value, from: "", to: "" };
      redraw();
    };
    $("#movefrom").onchange = () => { move.from = $("#movefrom").value; move.to = ""; redraw(); };
    $("#moveto").onchange = () => { move.to = $("#moveto").value; redraw(); };
    $("#domove").onclick = () => {
      reassignPick(move.bet, move.from, move.to);
      move = { bet: "", from: "", to: "" };
    };
  }
}
