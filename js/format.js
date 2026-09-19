/* Presentation helpers. No state, no database, no DOM. */

export const money = n => (n < 0 ? "-$" : "$") + Math.abs(n).toFixed(2);

export const esc = s => String(s ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Catalog bets are written with {home} and {away} so they read as real team
   names once a game is loaded. */
export function withTeams(text, game) {
  if (!game) return String(text);
  return String(text)
    .replace(/\{home\}/g, game.home_team)
    .replace(/\{away\}/g, game.away_team);
}

export const matchup = game => game ? `${game.away_team} at ${game.home_team}` : "";

export function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx(), osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
  } catch (e) { /* audio is a nicety, never a failure */ }
}
