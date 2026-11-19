import { Chess } from "chess.js";
import { analyzeBrowser } from "./browser-engine";

export function validateBrowser(fen: string) {
  const errors: string[] = [],
    warnings: string[] = [];
  try {
    const board = new Chess(fen),
      pieces = board
        .board()
        .flat()
        .filter((p) => p !== null);
    for (const color of ["w", "b"] as const) {
      const side = pieces.filter((p) => p.color === color);
      if (side.length > 16)
        errors.push(
          `${color === "w" ? "White" : "Black"} has more than sixteen pieces.`,
        );
      if (side.filter((p) => p.type === "p").length > 8)
        errors.push("A side cannot have more than eight pawns.");
    }
    const fields = fen.split(" ");
    const kings = pieces.filter((p) => p.type === "k");
    if (kings.length !== 2)
      errors.push("Exactly one king of each color is required.");
    for (const right of fields[2].replace("-", "")) {
      const color = right === right.toUpperCase() ? "w" : "b",
        rank = color === "w" ? "1" : "8";
      const king = board.get(`e${rank}` as "e1"),
        rook = board.get(
          `${right.toLowerCase() === "k" ? "h" : "a"}${rank}` as "a1",
        );
      if (
        king?.type !== "k" ||
        king.color !== color ||
        rook?.type !== "r" ||
        rook.color !== color
      )
        errors.push("Castling rights conflict with king or rook locations.");
    }
    // Chess.js validates FEN syntax and kings; verify that the previous mover is not in check.
    const opposite = fields.slice();
    opposite[1] = fields[1] === "w" ? "b" : "w";
    opposite[3] = "-";
    if (new Chess(opposite.join(" ")).isCheck())
      errors.push(
        "The side that just moved has left its king in check (or kings are adjacent).",
      );
    if (fields[3] !== "-") {
      const ep = fields[3],
        white = fields[1] === "w",
        rank = white ? "6" : "3",
        pawnRank = white ? "5" : "4",
        originRank = white ? "7" : "2";
      const pawn = board.get(`${ep[0]}${pawnRank}` as "a1");
      if (
        ep[1] !== rank ||
        board.get(ep as "a1") ||
        board.get(`${ep[0]}${originRank}` as "a1") ||
        pawn?.type !== "p" ||
        pawn.color === (white ? "w" : "b")
      )
        errors.push("En passant target is inconsistent with this position.");
    }
  } catch (error) {
    errors.push((error as Error).message);
  }
  return { valid: !errors.length, errors, warnings };
}

export async function browserApi(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  if (path === "health")
    return {
      engine_ready: typeof WebAssembly !== "undefined",
      vision_ready: false,
    };
  if (path === "validate-position")
    return validateBrowser((body as { fen: string }).fen);
  if (path === "analyze") {
    const request = body as { fen: string; depth: number; multipv: number };
    const validation = validateBrowser(request.fen);
    if (!validation.valid) throw Error(validation.errors.join(" "));
    return analyzeBrowser(request, signal);
  }
  throw Error(
    "Photo recognition requires a configured Python backend. This free site supports manual board editing and real Stockfish analysis in your browser. Your image is preserved for comparison.",
  );
}
