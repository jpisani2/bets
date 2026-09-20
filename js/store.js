/* ===========================================================================
   The single source of truth for what the app is currently showing, plus the
   only place a re-render is triggered. Screens read state and call actions;
   they never mutate state directly and never call render themselves.
   =========================================================================== */

import * as db from "./db.js";
import { DORMANT_AFTER } from "./config.js";
import { isDormant, canLock } from "./scoring.js";
import { beep } from "./format.js";

export const state = {
  screen: "loading",   // loading | unconfigured | join | seat | idle | room
                       //          | setup | closeout | settle | stats
  game: null,
  players: [],
  bets: [],
  catalog: [],
  me: null,
  live: false,
  error: "",
  notice: "",
  proposing: false,
  menu: false,
  admin: false,
  history: { games: [], bets: [], payments: [], loaded: false },
  roster: { flags: [], changes: [], loaded: false },
};

let onRender = () => {};
export const onChange = fn => { onRender = fn; };
export const render = () => onRender();

export function setError(message) {
  state.error = message ? String(message) : "";
  render();
}

export function notify(message, ms = 4000) {
  state.notice = message;
  render();
  setTimeout(() => {
    if (state.notice === message) { state.notice = ""; render(); }
  }, ms);
}

/* --- derived ------------------------------------------------------------- */

export const stake = () => Number(state.game?.base_stake ?? 1);
export const nameOf = id => state.players.find(p => p.id === id)?.name ?? "—";
export const betsBy = status => visibleBets().filter(b => b.status === status);

export const phase = () => state.game?.phase ?? "live";
export const isPregame = () => phase() === "pregame";

/* Before kickoff the room shows the pregame board and nothing else. */
export function visibleBets() {
  return isPregame() ? state.bets.filter(b => b.is_pregame) : state.bets;
}

/* Sides on a pregame bet stay hidden until kickoff. */
export const isBlind = bet => isPregame() && bet.is_pregame;

/* Players who still appear in other people's "waiting on" lines. */
export const presentPlayers = () =>
  state.players.filter(p => !isDormant(p.id, state.bets, DORMANT_AFTER));

export const awaiting = bet =>
  presentPlayers().filter(p => !bet.picks.some(x => x.player_id === p.id));

/* --- loading ------------------------------------------------------------- */

let loading = false;

export async function reload({ announce = false } = {}) {
  if (loading) return;
  loading = true;
  try {
    const openBefore = betsBy("open").length;
    const [game, players] = await Promise.all([db.fetchOpenGame(), db.fetchPlayers()]);
    state.game = game;
    state.players = players;
    state.bets = await db.fetchBets(game?.id);
    if (announce && betsBy("open").length > openBefore) beep();
    state.error = "";
    render();
  } catch (e) {
    setError(e.message || e);
  } finally {
    loading = false;
  }
}

export async function boot() {
  if (!db.configured()) { state.screen = "unconfigured"; return render(); }

  try {
    const [game, players, catalog] = await Promise.all([
      db.fetchOpenGame(), db.fetchPlayers(), db.fetchCatalog(),
    ]);
    state.game = game;
    state.players = players;
    state.catalog = catalog;
    state.bets = await db.fetchBets(game?.id);
  } catch (e) {
    state.screen = "unconfigured";
    return setError("Couldn't reach the database: " + (e.message || e));
  }

  state.admin = localStorage.getItem("betroom.admin") === "1";

  const saved = localStorage.getItem("betroom.player");
  const known = saved && state.players.some(p => p.id === saved);

  if (known) {
    state.me = saved;
    state.screen = state.game ? "room" : "idle";
    db.markPresent(state.game?.id, saved);
  } else {
    state.screen = localStorage.getItem("betroom.pw") ? "seat" : "join";
  }

  render();
  db.watchRoom(() => reload({ announce: true }), up => { state.live = up; render(); });

  // Backstop for a phone that suspended its socket.
  setInterval(() => reload({ announce: true }), 20000);
}

/* --- actions ------------------------------------------------------------- */

export async function submitPassword(pw) {
  try {
    if (!await db.verifyRoomPassword(pw)) return setError("That password doesn't match.");
    localStorage.setItem("betroom.pw", "1");
    state.error = "";
    state.screen = "seat";
    render();
  } catch (e) { setError(e.message || e); }
}

