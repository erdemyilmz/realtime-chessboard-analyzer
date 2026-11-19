# Boardlight

## Free GitHub Pages version

For photo recognition, follow the [Gemini + free Render setup guide](docs/GEMINI_SETUP.md). The backend uses Google's official SDK with `GEMINI_API_KEY` and configurable `VISION_MODEL`; the key is never sent to the frontend.

The repository's Pages workflow builds the frontend with a real single-threaded **Stockfish 19 Lite WebAssembly worker**. Manual editing, legal play, FEN/PGN tools, move arrows, and engine evaluation run in your browser with no paid service. The Lite engine is smaller and weaker than the full native engine. It is not a simulated evaluation.

GitHub Pages cannot run Python or keep API keys secret. Automatic photo detection/recognition requires the backend below; without it, the uploaded photo stays available for manual comparison and the site explains the limitation. Nothing substitutes a fabricated recognized position.

The workflow publishes to `https://erdemyilmz.github.io/boardlight/`. For another repository, update `NEXT_PUBLIC_BASE_PATH` in `.github/workflows/pages.yml`. The GitHub Pages repository setting must use **GitHub Actions** as its publishing source.

To enable hosted recognition, deploy the included `render.yaml` blueprint on Render's free plan, set the server-side API key there, and set this repository's `VISION_BACKEND_URL` Actions variable to the resulting HTTPS backend origin, without a trailing slash. Re-run the Pages workflow. The backend's allowed origin must match the Pages origin. Free Render servers sleep when idle; AI provider usage is separate and can incur charges. No backend service or paid AI usage is provisioned by the Pages workflow.

To test the same static build locally in PowerShell:

```powershell
$env:NEXT_PUBLIC_STATIC_HOST='true'
$env:NEXT_PUBLIC_BASE_PATH='/boardlight'
npm run build
# Serve out/ under /boardlight/ with any static server.
```

Remove those two environment variables before returning to the full local server setup. Do not deploy `.env`. Browser engine files are copied from the pinned npm package during install/build, with the GPL license and exact upstream source links available beside the binary and in the site's footer.

A local-first chessboard recognition and analysis application. Next.js + React + TypeScript provide the review interface; FastAPI, OpenCV, a structured multimodal provider, python-chess, and **a real Stockfish UCI process** do the work. The initial board is empty. Starting positions appear only when explicitly loaded by the user.

## Quick start

Requires Node.js 22+, Python 3.11+, and Stockfish. All commands run from this repository.

### Windows (PowerShell)

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-lock.txt
npm ci
Copy-Item .env.example .env
```

Download and extract an engine from the [official Stockfish downloads](https://stockfishchess.org/download/). Set `STOCKFISH_PATH` in `.env` to the executable's **absolute path**, using forward slashes, for example `C:/chess/stockfish/stockfish.exe`. Keep the engine's supplied network files beside it if the distribution requires them. Stockfish is GPLv3; its source and license are in the official release.

### macOS / Linux

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements-lock.txt
npm ci
cp .env.example .env
# macOS:
brew install stockfish
# Debian / Ubuntu:
sudo apt-get install stockfish
```

Set `STOCKFISH_PATH` to the result of `which stockfish` (often `/opt/homebrew/bin/stockfish` or `/usr/games/stockfish`). The lock file records the tested Python package set; use `backend/requirements.txt` if a different platform requires re-resolution.

### Start both services

```sh
npm run dev
```

