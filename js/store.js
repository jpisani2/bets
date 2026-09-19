/* ===========================================================================
   The single source of truth for what the app is currently showing, plus the
   only place a re-render is triggered. Screens read state and call actions;
   they never mutate state directly and never call render themselves.
   =========================================================================== */

import * as db from "./db.js";
import { DORMANT_AFTER } from "./config.js";
import { isDormant } from "./scoring.js";
import { beep } from "./format.js";

export const state = {
  screen: "loading",   // loading | unconfigured | join | seat | nogame | room
  game: null,
  players: [],
  bets: [],
  catalog: [],
  me: null,
  live: false,
  error: "",
  notice: "",
  proposing: false,
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
export const betsBy = status => state.bets.filter(b => b.status === status);

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

  const saved = localStorage.getItem("betroom.player");
  const known = saved && state.players.some(p => p.id === saved);

  if (known) {
    state.me = saved;
    state.screen = state.game ? "room" : "nogame";
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

    state.screen = state.game ? "room" : "nogame";
    render();
  } catch (e) { setError(e.message || e); }
}

export async function addPlayer(name) {
  try {
    const player = await db.createPlayer(name);
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

export function openProposeSheet(open) {
  state.proposing = open;
  render();
}
