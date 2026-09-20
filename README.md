# Bet Room — how the code is arranged

Plain ES modules, loaded natively by the browser. No build step, no npm, no
bundler. Edit a file, commit it, it's live. That is the point: this has to be
fixable from a phone at halftime, and still work in two years without anyone
updating a dependency.

## The four rules

Everything follows these. If a change would break one, the change is wrong.

**1. Only `db.js` talks to Supabase.**
No screen imports the client or writes a query. If data comes from the
database, it arrives through a named function in that file. This is why the
whole app can be repointed at a different backend by editing one file, and why
you never have to hunt for where a write happens.

**2. Only `scoring.js` and `ledger.js` compute money.**
`scoring.js` settles bets; `ledger.js` turns those settlements plus the
payment log into balances and transfers. Both mirror views in `schema.sql`.
When a number looks wrong there are a known few places to check, and they must
agree with the database. No screen works out a payout on its own.

**3. Only `store.js` changes state, and only it triggers a render.**
Screens read from `state` and call actions. They never mutate it and never
call `render()`. One path in, one path out, so there is no question about what
caused a redraw.

**4. Each screen is one file that knows nothing about the others.**
A screen exports `view()` returning HTML and `wire(root)` attaching handlers.
It does not know what screen came before or comes next — `app.js` decides that.
New screens get added without touching existing ones.

## The files

```
index.html          Shell. Loads the stylesheet, Supabase, and app.js.
styles.css          All styling. Semantic colors documented at the top.
js/
  config.js         The only file you edit to deploy: URL, key, two tunables.
  format.js         Display helpers. No state, no database, no DOM.
  scoring.js        Settlement math. Mirrors the SQL views.
  pregame.js        The eleven pregame bets and how they derive from the line.
  ledger.js         Balances, rounding, and who hands what to whom.
  db.js             Every Supabase call.
  store.js          State, derived values, actions, realtime wiring.
  app.js            Picks a screen, renders it, wires it. Nothing else.
  screens/
    join.js         Room password.
    seat.js         Claim a seat from the roster.
    room.js         The live board and scoreboard.
    propose.js      The call-a-bet sheet.
    setup.js        Admin: create a game, tune the board, open it.
    closeout.js     Admin: end the night, grade the stragglers, delete a game.
    settle.js       Balances, suggested transfers, the payment log.
    stats.js        Range filters, streaks, categories, CSV export.
    idle.js         Midweek: what you owe, last game, season table.
```

## Two things that look odd but aren't

**The whole screen re-renders on every change.** Not because it's clever, but
because at six players and ten bets it costs nothing, and incremental DOM
updates are where realtime bugs hide. The propose sheet restores focus and
cursor position by hand after a redraw — that's the one place the cost shows.

**Realtime just refetches.** Any change to `bets` or `picks` triggers a full
reload of the game's bets rather than applying a diff. Reconciling state by
hand is how two phones end up disagreeing. Refetching cannot drift.

## Where the constraints come from

`picks.auto` marks a row the system created rather than a player. Without it, a
silent player would be revived by the auto-out that noticed they were silent,
and dormancy could never trigger at all.

Inputs are `font-size: 16px` because iOS zooms the page when a smaller input
takes focus.

The four semantic colors — `--a`, `--b`, `--up`, `--down` — carry meaning and
must not be reused for decoration. Team themes will recolor everything around
them and leave those four alone, or a green number stops telling you whether
it means a side or a win.