Open [localhost:3000](http://localhost:3000). The launcher selects the project virtual environment automatically. Override its Python executable with the `PYTHON` environment variable if necessary. Ctrl+C stops both services. API documentation is at [localhost:8000/docs](http://localhost:8000/docs).

The frontend reloads during development. Restart the command after backend source or configuration changes.

For production builds: `npm run build`, then run `npm start` and `.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000` in separate terminals (Windows: `.venv/Scripts/python.exe`). Keep one backend worker to maintain a single engine and cache. Put authentication, HTTPS, request rate limits, and a total-body upload limit in front of a public deployment. The supplied configuration is a local application, not an authenticated multi-tenant service.

## Configuration

| Variable | Purpose |
| --- | --- |
| `STOCKFISH_PATH` | Absolute Stockfish executable path, or an executable on PATH |
| `GEMINI_API_KEY` | Server-only credential; optional for editing and analysis |
| `VISION_MODEL` | Image-capable Google Gemini model supporting structured outputs; default `gemini-3.5-flash-lite` |
| `ENGINE_SECONDS` | Per-search time budget, clamped to 1–20 seconds; default 8 |
| `BACKEND_URL` | Next.js proxy target, default `http://127.0.0.1:8000` |
| `ALLOWED_ORIGINS` | Comma-separated allowed frontend origins |

Never prefix API credentials with `NEXT_PUBLIC_`. Restart the backend after changing `.env`. Health indicators report whether configuration/executable paths exist, not whether a paid account has quota. No sample evaluations or recognition results are used as fallbacks.

## Using Boardlight

1. Upload a JPEG, PNG, or WebP photo, or use the phone camera. Browser-normalized upload images are limited to 2,000 pixels on their longest side; input files must be below 10 MB. The backend independently enforces format signatures, decoded dimensions, and a 10 MB file limit.
2. Review the proposed corners. Drag handles to the outside edges of the **playing area**, excluding the frame. If detection fails, handles are still available. The contour fallback is explicitly labeled as a geometric proposal.
3. Rotate the square mapping, preview the labeled perspective-corrected board, and confirm that the labels match your physical board. Coordinates are a8 at upper left, h1 at lower right after rotation.
4. Recognize. Two genuine vision requests compare the full board and a contact sheet of all 64 labeled square crops. The second pass reviews visual ambiguity and chess contradictions. Confidence is **model-estimated, not calibrated**. Gold outlines mark uncertain or revised squares. Missing pieces are never inserted by chess rules.
5. Click squares to inspect their crop and prediction; choose a replacement piece or remove it. Drag pieces freely in Edit Position. Undo/redo covers corrections. Compare against the uploaded photograph.
6. Confirm the side to move. Castling defaults to none; en passant defaults to none; counters default to 0 and 1. Position details allow explicit changes. Imported FEN metadata is preserved.
7. Analyze with Stockfish. Three candidate lines, actual achieved depth, SAN continuations, arrows, and the adjacent evaluation bar come from the engine. Positive centipawns favor White. Mate labels are signed from White's perspective. A terminal M0 means the side to move is checkmated. Bar proportions are a bounded tanh visualization, **not winning probabilities**.
8. Play legal moves, choose pawn promotions, navigate the line, click a candidate to play it, or export FEN/PGN/a board image. PGN contains the root position and the current explored branch; branching replaces the later moves. Board flipping changes only the view.

## Architecture

- `app/`: responsive neutral-and-burgundy interface, review/editor, analysis, import/export.
- `lib/chess.ts`: pure FEN mapping and client move helpers.
- `backend/vision.py`: decoding, internal-grid/contour detection, homography, indexed crop sheet. Provider-independent.
- `backend/provider.py`: replaceable Google Gemini vision adapter with strict Pydantic structured output and a context refinement pass. Transport retries are bounded.
- `backend/position.py`: python-chess status checks and evidence-preserving candidate FEN assembly.
- `backend/engine.py`: one lazy UCI process, serialized searches, bounded time/hash/threads, 128-entry FEN/depth/MultiPV cache, restart on timeout/crash.
- `backend/app.py`: `/api/detect`, `/api/preview`, `/api/recognize`, `/api/validate-position`, `/api/analyze`, `/api/health`.

The browser debounces analysis and aborts obsolete requests. The backend monitors disconnects and cancels the corresponding task. A shared lock prevents uncontrolled simultaneous engines. Recognition concurrency is limited to two. Photos are not saved by the backend; the browser retains its image until replacement/reload. Google Gemini receives the board images during recognition and its data-handling terms apply.

## Verification

```sh
npm run typecheck
npm test
npm run build
.venv/bin/python -m pytest backend/tests -q
```

Windows: replace `.venv/bin/python` with `.venv/Scripts/python.exe`. The real-engine integration test runs when Stockfish is available, otherwise explicitly skips. Tests use deterministic board images and known positions for geometry, orientations, missing kings, illegal metadata, promotions, unusual material, captures, black-to-move positions, FEN mapping, correction, score perspective, and SAN legality. They do not pretend synthetic boards validate real-photo accuracy.

One test makes **live Gemini calls only when both** `LIVE_VISION_PHOTO` and `GEMINI_API_KEY` are set. `LIVE_VISION_PHOTO` must be a corrected top-down board with White's coordinate orientation. Without an explicitly supplied photo, it skips.

### Physical-set benchmark

No real-photo accuracy claim is made. To evaluate your model, collect at least 30 consented photos across conventional wood, stylized/decorative, plastic, and metallic sets. Include both sides, rotated views, oblique angles, occlusion, blur, and promotions. Keep a held-out group of entire sets.

For each image, a human labels all squares, corners, intended rotation, and the true placement FEN. Set metadata separately. Run recognition and save the **unaltered API JSON**, not the user-corrected board. Use `python scripts/benchmark.py results/manifest.json` to measure per-square accuracy, exact-board rate, and uncertainty coverage. Manifest format:

```json
[
  {"id":"wood-01", "truth_fen":"8/8/8/4k3/8/4K3/8/8 w - - 0 1", "prediction":"wood-01.json"}
]
```

Prediction paths resolve relative to the manifest. Record model/version, camera angle, set family, detection failure rate, per-piece confusion, manual corrections, latency, and cost. Count detection/provider failures as failures in overall workflow reporting, and report conditional recognition accuracy separately. Confidence values require empirical calibration before threshold-based accuracy claims. Corner accuracy and square occlusion should be reviewed independently: top-down warps can distort tall pieces.

## Limits

Generic multimodal recognition can misread nontraditional pieces and cannot recover invisible evidence. Chess validity is a consistency check, not proof of historical reachability. Occluded pieces and ambiguous orientation require human review. The application is stateless across page reloads; export FEN/PGN to retain work. Real-phone camera capture depends on the browser and secure deployment. Typography uses the local Helvetica/Arial system stack; no external font requests are required.

Integration references: [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output), [python-chess engine communication](https://python-chess.readthedocs.io/en/latest/engine.html), [Stockfish setup](https://official-stockfish.github.io/docs/stockfish-wiki/Download-and-usage.html).
