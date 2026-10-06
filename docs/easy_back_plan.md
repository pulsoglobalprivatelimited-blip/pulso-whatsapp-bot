# Plan: going back is always easy in the WhatsApp console

Written 7 October 2026. Your words: "Going back from each page is difficult
in this. Make going back always easy."

For whatsapp.pulso.co.in/admin, on phones and on the installed home-screen
app.

## Why it is hard today

- **The phone's back does not work.** A chat, a provider's details, a
  booking, a photo, the call sheet and the filter sheet all open on top of the
  list without telling the phone a new page opened. So the Android back
  button or back swipe leaves the whole console, or closes the installed app,
  instead of closing what is open. On iPhone the installed app has no
  browser bar at all, so back does nothing.
- **The only way out is a small button.** "Back" or "Back to list" is a small
  text button in the header. It sits in a different place on each page, and
  on some pages it scrolls away.
- **Tabs do not count as pages either.** Switching Provider → Agency does not
  make a step the phone can go back from.
- **A refresh loses your place.** The open chat is not in the address, so a
  reload drops you on the list.

## What changes

One rule for the whole console: **a round back arrow sits at the top left
of every page, and it, the phone's back, and a swipe from the left edge all
do the same thing.** (Founder, 7 Oct: "a round shape with an arrow at the top
left near Provider".)

1. **Phone back closes one layer at a time.** Back on a photo closes the
   photo. Back on a chat returns to the list. Back on the list with nothing
   open goes to the previous tab, then out of the console, as any app would.
   Never out of the console while something is open.
2. **One round back arrow, top left, on every page.** A 40-px round button
   with a left arrow, in the top bar:
   - On the main desk it sits just left of the **Provider** tab, so the bar
     reads `(←) Provider 21 · Agency 10 · Customer · Supply`.
   - On the inbox, booking chats, provider support, bookings and admins
     pages it sits at the top left of their own header, the same size and
     colour, so the hand always finds it in the same spot.
   - It stays fixed at the top while the page scrolls, and never hides.
   - It replaces the small "Back" / "Back to list" text buttons.

   **What one tap does, in this order:** closes whatever is open on top (a
   photo, the call sheet, a filter sheet, a chat, a provider's details) →
   if nothing is open, goes to the previous tab → if there is no previous
   tab, goes to the previous page (inbox → desk) → when there is nowhere to
   go, the arrow is greyed out. The phone's back and the edge swipe follow
   the same order.
3. **Swipe from the left edge to go back,** on both phones, the way WhatsApp
   itself works. The installed iPhone app has no such gesture of its own, so
   the console provides it.
4. **Tabs are steps.** Switching Provider → Agency → Customer makes steps, so
   back walks them in reverse.
5. **The address keeps your place.** Which tab and which chat are open are in
   the address, so a refresh or reopening the app lands on the same chat, and
   back from there still works.
6. **Keyboard on a laptop.** Escape closes the top layer, like the arrow.

## What does not change

Every list, chat, action, button and word. The bot, WhatsApp messages,
Pulso app, Firebase. Nothing new is stored.

## Build

1. One small shared piece of code, the "back stack", used by every page:
   open a layer → register it; phone back / arrow / edge swipe / Escape →
   close the top layer. Pages: inbox, booking inbox, providers dashboard,
   booking dashboard, provider support, admins.
2. Replace the "Back" / "Back to list" buttons with the arrow, fixed at the
   top.
3. Tabs and the open chat go into the address; opening from the address on
   load.
4. Tests for the back stack (open two layers, back closes one, then the
   other, then nothing; the arrow and back do the same; the address round
   trip).
5. Check on the Xiaomi and the iPhone, in the browser and as the installed
   app: chat → photo → back → back → list; tab → tab → back; refresh on a
   chat.
6. Push to the bot repo; Render deploys itself in a few minutes.

About half a day.

---

## For the developer

- Repo `~/Documents/pulso-whatsapp-bot`, pages in `src/public/admin/*.html`,
  scripts in `src/public/assets/`. Layers open by `classList` toggles with no
  `history.pushState` anywhere (`grep pushState` finds only
  `admin-sides.js:147`, which is a `replaceState` for the tab).
- Back stack: `src/public/assets/back-stack.js`, loaded by every admin page
  after `desk-shell.js`. API: `BackStack.push(name, close)` on open,
  `BackStack.pop()` from the arrow; `popstate` → run the top `close`; a
  `close` called directly (code path that hides a layer) must call
  `BackStack.drop(name)` so the history stays in step. Guard against double
  entries on re-open of the same layer.
- Hook points: inbox `selectChat` / `closeThread` (`inbox.js` ~391/430);
  booking inbox thread (`booking-inbox.js` ~728/765), photo viewer
  (~332/347), call sheet (~437/455); providers `renderDetail` /
  `back-to-list-button` (`dashboard.js` ~1596, 88); booking dashboard
  (`booking-dashboard.js` ~1191, 1369); provider support
  `back-to-list-button`; `desk-shell.js` sheet/menu `closeSheet` /
  `setOpen(false)` (Escape handlers at 90 / 121 move into the stack);
  `admin-sides.js` `replaceState` → `pushState` for a side change (keep
  `replaceState` on first load).
- Address: `?side=agency&chat=%2B91…` (inbox) / `&phone=` (providers); read
  on load after the list fetch, open the matching item.
- Arrow: a `desk-back` button rendered by `desk-shell.js` into every page's
  top bar on load (so one piece of markup serves all pages): `index.html`
  inserts it as the first child of `#side-switch` (the hero `.side-switch`
  row, before the `provider` tab); the other pages insert it at the start of
  their header. Style in `dashboard.css` / `inbox.css`: 40×40, `border-radius:
  50%`, teal `#008069` on white (the console's own colour), SVG left arrow,
  `position: sticky; top: 0` with safe-area padding for the notch;
  `[aria-disabled=true]` greys it when `BackStack` is empty and there is no
  previous tab/page. Tap → `BackStack.pop()`; fallback `history.back()` when
  the stack is empty but `history.length > 1`; otherwise `location.href =
  '/admin'` for sub-pages and disabled on the desk root.
- Edge swipe: `touchstart` within 24 px of the left edge, `touchend` ≥ 80 px
  right and mostly horizontal → `BackStack.pop()`; ignore while a horizontal
  scroller is under the finger.
- Tests: `test/back-stack.test.js` with a tiny fake `window.history` /
  `popstate` dispatcher under `node --test`.
