/*
  Layout and contrast probes for the admin harness, shipped INSIDE each page.

  They used to be pasted into the console per page, which quietly stopped
  working the moment a navigation cleared the global — five panes reported
  `undefined` and that reads exactly like five passes. Living in the page means
  they cannot be absent without the page failing to load.

  Both probes are self-testing: call __selftest() to inject a deliberately
  broken element and confirm each one reports it.
*/

/*
  Is this element part of a loading skeleton rather than the page?

  ── WHY THIS EXISTS ──
  A streamed Next route keeps its loading.tsx skeleton in the DOM alongside the
  real content until React commits the swap, and React defers that work while
  the document is hidden — which a browser pane driven by a tool usually is. So
  "wait for the skeleton to go" can wait forever, on a page whose real content
  is already sitting right there.

  Measuring the skeleton is worse than waiting: it has real geometry and real
  colours, so it produces a confident, entirely fictional report. Excluding it
  is both correct and sufficient — the placeholder is decorative by
  construction, and its insides are aria-hidden.
*/
function inSkeleton(el) {
  return !!(el.closest && el.closest('[aria-busy="true"], .pbk'));
}

window.__overflow = function () {
  const vw = document.documentElement.clientWidth;
  const clipped = [];
  const loose = [];
  document.querySelectorAll("*").forEach((el) => {
    if (inSkeleton(el)) return;
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

/*
  Colour parsing, done by the browser rather than by hand.

  This used to be a regex over rgb()/rgba(), which is every colour a computed
  style reports — right up until it is not. The mail views paint label chips
  with oklch(), Chrome reports oklch() back verbatim, and the probe threw. It
  was right to throw (a colour that cannot be read is a broken check, not an
  absent problem), but the answer is not to bolt on an oklch parser and then a
  lab() one and then color-mix().

  A 1x1 canvas converts anything the browser can paint into sRGB bytes, which
  is the space WCAG contrast is defined in. getImageData returns
  non-premultiplied RGBA, so alpha survives for the compositing below.
*/
const probeCanvas = document.createElement("canvas");
probeCanvas.width = probeCanvas.height = 1;
const probeCtx = probeCanvas.getContext("2d", { willReadFrequently: true });

const parse = (s) => {
  if (!s || s === "transparent" || s === "none") return { r: 0, g: 0, b: 0, a: 0 };
  probeCtx.clearRect(0, 0, 1, 1);
  probeCtx.fillStyle = "#000";
  // An unparseable value leaves fillStyle at the previous one, so a colour the
  // browser rejects reads back as the sentinel black rather than silently
  // becoming whatever was measured last.
  probeCtx.fillStyle = s;
  if (probeCtx.fillStyle === "#000" && !/^(#000000|#000|black|rgba?\(0, ?0, ?0)/.test(s.trim())) {
    return null;
  }
  probeCtx.clearRect(0, 0, 1, 1);
  probeCtx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probeCtx.getImageData(0, 0, 1, 1).data;
  return { r, g, b, a: a / 255 };
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
    if (inSkeleton(el)) return;
    const hasText = [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 1,
    );
    if (!hasText) return;
    const r = el.getBoundingClientRect();
    /*
      1px is the visually-hidden idiom, not a real box.

      .pbm-sr carries text for screen readers only — "Unread", "Last reply
      sent" — clipped to a 1x1 rect. Measuring its contrast reports a failure
      on text no sighted user can see, and "fixing" it would change nothing
      except the numbers here. A zero check alone let all of those through.
    */
    if (r.width <= 1 || r.height <= 1) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0") return;
    if (cs.clipPath === "inset(50%)" || cs.clip === "rect(0px, 0px, 0px, 0px)") return;

    /*
      ── GRADIENT TEXT IS NOT TRANSPARENT TEXT ──
      The homepage paints its hero emphasis with `background-clip: text` and a
      transparent fill, so `color` computes to rgba(0,0,0,0). Read naively that
      is text the same colour as its background, and this probe duly reported
      the h1 at 1:1 — a headline anyone can see perfectly well.

      What a reader actually sees is the gradient. Each stop is measured
      against the ground and the WORST one is used, since the text spans all of
      them. Same approach as the --accent-grad guard in the contrast test.
    */
    const clip = cs.webkitBackgroundClip || cs.backgroundClip;
    const fill = cs.webkitTextFillColor || cs.color;
    const isGradientText =
      clip === "text" && parse(fill) && parse(fill).a === 0 && /gradient/.test(cs.backgroundImage);
    if (isGradientText) {
      const bgForText = ground(el.parentElement || el);
      const stops = (cs.backgroundImage.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/gi) || [])
        .map(parse)
        .filter(Boolean);
      // A gradient whose stops cannot be read is a broken check, not a pass.
      if (stops.length === 0) throw new Error("gradient text with no readable stops: " + cs.backgroundImage);
      const px2 = parseFloat(cs.fontSize);
      const bold2 = parseInt(cs.fontWeight, 10) >= 700;
      const need2 = px2 >= 24 || (px2 >= 18.66 && bold2) ? 3 : 4.5;
      let worst = Infinity;
      for (const stop of stops) worst = Math.min(worst, ratio(over(stop, bgForText), bgForText));
      if (worst < need2) {
        out.push({
          cls: (el.className || el.tagName).toString().slice(0, 34),
          text: el.textContent.trim().slice(0, 40),
          px: Math.round(px2 * 10) / 10,
          got: Math.round(worst * 100) / 100,
          need: need2,
          note: "gradient text, worst stop",
        });
      }
      return;
    }

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
    if (inSkeleton(e)) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  /*
    A hidden control's target is its label.

    The theme picker is the case: a 1x1 opacity-0 radio inside a 161x168
    <label> card. That is the correct, accessible way to build it — the card is
    what anyone taps — but measuring the input's own box reports six failures
    and invites somebody to "fix" markup that was already right.

    So a control wrapped in (or pointed at by) a label is measured by the union
    of the two. Same principle as the pseudo-element hit test below: measure
    what the pointer actually lands on.
  */
  const labelFor = (e) => {
    const wrapping = e.closest && e.closest("label");
    if (wrapping) return wrapping;
    if (!e.id) return null;
    try {
      return document.querySelector(`label[for="${CSS.escape(e.id)}"]`);
    } catch {
      return null;
    }
  };
  const union = (a, b) => {
    const left = Math.min(a.left, b.left);
    const top = Math.min(a.top, b.top);
    const right = Math.max(a.right, b.right);
    const bottom = Math.max(a.bottom, b.bottom);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  };

  const c = els.map((e) => {
    let r = e.getBoundingClientRect();
    const lab = labelFor(e);
    if (lab) {
      const lr = lab.getBoundingClientRect();
      if (lr.width > 0 && lr.height > 0) r = union(r, lr);
    }
    return { e, r, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
  /*
    Does a 24px box centred on this control actually hit it?

    getBoundingClientRect measures the element's own box and nothing else, so
    a control whose hit area is grown with a pseudo-element — which is how you
    give a 14px icon a 24px target without inflating the layout around it —
    reads as 14px and gets reported forever. .pbm-label-x is exactly that.

    elementFromPoint answers the question the success criterion is really
    asking: if a finger lands here, does this control receive it. Pseudo
    elements are hit-testable and report their originating element, so the
    grown area is measured rather than guessed at.
  */
  const hitsAt = (t, dx, dy) => {
    const el = document.elementFromPoint(t.cx + dx, t.cy + dy);
    return el === t.e || t.e.contains(el) || (el && el.contains(t.e));
  };
  const effectively24 = (t) => {
    const r = 11.5; // just inside a 24px box, to stay off the boundary
    return [
      [0, 0], [-r, -r], [r, -r], [-r, r], [r, r], [-r, 0], [r, 0], [0, -r], [0, r],
    ].every(([dx, dy]) => hitsAt(t, dx, dy));
  };

  const small = [];
  for (const t of c) {
    if (t.r.width >= 24 && t.r.height >= 24) continue;
    // Small box, but the pointer still lands on it across a 24px square.
    if (effectively24(t)) continue;
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

/**
 * Sentences that were made into flex rows.
 *
 * ── THE SIGNATURE IS AN ANONYMOUS FLEX ITEM ──
 * A flex container blockifies every child, and each run of raw text between
 * its elements becomes an ANONYMOUS flex item. So `<p class="flex">Right now
 * it is <b>09:00</b> in Europe/London</p>` is not one wrapping paragraph, it
 * is five items in a row that cannot wrap across each other.
 *
 * That is what .st-status was: eight items running to 404px inside a 375px
 * phone, with the clock clipped off the end. It is invisible until the
 * sentence is long enough, which is why it survived — the text only overflows
 * in the configuration that produces the longest string.
 *
 * A key/value row of <span>s in a flex container is fine and common, so a bare
 * "text inside flex" would cry wolf constantly. The report is narrowed to
 * containers that do NOT wrap and whose items already exceed their own width —
 * the state that actually clips.
 */
window.__flexSentences = function () {
  const out = [];
  document.querySelectorAll("*").forEach((el) => {
    if (inSkeleton(el)) return;
    const cs = getComputedStyle(el);
    if (cs.display !== "flex" && cs.display !== "inline-flex") return;
    if (cs.flexWrap !== "nowrap") return;
    if (cs.flexDirection.startsWith("column")) return;

    const textKids = [...el.childNodes].filter(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
    );
    if (textKids.length === 0) return;

    // Does it actually overflow its own box? A short sentence in a flex row is
    // wrong in principle but harms nobody, and reporting it buries the ones
    // that clip.
    /*
      Measure the ANONYMOUS items too, not just the element children.

      The first version of this looped over el.children and reported nothing
      anywhere — including on its own self-test injection, which is the only
      reason it was caught. The text runs are the items that overflow, and they
      are not elements, so `children` cannot see them. A Range around each text
      node can.
    */
    const box = el.getBoundingClientRect();
    let widest = 0;
    for (const kid of el.children) {
      const r = kid.getBoundingClientRect();
      if (r.right > widest) widest = r.right;
    }
    for (const node of textKids) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      if (r.right > widest) widest = r.right;
    }
    if (widest <= box.right + 1) return;

    out.push({
      cls: (el.className || el.tagName).toString().slice(0, 40),
      text: el.textContent.replace(/\s+/g, " ").trim().slice(0, 60),
      boxRight: Math.round(box.right),
      contentRight: Math.round(widest),
      items: el.childNodes.length,
    });
  });
  return out;
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

  // A sentence in a nowrap flex row, long enough to overflow its own box —
  // exactly the .st-status shape.
  const row = document.createElement("p");
  row.style.cssText = "display:flex;flex-wrap:nowrap;width:120px";
  row.append(
    "Right now it is ",
    Object.assign(document.createElement("b"), { textContent: "09:00" }),
    " in Europe/London and this keeps going well past the box",
  );
  host.appendChild(row);
  const sawFlexSentence = window.__flexSentences().length > 0;
  row.remove();

  return { sawOverflow, sawContrast, sawTarget, sawFlexSentence };
};

/* ────────────────────────────────────────────────────────────────────────
   THE REST OF WCAG 2.2 AA THAT A MACHINE CAN ACTUALLY DECIDE

   The probes above cover 1.4.3 (contrast), 1.4.10 (reflow), 2.5.8 (target
   size) and the flex-sentence clipping 1.4.10 lets through. What follows is
   the rest of the AA set that can be judged from the DOM.

   Deliberately NOT attempted, because a pass would be a lie: whether alt text
   DESCRIBES its image (1.1.1), whether a heading is the right heading (2.4.6),
   whether an error message helps (3.3.3), whether focus ORDER is logical
   (2.4.3). Those need a person. This reports the mechanical half and claims
   nothing about the rest.
   ──────────────────────────────────────────────────────────────────────── */

/** 1.1.1, 2.4.4, 4.1.2 — everything interactive or informative has a name. */
window.__names = function () {
  const out = [];

  const nameOf = (el) => {
    const label = el.getAttribute("aria-label");
    if (label && label.trim()) return label.trim();

    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const text = by
        .split(/\s+/)
        .map((id) => (document.getElementById(id) || {}).textContent || "")
        .join(" ")
        .trim();
      if (text) return text;
    }

    if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") {
      if (el.id) {
        const lab = document.querySelector("label[for='" + CSS.escape(el.id) + "']");
        if (lab && lab.textContent.trim()) return lab.textContent.trim();
      }
      const wrapping = el.closest("label");
      if (wrapping && wrapping.textContent.trim()) return wrapping.textContent.trim();
      const ph = el.getAttribute("placeholder");
      // A placeholder is NOT a label — it vanishes the moment you type — but
      // it does identify the field, so it is reported as weak rather than
      // missing. Same for title.
      if (ph && ph.trim()) return { weak: ph.trim(), via: "placeholder" };
    }

    if (el.tagName === "IMG") {
      const alt = el.getAttribute("alt");
      return alt === null ? null : alt; // "" is a valid decorative alt
    }

    const text = (el.textContent || "").trim();
    if (text) return text;

    const titled = el.getAttribute("title");
    if (titled && titled.trim()) return { weak: titled.trim(), via: "title" };

    return null;
  };

  const sel =
    'a[href],button,input:not([type="hidden"]),select,textarea,img,[role="button"],[role="link"]';
  document.querySelectorAll(sel).forEach((el) => {
    if (el.closest("[aria-hidden='true']")) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0 && el.tagName !== "INPUT") return;

    const name = nameOf(el);
    const where = (el.className || "").toString().slice(0, 34);
    if (name === null) {
      out.push({ problem: "no accessible name", tag: el.tagName, cls: where });
    } else if (typeof name === "object") {
      out.push({ problem: "named only by " + name.via, tag: el.tagName, cls: where, name: name.weak });
    }
  });
  return out;
};

/** 1.3.1 — heading levels describe a structure, not a font size. */
window.__headings = function () {
  const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(
    (h) => !h.closest("[aria-hidden='true']") && h.getBoundingClientRect().height > 0,
  );
  const levels = hs.map((h) => ({
    level: Number(h.tagName[1]),
    text: h.textContent.trim().slice(0, 40),
  }));
  const problems = [];
  if (levels.length === 0) return { levels, problems: ["no headings on the page"] };

  const h1s = levels.filter((l) => l.level === 1);
  if (h1s.length === 0) problems.push("no h1");
  if (h1s.length > 1) problems.push(h1s.length + " h1s");

  for (let i = 1; i < levels.length; i++) {
    if (levels[i].level - levels[i - 1].level > 1) {
      problems.push(
        "jumps h" + levels[i - 1].level + " to h" + levels[i].level + ' at "' + levels[i].text + '"',
      );
    }
  }
  return { levels, problems };
};

/** 3.1.1, 2.4.2, 4.1.2 — structural mistakes that break assistive tech. */
window.__structure = function () {
  const problems = [];

  // Focusable inside aria-hidden: reachable by tab, invisible to a reader.
  // The reader announces nothing while focus sits on it.
  document.querySelectorAll("[aria-hidden='true']").forEach((h) => {
    const focusable = h.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    );
    for (const f of focusable) {
      problems.push(
        "focusable " + f.tagName.toLowerCase() + " inside aria-hidden " +
          (h.className || "").toString().slice(0, 30),
      );
    }
  });

  // A duplicate id breaks every label-for and aria-labelledby aimed at it.
  const seen = new Map();
  document.querySelectorAll("[id]").forEach((el) => seen.set(el.id, (seen.get(el.id) || 0) + 1));
  for (const [id, n] of seen) if (n > 1) problems.push('id "' + id + '" used ' + n + " times");

  // A positive tabindex reorders the entire page around one element.
  document.querySelectorAll("[tabindex]").forEach((el) => {
    const t = Number(el.getAttribute("tabindex"));
    if (t > 0) problems.push("positive tabindex=" + t + " on " + el.tagName.toLowerCase());
  });

  return {
    lang: document.documentElement.getAttribute("lang"), // 3.1.1
    title: document.title || null, // 2.4.2
    problems,
  };
};

/**
 * 2.4.7 Focus Visible — focusing a control changes how it looks.
 *
 * Focuses each one in turn and compares outline, shadow, border and
 * background before and after. A control that looks identical when focused
 * cannot be tracked by anyone navigating with a keyboard.
 */
window.__focusVisible = function () {
  const out = [];
  const sel =
    'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
  const wasActive = document.activeElement;

  /*
    ── WITHOUT DOCUMENT FOCUS THIS MEASURES NOTHING ──
    :focus only matches while the DOCUMENT itself has focus. In a browser pane
    that is hidden or not frontmost, el.focus() sets document.activeElement and
    :focus still does not match — so every control looks identical before and
    after, and this probe reported fourteen failures on a page whose focus
    styles are fine.

    "Cannot measure" and "fails" must never come back looking the same, so it
    refuses rather than guessing. Bring the pane forward to get a real answer;
    the ring's CONTRAST is separately guarded, without a browser, in
    tests/contrast-tokens.test.ts.
  */
  if (!document.hasFocus()) {
    return { measurable: false, why: "the document does not have focus, so :focus never matches" };
  }

  const snap = (el) => {
    const cs = getComputedStyle(el);
    return [
      cs.outlineStyle,
      cs.outlineWidth,
      cs.outlineColor,
      cs.outlineOffset,
      cs.boxShadow,
      cs.borderColor,
      cs.backgroundColor,
    ].join("|");
  };

  document.querySelectorAll(sel).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (el.closest("[aria-hidden='true']")) return;
    const before = snap(el);
    el.focus();
    if (snap(el) === before) {
      out.push({
        tag: el.tagName,
        cls: (el.className || "").toString().slice(0, 38),
        text: (el.textContent || "").trim().slice(0, 24),
      });
    }
  });

  if (wasActive && wasActive.focus) wasActive.focus();
  return out;
};

/**
 * 1.4.12 Text Spacing — the page survives a reader's own spacing.
 *
 * Applies exactly what the criterion names — line height 1.5em, letter
 * spacing 0.12em, word spacing 0.16em, paragraph spacing 2em — then looks for
 * text now clipped by a fixed height. Restores afterwards.
 */
window.__textSpacing = function () {
  const style = document.createElement("style");
  style.textContent =
    "* { line-height: 1.5em !important; letter-spacing: 0.12em !important;" +
    " word-spacing: 0.16em !important; }\np { margin-bottom: 2em !important; }";
  document.head.appendChild(style);
  void document.body.offsetHeight;

  const clipped = [];
  document.querySelectorAll("*").forEach((el) => {
    if (inSkeleton(el)) return;
    // The visually-hidden idiom is a 1px box on purpose. Reporting it as
    // "clipped" is reporting that screen-reader text is not on screen.
    const box = el.getBoundingClientRect();
    if (box.width <= 1 || box.height <= 1) return;
    const cs = getComputedStyle(el);
    if (cs.overflow === "visible" && cs.overflowY === "visible") return;
    // A box that is MEANT to scroll is not clipping anything.
    if (cs.overflowY === "auto" || cs.overflowY === "scroll") return;
    const hasText = [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 1,
    );
    if (!hasText) return;
    if (el.scrollHeight > el.clientHeight + 2) {
      clipped.push({
        cls: (el.className || el.tagName).toString().slice(0, 38),
        text: el.textContent.replace(/\s+/g, " ").trim().slice(0, 44),
        scroll: el.scrollHeight,
        client: el.clientHeight,
      });
    }
  });

  style.remove();
  void document.body.offsetHeight;
  return clipped;
};

/**
 * Wait until the page is the PAGE, not its skeleton.
 *
 * ── THIS INVALIDATED A WHOLE SWEEP ──
 * Every route has a loading.tsx now, so a slow render shows a skeleton with
 * real geometry, real colours and no headings. Probes run against that come
 * back beautifully clean — no contrast failures, no small targets, no
 * overflow — because a placeholder has nothing to fail. On a cold dev server
 * the homepage took 16 SECONDS to swap the real content in, and an audit run
 * at t+0 measured bars.
 *
 * So: no measuring until the skeletons are gone and something real is on
 * screen. Resolves with what it waited for, so a caller can tell "ready" from
 * "gave up", because those must never look the same.
 */
window.__ready = async function (timeoutMs) {
  const limit = timeoutMs || 25000;
  const started = Date.now();
  const busy = () =>
    [...document.querySelectorAll('[aria-busy="true"], .pbk')].some(
      (el) => el.getBoundingClientRect().height > 0,
    );
  const hasContent = () =>
    [...document.querySelectorAll("h1,h2,h3,main,article,table,form,input,button")].some(
      (el) => el.getBoundingClientRect().height > 0,
    );

  while (Date.now() - started < limit) {
    // Content is enough. The skeleton is EXCLUDED from every probe rather than
    // waited out, because React will not commit the swap while the document is
    // hidden and a hidden document is the normal case for a driven pane.
    if (hasContent() && document.readyState === "complete") {
      // One more frame, so a swap that just happened has been laid out.
      await new Promise((r) => requestAnimationFrame(() => r()));
      return { ready: true, waitedMs: Date.now() - started };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return {
    ready: false,
    waitedMs: Date.now() - started,
    stillBusy: busy(),
    hasContent: hasContent(),
  };
};

/**
 * 1.4.4 Resize Text — text doubles without losing content or function.
 *
 * Distinct from 1.4.10 Reflow, which is about a narrow viewport. This is a
 * reader who has set a larger default text size, and the failure looks
 * different: not a page that scrolls sideways, but a box with a fixed height
 * that swallows its own text once the text grows.
 *
 * Doubling the root font-size is not enough on its own — anything with a
 * font-size in px ignores the root, and would pass this check while failing a
 * real reader — so px-sized elements are doubled explicitly and put back.
 */
window.__textZoom = function () {
  const style = document.createElement("style");
  style.textContent = "html { font-size: 200% !important; }";
  document.head.appendChild(style);

  const touched = [];
  document.querySelectorAll("*").forEach((el) => {
    if (inSkeleton(el)) return;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (!px) return;
    touched.push([el, el.style.fontSize]);
    el.style.fontSize = px * 2 + "px";
  });
  void document.body.offsetHeight;

  const clipped = [];
  document.querySelectorAll("*").forEach((el) => {
    if (inSkeleton(el)) return;
    const box = el.getBoundingClientRect();
    if (box.width <= 1 || box.height <= 1) return;
    const cs = getComputedStyle(el);
    if (cs.overflow === "visible" && cs.overflowY === "visible") return;
    if (cs.overflowY === "auto" || cs.overflowY === "scroll") return;
    const hasText = [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 1,
    );
    if (!hasText) return;
    if (el.scrollHeight > el.clientHeight + 2) {
      clipped.push({
        cls: (el.className || el.tagName).toString().slice(0, 38),
        text: el.textContent.replace(/\s+/g, " ").trim().slice(0, 40),
        scroll: el.scrollHeight,
        client: el.clientHeight,
      });
    }
  });

  for (const [el, inline] of touched) el.style.fontSize = inline;
  style.remove();
  void document.body.offsetHeight;
  return clipped;
};

/**
 * Everything above, for one page, in one call.
 *
 * Async, and it waits first. A synchronous version measured skeletons.
 */
window.__audit = async function () {
  const ready = await window.__ready();
  const o = window.__overflow();
  const t = window.__targets();
  const s = window.__structure();
  const h = window.__headings();
  return {
    // First, so a reader sees it before the findings. A result measured
    // against a skeleton is worse than no result.
    ready,
    selftest: window.__selftest(),
    reflow: { clipped: o.clipped, loose: o.loose },
    contrast: window.__contrast(),
    targets: t.failing,
    smallButSpaced: t.exemptButSmall.map((x) => x.cls + " " + x.w + "x" + x.h),
    flexSentences: window.__flexSentences(),
    names: window.__names(),
    headings: h.problems,
    structure: s.problems,
    lang: s.lang,
    title: s.title,
    focusVisible: window.__focusVisible(),
    textSpacing: window.__textSpacing(),
  };
};
