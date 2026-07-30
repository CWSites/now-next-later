import { describe, it, expect } from "vitest";
import { decodeHtmlEntities } from "../lib/decode-html";

describe("decodeHtmlEntities", () => {
  it("decodes the common named entities", () => {
    expect(decodeHtmlEntities("A &amp; B")).toBe("A & B");
    expect(decodeHtmlEntities("a &lt; b &gt; c")).toBe("a < b > c");
    expect(decodeHtmlEntities("she said &quot;hi&quot;")).toBe('she said "hi"');
    expect(decodeHtmlEntities("it&apos;s fine")).toBe("it's fine");
    expect(decodeHtmlEntities("hard&nbsp;space")).toBe("hard space");
  });

  it("decodes decimal and hex numeric references", () => {
    expect(decodeHtmlEntities("it&#39;s fine")).toBe("it's fine");
    expect(decodeHtmlEntities("&#x27;quoted&#x27;")).toBe("'quoted'");
    expect(decodeHtmlEntities("emoji &#128512;")).toBe("emoji 😀");
  });

  it("handles the real Lattice sample from the screenshots", () => {
    const raw =
      "**Assisting with Culture Change &amp; EM Role** - Communicate across tech leads &amp; EM&#39;s better - Getting more into the architecture (patterns) &gt; kubernetes &gt; larger infrastructure, etc.";
    const decoded = decodeHtmlEntities(raw);
    expect(decoded).toContain("Culture Change & EM Role");
    expect(decoded).toContain("EM's better");
    expect(decoded).toContain("(patterns) > kubernetes > larger");
    expect(decoded).not.toContain("&amp;");
    expect(decoded).not.toContain("&gt;");
    expect(decoded).not.toContain("&#39;");
  });

  it("is idempotent for already-decoded text", () => {
    const clean = "already & clean < text >";
    expect(decodeHtmlEntities(decodeHtmlEntities(clean))).toBe(clean);
  });

  it("preserves doubly-encoded entities to one level of decoding", () => {
    // `&amp;lt;` — an already-escaped `&lt;` — should decode to `&lt;`,
    // not collapse all the way to `<`.
    expect(decodeHtmlEntities("&amp;lt;")).toBe("&lt;");
  });

  it("returns strings without any '&' unchanged (fast path)", () => {
    expect(decodeHtmlEntities("plain text")).toBe("plain text");
    expect(decodeHtmlEntities("")).toBe("");
  });

  it("leaves malformed / unknown entities intact rather than mangling them", () => {
    expect(decodeHtmlEntities("look at &this; thing")).toBe("look at &this; thing");
    expect(decodeHtmlEntities("&#notanumber;")).toBe("&#notanumber;");
  });
});
