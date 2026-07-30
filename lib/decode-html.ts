/**
 * Small HTML-entity decoder for task titles/notes that arrive from
 * upstream systems (Lattice, Confluence excerpts, etc.) with raw entity
 * references like `&amp;`, `&#39;`, or `&gt;` in them.
 *
 * Deliberately stays a plain-string transform (no DOMParser) so it works
 * both in the browser and in server-side ingest scripts, and so it's
 * safe to run on untrusted input — the decoder can only produce plain
 * text, never HTML.
 *
 * Only decodes; never re-encodes. Idempotent for already-decoded text.
 */
export function decodeHtmlEntities(input: string): string {
  if (!input || input.indexOf("&") === -1) return input;
  return (
    input
      // Named entities we care about in real task content. Order matters:
      // `&amp;` must run LAST so a doubly-encoded string like `&amp;lt;`
      // decodes to `&lt;` (one level) rather than collapsing to `<`.
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, " ")
      // Decimal numeric references, e.g. `&#39;` → `'`.
      .replace(/&#(\d+);/g, (_, n) => {
        const code = Number(n);
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : _;
      })
      // Hex numeric references, e.g. `&#x27;` → `'`.
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
        const code = parseInt(hex, 16);
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : _;
      })
      .replace(/&amp;/g, "&")
  );
}
