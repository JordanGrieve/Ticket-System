// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The pasteable contact-form snippet, ACTUALLY EXECUTED.
 *
 * tests/install-contact-snippet.test.ts reads the source and asserts on what it
 * says. This one runs it against a real form and a stubbed provider and asserts
 * on what it DOES, because those are different claims and only the second one
 * is the promise we are making. "The text contains `button.disabled = true`" is
 * satisfied by a line that never executes.
 *
 * It matters more here than almost anywhere else in the repo: this code is not
 * ours to debug once it ships. It is pasted, by hand, onto a small business's
 * live contact page by somebody who will not read it first, and it is the only
 * thing standing between a customer's enquiry and nothing happening at all.
 * AGENTS.md: use the feature once before saying it is done.
 *
 * ── HOW IT IS RUN ──
 *
 * The snippet is a template literal inside a client component, so it is lifted
 * out as text, its one interpolation is filled in, and it is executed with
 * `new Function`. Executing generated source in a test looks alarming and is
 * exactly right here: the artifact under test IS source text meant to be
 * executed, and any indirection would test a copy of it instead.
 */

const SRC = readFileSync(
  join(process.cwd(), "components/InstallView.tsx"),
  "utf8",
);

const ENDPOINT = "https://postbox.help/api/tickets/test-key";

/** Lift the snippet out of the component and make it runnable. */
function snippetCode(): string {
  const open = "const snippetB = `";
  const start = SRC.indexOf(open);
  expect(start, "snippetB is gone or renamed").toBeGreaterThan(-1);
  const from = start + open.length;
  const end = SRC.indexOf("`;", from);
  expect(end, "snippetB's template literal never closes").toBeGreaterThan(from);

  const raw = SRC.slice(from, end);
  // The snippet is wrapped in <script> tags for pasting; drop them, and fill in
  // the one interpolation the component would have supplied.
  const code = raw
    .split("${endpoint}")
    .join(ENDPOINT)
    .replace("<script>", "")
    .replace("</script>", "");

  // Guard the extraction itself. A regex that quietly matched nothing would
  // leave every assertion below passing against an empty function.
  expect(code).toContain("addEventListener");
  expect(code).toContain(ENDPOINT);
  expect(code).not.toContain("${");
  return code;
}

/**
 * A form as a VISITOR leaves it: empty markup, values typed in.
 *
 * The distinction is load-bearing and cost a green test to find. Writing
 * `value="…"` in the HTML sets the input's DEFAULT, and `form.reset()` restores
 * defaults — so a fixture built that way reports that reset() does nothing,
 * which is true of that fixture and false of every real contact form. Setting
 * `.value` is what typing does.
 */
function buildPage(): HTMLFormElement {
  document.body.innerHTML = `
    <main>
      <form id="contact-form">
        <input name="name" />
        <input name="email" />
        <textarea name="message"></textarea>
        <button type="submit">Send</button>
      </form>
    </main>`;
  const form = document.querySelector("#contact-form") as HTMLFormElement;
  (form.querySelector("[name=name]") as HTMLInputElement).value = "Priya Raman";
  (form.querySelector("[name=email]") as HTMLInputElement).value = "priya@example.com";
  (form.querySelector("textarea") as HTMLTextAreaElement).value =
    "Do you cater for gluten-free events?";
  return form;
}

function run() {
  new Function(snippetCode())();
}

/** Submit and let the snippet's promise chain settle. */
async function submit(form: HTMLFormElement) {
  form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  // Two turns: one for the awaited fetch, one for the code after it.
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

const statusEl = () => document.querySelector("[data-postbox-status]");
const button = () => document.querySelector("#contact-form button") as HTMLButtonElement;

function reply(status: number) {
  return new Response(JSON.stringify({ ok: status < 400 }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a successful submission", () => {
  it("posts the form's fields to the endpoint as JSON", async () => {
    const fetchMock = vi.fn(async () => reply(201));
    vi.stubGlobal("fetch", fetchMock);
    const form = buildPage();
    run();

    await submit(form);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({
      name: "Priya Raman",
      email: "priya@example.com",
      message: "Do you cater for gluten-free events?",
    });
  });

  it("does not navigate away", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(201)));
    const form = buildPage();
    run();
    const ev = new Event("submit", { cancelable: true, bubbles: true });
    form.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("puts a readable reply INTO the page, next to the form", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(201)));
    const form = buildPage();
    run();
    await submit(form);

    const s = statusEl();
    expect(s, "no status element was created").not.toBeNull();
    expect(s!.textContent).toMatch(/thanks/i);
    expect(s!.getAttribute("role")).toBe("status");
    // Next to the form, not appended to the end of <body> where a visitor
    // would have to go looking for it.
    expect(form.nextElementSibling).toBe(s);
  });

  it("clears the form", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(201)));
    const form = buildPage();
    run();
    await submit(form);
    expect((form.querySelector("[name=email]") as HTMLInputElement).value).toBe("");
  });

  it("re-enables the button afterwards", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(201)));
    const form = buildPage();
    run();
    await submit(form);
    expect(button().disabled).toBe(false);
  });
});

