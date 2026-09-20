/* Settling up.

   The transfer list is a suggestion, never an instruction — somebody always
   has two twenties and no fives. The payments log is what's real, so the
   screen says so and puts logging a payment right underneath. */

import { state, goto, logPayment, undoPayment, loadHistory } from "../store.js";
import { esc, money } from "../format.js";
import { balances, roundAgainstYourself, suggestTransfers, leaverPlan } from "../ledger.js";

let form = { payer: "", payee: "", amount: "", note: "" };
let leaving = "";

export function reset() {
  form = { payer: state.me ?? "", payee: "", amount: "", note: "" };
  leaving = "";
}

/* One stake per game, so balances are computed game by game and summed. */
function allBalances() {
  const { games, bets, payments } = state.history;
  const perGame = new Map();

  games.forEach(g => {
    const mine = bets.filter(b => b.game_id === g.id);
    balances(mine, state.players, [], Number(g.base_stake)).forEach(row => {
      perGame.set(row.id, (perGame.get(row.id) ?? 0) + row.exact);
    });
  });

  const live = payments.filter(p => !p.voided_at);
  return state.players.map(p => {
    const received = live.filter(x => x.payee_id === p.id)
      .reduce((s, x) => s + Number(x.amount), 0);
    const paid = live.filter(x => x.payer_id === p.id)
      .reduce((s, x) => s + Number(x.amount), 0);
    return { id: p.id, name: p.name, exact: (perGame.get(p.id) ?? 0) - received + paid };
  });
}

export function view() {
  if (!state.history.loaded) return `<div class="center"><p>Working it out…</p></div>`;

  const rows = allBalances();
  const settled = rows.every(r => Math.abs(r.exact) < 0.005);
  const rounded = roundAgainstYourself(rows);
  const transfers = suggestTransfers(rounded);
  const leaver = leaving ? rows.find(r => r.id === leaving) : null;
  const plan = leaver ? leaverPlan(leaver, rows) : null;

  return `<div class="page">
    <header class="head">
      <div>
        <h1 class="cond">Settling up</h1>
        <div class="sub">Round against yourself: whoever owes rounds up,
          whoever is owed rounds down.</div>
      </div>
      <button class="btn sm" id="back">Back</button>
    </header>

    ${state.error ? `<div class="err">${esc(state.error)}</div>` : ""}

    ${settled ? `<div class="empty">Everyone is square.</div>` : `
      <div class="sechead"><span>${leaver ? "If they leave now" : "Fewest handoffs"}</span><span class="rule"></span></div>
      ${leaver ? leaverView(leaver, plan) : transfers.map(t => `
        <div class="transfer">
          <span class="tnames">${esc(t.fromName)} <span class="arrow">→</span> ${esc(t.toName)}</span>
          <span class="tamount cond num">$${t.amount}</span>
        </div>`).join("")}
      <div class="hint" style="margin-top:10px">
        Suggested — log what actually gets paid.
      </div>`}

    <div class="sechead"><span>Balances</span><span class="rule"></span></div>
    <table class="board num">
      <thead><tr><th>Player</th><th>Exact</th><th>Rounded</th><th></th></tr></thead>
      <tbody>${rounded.map(r => `<tr>
        <td class="${r.id === state.me ? "you" : ""}">${esc(r.name)}</td>
        <td class="${tone(r.exact)}">${money(r.exact)}</td>
        <td class="${tone(r.whole)}">${r.whole === 0 ? "—" : "$" + Math.abs(r.whole)}</td>
        <td>${r.exact < -0.005
          ? `<button class="linkish" data-leaving="${r.id}">${
              leaving === r.id ? "never mind" : "leaving early"}</button>`
          : ""}</td>
      </tr>`).join("")}</tbody>
    </table>

    <div class="sechead"><span>Log a payment</span><span class="rule"></span></div>
    <div class="payform">
      ${who("payer", "Who paid")}
      ${who("payee", "Who got it")}
      <div><label class="flabel">Amount</label>
        <input class="field num" id="amount" inputmode="decimal" value="${esc(form.amount)}"
               placeholder="0.00"></div>
      <div><label class="flabel">Note (optional)</label>
        <input class="field" id="note" value="${esc(form.note)}" placeholder=""></div>
    </div>
    <div class="rowbtns">
      <button class="btn primary" id="logpay" ${
        form.payer && form.payee && Number(form.amount) > 0 && form.payer !== form.payee
          ? "" : "disabled"}>Log it</button>
    </div>

    ${paymentLog()}
  </div>`;
}

