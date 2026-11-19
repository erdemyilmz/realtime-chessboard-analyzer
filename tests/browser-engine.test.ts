import { test } from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { parseInfo } from "../lib/browser-engine";
import { validateBrowser } from "../lib/browser-api";
test("UCI parser converts scores, SAN and MultiPV from real protocol lines", () => {
  const fen = new Chess().fen();
  const line = parseInfo(
    "info depth 12 multipv 2 score cp 34 nodes 123 pv e2e4 e7e5 g1f3",
    fen,
  )!;
  assert.equal(line.rank, 2);
  assert.deepEqual(line.line.pv, ["e4", "e5", "Nf3"]);
  assert.equal(line.line.cp, 34);
  const board = new Chess();
  board.move("e4");
  assert.equal(
    parseInfo("info depth 9 score cp 60 pv e7e5", board.fen())!.line.cp,
    -60,
  );
  assert.equal(
    parseInfo("info depth 9 score mate 3 pv e7e5", board.fen())!.line.mate,
    -3,
  );
  assert.equal(
    parseInfo("info depth 9 score cp 60 lowerbound pv e7e5", board.fen()),
    null,
  );
  assert.equal(
    parseInfo("info depth 9 score cp 60 pv e7e4", board.fen()),
    null,
  );
});
test("browser validation rejects missing kings, adjacent kings, excess material and bad metadata", () => {
  assert.equal(validateBrowser(new Chess().fen()).valid, true);
  for (const fen of [
    "8/8/8/8/8/8/8/4K3 w - - 0 1",
    "8/8/8/8/8/8/4k3/4K3 w - - 0 1",
    "4k3/8/8/8/8/8/8/4K3 w K - 0 1",
    "4k3/8/8/8/8/8/8/4K3 w - e3 0 1",
    "4k3/pppppppp/p7/8/8/8/8/4K3 w - - 0 1",
  ])
    assert.equal(validateBrowser(fen).valid, false, fen);
  assert.equal(validateBrowser("4k3/QQ6/8/8/8/8/8/4K3 b - - 0 1").valid, true);
  assert.equal(validateBrowser("7k/6Q1/5K2/8/8/8/8/8 b - - 0 1").valid, true);
});