describe("while the request is in flight", () => {
  it("disables the button, so an impatient visitor cannot send twice", async () => {
    /*
     * The assertion is on the button, deliberately, and not on a fetch count.
     *
     * A browser will not submit a form from a disabled button, so disabling it
     * IS the guard. A test that dispatched a second synthetic submit event and
     * counted fetches would prove nothing either way: dispatchEvent bypasses
     * the button entirely, so it would report a "double send" that no real
     * visitor can perform. Asserting the thing that actually stops them is the
     * honest version.
     */
    let release: (r: Response) => void = () => {};
    const pending = new Promise<Response>((r) => { release = r; });
    vi.stubGlobal("fetch", vi.fn(() => pending));
    const form = buildPage();
    run();

    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await Promise.resolve();

    expect(button().disabled, "the button stayed live mid-send").toBe(true);

    release(reply(201));
    await submit(form);
    expect(button().disabled, "the button never came back").toBe(false);
  });

  it("says something while they wait", async () => {
    const pending = new Promise<Response>(() => {});
    vi.stubGlobal("fetch", vi.fn(() => pending));
    const form = buildPage();
    run();
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await Promise.resolve();
    expect(statusEl()!.textContent).toMatch(/sending/i);
  });
});

describe("when it fails", () => {
  it("KEEPS what the visitor typed", async () => {
    // The expensive one. Throwing away a written-out enquiry because the
    // network blinked loses the customer and the message.
    vi.stubGlobal("fetch", vi.fn(async () => reply(500)));
    const form = buildPage();
    run();
    await submit(form);
    expect((form.querySelector("textarea") as HTMLTextAreaElement).value).toMatch(
      /gluten-free/,
    );
  });

  it("re-enables the button so they can try again", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(500)));
    const form = buildPage();
    run();
    await submit(form);
    expect(button().disabled).toBe(false);
  });

  it("offers a way through that does not need us", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(500)));
    const form = buildPage();
    run();
    await submit(form);
    expect(statusEl()!.textContent).toMatch(/email us directly/i);
    expect(statusEl()!.getAttribute("data-state")).toBe("error");
  });

  it("tells a rate-limited visitor to WAIT rather than retry now", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(429)));
    const form = buildPage();
    run();
    await submit(form);
    expect(statusEl()!.textContent).toMatch(/minute/i);
  });

  it("survives the network throwing rather than answering", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("failed"); }));
    const form = buildPage();
    run();
    await submit(form);
    expect(statusEl()!.textContent).toMatch(/connection/i);
    expect(button().disabled, "a thrown request left the form dead").toBe(false);
  });
});

describe("it leaves the site alone", () => {
  it("uses a status element the site already provides, wherever it put it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(201)));
    document.body.innerHTML = `
      <main>
        <p data-postbox-status id="theirs"></p>
        <form id="contact-form">
          <input name="name" /><input name="email" />
          <textarea name="message"></textarea>
          <button type="submit">Send</button>
        </form>
      </main>`;
    const form = document.querySelector("#contact-form") as HTMLFormElement;
    run();
    await submit(form);

    expect(document.querySelectorAll("[data-postbox-status]")).toHaveLength(1);
    expect(document.getElementById("theirs")!.textContent).toMatch(/thanks/i);
  });

  it("sets no inline styles on anything", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(201)));
    const form = buildPage();
    run();
    await submit(form);
    expect(statusEl()!.getAttribute("style")).toBeNull();
    expect(form.getAttribute("style")).toBeNull();
  });

  it("does nothing at all when the form selector matches nothing", async () => {
    // Pasted on a page whose form has a different id — which will happen. It
    // must not throw, and must not invent a form.
    const fetchMock = vi.fn(async () => reply(201));
    vi.stubGlobal("fetch", fetchMock);
    document.body.innerHTML = `<form id="something-else"></form>`;
    expect(() => run()).not.toThrow();
    expect(document.querySelector("[data-postbox-status]")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
