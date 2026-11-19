from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Piece = Literal["K", "Q", "R", "B", "N", "P", "k", "q", "r", "b", "n", "p"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Alternative(Strict):
    piece: Piece | None
    confidence: float = Field(ge=0, le=1)


class Prediction(Alternative):
    square: str = Field(pattern=r"^[a-h][1-8]$")
    alternatives: list[Alternative]
    reason: str


class Recognition(Strict):
    squares: list[Prediction] = Field(min_length=64, max_length=64)
    orientation_uncertain: bool
    notes: list[str]

    @model_validator(mode="after")
    def unique(self):
        if len({s.square for s in self.squares}) != 64:
            raise ValueError("All 64 unique squares are required")
        return self


class PositionRequest(Strict):
    fen: str = Field(max_length=160)


class AnalysisRequest(PositionRequest):
    depth: int = Field(default=18, ge=5, le=24)
    multipv: int = Field(default=3, ge=1, le=3)


class Validation(Strict):
    valid: bool
    errors: list[str]
    warnings: list[str]


class Line(Strict):
    move: str
    uci: str
    cp: int | None
    mate: int | None
    depth: int
    pv: list[str]


class Analysis(Strict):
    fen: str
    lines: list[Line]
    terminal: str | None = None
    cp: int | None = None
    mate: int | None = None
    engine: str