export async function takeSeat(playerId) {
  try {
    state.me = playerId;
    localStorage.setItem("betroom.player", playerId);

    let token = localStorage.getItem("betroom.device");
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem("betroom.device", token);
    }
    await db.rememberDevice(token, playerId);
    await db.markPresent(state.game?.id, playerId);

    state.screen = state.game ? "room" : "idle";
    render();
  } catch (e) { setError(e.message || e); }
}

export async function addPlayer(name) {
  try {
    const player = await db.createPlayer(name);
    await flagIfSimilar(player.id, name);
    state.players = await db.fetchPlayers();
    await takeSeat(player.id);
  } catch (e) { setError(e.message || e); }
}

export async function proposeBet(draft, side) {
  try {
    await db.createBet({ ...draft, game_id: state.game.id, proposer_id: state.me,
                         status: "open" }, state.me, side);
    state.proposing = false;
    await reload();
    notify("Bet posted — everyone picks a side");
  } catch (e) { setError(e.message || e); }
}

export async function pick(betId, side) {
  const bet = state.bets.find(b => b.id === betId);
  if (!bet || bet.status !== "open") return;
  try {
    await db.savePick(betId, state.me, side);
    await reload();
  } catch (e) { setError(e.message || e); }
}

export async function lock(betId) {
  const bet = state.bets.find(b => b.id === betId);
  if (!bet) return;
  try {
    await db.autoOut(betId, awaiting(bet).map(p => p.id));
    await db.lockBet(betId);
    await reload();
  } catch (e) { setError(e.message || e); }
}

export async function grade(betId, result) {
  try { await db.gradeBet(betId, result); await reload(); }
  catch (e) { setError(e.message || e); }
}

export async function ungrade(betId) {
  try { await db.ungradeBet(betId); await reload(); }
  catch (e) { setError(e.message || e); }
}

export async function pull(betId) {
  try { await db.deleteBet(betId); await reload(); }
  catch (e) { setError(e.message || e); }
}

/* --- admin --------------------------------------------------------------- */

export async function unlockAdmin(pin) {
  try {
    if (!await db.verifyAdminPin(pin)) return setError("That PIN doesn't match.");
    state.admin = true;
    state.error = "";
    localStorage.setItem("betroom.admin", "1");
    render();
  } catch (e) { setError(e.message || e); }
}

export function goto(screen) {
  state.screen = screen;
  state.error = "";
  render();
}

export async function createGameWithBoard(fields, betRows) {
  try {
    const game = await db.createGame({ ...fields, phase: "pregame" });
    await db.createBets(betRows.map(r => ({ ...r, game_id: game.id,
                                            proposer_id: state.me })));
    await reload();
    state.screen = "room";
    render();
    notify(`Pregame board is up — ${betRows.length} bets, pick before kickoff`);
  } catch (e) { setError(e.message || e); }
}

/* Kickoff closes the pregame board: both-sided bets lock, one-sided ones
   void, and in-game betting opens. */
export async function kickOff() {
  const open = state.bets.filter(b => b.is_pregame && b.status === "open");
  const lockable = open.filter(canLock);
  const dead = open.filter(b => !canLock(b));
  try {
    for (const bet of lockable) {
      await db.autoOut(bet.id, awaiting(bet).map(p => p.id));
    }
    await db.lockBets(lockable.map(b => b.id));
    await db.voidBets(dead.map(b => b.id));
    await db.setGamePhase(state.game.id, "live", "kicked_off_at");
    await reload();
    notify(`Kickoff — ${lockable.length} pregame bets locked` +
           (dead.length ? `, ${dead.length} voided with no action` : ""), 6000);
  } catch (e) { setError(e.message || e); }
}

/* Closing out the night. Bets still taking picks are voided without asking —
   nobody committed to them. Locked bets each need an answer first, which the
   close-out screen enforces before it calls this. */
/* --- history, money, stats ----------------------------------------------- */

export async function loadHistory() {
  try {
    const [games, bets, payments] = await Promise.all([
      db.fetchGames(), db.fetchAllBets(), db.fetchPayments(),
    ]);
    state.history = { games, bets, payments, loaded: true };
    render();
  } catch (e) { setError(e.message || e); }
}

