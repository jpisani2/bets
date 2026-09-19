/* The live board: open bets, locked bets, settled bets, scoreboard. */

import { state, stake, nameOf, betsBy, awaiting, isPregame, isBlind,
         pick, lock, grade, ungrade, pull, openProposeSheet,
         kickOff, goto } from "../store.js";
import { MAX_OPEN_BETS } from "../config.js";
import { esc, money, matchup } from "../format.js";
import { riskA, riskB, takers, pot, canLock, settle, ifThisHits, rollUp } from "../scoring.js";
import * as propose from "./propose.js";

export function view() {
  const open = betsBy("open"), locked = betsBy("locked"), graded = betsBy("graded");
  const totals = rollUp(state.bets, state.players, stake());
  const mine = totals[state.me]?.net ?? 0;
  const full = open.length >= MAX_OPEN_BETS;

  return `
  <div class="wrap">
    <header class="head">
      <div>
        <h1 class="cond">${esc(matchup(state.game))}</h1>
        <div class="sub">Base stake ${money(stake())} · you're ${esc(nameOf(state.me))}
          · <button class="linkish" id="adminlink">admin</button></div>
      </div>
      <div class="yournet">
        <div class="v cond num ${tone(mine)}">${money(mine)}</div>
        <div class="k">your net</div>
      </div>
    </header>

    ${state.notice ? `<div class="banner">${esc(state.notice)}</div>` : ""}
    ${state.error ? `<div class="err">${esc(state.error)}</div>` : ""}

    ${section(isPregame() ? `Pregame board (${open.length})` : `Taking picks (${open.length})`)}
    ${open.length ? open.map(openCard).join("")
      : `<div class="empty">${isPregame()
          ? "The pregame board is empty."
          : "Nothing on the table. Call one before the next snap."}</div>`}

    ${locked.length ? section(`Locked, waiting on the result (${locked.length})`)
      + locked.map(lockedCard).join("") : ""}

    ${graded.length ? section(`Settled (${graded.length})`)
      + graded.map(gradedCard).join("") : ""}

    ${section("Scoreboard")}
    ${scoreboard(totals)}
  </div>

  <div class="fab"><div class="inner">
    ${isPregame() ? `
      <button class="btn primary wide" id="kickoff">Kick off — close the pregame board</button>
      <div class="fabnote">Admin only. In-game betting opens once this is tapped.</div>`
    : `<button class="btn primary wide" id="callbet" ${full ? "disabled" : ""}>
        ${full ? "Ten bets already open" : "Call a bet"}
      </button>`}
  </div></div>

  ${state.proposing ? propose.view() : ""}`;
}

export function wire(root) {
  root.querySelectorAll("[data-pick]").forEach(el => {
    el.onclick = () => pick(el.dataset.pick, el.dataset.side);
  });
  root.querySelectorAll("[data-lock]").forEach(el => {
    el.onclick = () => lock(el.dataset.lock);
  });
  root.querySelectorAll("[data-grade]").forEach(el => {
    el.onclick = () => grade(el.dataset.grade, el.dataset.result);
  });
  root.querySelectorAll("[data-ungrade]").forEach(el => {
    el.onclick = () => ungrade(el.dataset.ungrade);
  });
  root.querySelectorAll("[data-pull]").forEach(el => {
    el.onclick = () => pull(el.dataset.pull);
  });
  const callbet = root.querySelector("#callbet");
  if (callbet) callbet.onclick = () => {
    propose.reset();
    openProposeSheet(true);
  };

  const kick = root.querySelector("#kickoff");
  if (kick) kick.onclick = () => state.admin ? kickOff() : goto("setup");

  const admin = root.querySelector("#adminlink");
  if (admin) admin.onclick = () => goto("setup");
  if (state.proposing) propose.wire(root);
}

/* --- pieces -------------------------------------------------------------- */

const tone = n => n > 0.001 ? "up" : n < -0.001 ? "down" : "";
const section = title => `<div class="sechead"><span>${esc(title)}</span><span class="rule"></span></div>`;

function sideButton(bet, side, blind) {
  const s = stake();
  const risk = side === "A" ? riskA(bet.p, s) : riskB(bet.p, s);
  const other = side === "A" ? riskB(bet.p, s) : riskA(bet.p, s);
  const mine = bet.picks.find(p => p.player_id === state.me)?.side;
  const label = side === "A" ? bet.side_a : bet.side_b;

  return `<button class="side" data-s="${side}" data-mine="${mine === side ? 1 : 0}"
            data-pick="${bet.id}" data-side="${side}">
    <div class="nm">${esc(label)}</div>
    <div class="rk num">risk ${money(risk)}</div>
    <div class="py num">pays ${(other / risk).toFixed(2)}×</div>
    ${blind ? "" : `<div class="takers">${takers(bet, side)
      .map(id => `<span class="chip">${esc(nameOf(id))}</span>`).join("")}</div>`}
  </button>`;
}

