/* Lifetime stats.

   Every figure is computed from the picks themselves — no stored totals — so
   a corrected grade or a roster merge flows straight through, including back
   through past seasons. */

import { state, goto, loadHistory } from "../store.js";
import { esc, money } from "../format.js";
import { rollUp, settle, riskA, riskB } from "../scoring.js";

let range = "season";

export function reset() { range = "season"; }

/* Seasons run August through July, so a January playoff game belongs to the
   previous August. Matches the generated column in schema.sql. */
const seasonOf = dateStr => {
  const d = new Date(dateStr + "T00:00:00");
  return d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
};

const currentSeason = () => {
  const now = new Date();
  return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
};

const RANGES = [
  ["season", "This season"],
  ["month", "Last 30 days"],
  ["all", "All time"],
];

function inRange(game) {
  if (range === "all") return true;
  if (range === "season") return seasonOf(game.kickoff_date) === currentSeason();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  return new Date(game.kickoff_date + "T00:00:00") >= cutoff;
}

/* Bets carry no stake of their own — it lives on the game — so totals are
   accumulated game by game. */
function totals(games, bets) {
  const out = {};
  state.players.forEach(p => {
    out[p.id] = { net: 0, risked: 0, wins: 0, losses: 0, pushes: 0, bets: 0,
                  best: 0, worst: 0, games: new Set(), byCategory: {} };
  });

  games.forEach(game => {
    const stake = Number(game.base_stake);
    const mine = bets.filter(b => b.game_id === game.id && b.status === "graded");
    const rolled = rollUp(mine, state.players, stake);

    Object.entries(rolled).forEach(([id, row]) => {
      const t = out[id];
      t.net += row.net; t.risked += row.risked; t.bets += row.bets;
      t.wins += row.wins; t.losses += row.losses; t.pushes += row.pushes;
      if (row.bets) t.games.add(game.id);
    });

    mine.forEach(bet => {
      const nets = settle(bet, stake);
      Object.entries(nets).forEach(([id, net]) => {
        const t = out[id];
        if (!t) return;
        if (net > t.best) t.best = net;
        if (net < t.worst) t.worst = net;
        t.byCategory[bet.category] = (t.byCategory[bet.category] ?? 0) + net;
      });
    });
  });

  return out;
}

/* Streaks run in grade order, so a game-long prop called in the first quarter
   lands where it settled rather than where it started. */
function streaks(bets) {
  const out = {};
  state.players.forEach(p => { out[p.id] = { current: null, run: 0, longest: 0, kind: null }; });

  [...bets].filter(b => b.status === "graded" && b.graded_at)
    .sort((a, b) => new Date(a.graded_at) - new Date(b.graded_at))
    .forEach(bet => {
      if (bet.result === "PUSH" || bet.result === "VOID") return;
      bet.picks.forEach(pick => {
        if (pick.side === "OUT") return;
        const row = out[pick.player_id];
        if (!row) return;
        const kind = bet.result === pick.side ? "W" : "L";
        if (row.current === kind) row.run += 1;
        else { row.current = kind; row.run = 1; }
        if (row.run > row.longest) { row.longest = row.run; row.kind = kind; }
      });
    });

  return out;
}

