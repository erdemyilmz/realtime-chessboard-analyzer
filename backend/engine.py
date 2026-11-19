import asyncio
import os
import shutil
from collections import OrderedDict

import chess
import chess.engine

from .models import Analysis, Line


def white_score(score):
    s = score.white()
    return s.score(), s.mate()


class EngineService:
    def __init__(self):
        self.lock = asyncio.Lock()
        self.engine = None
        self.transport = None
        self.cache = OrderedDict()

    def path(self):
        return shutil.which(os.getenv("STOCKFISH_PATH", "stockfish"))

    async def close(self):
        if self.transport:
            self.transport.close()
        self.engine = self.transport = None

    async def analyze(self, request):
        key = (request.fen, request.depth, request.multipv)
        async with self.lock:
            if key in self.cache:
                self.cache.move_to_end(key)
                return self.cache[key]
            board = chess.Board(request.fen)
            if not board.is_valid():
                raise ValueError("Correct the invalid position before analysis.")
            if not self.path():
                raise ValueError(
                    "Stockfish is not installed or STOCKFISH_PATH is incorrect."
                )
            try:
                if not self.engine:
                    self.transport, self.engine = await chess.engine.popen_uci(
                        self.path()
                    )
                    await self.engine.configure({"Threads": 1, "Hash": 64})
                name = self.engine.id.get("name", "Stockfish")
                if board.is_game_over(claim_draw=False):
                    result = Analysis(
                        fen=request.fen,
                        lines=[],
                        terminal=board.outcome().termination.name,
                        cp=0 if not board.is_checkmate() else None,
                        mate=0 if board.is_checkmate() else None,
                        engine=name,
                    )
                else:
                    seconds = min(20, max(1, float(os.getenv("ENGINE_SECONDS", "8"))))
                    infos = await asyncio.wait_for(
                        self.engine.analyse(
                            board,
                            chess.engine.Limit(depth=request.depth, time=seconds),
                            multipv=request.multipv,
                        ),
                        timeout=seconds + 5,
                    )
                    lines = []
                    for info in infos:
                        pv = info.get("pv", [])
                        if not pv:
                            continue
                        replay = board.copy()
                        sans = []
                        for move in pv:
                            sans.append(replay.san(move))
                            replay.push(move)
                        cp, mate = white_score(info["score"])
                        lines.append(
                            Line(
                                move=sans[0],
                                uci=pv[0].uci(),
                                cp=cp,
                                mate=mate,
                                depth=info.get("depth", 0),
                                pv=sans,
                            )
                        )
                    result = Analysis(fen=request.fen, lines=lines, engine=name)
                self.cache[key] = result
                if len(self.cache) > 128:
                    self.cache.popitem(last=False)
                return result
            except (TimeoutError, chess.engine.EngineError, OSError) as e:
                await self.close()
                raise ValueError(
                    "Stockfish stopped or timed out. Retry analysis; the engine will restart."
                ) from e
            except asyncio.CancelledError:
                await self.close()
                raise
