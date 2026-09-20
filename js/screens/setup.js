/* Admin: set up this week's game and open the pregame board.
   Gated behind the shared PIN — anyone who knows it gets admin on their own
   device, which is what survives the admin's phone dying at halftime. */

import { state, stake, unlockAdmin, goto, createGameWithBoard } from "../store.js";
import { esc, money } from "../format.js";
import { riskA, riskB } from "../scoring.js";
import { buildBoard, toBetRows } from "../pregame.js";

let form;

export function reset() {
  const sunday = nextSunday();
  form = {
    kickoff_date: sunday,
    home_team: "",
    away_team: "",
    favorite: "home",
    spread: 3,
    total: 44.5,
    base_stake: 1,
    overrides: {},
  };
}
reset();

function nextSunday() {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return d.toISOString().slice(0, 10);
}

const ready = () => form.home_team.trim() && form.away_team.trim();

export function view() {
  if (!state.admin) return pinView();

  const board = ready() ? buildBoard(form, form.overrides) : [];
  const favName = form.favorite === "home" ? form.home_team : form.away_team;

  return `<div class="page">
    <header class="head">
      <div>
        <h1 class="cond">This week's game</h1>
        <div class="sub">Enter the matchup and the line. Every number below fills
          itself in from the spread and the total — nudge any you disagree with.</div>
      </div>
      <button class="btn sm" id="back">Back</button>
    </header>

    ${state.error ? `<div class="err">${esc(state.error)}</div>` : ""}

    <div class="setupgrid">
      <div><label class="flabel">Kickoff date</label>
        <input class="field" type="date" id="f-kickoff_date" value="${esc(form.kickoff_date)}"></div>
      <div><label class="flabel">Away team</label>
        <input class="field" id="f-away_team" value="${esc(form.away_team)}" placeholder="Bears"></div>
      <div><label class="flabel">Home team</label>
        <input class="field" id="f-home_team" value="${esc(form.home_team)}" placeholder="Packers"></div>
      <div><label class="flabel">Base stake</label>
        <input class="field num" type="number" step="0.5" min="0.5" id="f-base_stake"
               value="${form.base_stake}"></div>
      <div><label class="flabel">Spread</label>
        <input class="field num" type="number" step="0.5" min="0" id="f-spread"
               value="${form.spread}"></div>
      <div><label class="flabel">Total</label>
        <input class="field num" type="number" step="0.5" id="f-total"
               value="${form.total}"></div>
    </div>

    <div class="favrow">
      <span class="flabel">Favored</span>
      <button class="vbtn" data-fav="away" data-on="${form.favorite === "away" ? 1 : 0}">
        ${esc(form.away_team || "away")}</button>
      <button class="vbtn" data-fav="home" data-on="${form.favorite === "home" ? 1 : 0}">
        ${esc(form.home_team || "home")}</button>
      <span class="hint">${ready()
        ? `${esc(favName)} by ${form.spread}. Home field is already priced into
           the spread, so this only decides who the bets are written about.`
        : "Fill in both teams to build the board."}</span>
    </div>

    ${ready() ? boardView(board) : ""}
  </div>`;
}

function boardView(board) {
  const s = Number(form.base_stake) || 1;
  return `
    <div class="sechead"><span>Pregame board</span><span class="rule"></span></div>
    ${board.map(row => `<div class="setrow">
      <div>
        <div class="setlabel">${esc(row.body)}</div>
        <div class="setnote">${esc(row.side_a)} vs ${esc(row.side_b)} ·
          ${row.changed ? `<span class="edited">you set this</span>` : esc(row.note)}</div>
      </div>
      <div class="setctl">
        <input type="range" min="3" max="97" value="${row.pct}" data-odds="${row.key}"
               style="accent-color:${row.changed ? "var(--edit)" : "var(--a)"}">
        <span class="setpct cond num ${row.changed ? "edited" : ""}">${row.pct}%</span>
        <span class="setrisk num">${money(riskA(row.pct / 100, s))} /
          ${money(riskB(row.pct / 100, s))}</span>
      </div>
    </div>`).join("")}

    <div class="rowbtns" style="margin-top:20px">
      <button class="btn primary" id="post">Open the pregame board</button>
      <button class="btn" id="resetodds" ${Object.keys(form.overrides).length ? "" : "disabled"}>
        Reset to the derived numbers</button>
    </div>
    <div class="hint" style="margin-top:12px">
      Posting creates the game and opens picks straight away. Sides stay hidden
      until you kick off.
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
  const redraw = () => goto("setup");

  if ($("#back")) $("#back").onclick = () => goto(state.game ? "room" : "idle");

  if (!state.admin) {
    const pin = $("#pin");
    const go = () => unlockAdmin(pin.value.trim());
    $("#unlock").onclick = go;
    pin.onkeydown = e => { if (e.key === "Enter") go(); };
    pin.focus();
    return;
  }

  /* Text fields keep their value in the draft without redrawing, so typing
     isn't interrupted. Numbers redraw, since the board depends on them. */
  ["home_team", "away_team"].forEach(key => {
    const el = $(`#f-${key}`);
    el.oninput = () => { form[key] = el.value; };
    el.onblur = redraw;
  });
  ["kickoff_date", "base_stake", "spread", "total"].forEach(key => {
    const el = $(`#f-${key}`);
    el.onchange = () => { form[key] = el.value; redraw(); };
  });

  root.querySelectorAll("[data-fav]").forEach(el => {
    el.onclick = () => { form.favorite = el.dataset.fav; redraw(); };
  });

  root.querySelectorAll("[data-odds]").forEach(el => {
    el.oninput = () => {
      form.overrides[el.dataset.odds] = +el.value;
      redraw();
    };
  });

  if ($("#resetodds")) $("#resetodds").onclick = () => { form.overrides = {}; redraw(); };

  if ($("#post")) $("#post").onclick = () => {
    const board = buildBoard(form, form.overrides);
    createGameWithBoard({
      kickoff_date: form.kickoff_date,
      home_team: form.home_team.trim(),
      away_team: form.away_team.trim(),
      favorite: form.favorite,
      spread: Number(form.spread),
      total: Number(form.total),
      base_stake: Number(form.base_stake),
    }, toBetRows(board, null));
  };
}
