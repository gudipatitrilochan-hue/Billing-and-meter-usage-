// Plain helpers that keep the page code simple. The site uses no animation library and no
// motion effects: numbers are shown at their final value and content appears immediately.
// The function names are kept so every page can call them the same way.

/** Always true: charts, scrolling and other code check this and skip any animation. */
export const reduced = true;

/** Kept for compatibility; there is nothing to start. */
export function initMotion() {}

/** Kept for compatibility; there are no hover effects to wire up. */
export function enhance() {}

/** Go to another page (a normal link navigation). */
export function navigate(href) {
  location.href = href;
}

/** Content is visible straight away, so there is nothing to reveal. */
export function reveal() {}

/** Headings are shown as written. */
export function splitWords() {}

/** Show the final number straight away (no counting animation). */
export function countUp(el, to, format = (n) => n.toLocaleString("en-US")) {
  if (el) el.textContent = format(to);
}

/** Kept for compatibility; no bounce or shake effects. */
export function pop() {}
export function shake() {}
export function confetti() {}