export function view() {
  if (!state.history.loaded) return `<div class="center"><p>Adding it up…</p></div>`;

  const games = state.history.games.filter(inRange);
  const ids = new Set(games.map(g => g.id));
  const bets = state.history.bets.filter(b => ids.has(b.game_id));
  const t = totals(games, bets);
  const st = streaks(bets);
  const ranked = [...state.players].sort((a, b) => t[b.id].net - t[a.id].net);
  const categories = [...new Set(bets.filter(b => b.status === "graded").map(b => b.category))];

  return `<div class="page">
    <header class="head">
      <div>
        <h1 class="cond">Stats</h1>
        <div class="sub">${games.length} game${games.length === 1 ? "" : "s"} ·
          ${bets.filter(b => b.status === "graded").length} settled bets</div>
      </div>
      <div class="rangebar">
        ${RANGES.map(([k, label]) => `<button class="vbtn" data-range="${k}"
          data-on="${range === k ? 1 : 0}">${label}</button>`).join("")}
        <button class="btn sm" id="back">Back</button>
      </div>
    </header>

    ${games.length ? `
      <table class="board num">
        <thead><tr>
          <th></th><th>Player</th><th>Games</th><th>Bets</th><th>W–L–P</th>
          <th>Win rate</th><th>Risked</th><th>Best</th><th>Worst</th>
          <th>Streak</th><th>Net</th>
        </tr></thead>
        <tbody>${ranked.map((p, i) => {
          const r = t[p.id], s = st[p.id];
          const decided = r.wins + r.losses;
          return `<tr>
            <td class="rank">${i + 1}</td>
            <td class="${p.id === state.me ? "you" : ""}">${esc(p.name)}</td>
            <td>${r.games.size}</td>
            <td>${r.bets}</td>
            <td>${r.wins}–${r.losses}–${r.pushes}</td>
            <td>${decided ? Math.round((r.wins / decided) * 100) + "%" : "—"}</td>
            <td>${money(r.risked)}</td>
            <td class="up">${r.best > 0 ? money(r.best) : "—"}</td>
            <td class="down">${r.worst < 0 ? money(r.worst) : "—"}</td>
            <td>${s.current ? `<span class="streak s${s.current}">${s.current}${s.run}</span>` : "—"}</td>
            <td class="${tone(r.net)}">${money(r.net)}</td>
          </tr>`;
        }).join("")}</tbody>
      </table>

      <div class="sechead"><span>Who's good at what</span><span class="rule"></span></div>
      <table class="board num">
        <thead><tr><th>Category</th><th>Bets</th><th>Best</th><th>Worst</th></tr></thead>
        <tbody>${categories.map(c => {
          const scored = state.players
            .filter(p => t[p.id].byCategory[c] !== undefined)
            .map(p => ({ name: p.name, v: t[p.id].byCategory[c] }))
            .sort((a, b) => b.v - a.v);
          if (!scored.length) return "";
          const count = bets.filter(b => b.category === c && b.status === "graded").length;
          const top = scored[0], bottom = scored[scored.length - 1];
          return `<tr>
            <td>${esc(c)}</td><td>${count}</td>
            <td>${esc(top.name)} <span class="up">${money(top.v)}</span></td>
            <td>${esc(bottom.name)} <span class="down">${money(bottom.v)}</span></td>
          </tr>`;
        }).join("")}</tbody>
      </table>

      <div class="rowbtns" style="margin-top:22px">
        <button class="btn" id="csv">Export this range as CSV</button>
      </div>
    ` : `<div class="empty">No games in this range yet.</div>`}
  </div>`;
}

const tone = n => n > 0.005 ? "up" : n < -0.005 ? "down" : "";

/* One row per pick, which is the grain everything else is derived from — so
   the export can reproduce any figure on this screen. */
function csv(games, bets) {
  const nameOf = id => state.players.find(p => p.id === id)?.name ?? "";
  const gameOf = id => games.find(g => g.id === id);
  const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;

  const lines = [["date", "matchup", "category", "bet", "side_a", "side_b",
                  "probability", "stake", "player", "picked", "risk", "result", "net"]
                  .map(cell).join(",")];

  bets.filter(b => b.status === "graded").forEach(bet => {
    const game = gameOf(bet.game_id);
    if (!game) return;
    const stake = Number(game.base_stake);
    const nets = settle(bet, stake);
    bet.picks.forEach(pick => {
      const risk = pick.side === "A" ? riskA(bet.p, stake)
                 : pick.side === "B" ? riskB(bet.p, stake) : 0;
      lines.push([
        game.kickoff_date, `${game.away_team} at ${game.home_team}`,
        bet.category, bet.body, bet.side_a, bet.side_b,
        bet.p, stake, nameOf(pick.player_id), pick.side,
        risk.toFixed(2), bet.result, (nets[pick.player_id] ?? 0).toFixed(2),
      ].map(cell).join(","));
    });
  });

  return lines.join("\n");
}

export function wire(root) {
  if (!state.history.loaded) { loadHistory(); return; }

  root.querySelector("#back").onclick = () => goto(state.game ? "room" : "idle");

  root.querySelectorAll("[data-range]").forEach(el => {
    el.onclick = () => { range = el.dataset.range; goto("stats"); };
  });

  const button = root.querySelector("#csv");
  if (button) button.onclick = () => {
    const games = state.history.games.filter(inRange);
    const ids = new Set(games.map(g => g.id));
    const text = csv(games, state.history.bets.filter(b => ids.has(b.game_id)));
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `bet-room-${range}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
}
