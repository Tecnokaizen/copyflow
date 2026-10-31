import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { notePlainLength, prepareNoteBody } from "./body";

describe("post-it body", () => {
  it("counts visible characters like public.order_note_plain_length_v1", () => {
    // Expected values computed with the SQL function on the local database.
    const samples: Array<[string, number]> = [
      ["<p>Hola</p>", 4],
      ["<p> a&nbsp;b &amp; c </p>", 7],
      ["<p>uno</p><p>dos</p>", 6],
      ["  <p>&#x41;&eacute;</p>\\n", 4],
      ["<p><br></p>", 0],
      ["<p>Hola</p>\\n<p>Adiós</p>", 11],
    ];
    for (const [html, length] of samples) assert.equal(notePlainLength(html), length, html);
    assert.equal(notePlainLength(null), 0);
  });

  it("sanitizes with the order profile and rejects empty or too long text", () => {
    assert.deepEqual(prepareNoteBody('<p data-text-align="right"><span data-text-size="large">Ojo</span><script>x</script></p>'), {
      ok: true,
      html: '<p data-text-align="right"><span data-text-size="large">Ojo</span></p>',
    });
    assert.deepEqual(prepareNoteBody("Texto sin etiquetas"), { ok: true, html: "<p>Texto sin etiquetas</p>" });
    // Plain text is escaped, never interpreted (same as orders.notes today).
    assert.deepEqual(prepareNoteBody("<script>alert(1)</script>"), { ok: true, html: "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>" });
    for (const raw of ["", "   ", "<p></p>", "<p><script>alert(1)</script></p>", `<p>${"x".repeat(4001)}</p>`, null, 7, {}]) {
      assert.deepEqual(prepareNoteBody(raw), { ok: false }, String(raw).slice(0, 30));
    }
    assert.equal(prepareNoteBody(`<p>${"x".repeat(4000)}</p>`).ok, true);
  });
});