function who(key, label) {
  return `<div><label class="flabel">${label}</label>
    <select class="field" id="${key}">
      <option value="">—</option>
      ${state.players.map(p => `<option value="${p.id}"
        ${form[key] === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}
    </select></div>`;
}

function leaverView(leaver, plan) {
  return `
    <div class="hint" style="margin-bottom:12px">
      ${esc(leaver.name)} owes ${money(Math.abs(leaver.exact))} and rounds up to
      <b>$${plan.purse}</b>. Everyone owed at least a dollar gets one, then the
      rest pays down whoever is owed most until it runs out.
    </div>
    ${plan.payments.map(p => `<div class="transfer">
      <span class="tnames">${esc(leaver.name)} <span class="arrow">→</span> ${esc(p.toName)}</span>
      <span class="tamount cond num">$${p.amount}</span>
    </div>`).join("")}
    <div class="hint" style="margin-top:10px">
      Leaves ${plan.remaining.filter(r => r.left > 0.005)
        .map(r => `${esc(r.name)} at ${money(r.left)}`).join(", ") || "everyone square"}.
      ${esc(leaver.name)} walks out at zero.
    </div>`;
}

function paymentLog() {
  const { payments } = state.history;
  if (!payments.length) return "";
  const nameOf = id => state.players.find(p => p.id === id)?.name ?? "—";

  return `<div class="sechead"><span>Payment log</span><span class="rule"></span></div>
    ${payments.slice(0, 30).map(p => `<div class="logrow ${p.voided_at ? "voided" : ""}">
      <div>
        <div class="logline">${esc(nameOf(p.payer_id))} → ${esc(nameOf(p.payee_id))}
          <b class="num">${money(Number(p.amount))}</b></div>
        <div class="lognote">${new Date(p.paid_at).toLocaleDateString()} ·
          recorded by ${esc(nameOf(p.recorded_by))}${p.note ? " · " + esc(p.note) : ""}${
          p.voided_at ? ` · <span class="down">voided by ${esc(nameOf(p.voided_by))}</span>` : ""}</div>
      </div>
      ${p.voided_at ? "" : `<button class="btn sm" data-void="${p.id}">Void</button>`}
    </div>`).join("")}`;
}

const tone = n => n > 0.005 ? "up" : n < -0.005 ? "down" : "";

export function wire(root) {
  const $ = sel => root.querySelector(sel);
  const redraw = () => goto("settle");

  if (!state.history.loaded) { loadHistory(); return; }

  $("#back").onclick = () => goto(state.game ? "room" : "idle");

  root.querySelectorAll("[data-leaving]").forEach(el => {
    el.onclick = () => {
      leaving = leaving === el.dataset.leaving ? "" : el.dataset.leaving;
      redraw();
    };
  });

  ["payer", "payee"].forEach(key => {
    const el = $(`#${key}`);
    el.onchange = () => { form[key] = el.value; redraw(); };
  });
  $("#amount").oninput = () => { form.amount = $("#amount").value; };
  $("#amount").onblur = redraw;
  $("#note").oninput = () => { form.note = $("#note").value; };

  $("#logpay").onclick = () => {
    logPayment(form.payer, form.payee, form.amount, form.note);
    form = { payer: state.me ?? "", payee: "", amount: "", note: "" };
  };

  root.querySelectorAll("[data-void]").forEach(el => {
    el.onclick = () => undoPayment(el.dataset.void);
  });
}
