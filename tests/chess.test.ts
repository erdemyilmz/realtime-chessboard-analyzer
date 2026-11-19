import { test } from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import {
  pack,
  unpack,
  moveFen,
  barPercent,
  displayPieces,
  EMPTY,
} from "../lib/chess";
test("FEN round trip preserves positions and metadata", () => {
  for (const f of [
    new Chess().fen(),
    "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2",
    "4k3/QQ6/8/8/8/8/8/4K3 b - - 5 40",
    EMPTY,
  ])
    assert.equal(pack(unpack(f), f.split(" ").slice(1).join(" ")), f);
});
test("manual corrections preserve metadata and support missing kings", () => {
  const p = unpack(EMPTY);
  p.e4 = "N";
  assert.equal(pack(p, "b - - 0 1"), "8/8/8/8/4N3/8/8/8 b - - 0 1");
  delete p.e4;
  assert.equal(pack(p, "w - - 0 1"), EMPTY);
});
test("legal moves, captures, turn, and promotion", () => {
  let f = new Chess().fen();
  f = moveFen(f, "e2", "e4").fen;
  assert.equal(f.split(" ")[1], "b");
  f = moveFen(f, "d7", "d5").fen;
  assert.equal(moveFen(f, "e4", "d5").san, "exd5");
  assert.throws(() => moveFen(f, "e1", "e5"));
  assert.equal(
    moveFen("4k3/P7/8/8/8/8/8/4K3 w - - 0 1", "a7", "a8", "n").san,
    "a8=N",
  );
});
test("view orientation never modifies FEN or square mappings", () => {
  const fen = new Chess().fen();
  const before = displayPieces(fen);
  assert.equal(before.a1, "wR");
  assert.equal(before.a8, "bR");
  assert.equal(pack(unpack(fen), fen.split(" ").slice(1).join(" ")), fen);
});
test("evaluation bar is monotonic and White perspective", () => {
  assert.equal(barPercent(0, null), 50);
  assert.ok(barPercent(200, null) > 50);
  assert.ok(barPercent(-200, null) < 50);
  assert.equal(barPercent(null, 3), 98);
  assert.equal(barPercent(null, -2), 2);
  assert.equal(barPercent(null, 0, "w"), 2);
});
