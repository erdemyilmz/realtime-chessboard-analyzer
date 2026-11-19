"""Opt-in live integration: consumes the configured Gemini project's quota."""

import asyncio
import os
from pathlib import Path

import pytest

from backend.provider import GeminiVision, gemini_key
from backend.vision import decode


@pytest.mark.skipif(
    not os.getenv("LIVE_VISION_PHOTO") or not gemini_key(),
    reason="Requires explicit LIVE_VISION_PHOTO and a Gemini key; consumes provider quota",
)
def test_live_vision():
    result, _changed = asyncio.run(
        GeminiVision().recognize(
            decode(Path(os.environ["LIVE_VISION_PHOTO"]).read_bytes())
        )
    )
    assert len(result.squares) == 64
