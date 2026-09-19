/* ===========================================================================
   The pregame board.

   Eleven bets derived from two numbers: the spread and the total. Only the
   first three are principled — a spread and a total are 50/50 by definition,
   and a coin toss is a coin toss. The moneyline conversion is standard. The
   remaining seven are rules of thumb, not fitted to data. They exist to save
   typing, and the override slider on the setup screen is the real answer.
   =========================================================================== */

const clamp = x => Math.min(0.95, Math.max(0.05, x));

/* Logistic approximation of the normal CDF. Good to about half a percent
   across the range a football spread ever reaches. */
const ncdf = z => 0.5 * (1 + Math.tanh(0.79788 * z * (1 + 0.044715 * z * z)));

export const TEMPLATES = [
  { key: "spread", body: "{fav} covers the spread",
    a: "{fav} covers", b: "{dog} covers",
    derive: () => 0.5, note: "50/50 by definition — that's what the line is for" },

  { key: "total", body: "Total points over or under {total}",
    a: "Over", b: "Under",
    derive: () => 0.5, note: "also 50/50 by definition" },

  { key: "ball", body: "Which team gets the ball first",
    a: "{away}", b: "{home}",
    derive: () => 0.5, note: "coin toss — 50/50 whatever the line says" },

  { key: "moneyline", body: "{fav} wins outright",
    a: "Yes", b: "No",
    derive: s => clamp(ncdf(s / 13.5)), note: "derived from the spread" },

  { key: "firstscore", body: "First team to score",
    a: "{fav}", b: "{dog}",
    derive: s => clamp(0.5 + s * 0.012), note: "favorite's edge grows with the spread" },

  { key: "quick", body: "First score comes inside the first six minutes",
    a: "Yes", b: "No",
    derive: (s, t) => clamp(0.42 + (t - 44) * 0.008), note: "rises with the total" },

  { key: "firsttd", body: "First score is a touchdown",
    a: "TD", b: "Field goal or safety",
    derive: (s, t) => clamp(0.56 + (t - 44) * 0.006), note: "rises with the total" },

  { key: "bothq1", body: "Both teams score in the first quarter",
    a: "Yes", b: "No",
    derive: (s, t) => clamp(0.28 + (t - 44) * 0.010), note: "rises with the total" },

  { key: "thirty", body: "Either team reaches 30 points",
    a: "Yes", b: "No",
    derive: (s, t) => clamp(0.42 + (t - 44) * 0.022), note: "mostly the total" },

  { key: "overtime", body: "Game goes to overtime",
    a: "Yes", b: "No",
    derive: s => clamp(0.06 + Math.max(0, 3 - s) * 0.012),
    note: "only meaningful on a short spread" },

  { key: "margin", body: "Final margin over or under 7",
    a: "Over 7", b: "Under 7",
    derive: s => clamp(0.45 + s * 0.008), note: "widens with the spread" },
];

/* A game here is the setup form's draft, not necessarily a saved row. */
function resolve(text, game) {
  const fav = game.favorite === "home" ? game.home_team : game.away_team;
  const dog = game.favorite === "home" ? game.away_team : game.home_team;
  return String(text)
    .replace(/\{fav\}/g, fav)
    .replace(/\{dog\}/g, dog)
    .replace(/\{home\}/g, game.home_team)
    .replace(/\{away\}/g, game.away_team)
    .replace(/\{total\}/g, game.total);
}

/* Every row the board will post, with derived odds and any override applied. */
export function buildBoard(game, overrides = {}) {
  const spread = Number(game.spread) || 0;
  const total = Number(game.total) || 44;

  return TEMPLATES.map(t => {
    const derived = Math.round(t.derive(spread, total) * 100);
    const pct = overrides[t.key] ?? derived;
    return {
      key: t.key,
      body: resolve(t.body, game),
      side_a: resolve(t.a, game),
      side_b: resolve(t.b, game),
      derived,
      pct,
      changed: pct !== derived,
      note: t.note,
    };
  });
}

/* The shape the bets table wants. */
export const toBetRows = (board, gameId) => board.map(row => ({
  game_id: gameId,
  category: "Pregame",
  is_pregame: true,
  body: row.body,
  side_a: row.side_a,
  side_b: row.side_b,
  p: row.pct / 100,
  odds_edited: row.changed,
  even_money: false,
  status: "open",
}));
