/* The midweek screen: no game running.

   Ordered so that whatever you can act on beats whatever is merely
   interesting. Owing someone six dollars sits above your win rate. */

import { state, goto, loadHistory } from "../store.js";
import { esc, money, matchup } from "../format.js";
import { rollUp } from "../scoring.js";
import { balances } from "../ledger.js";
import * as setup from "./setup.js";
import * as settle from "./settle.js";
import * as stats from "./stats.js";
import * as roster from "./roster.js";

export function view() {
  if (!state.history.loaded) return `<div class="center"><p>Catching up…</p></div>`;

  const { games, bets, payments } = state.history;
  const last = games.find(g => g.phase === "closed");
  const owed = outstanding();
  const mine = owed.find(r => r.id === state.me);

  return `<div class="page">
    <header class="head">
      <div>
        <h1 class="cond">Nothing on today</h1>
        <div class="sub">${games.length
          ? `${games.length} game${games.length === 1 ? "" : "s"} played so far`
          : "No games played yet"}</div>
      </div>
      <div class="rangebar">
        <button class="btn sm" id="toroster">Roster</button>
        <button class="btn sm" id="admin">Set up a game</button>
      </div>
    </header>

    ${state.error ? `<div class="err">${esc(state.error)}</div>` : ""}

    ${owed.length ? `
      <div class="sechead"><span>Still to settle</span><span class="rule"></span></div>
      ${mine && Math.abs(mine.exact) > 0.005 ? `<div class="banner">
        ${mine.exact < 0
          ? `You owe ${money(Math.abs(mine.exact))}`
          : `You're owed ${money(mine.exact)}`}
      </div>` : ""}
      <table class="board num">
        <tbody>${owed.map(r => `<tr>
          <td class="${r.id === state.me ? "you" : ""}">${esc(r.name)}</td>
          <td class="${r.exact > 0 ? "up" : "down"}">${money(r.exact)}</td>
        </tr>`).join("")}</tbody>
      </table>
      <div class="rowbtns"><button class="btn primary" id="tosettle">Settle up</button></div>
    ` : `<div class="sechead"><span>Everyone is square</span><span class="rule"></span></div>`}

    ${last ? lastGame(last, bets) : ""}

    <div class="sechead"><span>This season</span><span class="rule"></span></div>
    ${seasonTable(games, bets)}
    <div class="rowbtns"><button class="btn" id="tostats">Full stats</button></div>
  </div>`;
}

function outstanding() {
  const { games, bets, payments } = state.history;
  const running = new Map();

  games.forEach(g => {
    const mine = bets.filter(b => b.game_id === g.id);
    balances(mine, state.players, [], Number(g.base_stake)).forEach(row => {
      running.set(row.id, (running.get(row.id) ?? 0) + row.exact);
    });
  });

  const live = payments.filter(p => !p.voided_at);
  return state.players.map(p => {
    const received = live.filter(x => x.payee_id === p.id)
      .reduce((s, x) => s + Number(x.amount), 0);
    const paid = live.filter(x => x.payer_id === p.id)
      .reduce((s, x) => s + Number(x.amount), 0);
    return { id: p.id, name: p.name, exact: (running.get(p.id) ?? 0) - received + paid };
  }).filter(r => Math.abs(r.exact) > 0.005)
    .sort((a, b) => b.exact - a.exact);
}

function lastGame(game, bets) {
  const stake = Number(game.base_stake);
  const mine = bets.filter(b => b.game_id === game.id);
  const totals = rollUp(mine, state.players, stake);
  const ranked = state.players
    .filter(p => totals[p.id].bets > 0)
    .sort((a, b) => totals[b.id].net - totals[a.id].net);
  if (!ranked.length) return "";

  return `<div class="sechead"><span>Last time out — ${esc(matchup({
    home_team: game.home_team, away_team: game.away_team }))}</span><span class="rule"></span></div>
    <table class="board num">
      <thead><tr><th>Player</th><th>Bets</th><th>W–L</th><th>Net</th></tr></thead>
      <tbody>${ranked.map(p => {
        const r = totals[p.id];
        return `<tr>
          <td class="${p.id === state.me ? "you" : ""}">${esc(p.name)}</td>
          <td>${r.bets}</td><td>${r.wins}–${r.losses}</td>
          <td class="${r.net > 0.005 ? "up" : r.net < -0.005 ? "down" : ""}">${money(r.net)}</td>
        </tr>`;
      }).join("")}</tbody>
    </table>`;
}

function seasonTable(games, bets) {
  const now = new Date();
  const season = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const inSeason = games.filter(g => {
    const d = new Date(g.kickoff_date + "T00:00:00");
    return (d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1) === season;
  });
  if (!inSeason.length) return `<div class="empty">Nothing this season yet.</div>`;

  const running = {};
  state.players.forEach(p => { running[p.id] = { net: 0, wins: 0, losses: 0, games: 0 }; });

  inSeason.forEach(g => {
    const rolled = rollUp(bets.filter(b => b.game_id === g.id), state.players,
                          Number(g.base_stake));
    Object.entries(rolled).forEach(([id, r]) => {
      running[id].net += r.net;
      running[id].wins += r.wins;
      running[id].losses += r.losses;
      if (r.bets) running[id].games += 1;
    });
  });

  const ranked = state.players.filter(p => running[p.id].games > 0)
    .sort((a, b) => running[b.id].net - running[a.id].net);

  return `<table class="board num">
    <thead><tr><th>Player</th><th>Games</th><th>W–L</th><th>Net</th></tr></thead>
    <tbody>${ranked.map(p => {
      const r = running[p.id];
      return `<tr>
        <td class="${p.id === state.me ? "you" : ""}">${esc(p.name)}</td>
        <td>${r.games}</td><td>${r.wins}–${r.losses}</td>
        <td class="${r.net > 0.005 ? "up" : r.net < -0.005 ? "down" : ""}">${money(r.net)}</td>
      </tr>`;
    }).join("")}</tbody>
  </table>`;
}

export function wire(root) {
  if (!state.history.loaded) { loadHistory(); return; }

  root.querySelector("#admin").onclick = () => { setup.reset(); goto("setup"); };

  const toSettle = root.querySelector("#tosettle");
  if (toSettle) toSettle.onclick = () => { settle.reset(); goto("settle"); };

  const toStats = root.querySelector("#tostats");
  if (toStats) toStats.onclick = () => { stats.reset(); goto("stats"); };

  const toRoster = root.querySelector("#toroster");
  if (toRoster) toRoster.onclick = () => { roster.reset(); goto("roster"); };
}
