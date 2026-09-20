/* Themes are per device, kept in that browser's storage and never in the
   database — so a phone in a dark room and a laptop under lights disagree
   naturally, which is the point. */

export const THEMES = [
  { id: "dark",           name: "Dark",            note: "the default, built for a dim room" },
  { id: "light",          name: "Light",           note: "for daylight" },
  { id: "lions-dark",     name: "Lions",           note: "Honolulu blue on near-black" },
  { id: "lions-light",    name: "Lions light",     note: "Honolulu blue and silver" },
  { id: "michigan",       name: "Michigan",        note: "maize on navy" },
  { id: "michigan-state", name: "Michigan State",  note: "Spartan green on white" },
];

const KEY = "betroom.theme";

export const current = () => localStorage.getItem(KEY) || "dark";

export function apply(id) {
  const chosen = THEMES.some(t => t.id === id) ? id : "dark";
  document.documentElement.dataset.theme = chosen;
  try { localStorage.setItem(KEY, chosen); } catch (e) { /* private mode */ }
}

export const restore = () => apply(current());
