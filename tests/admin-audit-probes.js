/*
  Layout and contrast probes for the admin harness, shipped INSIDE each page.

  They used to be pasted into the console per page, which quietly stopped
  working the moment a navigation cleared the global — five panes reported
  `undefined` and that reads exactly like five passes. Living in the page means
  they cannot be absent without the page failing to load.

  Both probes are self-testing: call __selftest() to inject a deliberately
  broken element and confirm each one reports it.
*/

window.__overflow = function () {
  const vw = document.documentElement.clientWidth;
  const clipped = [];
  const loose = [];
  document.querySelectorAll("*").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    if (r.right <= vw + 1 && r.left >= -1) return;
    let a = el.parentElement;
    let verdict = "loose";
    while (a && a !== document.body) {
      const o = getComputedStyle(a).overflowX;
      // auto/scroll means the content is reachable. hidden means it is cut
      // off with no way to get to it, which is the worse outcome, not an
      // excuse — an earlier version of this treated them the same and could
      // therefore never report anything.
      if (o === "auto" || o === "scroll") { verdict = "ok"; break; }
      if (o === "hidden") { verdict = "clipped"; break; }
      a = a.parentElement;
    }
    const label = (el.className || el.tagName).toString().slice(0, 42) + " r=" + Math.round(r.right);
    if (verdict === "clipped") clipped.push(label);
    else if (verdict === "loose") loose.push(label);
  });
  return { doc: document.documentElement.scrollWidth, vw, clipped, loose };
};

const parse = (s) => {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  if (p.length < 3 || p.some(Number.isNaN)) return null;
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
};

const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});

const lum = (c) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};

const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

/*
  The composited ground behind an element.

  Alpha compositing is not optional here. A helper that reads only the nearest
  declared background reported a pill in this product at 1.61:1 when it was
  really 4.63:1, and "fixing" that would have broken working design.
*/
const ground = (el) => {
  const stack = [];
  let n = el;
  while (n) {
    const c = parse(getComputedStyle(n).backgroundColor);
    if (c && c.a > 0) {
      stack.push(c);
      if (c.a === 1) break;
    }
    n = n.parentElement;
  }
  if (!stack.length) return { r: 255, g: 255, b: 255, a: 1 };
  let base = stack[stack.length - 1];
  for (let i = stack.length - 2; i >= 0; i--) base = over(stack[i], base);
  return base;
};

window.__contrast = function () {
  const out = [];
  document.querySelectorAll("*").forEach((el) => {
    const hasText = [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 1,
    );
    if (!hasText) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0") return;
    const fgRaw = parse(cs.color);
    // Never `if (!x) return` in a check: a colour that cannot be read is a
    // broken probe, not an absent problem.
    if (!fgRaw) throw new Error("unparsed colour: " + cs.color);
    const bg = ground(el);
    const fg = over(fgRaw, bg);
    const px = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = px >= 24 || (px >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const got = ratio(fg, bg);
    if (got < need) {
      out.push({
        cls: (el.className || el.tagName).toString().slice(0, 34),
        text: el.textContent.trim().slice(0, 40),
        px: Math.round(px * 10) / 10,
        got: Math.round(got * 100) / 100,
        need,
      });
    }
  });
  return out;
};

/** WCAG 2.2 2.5.8, including the 24px spacing exception. */
window.__targets = function () {
  const sel =
    'a,button,input:not([type="hidden"]),select,textarea,summary,[role="button"],[tabindex]:not([tabindex="-1"])';
  const els = [...document.querySelectorAll(sel)].filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const c = els.map((e) => {
    const r = e.getBoundingClientRect();
    return { e, r, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
  const small = [];
  for (const t of c) {
    if (t.r.width >= 24 && t.r.height >= 24) continue;
    // The exception is measured as a 24px circle on each centre: if no other
    // target's centre falls inside it, the small target still passes.
    let near = null;
    for (const o of c) {
      if (o === t) continue;
      const d = Math.hypot(o.cx - t.cx, o.cy - t.cy);
      if (d < 24) { near = Math.round(d); break; }
    }
    small.push({
      cls: (t.e.className || t.e.tagName).toString().slice(0, 34),
      text: (t.e.textContent || "").trim().slice(0, 26),
      w: Math.round(t.r.width),
      h: Math.round(t.r.height),
      crowdedBy: near,
      fails: near !== null,
    });
  }
  return { total: els.length, failing: small.filter((s) => s.fails), exemptButSmall: small.filter((s) => !s.fails) };
};

/** Injects a broken element and confirms each probe reports it. */
window.__selftest = function () {
  const host = document.querySelector(".pba-content") || document.body;

  const wide = document.createElement("div");
  // Relative to the viewport, not a fixed 900px. A fixed width fits inside a
  // desktop window, so the self-test quietly reported "cannot see overflow"
  // at 1280 — which is indistinguishable from the probe being broken.
  wide.style.cssText = `width:${document.documentElement.clientWidth * 2}px;height:8px`;
  host.appendChild(wide);
  const seen = window.__overflow();
  /*
    A verdict, not a boolean.

    Above 980px .pba-content carries `overflow-y: auto`, and CSS computes
    overflow-x to `auto` whenever the other axis is not visible — so the probe
    lands in a genuine scroller there and is correctly NOT reported. A bare
    false could not be told apart from a probe that had stopped working, which
    is the whole thing this function exists to rule out.
  */
  const sawOverflow =
    seen.clipped.length + seen.loose.length > 0
      ? "reported"
      : "absorbed by a scrolling ancestor (expected above 980px)";
  wide.remove();

  const faint = document.createElement("p");
  faint.style.cssText =
    "color:rgba(120,120,140,0.55);font-size:13px;background:rgba(255,255,255,0.04)";
  faint.textContent = "deliberately illegible probe";
  host.appendChild(faint);
  const sawContrast = window.__contrast().length > 0;
  faint.remove();

  const a = document.createElement("button");
  const b = document.createElement("button");
  for (const el of [a, b]) {
    el.style.cssText = "width:14px;height:14px;padding:0;position:relative";
    host.appendChild(el);
  }
  b.style.left = "-6px";
  const sawTarget = window.__targets().failing.length > 0;
  a.remove();
  b.remove();

  return { sawOverflow, sawContrast, sawTarget };
};
