/* Going back, for the whole console.

   A chat, a provider's details, a photo, the call sheet and the filter sheet
   all used to open on top of the list without telling the phone a new page
   had opened. So the Android back button left the console, the installed
   iPhone app had no back at all, and the only way out was a small "Back to
   list" button that sat somewhere different on every page.

   One rule now (docs/easy_back_plan.md, founder, 7 Oct 2026): every layer
   that opens registers here and gets a history entry; the phone's back, the
   round arrow at the top left, a swipe from the left edge and the Escape key
   all close the top layer, then walk back through the tabs, then leave the
   page. The address carries the open tab and chat, so a refresh lands where
   you were.

   Browser: window.PulsoBack. Node (tests): module.exports.createBackStack. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.PulsoBack = api.createBackStack(root);
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const KEY = 'pulsoBack';
  const DESK_ROOTS = ['/admin', '/admin/kerala', '/admin/karnataka'];

  function createBackStack(global) {
    const history = global.history;
    const location = global.location;
    const doc = global.document || null;
    const stack = []; // { name, close, closed }
    const root = { canBack: null, onPop: null, fallbackHref: undefined };
    let button = null;

    function live() {
      return stack.filter((entry) => !entry.closed).length;
    }

    function baseState() {
      const state = history.state && typeof history.state === 'object' ? history.state : {};
      const out = {};
      Object.keys(state).forEach((key) => {
        if (key !== KEY && key !== 'depth') out[key] = state[key];
      });
      return out;
    }

    function defaultFallback() {
      if (!location) return undefined;
      const path = String(location.pathname || '').replace(/\/+$/, '');
      return DESK_ROOTS.includes(path) ? undefined : '/admin';
    }

    function fallbackHref() {
      return root.fallbackHref === undefined ? defaultFallback() : root.fallbackHref;
    }

    function canGoBack() {
      if (live() > 0) return true;
      if (typeof root.canBack === 'function' && root.canBack()) return true;
      return Boolean(fallbackHref());
    }

    function refresh() {
      if (!button) return;
      button.setAttribute('aria-disabled', canGoBack() ? 'false' : 'true');
    }

    /* A layer opened. Re-opening the layer that is already on top (the next
       chat in the list) swaps what closing it does and the address, but does
       not add a step - one back still means "back to the list". */
    function push(name, close, extra) {
      const url = extra && extra.url ? extra.url : undefined;
      const top = stack[stack.length - 1];
      if (top && !top.closed && top.name === name) {
        top.close = close;
        if (url) history.replaceState(history.state, '', url);
        refresh();
        return;
      }
      stack.push({ name, close, closed: false });
      const state = Object.assign(baseState(), { [KEY]: name, depth: stack.length });
      history.pushState(state, '', url || (location ? location.href : undefined));
      refresh();
    }

    /* The layer's own close control (the x, the backdrop, "Back to list"):
       goes through history so the address and the stack stay in step. */
    function dismiss(name) {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        const entry = stack[i];
        if (entry.name !== name || entry.closed) continue;
        if (i === stack.length - 1) {
          history.back();
          return true;
        }
        entry.closed = true;
        entry.close();
        refresh();
        return true;
      }
      return false;
    }

    /* The layer vanished by itself (a refresh emptied the list, a filter hid
       the detail): forget it without closing it again, and unwind history past
       whatever dead entries sit on top so the address agrees. */
    function drop(name) {
      let any = false;
      stack.forEach((entry) => {
        if (entry.name === name && !entry.closed) {
          entry.closed = true;
          any = true;
        }
      });
      if (!any) return false;
      let dead = 0;
      for (let i = stack.length - 1; i >= 0 && stack[i].closed; i -= 1) dead += 1;
      if (dead) {
        stack.splice(stack.length - dead, dead);
        history.go(-dead);
      }
      refresh();
      return true;
    }

    /* The arrow, the edge swipe, Escape. */
    function pop() {
      if (live() > 0) {
        history.back();
        return;
      }
      if (typeof root.canBack === 'function' && root.canBack()) {
        history.back();
        return;
      }
      const href = fallbackHref();
      if (href && location) location.href = href;
    }

    function onPopState(event) {
      const state = event && event.state && typeof event.state === 'object' ? event.state : {};
      const depth = state[KEY] ? Number(state.depth) || 0 : 0;
      if (depth > stack.length) {
        // Forward into a layer this page no longer holds: step back out of it.
        history.go(stack.length - depth);
        return;
      }
      while (stack.length > depth) {
        const entry = stack.pop();
        if (!entry.closed) {
          try {
            entry.close();
          } catch (error) {
            // A layer that fails to close must not stop the rest unwinding.
          }
        }
      }
      if (depth === 0 && typeof root.onPop === 'function') root.onPop(state);
      refresh();
    }

    function setRoot(config) {
      Object.assign(root, config || {});
      refresh();
    }

    /* Address helpers, so a refresh lands on the same chat. */
    function withParam(key, value) {
      const url = new URL(location.href);
      if (value === null || value === undefined || value === '') url.searchParams.delete(key);
      else url.searchParams.set(key, String(value));
      return url.pathname + url.search + url.hash;
    }

    function param(key) {
      return location ? new URL(location.href).searchParams.get(key) : null;
    }

    /* A number pasted from WhatsApp carries +91 and spaces; the console stores
       digits. A link should find the record either way. */
    function samePhone(a, b) {
      const da = String(a || '').replace(/\D/g, '');
      const db = String(b || '').replace(/\D/g, '');
      return da.length > 0 && da === db;
    }

    /* Desktop: the detail is a pane beside the list, not a layer, so it gets
       no step - but the address still remembers it. */
    function remember(params) {
      const url = new URL(location.href);
      Object.keys(params || {}).forEach((key) => {
        const value = params[key];
        if (value === null || value === undefined || value === '') url.searchParams.delete(key);
        else url.searchParams.set(key, String(value));
      });
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    }

    /* ---- the round arrow ------------------------------------------------- */

    /* On a phone the arrow floats (position: fixed) and must sit above the
       open detail, sheet or photo. Inside the top bar it cannot: the desk's bar
       is itself a fixed layer, so anything inside it stays under the detail
       (found on the iPhone, 7 Oct 2026). So on a phone the button lives on the
       body, drawn at the bar's top-left by the stylesheet; on a wide screen it
       sits in the bar's own flow, left of the tabs. */
    const phoneQuery = global.matchMedia
      ? global.matchMedia('(max-width: 960px), (hover: none) and (pointer: coarse)')
      : null;
    let inFlowHost = null;
    let inFlowBefore = null;

    function place() {
      if (!button || !doc.body) return;
      const floating = Boolean(phoneQuery && phoneQuery.matches);
      if (floating) {
        if (button.parentNode !== doc.body) doc.body.appendChild(button);
      } else if (inFlowHost && button.parentNode !== inFlowHost) {
        inFlowHost.insertBefore(button, inFlowBefore && inFlowBefore.parentNode === inFlowHost ? inFlowBefore : inFlowHost.firstChild);
      }
    }

    function mount() {
      if (!doc || button) return;
      const sideSwitch = doc.querySelector('#side-switch');
      const topbar = doc.querySelector('.inbox-topbar');
      const hero = doc.querySelector('.hero');
      const host = sideSwitch ? sideSwitch.parentNode : (topbar || hero);
      if (!host) return;

      button = doc.createElement('button');
      button.type = 'button';
      button.className = 'desk-back';
      button.setAttribute('aria-label', 'Back');
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5"></path><path d="M12 19l-7-7 7-7"></path></svg>';
      inFlowHost = host;
      inFlowBefore = sideSwitch || host.firstChild;
      host.insertBefore(button, inFlowBefore);
      button.addEventListener('click', () => {
        if (canGoBack()) pop();
      });
      place();
      if (phoneQuery) {
        if (phoneQuery.addEventListener) phoneQuery.addEventListener('change', place);
        else if (phoneQuery.addListener) phoneQuery.addListener(place);
      }
      refresh();
    }

    /* ---- the phone's back, Escape, the edge swipe ------------------------- */

    function horizontalScroller(node) {
      let el = node && node.nodeType === 1 ? node : null;
      while (el && el !== doc.body) {
        const style = global.getComputedStyle(el);
        if (/(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1) return el;
        el = el.parentElement;
      }
      return null;
    }

    function wire() {
      global.addEventListener('popstate', onPopState);
      if (!doc) return;

      doc.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || live() === 0) return;
        event.preventDefault();
        pop();
      });

      let start = null;
      doc.addEventListener('touchstart', (event) => {
        const touch = event.touches && event.touches[0];
        start = null;
        if (!touch || touch.clientX > 28) return;
        start = { x: touch.clientX, y: touch.clientY, scroller: horizontalScroller(event.target) };
      }, { passive: true });
      // The system's own edge gesture cancels the touch, so this never doubles it.
      doc.addEventListener('touchcancel', () => { start = null; }, { passive: true });
      doc.addEventListener('touchend', (event) => {
        if (!start) return;
        const begun = start;
        start = null;
        const touch = event.changedTouches && event.changedTouches[0];
        if (!touch) return;
        if (begun.scroller && begun.scroller.scrollLeft > 0) return;
        const dx = touch.clientX - begun.x;
        const dy = Math.abs(touch.clientY - begun.y);
        if (dx >= 80 && dy < 60 && canGoBack()) pop();
      }, { passive: true });

      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount);
      else mount();
    }

    wire();

    return {
      push,
      dismiss,
      drop,
      pop,
      canGoBack,
      refresh,
      setRoot,
      withParam,
      param,
      remember,
      samePhone,
      mount,
      _stack: () => stack.map((entry) => ({ name: entry.name, closed: entry.closed }))
    };
  }

  return { createBackStack };
});