export async function logPayment(payerId, payeeId, amount, note) {
  try {
    await db.createPayment({
      payer_id: payerId, payee_id: payeeId,
      amount: Number(amount), recorded_by: state.me, note: note || null,
    });
    await loadHistory();
    notify("Payment logged");
  } catch (e) { setError(e.message || e); }
}

export async function undoPayment(id) {
  try {
    await db.voidPayment(id, state.me);
    await loadHistory();
  } catch (e) { setError(e.message || e); }
}

/* --- roster -------------------------------------------------------------- */

export async function loadRoster() {
  try {
    const [flags, changes] = await Promise.all([db.fetchFlags(), db.fetchRosterChanges()]);
    state.roster = { flags, changes, loaded: true };
    render();
  } catch (e) { setError(e.message || e); }
}

/* Deliberately trigger-happy: a false flag costs the admin one tap, a missed
   one costs a split record nobody notices. */
export function looksLike(a, b) {
  const norm = s => s.toLowerCase().replace(/[^a-z]/g, "");
  const x = norm(a), y = norm(b);
  if (!x || !y) return null;
  if (x === y) return "same name";
  if (x.startsWith(y) || y.startsWith(x)) return "one name starts with the other";
  if (editDistance(x, y) <= 2) return "nearly identical spelling";
  const first = s => s.trim().split(/\s+/)[0].toLowerCase();
  if (first(a) === first(b)) return "same first name";
  return null;
}

function editDistance(a, b) {
  const grid = Array.from({ length: a.length + 1 },
    (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) grid[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      grid[i][j] = Math.min(grid[i - 1][j] + 1, grid[i][j - 1] + 1,
                            grid[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return grid[a.length][b.length];
}

async function flagIfSimilar(playerId, name) {
  const hit = state.players
    .filter(p => p.id !== playerId)
    .map(p => ({ p, why: looksLike(name, p.name) }))
    .find(x => x.why);
  if (hit) await db.raiseFlag(playerId, hit.p.id, hit.why);
}

export async function renamePlayer(id, name) {
  const clean = String(name).trim();
  if (!clean) return;
  try {
    await db.renamePlayer(id, clean);
    state.players = await db.fetchPlayers();
    await flagIfSimilar(id, clean);
    await loadRoster();
  } catch (e) { setError(e.message || e); }
}

export async function mergePlayers(source, target) {
  try {
    await db.mergePlayers(source, target);
    if (state.me === source) {
      state.me = target;
      localStorage.setItem("betroom.player", target);
    }
    state.players = await db.fetchPlayers();
    await Promise.all([reload(), loadHistory(), loadRoster()]);
    notify("Merged — every stat recalculated");
  } catch (e) { setError(e.message || e); }
}

export async function removePlayer(id) {
  try {
    await db.removePlayer(id);
    state.players = await db.fetchPlayers();
    await Promise.all([reload(), loadHistory(), loadRoster()]);
  } catch (e) { setError(e.message || e); }
}

export async function undoRosterChange(id) {
  try {
    await db.undoRosterChange(id);
    state.players = await db.fetchPlayers();
    await Promise.all([reload(), loadHistory(), loadRoster()]);
    notify("Put back");
  } catch (e) { setError(e.message || e); }
}

export async function clearFlag(id) {
  try { await db.clearFlag(id); await loadRoster(); }
  catch (e) { setError(e.message || e); }
}

export async function reassignPick(betId, fromId, toId) {
  try { await db.reassignPick(betId, fromId, toId); await reload(); }
  catch (e) { setError(e.message || e); }
}

export async function closeOutNight() {
  const stillOpen = state.bets.filter(b => b.status === "open");
  try {
    await db.voidBets(stillOpen.map(b => b.id));
    await db.setGamePhase(state.game.id, "closed", "closed_at");
    await reload();
    state.screen = "idle";
    render();
  } catch (e) { setError(e.message || e); }
}

export async function scrapGame() {
  try {
    await db.deleteGame(state.game.id);
    await reload();
    state.screen = "idle";
    render();
  } catch (e) { setError(e.message || e); }
}

export function openProposeSheet(open) {
  state.proposing = open;
  render();
}

export function openMenu(open) {
  state.menu = open;
  render();
}
