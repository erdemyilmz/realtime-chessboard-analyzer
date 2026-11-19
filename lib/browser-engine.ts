import { Chess } from "chess.js";

export type EngineLine = {
  move: string;
  uci: string;
  cp: number | null;
  mate: number | null;
  depth: number;
  pv: string[];
};
export type EngineResult = {
  fen: string;
  lines: EngineLine[];
  terminal: string | null;
  cp: number | null;
  mate: number | null;
  engine: string;
};

/** UCI scores are relative to the mover; the interface always reports White's score. */
export function parseInfo(
  text: string,
  fen: string,
): { rank: number; line: EngineLine } | null {
  const tokens = text.split(/\s+/),
    value = (key: string) => tokens[tokens.indexOf(key) + 1];
  if (
    !tokens.includes("score") ||
    !tokens.includes("pv") ||
    tokens.includes("lowerbound") ||
    tokens.includes("upperbound")
  )
    return null;
  const rawPv = tokens.slice(tokens.indexOf("pv") + 1),
    board = new Chess(fen),
    pv: string[] = [];
  try {
    for (const uci of rawPv) {
      const move = board.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4],
      });
      pv.push(move.san);
    }
  } catch {
    return null;
  }
  if (!pv.length) return null;
  const sign = fen.split(" ")[1] === "w" ? 1 : -1;
  const scoreType = tokens[tokens.indexOf("score") + 1],
    amount = Number(tokens[tokens.indexOf("score") + 2]);
  if (!Number.isFinite(amount)) return null;
  return {
    rank: tokens.includes("multipv") ? Number(value("multipv")) : 1,
    line: {
      move: pv[0],
      uci: rawPv[0],
      cp: scoreType === "cp" ? amount * sign : null,
      mate: scoreType === "mate" ? amount * sign : null,
      depth: Number(value("depth")) || 0,
      pv,
    },
  };
}

let worker: Worker | null = null,
  ready: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, EngineResult>();
const abortError = () => new DOMException("Analysis cancelled", "AbortError");
function dispose() {
  worker?.terminate();
  worker = null;
  ready = null;
}
function getWorker() {
  if (ready) return ready;
  ready = new Promise<Worker>((resolve, reject) => {
    const current = new Worker(
      `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/engine/stockfish-19-lite-single.js`,
    );
    worker = current;
    const timer = setTimeout(
      () =>
        fail(
          Error("The browser engine did not start. Reload the page to retry."),
        ),
      20000,
    );
    const fail = (error: Error) => {
      clearTimeout(timer);
      dispose();
      reject(error);
    };
    current.onerror = () =>
      fail(
        Error(
          "Unable to load Stockfish WebAssembly. Check your browser and connection.",
        ),
      );
    current.onmessage = (event) => {
      const line = String(event.data);
      if (line === "uciok") {
        current.postMessage("setoption name Hash value 32");
        current.postMessage("isready");
      } else if (line === "readyok") {
        clearTimeout(timer);
        current.onmessage = null;
        current.onerror = null;
        resolve(current);
      }
    };
    current.postMessage("uci");
  });
  return ready;
}

export function analyzeBrowser(
  request: { fen: string; depth: number; multipv: number },
  signal?: AbortSignal,
): Promise<EngineResult> {
  const run = async () => {
    if (signal?.aborted) throw abortError();
    const key = JSON.stringify(request),
      cached = cache.get(key);
    if (cached) return cached;
    const board = new Chess(request.fen);
    const engine = "Stockfish 19 Lite · browser";
    if (board.isGameOver())
      return {
        fen: request.fen,
        lines: [],
        terminal: board.isCheckmate()
          ? "CHECKMATE"
          : board.isStalemate()
            ? "STALEMATE"
            : "DRAW",
        cp: board.isCheckmate() ? null : 0,
        mate: board.isCheckmate() ? 0 : null,
        engine,
      };
    const current = await getWorker();
    if (signal?.aborted) throw abortError();
    return new Promise<EngineResult>((resolve, reject) => {
      const lines = new Map<number, EngineLine>();
      const timer = setTimeout(() => {
        dispose();
        finish(Error("Browser analysis timed out. Try a lower depth."));
      }, 15000);
      function finish(error?: Error, result?: EngineResult) {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        current.onmessage = null;
        current.onerror = null;
        if (error) reject(error);
        else resolve(result!);
      }
      function cancel() {
        current.postMessage("stop");
      }
      signal?.addEventListener("abort", cancel, { once: true });
      current.onerror = () => {
        dispose();
        finish(Error("Stockfish stopped unexpectedly. Retry analysis."));
      };
      current.onmessage = (event) => {
        const text = String(event.data),
          info = parseInfo(text, request.fen);
        if (info) lines.set(info.rank, info.line);
        if (text.startsWith("bestmove")) {
          if (signal?.aborted) {
            finish(abortError());
            return;
          }
          const result: EngineResult = {
            fen: request.fen,
            lines: [...lines.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([, line]) => line),
            terminal: null,
            cp: null,
            mate: null,
            engine,
          };
          if (!result.lines.length) {
            finish(Error("Stockfish returned no legal candidate moves."));
            return;
          }
          cache.set(key, result);
          if (cache.size > 128) cache.delete(cache.keys().next().value!);
          finish(undefined, result);
        }
      };
      current.postMessage(
        `setoption name MultiPV value ${Math.max(1, Math.min(3, request.multipv))}`,
      );
      current.postMessage(`position fen ${request.fen}`);
      current.postMessage(
        `go depth ${Math.max(5, Math.min(24, request.depth))} movetime 8000`,
      );
    });
  };
  const pending = queue.then(run, run);
  queue = pending.catch(() => {});
  return pending;
}