function openCard(bet) {
  const s = stake();
  const blind = isBlind(bet);
  const mine = bet.picks.find(p => p.player_id === state.me)?.side;
  const sittingOut = takers(bet, "OUT");
  const missing = awaiting(bet);
  const lockable = canLock(bet);
  const myWin = !blind && (mine === "A" || mine === "B") ? ifThisHits(bet, mine, s) : null;
  const canPull = !blind && bet.proposer_id === state.me && bet.picks.length <= 1;
  const inCount = takers(bet, "A").length + takers(bet, "B").length;

  return `<article class="card">
    <div class="grp">${esc(bet.category)}${badge(bet)}</div>
    <div class="q">${esc(bet.body)}</div>
    <div class="sides">${sideButton(bet, "A", blind)}${sideButton(bet, "B", blind)}</div>

    <div class="potrow">
      ${blind
        ? `<span><b>${inCount}</b> in${mine && mine !== "OUT"
            ? ` · you're on ${esc(mine === "A" ? bet.side_a : bet.side_b)}` : ""}</span>`
        : `<span>Pot <b class="num">${money(pot(bet, s))}</b>${
            myWin !== null ? ` · you'd win <b class="num">${money(myWin)}</b>` : ""}</span>`}
      <button class="linkish" data-pick="${bet.id}" data-side="OUT">${
        mine === "OUT" ? "sitting out" : "sit this one out"}</button>
    </div>

    ${(sittingOut.length || missing.length) ? `<div class="who">
      ${sittingOut.length ? `out: ${sittingOut.map(id => esc(nameOf(id))).join(", ")}. ` : ""}
      ${missing.length ? `no answer yet: ${missing.map(p => esc(p.name)).join(", ")}` : ""}
    </div>` : ""}

    ${blind ? `<div class="who">
      Sides stay hidden until kickoff. Change your mind as often as you like.
    </div>` : `
      <div class="rowbtns">
        <button class="btn wide" data-lock="${bet.id}" ${lockable ? "" : "disabled"}>
          ${lockable ? "Lock it — ball's about to be snapped"
            : `Needs someone on ${esc(takers(bet, "A").length ? bet.side_b : bet.side_a)}`}
        </button>
      </div>
      <div class="who">${lockable
        ? "Anyone who hasn't picked when this locks is marked out."
        : "A bet with everyone on one side pays nobody, so it can't lock."}${
        canPull ? ` <button class="linkish" data-pull="${bet.id}">pull this bet</button>` : ""}
      </div>`}
  </article>`;
}

function badge(bet) {
  if (bet.even_money) return ` <span class="edited">· even money</span>`;
  if (bet.odds_edited) return ` <span class="edited">· odds changed to ${Math.round(bet.p * 100)}%</span>`;
  return "";
}

function lockedCard(bet) {
  const names = side => takers(bet, side).map(id => esc(nameOf(id))).join(", ") || "—";
  return `<article class="card">
    <div class="grp">${esc(bet.category)}</div>
    <div class="q">${esc(bet.body)}</div>
    <div class="lineup">
      <span class="nmA">${esc(bet.side_a)}</span> — ${names("A")}<br>
      <span class="nmB">${esc(bet.side_b)}</span> — ${names("B")}
    </div>
    <div class="grades">
      <button class="gbtn" data-k="A" data-grade="${bet.id}" data-result="A">${esc(bet.side_a)} hit</button>
      <button class="gbtn" data-k="B" data-grade="${bet.id}" data-result="B">${esc(bet.side_b)} hit</button>
      <button class="gbtn" data-grade="${bet.id}" data-result="PUSH">Push</button>
      <button class="gbtn" data-grade="${bet.id}" data-result="VOID">Void</button>
    </div>
  </article>`;
}

function gradedCard(bet) {
  const nets = settle(bet, stake());
  const label = bet.result === "A" ? bet.side_a
              : bet.result === "B" ? bet.side_b
              : bet.result === "PUSH" ? "Push" : "Void";
  return `<article class="card">
    <div class="grp">${esc(bet.category)}</div>
    <div class="q" style="margin-bottom:6px">${esc(bet.body)}</div>
    <div class="result">Result: <b>${esc(label)}</b></div>
    <div class="splits">${Object.entries(nets).map(([id, net]) =>
      `<div class="split"><span>${esc(nameOf(id))}</span>
        <span class="num ${tone(net)}">${money(net)}</span></div>`).join("")}</div>
    <div class="rowbtns">
      <button class="btn sm" data-ungrade="${bet.id}">Graded wrong — undo</button>
    </div>
  </article>`;
}

function scoreboard(totals) {
  return `<table class="board num">
    <thead><tr><th>Player</th><th>In</th><th>W–L–P</th><th>Risked</th><th>Net</th></tr></thead>
    <tbody>${state.players.map(p => {
      const r = totals[p.id];
      return `<tr>
        <td class="${p.id === state.me ? "you" : ""}">${esc(p.name)}</td>
        <td>${r.bets}</td>
        <td>${r.wins}–${r.losses}–${r.pushes}</td>
        <td>${money(r.risked)}</td>
        <td class="${tone(r.net)}">${money(r.net)}</td>
      </tr>`;
    }).join("")}</tbody>
  </table>`;
}
