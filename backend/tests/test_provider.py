"""Deterministic Gemini SDK contract tests; fixtures never reach a live provider."""

import asyncio
import json

import chess
import httpx
import numpy as np
import pytest

from backend import provider
from backend.models import Recognition
from backend.position import candidate_fen, validate


def fixture_board():
    # Intentionally omit the black king: chess rules must not insert it.
    board = chess.Board("8/8/8/8/8/8/4P3/4K3 w - - 0 1")
    return Recognition(
        squares=[
            {
                "square": chess.square_name(s),
                "piece": board.piece_at(s).symbol() if board.piece_at(s) else None,
                "confidence": 0.6,
                "reason": "Fixture",
                "alternatives": [],
            }
            for s in chess.SQUARES
        ],
        orientation_uncertain=True,
        notes=[],
    )


def install_transport(monkeypatch, handler):
    monkeypatch.setenv("GEMINI_API_KEY", "test-fixture-not-a-real-key")
    monkeypatch.setenv("VISION_MODEL", provider.DEFAULT_MODEL)
    real_client = provider.genai.Client

    def client(**kwargs):
        options = kwargs.pop("http_options")
        options.httpx_async_client = httpx.AsyncClient(
            transport=httpx.MockTransport(handler)
        )
        return real_client(http_options=options, **kwargs)

    monkeypatch.setattr(provider.genai, "Client", client)


def gemini_response(text):
    return httpx.Response(
        200,
        json={
            "candidates": [
                {
                    "content": {"role": "model", "parts": [{"text": text}]},
                    "finishReason": "STOP",
                }
            ]
        },
    )


def test_gemini_http_contract_and_context_pass(monkeypatch):
    calls = []
    response = fixture_board()

    def handler(request):
        assert request.headers["x-goog-api-key"] == "test-fixture-not-a-real-key"
        assert f"models/{provider.DEFAULT_MODEL}:generateContent" in str(request.url)
        calls.append(json.loads(request.content))
        return gemini_response(response.model_dump_json())

    install_transport(monkeypatch, handler)
    result, changed = asyncio.run(
        provider.GeminiVision().recognize(np.zeros((800, 800, 3), np.uint8))
    )
    assert len(calls) == 2
    parts = calls[0]["contents"][0]["parts"]
    assert len(parts) == 3
    assert all(
        p["inlineData"].get("mimeType", p["inlineData"].get("mime_type"))
        == "image/jpeg"
        for p in parts[1:]
    )
    config = calls[0]["generationConfig"]
    assert config["responseMimeType"] == "application/json"
    # Generation avoids Gemini's state explosion; strict local validation below
    # still rejects missing, duplicated, or out-of-range squares.
    assert config["responseJsonSchema"]["properties"]["squares"]["type"] == "array"
    assert '"minItems"' not in json.dumps(config["responseJsonSchema"])
    assert '"maximum"' not in json.dumps(config["responseJsonSchema"])
    assert "black king" in calls[1]["contents"][0]["parts"][0]["text"]
    assert not validate(candidate_fen(result)).valid
    assert result.orientation_uncertain and changed == []
    assert any("not calibrated" in n for n in result.notes)


@pytest.mark.parametrize(
    "text",
    [
        "not JSON",
        "{}",
        fixture_board().model_dump_json().replace('"square":"b1"', '"square":"a1"'),
    ],
)
def test_rejects_malformed_or_duplicate_squares(monkeypatch, text):
    install_transport(monkeypatch, lambda request: gemini_response(text))
    with pytest.raises(ValueError, match="incomplete or invalid board"):
        asyncio.run(
            provider.GeminiVision().recognize(np.zeros((800, 800, 3), np.uint8))
        )


def test_missing_key_and_google_key_alias(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    assert provider.gemini_key() is None
    with pytest.raises(ValueError, match="GEMINI_API_KEY"):
        asyncio.run(
            provider.GeminiVision().recognize(np.zeros((800, 800, 3), np.uint8))
        )
    monkeypatch.setenv("GOOGLE_API_KEY", "alias-fixture")
    assert provider.gemini_key() == "alias-fixture"


def test_provider_access_error_is_safe_and_actionable(monkeypatch):
    install_transport(
        monkeypatch,
        lambda request: httpx.Response(
            403,
            json={
                "error": {
                    "code": 403,
                    "message": "private fixture detail",
                    "status": "PERMISSION_DENIED",
                }
            },
        ),
    )
    with pytest.raises(ValueError, match="access was denied") as error:
        asyncio.run(
            provider.GeminiVision().recognize(np.zeros((800, 800, 3), np.uint8))
        )
    assert "private fixture detail" not in str(error.value)


def test_refinement_revisions_are_reported(monkeypatch):
    first = fixture_board()
    refined = first.model_copy(deep=True)
    next(s for s in refined.squares if s.square == "e2").piece = "B"
    responses = iter([first, refined])
    install_transport(
        monkeypatch, lambda request: gemini_response(next(responses).model_dump_json())
    )
    result, changed = asyncio.run(
        provider.GeminiVision().recognize(np.zeros((800, 800, 3), np.uint8))
    )
    assert changed == ["e2"]
    assert next(s for s in result.squares if s.square == "e2").piece == "B"


def test_rate_limit_retries_are_bounded(monkeypatch):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(
            429,
            json={
                "error": {
                    "code": 429,
                    "message": "quota fixture",
                    "status": "RESOURCE_EXHAUSTED",
                }
            },
        )

    install_transport(monkeypatch, handler)
    with pytest.raises(ValueError, match="rate limit or quota"):
        asyncio.run(
            provider.GeminiVision().recognize(np.zeros((800, 800, 3), np.uint8))
        )
    assert len(calls) == 2


def test_invalid_key_is_actionable_and_redacted(monkeypatch, caplog):
    install_transport(
        monkeypatch,
        lambda request: httpx.Response(
            400,
            json={
                "error": {
                    "code": 400,
                    "message": "API key not valid: test-fixture-not-a-real-key",
                    "status": "INVALID_ARGUMENT",
                }
            },
        ),
    )
    with pytest.raises(ValueError, match="key is invalid or expired"):
        asyncio.run(
            provider.GeminiVision().recognize(np.zeros((800, 800, 3), np.uint8))
        )
    assert "[redacted]" in caplog.text
    assert "test-fixture-not-a-real-key" not in caplog.text
