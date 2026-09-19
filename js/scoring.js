/* ===========================================================================
   The settlement math. Mirrors the SQL views in schema.sql exactly.

   If a number ever looks wrong, there are two places to check and they must
   agree: the `settlements` view in the database and this file. Nothing else
   in the app may compute a payout.
   =========================================================================== */

export const riskA = (p, stake) => 2 * stake * p;
export const riskB = (p, stake) => 2 * stake * (1 - p);

export const takers = (bet, side) =>
  bet.picks.filter(p => p.side === side).map(p => p.player_id);

export function pot(bet, stake) {
  return takers(bet, "A").length * riskA(bet.p, stake)
       + takers(bet, "B").length * riskB(bet.p, stake);
}

/* A bet needs action on both sides or it pays nobody. */
export const canLock = bet =>
  takers(bet, "A").length > 0 && takers(bet, "B").length > 0;

/* What each player nets on one graded bet. Winners split the whole pot in
   proportion to what they risked; losers lose their risk; pushes are zero.
   Sums to zero, which canLock guarantees. */
export function settle(bet, stake) {
  const out = {};
  const A = takers(bet, "A"), B = takers(bet, "B");

  if (bet.result === "PUSH" || bet.result === "VOID") {
    [...A, ...B].forEach(id => { out[id] = 0; });
    return out;
  }

  const rA = riskA(bet.p, stake), rB = riskB(bet.p, stake);
  const total = A.length * rA + B.length * rB;
  const winners = bet.result === "A" ? A : B;
  const share = winners.length ? total / winners.length : 0;

  A.forEach(id => { out[id] = bet.result === "A" ? share - rA : -rA; });
  B.forEach(id => { out[id] = bet.result === "B" ? share - rB : -rB; });
  return out;
}

/* What one player would net if a side hits, given who is currently in. */
export function ifThisHits(bet, side, stake) {
  const list = takers(bet, side);
  if (!list.length) return null;
  const risk = side === "A" ? riskA(bet.p, stake) : riskB(bet.p, stake);
  return pot(bet, stake) / list.length - risk;
}

/* Per-player totals across a set of graded bets. */
export function rollUp(bets, players, stake) {
  const rows = {};
  players.forEach(p => {
    rows[p.id] = { net: 0, risked: 0, wins: 0, losses: 0, pushes: 0, bets: 0 };
  });

  bets.filter(b => b.status === "graded").forEach(bet => {
    const nets = settle(bet, stake);
    Object.entries(nets).forEach(([id, net]) => {
      const row = rows[id];
      if (!row) return;
      const side = bet.picks.find(p => p.player_id === id)?.side;
      row.net += net;
      row.bets += 1;
      row.risked += side === "A" ? riskA(bet.p, stake) : riskB(bet.p, stake);
      if (bet.result === "PUSH" || bet.result === "VOID") row.pushes += 1;
      else if (bet.result === side) row.wins += 1;
      else row.losses += 1;
    });
  });

  return rows;
}

/* Silent on the last N decided bets in a row. Only player-made picks count:
   an auto-out is the system's doing, so a quiet player is never revived by
   the mechanism that noticed they were quiet. */
export function isDormant(playerId, bets, after) {
  const decided = bets
    .filter(b => b.status !== "open")
    .sort((x, y) => new Date(y.created_at) - new Date(x.created_at))
    .slice(0, after);
  if (decided.length < after) return false;
  return decided.every(b =>
    !b.picks.some(p => p.player_id === playerId && !p.auto));
}
