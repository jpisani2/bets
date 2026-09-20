/* ===========================================================================
   Every call to Supabase lives here. No screen may import the client or
   write a query. If data comes from the database, it comes through a named
   function in this file.
   =========================================================================== */

import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

export const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

export const configured = () =>
  Boolean(SUPABASE_KEY) && !SUPABASE_KEY.startsWith("PASTE_");

/* --- reads --------------------------------------------------------------- */

export async function fetchOpenGame() {
  const { data, error } = await client.from("games").select("*")
    .neq("phase", "closed")
    .order("kickoff_date", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function fetchPlayers() {
  const { data, error } = await client.from("players").select("*")
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

export async function fetchCatalog() {
  const { data, error } = await client.from("bet_catalog").select("*")
    .eq("retired", false).order("id");
  if (error) throw error;
  return (data ?? []).map(row => ({ ...row, p: Number(row.p) }));
}

export async function fetchBets(gameId) {
  if (!gameId) return [];
  const { data, error } = await client.from("bets")
    .select("*, picks(player_id, side, auto)")
    .eq("game_id", gameId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(b => ({ ...b, p: Number(b.p), picks: b.picks ?? [] }));
}

/* --- writes -------------------------------------------------------------- */

export async function verifyRoomPassword(pw) {
  const { data, error } = await client.rpc("check_room_password", { pw });
  if (error) throw error;
  return Boolean(data);
}

export async function createPlayer(name) {
  const { data, error } = await client.from("players")
    .insert({ name: name.trim() }).select().single();
  if (error) throw error;
  return data;
}

export async function rememberDevice(token, playerId) {
  const { error } = await client.from("devices").upsert({
    token, player_id: playerId, last_seen: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function markPresent(gameId, playerId) {
  if (!gameId) return;
  await client.from("attendance").upsert(
    { game_id: gameId, player_id: playerId },
    { onConflict: "game_id,player_id", ignoreDuplicates: true });
}

export async function createBet(bet, proposerId, side) {
  const { data, error } = await client.from("bets").insert(bet).select().single();
  if (error) throw error;
  const pick = await client.from("picks")
    .insert({ bet_id: data.id, player_id: proposerId, side });
  if (pick.error) throw pick.error;
  return data;
}

export async function savePick(betId, playerId, side) {
  const { error } = await client.from("picks").upsert(
    { bet_id: betId, player_id: playerId, side, auto: false,
      updated_at: new Date().toISOString() },
    { onConflict: "bet_id,player_id" });
  if (error) throw error;
}

/* Everyone still in the room who never answered is marked out, flagged auto
   so it does not count as activity for dormancy. */
export async function autoOut(betId, playerIds) {
  if (!playerIds.length) return;
  const { error } = await client.from("picks").insert(
    playerIds.map(id => ({ bet_id: betId, player_id: id, side: "OUT", auto: true })));
  if (error) throw error;
}

export async function lockBet(betId) {
  const { error } = await client.from("bets")
    .update({ status: "locked", locked_at: new Date().toISOString() })
    .eq("id", betId);
  if (error) throw error;
}

export async function gradeBet(betId, result) {
  const { error } = await client.from("bets")
    .update({ status: "graded", result, graded_at: new Date().toISOString() })
    .eq("id", betId);
  if (error) throw error;
}

export async function ungradeBet(betId) {
  const { error } = await client.from("bets")
    .update({ status: "locked", result: null, graded_at: null })
    .eq("id", betId);
  if (error) throw error;
}

export async function deleteBet(betId) {
  const { error } = await client.from("bets").delete().eq("id", betId);
  if (error) throw error;
}

export async function verifyAdminPin(pin) {
  const { data, error } = await client.rpc("check_admin_pin", { pin });
  if (error) throw error;
  return Boolean(data);
}

export async function createGame(fields) {
  const { data, error } = await client.from("games").insert(fields).select().single();
  if (error) throw error;
  return data;
}

export async function createBets(rows) {
  if (!rows.length) return;
  const { error } = await client.from("bets").insert(rows);
  if (error) throw error;
}

export async function setGamePhase(gameId, phase, stamp) {
  const patch = { phase };
  if (stamp) patch[stamp] = new Date().toISOString();
  const { error } = await client.from("games").update(patch).eq("id", gameId);
  if (error) throw error;
}

/* Kickoff: everything with action on both sides locks, everything one-sided
   voids. A bet nobody took the other side of never had a bet in it. */
export async function lockBets(ids) {
  if (!ids.length) return;
  const { error } = await client.from("bets")
    .update({ status: "locked", locked_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw error;
}

export async function voidBets(ids) {
  if (!ids.length) return;
  const { error } = await client.from("bets")
    .update({ status: "graded", result: "VOID", graded_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw error;
}

export async function deleteGame(gameId) {
  const { error } = await client.from("games").delete().eq("id", gameId);
  if (error) throw error;
}

/* --- history and money --------------------------------------------------- */

export async function fetchGames() {
  const { data, error } = await client.from("games").select("*")
    .order("kickoff_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/* Every bet ever, for the stats and balance screens. A season is a few
   hundred rows, so one fetch beats paging. */
export async function fetchAllBets() {
  const { data, error } = await client.from("bets")
    .select("*, picks(player_id, side, auto)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(b => ({ ...b, p: Number(b.p), picks: b.picks ?? [] }));
}

export async function fetchPayments() {
  const { data, error } = await client.from("payments").select("*")
    .order("paid_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createPayment(row) {
  const { error } = await client.from("payments").insert(row);
  if (error) throw error;
}

/* Voids stay visible in the log rather than disappearing. */
export async function voidPayment(id, byPlayerId) {
  const { error } = await client.from("payments")
    .update({ voided_at: new Date().toISOString(), voided_by: byPlayerId })
    .eq("id", id);
  if (error) throw error;
}

/* --- realtime ------------------------------------------------------------ */

/* Any change to bets or picks just refetches. At six players and ten bets
   that costs less than reconciling state by hand, and cannot drift. */
export function watchRoom(onChange, onStatus) {
  return client.channel("room")
    .on("postgres_changes", { event: "*", schema: "public", table: "bets" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "picks" }, onChange)
    .subscribe(status => onStatus(status === "SUBSCRIBED"));
}
