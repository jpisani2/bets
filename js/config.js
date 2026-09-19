/* The only file you edit to point the app at your database. */

export const SUPABASE_URL = "https://mzvjmeczhvujdyfmibpd.supabase.co";
export const SUPABASE_KEY = "PASTE_YOUR_PUBLISHABLE_KEY_HERE";

/* How many silent bets in a row before someone drops off other people's
   screens. See the spec: only player-made picks count, never an auto-out. */
export const DORMANT_AFTER = 5;

/* Most bets that can be open at once. */
export const MAX_OPEN_BETS = 10;
