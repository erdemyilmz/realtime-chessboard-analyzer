import asyncio

import chess
import chess.engine
import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app import app
from backend.engine import EngineService, white_score
from backend.models import AnalysisRequest, Recognition
from backend.position import candidate_fen, validate
from backend.vision import decode, detect, indexed, rectify


@pytest.mark.parametrize(
    "fen",
    [
        chess.STARTING_FEN,
        "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
        "4k3/8/8/3p4/4P3/8/8/4K3 b - - 0 20",
        "4k3/QQ6/8/8/8/8/8/4K3 w - - 0 40",
        "4k3/8/8/8/8/8/BBB5/4K3 w - - 0 40",
        "7k/6Q1/5K2/8/8/8/8/8 b - - 0 1",
    ],
)
def test_valid(fen):
    assert validate(fen).valid


@pytest.mark.parametrize(
    "fen",
    [
        "8/8/8/8/8/8/8/4K3 w - - 0 1",
        "4k3/8/8/8/8/8/4k3/4K3 w - - 0 1",
        "P3k3/8/8/8/8/8/8/4K3 w - - 0 1",
        "8/8/8/8/8/8/4k3/4K3 w - - 0 1",
        "4k3/8/8/8/8/8/8/4K3 w K - 0 1",
        "4k3/8/8/8/8/8/8/4K3 w - e3 0 1",
        "invalid",
    ],
)
def test_invalid(fen):
    assert not validate(fen).valid


def predictions(fen):
    b = chess.Board(fen)
    return {
        "squares": [
            {
                "square": chess.square_name(s),
                "piece": b.piece_at(s).symbol() if b.piece_at(s) else None,
                "confidence": 0.7,
                "reason": "Synthetic test fixture",
                "alternatives": [],
            }
            for s in chess.SQUARES
        ],
        "orientation_uncertain": False,
        "notes": [],
    }


def test_schema_and_candidate():
    data = predictions(chess.STARTING_FEN)
    result = Recognition.model_validate(data)
    assert candidate_fen(result, "b") == chess.STARTING_BOARD_FEN + " b - - 0 1"
    assert result.squares[0].confidence == 0.7
    data["squares"][1]["square"] = "a1"
    with pytest.raises(ValidationError):
        Recognition.model_validate(data)


def test_no_invented_king():
    result = Recognition.model_validate(predictions("8/8/8/8/8/8/8/4K3 w - - 0 1"))
    assert not validate(candidate_fen(result)).valid
    assert "k" not in candidate_fen(result).split()[0]


def synthetic():
    board = np.zeros((800, 800, 3), np.uint8)
    for r in range(8):
        for c in range(8):
            board[r * 100 : (r + 1) * 100, c * 100 : (c + 1) * 100] = (
                (181, 217, 240) if (r + c) % 2 == 0 else (99, 136, 181)
            )
    return board


def test_detect_and_homography():
    image = synthetic()
    corners, _notes = detect(image)
    assert np.allclose(corners, [[0, 0], [799, 0], [799, 799], [0, 799]], atol=3)
    assert rectify(image, [[0, 0], [799, 0], [799, 799], [0, 799]]).shape == (
        800,
        800,
        3,
    )
    assert indexed(image).shape == (1040, 880, 3)


@pytest.mark.parametrize(
    "points",
    [
        [[-1, 0], [799, 0], [799, 799], [0, 799]],
        [[0, 0], [0, 0], [1, 1], [2, 2]],
        [[0, 0], [1, 1], [2, 2]],
        [[0, 0], [799, 0], [799, 799], [float("nan"), 799]],
    ],
)
def test_bad_corners(points):
    with pytest.raises(ValueError):
        rectify(synthetic(), points)


def test_rotated_square_mapping():
    # Marker in a8 moves to h1 after 180 degrees, to h8 after clockwise 90.
    image = synthetic()
    image[20:80, 20:80] = [0, 0, 255]
    rotated = cv2.rotate(image, cv2.ROTATE_180)
    assert (rotated[720:780, 720:780] == [0, 0, 255]).all()
    rotated = cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    assert (rotated[20:80, 720:780] == [0, 0, 255]).all()


def test_decode_and_blur():
    with pytest.raises(ValueError):
        decode(b"not an image")
    with pytest.raises(ValueError):
        detect(np.zeros((800, 800, 3), np.uint8))
    _ok, data = cv2.imencode(".png", synthetic())
    assert decode(data.tobytes()).shape == (800, 800, 3)


def test_score_perspective():
    assert white_score(chess.engine.PovScore(chess.engine.Cp(120), chess.BLACK)) == (
        -120,
        None,
    )
    assert white_score(chess.engine.PovScore(chess.engine.Mate(3), chess.BLACK)) == (
        None,
        -3,
    )


def test_api_errors_and_health(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    with TestClient(app) as client:
        response = client.get("/", follow_redirects=False)
        assert response.status_code == 307
        assert (
            response.headers["location"] == "https://erdemyilmz.github.io/boardlight/"
        )
        assert client.get("/api/health").json()["vision_ready"] is False
        assert (
            client.post("/api/validate-position", json={"fen": "bad"}).json()["valid"]
            is False
        )
        assert (
            client.post(
                "/api/analyze", json={"fen": chess.STARTING_FEN, "depth": 100}
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/detect", files={"file": ("bad.jpg", b"bad", "image/jpeg")}
            ).status_code
            == 422
        )
        _, data = cv2.imencode(".png", synthetic())
        res = client.post(
            "/api/recognize",
            files={"file": ("board.png", data.tobytes(), "image/png")},
            data={"corners": "[[0,0],[799,0],[799,799],[0,799]]"},
        )
        assert res.status_code == 422 and "GEMINI_API_KEY" in res.json()["detail"]


def test_stockfish_live():
    service = EngineService()
    if not service.path():
        pytest.skip(
            "Install Stockfish and set STOCKFISH_PATH for real UCI integration tests"
        )

    async def run():
        try:
            for fen in [chess.STARTING_FEN, "4k3/8/8/3p4/4P3/8/8/4K3 b - - 0 20"]:
                req = AnalysisRequest(fen=fen, depth=8, multipv=3)
                result = await service.analyze(req)
                assert len(result.lines) == 3
                for line in result.lines:
                    b = chess.Board(fen)
                    assert chess.Move.from_uci(line.uci) in b.legal_moves
                    for san in line.pv:
                        b.push_san(san)
                assert await service.analyze(req) is result
            result = await service.analyze(
                AnalysisRequest(fen="7k/6Q1/5K2/8/8/8/8/8 b - - 0 1")
            )
            assert result.terminal == "CHECKMATE" and result.mate == 0
            for turn in ["w", "b"]:
                result = await service.analyze(
                    AnalysisRequest(
                        fen=f"4k3/8/8/8/8/8/3Q4/4K3 {turn} - - 0 1", depth=8
                    )
                )
                assert result.lines[0].cp is not None and result.lines[0].cp > 400
        finally:
            await service.close()

    asyncio.run(run())
