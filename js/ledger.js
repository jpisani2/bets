/* ===========================================================================
   Settling up: balances, rounding, and who hands what to whom.

   Two ledgers. The bets ledger is what happened; the payments ledger is cash
   that actually moved. Balance is one minus the other, which mirrors the
   `balances` view in schema.sql. Nothing is stored as a total, so paying
   someone changes what they owe and never touches their record.

   Everything is tracked to the cent. Rounding happens once, here, for display
   on the settle-up screen only.
   =========================================================================== */

import { rollUp } from "./scoring.js";

/* Positive means owed money, negative means owes it. */
export function balances(bets, players, payments, stake) {
  const totals = rollUp(bets, players, stake);
  const live = payments.filter(p => !p.voided_at);

  return players.map(player => {
    const net = totals[player.id]?.net ?? 0;
    const received = live.filter(p => p.payee_id === player.id)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const paid = live.filter(p => p.payer_id === player.id)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    return { id: player.id, name: player.name, exact: net - received + paid };
  });
}

/* Round against yourself: whoever owes rounds up, whoever is owed rounds
   down. One sentence you can say out loud, and it never leaves a creditor
   waiting on change. */
export function roundAgainstYourself(rows) {
  return rows.map(row => ({
    ...row,
    whole: row.exact < 0 ? -Math.ceil(Math.abs(row.exact)) : Math.floor(row.exact),
  }));
}

/* Fewest handoffs that clear everyone: match the largest debt to the largest
   credit, repeat. Because debtors round up and creditors round down, a little
   more is handed over than is claimed — that surplus lands on the last
   creditor in the chain, which is what "leftovers land where the transfers
   fall" means in practice. */
export function suggestTransfers(rows) {
  const debtors = rows.filter(r => r.whole < 0)
    .map(r => ({ ...r, left: -r.whole })).sort((a, b) => b.left - a.left);
  const creditors = rows.filter(r => r.whole > 0)
    .map(r => ({ ...r, left: r.whole })).sort((a, b) => b.left - a.left);

  const transfers = [];
  let ci = 0;

  for (const debtor of debtors) {
    while (debtor.left > 0) {
      if (ci >= creditors.length) {
        // Everyone is square but this debtor still rounded up. The surplus
        // goes to whoever was owed most.
        const top = creditors[creditors.length - 1];
        if (top) {
          const last = transfers.find(t => t.from === debtor.id && t.to === top.id);
          if (last) last.amount += debtor.left;
          else transfers.push({ from: debtor.id, fromName: debtor.name,
                                to: top.id, toName: top.name, amount: debtor.left });
        }
        debtor.left = 0;
        break;
      }
      const creditor = creditors[ci];
      const amount = Math.min(debtor.left, creditor.left);
      if (amount > 0) {
        transfers.push({ from: debtor.id, fromName: debtor.name,
                         to: creditor.id, toName: creditor.name, amount });
      }
      debtor.left -= amount;
      creditor.left -= amount;
      if (creditor.left === 0) ci += 1;
    }
  }

  return transfers;
}

/* Someone leaving early rounds their debt up to the next whole dollar. Then:
     1. skip anyone owed under a dollar
     2. everyone else gets $1, highest owed first if it won't stretch
     3. whatever is left pays down whoever is owed most, repeatedly — which
        levels the remaining balances rather than clearing one person
   The surplus from rounding stays with the creditors and the leaver zeroes. */
export function leaverPlan(leaver, rows) {
  const owed = Math.abs(Math.min(0, leaver.exact));
  let purse = Math.ceil(owed);

  const creditors = rows
    .filter(r => r.id !== leaver.id && r.exact >= 1)
    .map(r => ({ id: r.id, name: r.name, owed: r.exact, paid: 0 }))
    .sort((a, b) => b.owed - a.owed);

  if (!purse || !creditors.length) return { purse, payments: [], remaining: creditors };

  // Step 2 — a dollar each, biggest creditor first if it runs short.
  for (const c of creditors) {
    if (purse < 1) break;
    c.paid += 1;
    purse -= 1;
  }

  // Step 3 — keep paying whoever is currently owed most.
  while (purse >= 1) {
    creditors.sort((a, b) => (b.owed - b.paid) - (a.owed - a.paid));
    const top = creditors[0];
    const next = creditors[1];
    const gap = next ? (top.owed - top.paid) - (next.owed - next.paid) : (top.owed - top.paid);
    const give = Math.max(1, Math.min(purse, Math.floor(gap) || 1));
    top.paid += give;
    purse -= give;
    if (creditors.every(c => c.owed - c.paid <= 0)) break;
  }

  return {
    purse: Math.ceil(owed),
    payments: creditors.filter(c => c.paid > 0)
      .map(c => ({ to: c.id, toName: c.name, amount: c.paid })),
    remaining: creditors.map(c => ({ ...c, left: c.owed - c.paid })),
  };
}
