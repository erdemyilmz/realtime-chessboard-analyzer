import { Chess, Square } from "chess.js";
export type Pieces = Record<string, string>;
export const EMPTY = "8/8/8/8/8/8/8/8 w - - 0 1";
export function unpack(fen: string): Pieces {
  const pieces: Pieces = {};
  fen
    .split(" ")[0]
    .split("/")
    .forEach((row, r) => {
      let f = 0;
      for (const p of row) {
        if (/[1-8]/.test(p)) f += Number(p);
        else pieces[`${"abcdefgh"[f++]}${8 - r}`] = p;
      }
    });
  return pieces;
}
export function pack(pieces: Pieces, metadata: string): string {
  const rows = [];
  for (let r = 8; r >= 1; r--) {
    let row = "",
      empty = 0;
    for (const f of "abcdefgh") {
      const p = pieces[f + r];
      if (p) {
        if (empty) row += empty;
        empty = 0;
        row += p;
      } else empty++;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join("/") + " " + metadata;
}
export function displayPieces(fen: string) {
  return Object.fromEntries(
    Object.entries(unpack(fen)).map(([s, p]) => [
      s,
      (p === p.toUpperCase() ? "w" : "b") + p.toUpperCase(),
    ]),
  );
}
export function moveFen(
  fen: string,
  from: string,
  to: string,
  promotion = "q",
) {
  const c = new Chess(fen);
  const move = c.move({ from: from as Square, to: to as Square, promotion });
  return {
    fen: c.fen(),
    san: move.san,
    uci: move.from + move.to + (move.promotion || ""),
  };
}
export function barPercent(cp: number | null, mate: number | null, turn = "w") {
  if (mate !== null)
    return mate === 0 ? (turn === "w" ? 2 : 98) : mate > 0 ? 98 : 2;
  return cp === null
    ? 50
    : Math.max(2, Math.min(98, 50 + 48 * Math.tanh(cp / 500)));
}
