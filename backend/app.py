import asyncio
import json
import os
from contextlib import asynccontextmanager
from typing import Annotated

import cv2
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse

from . import vision
from .engine import EngineService
from .models import Analysis, AnalysisRequest, PositionRequest, Validation
from .position import candidate_fen, validate
from .provider import DEFAULT_MODEL, GeminiVision, gemini_key

load_dotenv()
engine = EngineService()
recognition_gate = asyncio.Semaphore(2)


@asynccontextmanager
async def lifespan(app):
    yield
    await engine.close()


app = FastAPI(title="Boardlight API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def request_size(request: Request, call_next):
    length = request.headers.get("content-length")
    if length:
        try:
            if int(length) > 11 * 1024 * 1024:
                return JSONResponse(
                    status_code=413, content={"detail": "Upload request exceeds 11 MB."}
                )
        except ValueError:
            return JSONResponse(
                status_code=400, content={"detail": "Invalid content length."}
            )
    return await call_next(request)


@app.exception_handler(ValueError)
async def value_error(request, exc):
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "engine_ready": bool(engine.path()),
        "vision_ready": bool(gemini_key()),
        "vision_provider": "gemini",
        "vision_model": os.getenv("VISION_MODEL", DEFAULT_MODEL),
    }


@app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
async def frontend():
    return RedirectResponse(
        os.getenv("FRONTEND_URL", "https://erdemyilmz.github.io/boardlight/")
    )


async def read_image(file):
    data = await file.read(10 * 1024 * 1024 + 1)
    await file.close()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "Photographs must be smaller than 10 MB.")
    return await asyncio.to_thread(vision.decode, data)


@app.post("/api/detect")
async def detect(file: Annotated[UploadFile, File()]):
    image = await read_image(file)
    corners, notes = await asyncio.to_thread(vision.detect, image)
    return {
        "corners": corners,
        "width": image.shape[1],
        "height": image.shape[0],
        "notes": notes,
    }


@app.post("/api/recognize")
async def recognize(
    file: Annotated[UploadFile, File()],
    corners: Annotated[str | None, Form()] = None,
    rotation: Annotated[int, Form()] = 0,
    turn: Annotated[str, Form()] = "w",
):
    if rotation not in [0, 90, 180, 270] or turn not in ["w", "b"]:
        raise ValueError("Invalid orientation or side to move.")
    image = await read_image(file)
    try:
        points = (
            json.loads(corners)
            if corners
            else (await asyncio.to_thread(vision.detect, image))[0]
        )
    except (json.JSONDecodeError, TypeError):
        raise ValueError("Invalid corner coordinates.")
    board = await asyncio.to_thread(vision.rectify, image, points)
    if rotation:
        board = cv2.rotate(
            board,
            {
                90: cv2.ROTATE_90_CLOCKWISE,
                180: cv2.ROTATE_180,
                270: cv2.ROTATE_90_COUNTERCLOCKWISE,
            }[rotation],
        )
    async with recognition_gate:
        result, changed = await GeminiVision().recognize(board, turn)
    fen = candidate_fen(result, turn)
    return {
        **result.model_dump(),
        "fen": fen,
        "validation": validate(fen).model_dump(),
        "uncertain": [
            s.square
            for s in result.squares
            if s.confidence < 0.8 or s.alternatives or s.square in changed
        ],
        "rectified": vision.data_url(board),
        "confidence_kind": "model-estimated",
        "provider": "gemini",
        "model": os.getenv("VISION_MODEL", DEFAULT_MODEL),
    }


@app.post("/api/preview")
async def preview(
    file: Annotated[UploadFile, File()],
    corners: Annotated[str, Form()],
    rotation: Annotated[int, Form()] = 0,
):
    if rotation not in [0, 90, 180, 270]:
        raise ValueError("Invalid rotation.")
    image = await read_image(file)
    try:
        points = json.loads(corners)
    except (json.JSONDecodeError, TypeError):
        raise ValueError("Invalid corner coordinates.")
    board = await asyncio.to_thread(vision.rectify, image, points)
    if rotation:
        board = cv2.rotate(
            board,
            {
                90: cv2.ROTATE_90_CLOCKWISE,
                180: cv2.ROTATE_180,
                270: cv2.ROTATE_90_COUNTERCLOCKWISE,
            }[rotation],
        )
    return {"image": vision.data_url(vision.indexed(board))}


@app.post("/api/validate-position", response_model=Validation)
async def validate_position(request: PositionRequest):
    return validate(request.fen)


@app.post("/api/analyze", response_model=Analysis)
async def analyze(body: AnalysisRequest, request: Request):
    validation = validate(body.fen)
    if not validation.valid:
        raise ValueError(" ".join(validation.errors))
    task = asyncio.create_task(engine.analyze(body))
    try:
        while not task.done():
            await asyncio.sleep(0.1)
            if await request.is_disconnected():
                task.cancel()
                raise HTTPException(499, "Analysis cancelled.")
        return await task
    finally:
        if not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
