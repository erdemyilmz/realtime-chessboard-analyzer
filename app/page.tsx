"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Chess, Square } from "chess.js";
import {
  Camera,
  Upload,
  ArrowUpRight,
  RotateCw,
  FlipVertical2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ScanLine,
  ArrowRight,
  Check,
  X,
  Settings2,
  Undo2,
  Redo2,
} from "lucide-react";
import {
  EMPTY,
  unpack,
  pack,
  displayPieces,
  moveFen,
  barPercent,
} from "../lib/chess";
const Board = dynamic(
  () => import("react-chessboard").then((m) => m.Chessboard),
  { ssr: false },
);
type Prediction = {
  square: string;
  piece: string | null;
  confidence: number;
  reason: string;
  alternatives: { piece: string | null; confidence: number }[];
};
type Recognition = {
  fen: string;
  uncertain: string[];
  squares: Prediction[];
  rectified: string;
  notes: string[];
  orientation_uncertain: boolean;
  validation: { valid: boolean; errors: string[]; warnings: string[] };
};
type Line = {
  move: string;
  uci: string;
  cp: number | null;
  mate: number | null;
  depth: number;
  pv: string[];
};
type Result = {
  fen: string;
  lines: Line[];
  terminal: string | null;
  cp: number | null;
  mate: number | null;
  engine: string;
};
type Step = { fen: string; san?: string; uci?: string };
const glyph: Record<string, string> = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
  P: "♙",
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};
async function api(path: string, body?: unknown, signal?: AbortSignal) {
  if (
    process.env.NEXT_PUBLIC_STATIC_HOST === "true" &&
    !process.env.NEXT_PUBLIC_API_URL
  ) {
    const { browserApi } = await import("../lib/browser-api");
    return browserApi(path, body, signal);
  }
  const res = await fetch(
    (process.env.NEXT_PUBLIC_API_URL || "") + "/api/" + path,
    {
      method: body ? "POST" : "GET",
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
      headers:
        body && !(body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : undefined,
      signal,
    },
  );
  if (!res.ok) {
    let message =
      "The service is unavailable. Check that the backend is running.";
    try {
      const data = await res.json();
      message =
        typeof data.detail === "string"
          ? data.detail
          : JSON.stringify(data.detail);
    } catch {}
    throw Error(message);
  }
  return res.json();
}
const score = (cp: number | null, mate: number | null) =>
  mate !== null
    ? `${mate < 0 ? "-" : ""}M${Math.abs(mate)}`
    : cp === null
      ? "—"
      : `${cp >= 0 ? "+" : ""}${(cp / 100).toFixed(2)}`;
export default function Home() {
  const [mappingPreview, setMappingPreview] = useState(""),
    [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [fen, setFen] = useState(EMPTY),
    [mode, setMode] = useState<"edit" | "analyze">("edit"),
    [flip, setFlip] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [brush, setBrush] = useState("P");
  const [file, setFile] = useState<File | null>(null),
    [photo, setPhoto] = useState(""),
    [dimensions, setDimensions] = useState([1, 1]),
    [corners, setCorners] = useState<number[][]>([]),
    [rotation, setRotation] = useState(0),
    [recognition, setRecognition] = useState<Recognition | null>(null),
    [stage, setStage] = useState("Upload image");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [health, setHealth] = useState<{
      engine_ready: boolean;
      vision_ready: boolean;
    } | null>(null);
  const [result, setResult] = useState<Result | null>(null),
    [thinking, setThinking] = useState(false),
    [depth, setDepth] = useState(18),
    [multipv, setMultipv] = useState(3),
    [arrow, setArrow] = useState(true),
    [history, setHistory] = useState<Step[]>([{ fen: EMPTY }]),
    [cursor, setCursor] = useState(0),
    [editHistory, setEditHistory] = useState([EMPTY]),
    [editCursor, setEditCursor] = useState(0),
    [text, setText] = useState(""),
    [promotion, setPromotion] = useState<{ from: string; to: string } | null>(
      null,
    );
  const photoInput = useRef<HTMLInputElement>(null),
    cameraInput = useRef<HTMLInputElement>(null),
    boardRef = useRef<HTMLDivElement>(null),
    uploadVersion = useRef(0);
  useEffect(() => {
    setMappingPreview("");
    setMappingConfirmed(false);
  }, [corners, rotation]);
  async function previewMapping() {
    if (!file) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    form.append("corners", JSON.stringify(corners));
    form.append("rotation", String(rotation));
    try {
      const data = await api("preview", form);
      setMappingPreview(data.image);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    api("health")
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);
  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo);
    },
    [photo],
  );
  useEffect(() => {
    if (mode !== "analyze") return;
    const abort = new AbortController();
    setResult(null);
    setThinking(true);
    const timer = setTimeout(
      () =>
        api("analyze", { fen, depth, multipv }, abort.signal)
          .then(setResult)
          .catch((e) => {
            if (e.name !== "AbortError") setError(e.message);
          })
          .finally(() => {
            if (!abort.signal.aborted) setThinking(false);
          }),
      400,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [fen, depth, multipv, mode]);
  function edit(next: string) {
    setFen(next);
    setEditHistory([...editHistory.slice(0, editCursor + 1), next]);
    setEditCursor(editCursor + 1);
    setResult(null);
  }
  function metadata(index: number, value: string) {
    const fields = fen.split(" ");
    fields[index] = value;
    edit(fields.join(" "));
    if (index === 1) setConfirmed(false);
  }
  async function upload(original?: File) {
    if (!original) return;
    const version = ++uploadVersion.current;
    setError("");
    setNotice("");
    setBusy(true);
    setRecognition(null);
    setMode("edit");
    setConfirmed(false);
    setStage("Detecting board");
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(original.type))
        throw Error("Use a JPEG, PNG, or WebP photograph.");
      if (original.size > 10 * 1024 * 1024)
        throw Error("Photographs must be smaller than 10 MB.");
      const bitmap = await createImageBitmap(original, {
        imageOrientation: "from-image",
      });
      const canvas = document.createElement("canvas");
      const ratio = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.round(bitmap.width * ratio);
      canvas.height = Math.round(bitmap.height * ratio);
      canvas
        .getContext("2d")!
        .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(Error("Unable to read image."))),
          "image/jpeg",
          0.94,
        ),
      );
      const normalized = new File([blob], "board.jpg", { type: "image/jpeg" });
      setFile(normalized);
      setPhoto(URL.createObjectURL(normalized));
      setDimensions([canvas.width, canvas.height]);
      setRotation(0);
      setCorners([
        [canvas.width * 0.1, canvas.height * 0.1],
        [canvas.width * 0.9, canvas.height * 0.1],
        [canvas.width * 0.9, canvas.height * 0.9],
        [canvas.width * 0.1, canvas.height * 0.9],
      ]);
      const form = new FormData();
      form.append("file", normalized);
      try {
        const data = await api("detect", form);
        if (version === uploadVersion.current) {
          setCorners(data.corners);
          setNotice(data.notes.join(" "));
        }
      } catch (e) {
        if (version === uploadVersion.current) setNotice((e as Error).message);
      }
      setStage("Confirm board corners");
    } catch (e) {
      setError((e as Error).message);
      setStage("Upload image");
    } finally {
      setBusy(false);
    }
  }
  async function recognize() {
    if (!file) return;
    setBusy(true);
    setError("");
    setStage("Recognizing pieces");
    const form = new FormData();
    form.append("file", file);
    form.append("corners", JSON.stringify(corners));
    form.append("rotation", String(rotation));
    form.append("turn", fen.split(" ")[1]);
    try {
      const data: Recognition = await api("recognize", form);
      setRecognition(data);
      edit(data.fen);
      setConfirmed(false);
      setStage("Review position");
      if (!data.validation.valid) setError(data.validation.errors.join(" "));
      setNotice(
        "Position detected. Please review the highlighted squares. " +
          data.notes.join(" "),
      );
    } catch (e) {
      setError((e as Error).message);
      setStage("Confirm board corners");
    } finally {
      setBusy(false);
    }
  }
  async function analyze() {
    setError("");
    if (!confirmed) {
      setError("Confirm whose turn it is before analysis.");
      return;
    }
    try {
      const validation = await api("validate-position", { fen });
      if (!validation.valid) {
        setError(validation.errors.join(" "));
        return;
      }
      setNotice(validation.warnings.join(" "));
      setHistory([{ fen }]);
      setCursor(0);
      setSelected(null);
      setMode("analyze");
      setStage("Analyzing position");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function play(from: string, to: string, p = "q") {
    try {
      const next = moveFen(fen, from, to, p);
      setHistory([...history.slice(0, cursor + 1), next]);
      setCursor(cursor + 1);
      setFen(next.fen);
      setSelected(null);
      return true;
    } catch {
      return false;
    }
  }
  function drop(from: string, to: string | null) {
    if (!to) return false;
    if (from === to) return false;
    if (mode === "edit") {
      const pieces = unpack(fen);
      if (pieces[from]) {
        pieces[to] = pieces[from];
        delete pieces[from];
        edit(pack(pieces, fen.split(" ").slice(1).join(" ")));
      }
      return true;
    }
    const piece = unpack(fen)[from];
    if (piece?.toLowerCase() === "p" && /[18]$/.test(to)) {
      try {
        moveFen(fen, from, to);
        setPromotion({ from, to });
      } catch {}
      return false;
    }
    return play(from, to);
  }
  function click(square: string) {
    if (mode === "edit") {
      setSelected(square);
      return;
    }
    if (selected && selected !== square && drop(selected, square)) {
      setSelected(null);
      return;
    }
    setSelected(square);
  }
  function navigate(index: number) {
    setCursor(index);
    setFen(history[index].fen);
    setSelected(null);
  }
  function save(name: string, data: string, type = "text/plain") {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportPgn() {
    try {
      const c = new Chess(mode === "edit" ? fen : history[0].fen);
      (mode === "edit" ? [] : history.slice(1, cursor + 1)).forEach((s) => {
        if (s.uci)
          c.move({
            from: s.uci.slice(0, 2),
            to: s.uci.slice(2, 4),
            promotion: s.uci[4],
          });
      });
      save("boardlight.pgn", c.pgn());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function importText(pgn = false) {
    try {
      if (pgn) {
        const c = new Chess();
        c.loadPgn(text);
        const moves = c.history({ verbose: true });
        const root = moves[0]?.before || c.fen();
        const steps = [
          { fen: root },
          ...moves.map((m) => ({
            fen: m.after,
            san: m.san,
            uci: m.from + m.to + (m.promotion || ""),
          })),
        ];
        setHistory(steps);
        setCursor(steps.length - 1);
        setFen(c.fen());
        setMode("analyze");
        setConfirmed(true);
      } else {
        const fields = text.trim().split(/\s+/);
        if (fields.length !== 6) throw Error("FEN must have six fields.");
        new Chess(text.trim(), { skipValidation: true });
        setMode("edit");
        edit(text.trim());
        setConfirmed(false);
      }
      setText("");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  let legal: string[] = [];
  try {
    if (mode === "analyze" && selected)
      legal = new Chess(fen)
        .moves({ square: selected as Square, verbose: true })
        .map((m) => m.to);
  } catch {}
  const styles: Record<string, React.CSSProperties> = {};
  recognition?.uncertain.forEach(
    (s) => (styles[s] = { boxShadow: "inset 0 0 0 4px #d79832" }),
  );
  legal.forEach(
    (s) =>
      (styles[s] = {
        backgroundImage:
          "radial-gradient(circle, #79383855 20%, transparent 23%)",
      }),
  );
  if (selected)
    styles[selected] = {
      ...styles[selected],
      boxShadow: "inset 0 0 0 4px #793838",
    };
  const last = history[cursor]?.uci;
  if (mode === "analyze" && last)
    [last.slice(0, 2), last.slice(2, 4)].forEach(
      (s) => (styles[s] = { ...styles[s], backgroundColor: "#d5b3a0" }),
    );
  const best = result?.lines[0],
    cp = best?.cp ?? result?.cp ?? null,
    mate = best?.mate ?? result?.mate ?? null,
    percent = barPercent(cp, mate, fen.split(" ")[1]);
  const fields = fen.split(" "),
    prediction = recognition?.squares.find((s) => s.square === selected);
  return (
    <main>
      <header>
        <a
          className="brand"
          href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/`}
        >
          ♞{" "}
          <span>
            boardlight<span className="brand-dot">.</span>
          </span>
        </a>
        <a href="#workspace" className="header-link">
          Open the board <ArrowUpRight size={16} />
        </a>
      </header>
      <section className="intro">
        <h1>Analyze a chessboard photo with Stockfish</h1>
      </section>
      <section className="workspace" id="workspace">
        <aside className="photo-panel">
          <div className="panel-heading">
            <span className="step-number">01</span>
            <h2>The photograph</h2>
          </div>
          <p className="muted small">
            Start with a clear view of all 64 squares.
          </p>
          {process.env.NEXT_PUBLIC_STATIC_HOST === "true" &&
            !process.env.NEXT_PUBLIC_API_URL && (
              <p className="small muted">
                This free site runs Stockfish in your browser. Set up pieces
                manually; automatic photo recognition requires a backend.{" "}
                <a
                  href="https://github.com/erdemyilmz/boardlight/blob/main/docs/GEMINI_SETUP.md"
                  style={{ textDecoration: "underline" }}
                >
                  Set up Gemini recognition
                </a>
                .
              </p>
            )}
          <input
            hidden
            ref={photoInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <input
            hidden
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {photo ? (
            <div className="photo-wrap">
              <img src={photo} alt="Uploaded physical chessboard" />
              <svg
                viewBox={`0 0 ${dimensions[0]} ${dimensions[1]}`}
                aria-label="Drag four corners to fit the board"
                onPointerMove={(e) => {
                  if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                  const index = Number(e.currentTarget.dataset.drag);
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = Math.max(
                      0,
                      Math.min(
                        dimensions[0] - 1,
                        ((e.clientX - rect.left) / rect.width) * dimensions[0],
                      ),
                    ),
                    y = Math.max(
                      0,
                      Math.min(
                        dimensions[1] - 1,
                        ((e.clientY - rect.top) / rect.height) * dimensions[1],
                      ),
                    );
                  setCorners((c) =>
                    c.map((p, i) => (i === index ? [x, y] : p)),
                  );
                }}
                onPointerUp={(e) =>
                  e.currentTarget.releasePointerCapture(e.pointerId)
                }
              >
                <polygon
                  points={corners.map((p) => p.join(",")).join(" ")}
                  fill="#79383822"
                  stroke="#a14e4e"
                  strokeWidth={dimensions[0] / 200}
                />
                {corners.map((p, i) => (
                  <circle
                    key={i}
                    cx={p[0]}
                    cy={p[1]}
                    r={dimensions[0] / 35}
                    fill="#ffffff"
                    stroke="#793838"
                    strokeWidth={dimensions[0] / 250}
                    onPointerDown={(e) => {
                      e.currentTarget.parentElement!.dataset.drag = String(i);
                      (
                        e.currentTarget
                          .parentElement as unknown as SVGSVGElement
                      ).setPointerCapture(e.pointerId);
                    }}
                  />
                ))}
              </svg>
            </div>
          ) : (
            <button
              disabled={busy}
              className="upload-zone"
              onClick={() => photoInput.current?.click()}
            >
              <span className="upload-icon">
                <Upload size={25} />
              </span>
              <strong>Upload a chessboard photo</strong>
              <span>Review the pieces before analysis</span>
              <span className="file-types">JPG, PNG, WEBP · up to 10 MB</span>
              <span className="upload-cta">
                Choose a photograph <ArrowRight size={15} />
              </span>
            </button>
          )}
          <div className="button-row">
            <button
              disabled={busy}
              onClick={() => cameraInput.current?.click()}
            >
              <Camera size={15} /> Take photo
            </button>
            <button disabled={busy} onClick={() => photoInput.current?.click()}>
              <Upload size={15} /> {photo ? "Replace" : "Upload"}
            </button>
          </div>
          {photo && (
            <>
              <p className="small muted">
                Drag the corner handles to the outside board edges. Coordinates
                are assigned after rotation: a8 at top-left, h1 at bottom-right.
              </p>
              <button
                disabled={busy}
                className="full"
                onClick={() => setRotation((rotation + 90) % 360)}
              >
                <RotateCw size={15} /> Rotate mapping: {rotation}° clockwise
              </button>
              <button disabled={busy} className="full" onClick={previewMapping}>
                Preview square mapping
              </button>
              {mappingPreview && (
                <>
                  <img
                    className="mapping-preview"
                    src={mappingPreview}
                    alt="Perspective corrected square mapping labeled a8 to h1"
                  />
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={mappingConfirmed}
                      onChange={(e) => setMappingConfirmed(e.target.checked)}
                    />
                    These square labels match my board
                  </label>
                </>
              )}
              <button
                disabled={busy || !mappingConfirmed}
                className="primary full"
                onClick={recognize}
              >
                <ScanLine size={16} />
                {busy ? stage : "Recognize position"}
              </button>
            </>
          )}
          <div className="status">
            <span className={busy ? "pulse" : "status-dot"} />
            {stage}
          </div>
          <div className="privacy">
            <p>
              Photos are processed in memory. Recognition sends the corrected
              board to Google Gemini.
            </p>
          </div>
        </aside>
        <section className="board-panel">
          <div className="board-top">
            <div className="tabs">
              <button
                className={mode === "edit" ? "active" : ""}
                onClick={() => {
                  setMode("edit");
                  setThinking(false);
                  setEditHistory([fen]);
                  setEditCursor(0);
                }}
              >
                Edit position
              </button>
              <button
                className={mode === "analyze" ? "active" : ""}
                onClick={analyze}
              >
                Analyze
              </button>
            </div>
            <button
              className="icon-button"
              title="Flip board without changing position"
              aria-label="Flip board"
              onClick={() => setFlip(!flip)}
            >
              <FlipVertical2 size={18} />
            </button>
          </div>
          <div className="board-with-eval">
            <div
              className="eval-bar"
              aria-label={`White perspective evaluation ${score(cp, mate)}`}
            >
              <div className="eval-white" style={{ height: `${percent}%` }} />
              <span
                className={
                  percent > 50 ? "eval-label dark-label" : "eval-label"
                }
              >
                {thinking ? "…" : score(cp, mate)}
              </span>
            </div>
            <div className="board" ref={boardRef}>
              <Board
                id="boardlight"
                position={displayPieces(fen)}
                boardOrientation={flip ? "black" : "white"}
                customLightSquareStyle={{ backgroundColor: "#F0D9B5" }}
                customDarkSquareStyle={{ backgroundColor: "#B58863" }}
                customSquareStyles={styles}
                onPieceDrop={drop}
                onSquareClick={click}
                arePiecesDraggable={!busy}
                customArrows={
                  arrow && best
                    ? [
                        [
                          best.uci.slice(0, 2) as Square,
                          best.uci.slice(2, 4) as Square,
                          "#793838",
                        ],
                      ]
                    : []
                }
                animationDuration={180}
              />
            </div>
          </div>
          <div className="board-caption">
            <span>
              <i className={fields[1] === "w" ? "white-disc" : "black-disc"} />
              {fields[1] === "w" ? "White" : "Black"} to move
            </span>
            <span>
              {mode === "edit"
                ? "Click a square to correct it"
                : "Play a move to explore"}
            </span>
          </div>
          {mode === "edit" ? (
            <>
              <div className="edit-tools">
                <div className="piece-palette">
                  {Object.keys(glyph).map((p) => (
                    <button
                      title={`Select ${p === p.toUpperCase() ? "white" : "black"} ${p.toUpperCase()}`}
                      aria-label={`Select piece ${p}`}
                      className={brush === p ? "chosen" : ""}
                      key={p}
                      onClick={() => {
                        setBrush(p);
                        if (selected) {
                          const pieces = unpack(fen);
                          pieces[selected] = p;
                          edit(pack(pieces, fields.slice(1).join(" ")));
                        }
                      }}
                    >
                      {glyph[p]}
                    </button>
                  ))}
                  <button
                    title="Remove selected piece"
                    aria-label="Remove selected piece"
                    onClick={() => {
                      if (selected) {
                        const pieces = unpack(fen);
                        delete pieces[selected];
                        edit(pack(pieces, fields.slice(1).join(" ")));
                      }
                    }}
                  >
                    <X size={17} />
                  </button>
                </div>
                <p className="small muted">
                  {selected
                    ? `${selected}: choose a piece above, or remove it.`
                    : "Select a square, then choose a piece. Drag pieces to reposition."}
                </p>
                <div className="button-row">
                  <button
                    disabled={!editCursor}
                    onClick={() => {
                      setEditCursor(editCursor - 1);
                      setFen(editHistory[editCursor - 1]);
                    }}
                  >
                    <Undo2 size={14} />
                    Undo
                  </button>
                  <button
                    disabled={editCursor === editHistory.length - 1}
                    onClick={() => {
                      setEditCursor(editCursor + 1);
                      setFen(editHistory[editCursor + 1]);
                    }}
                  >
                    <Redo2 size={14} />
                    Redo
                  </button>
                  <button onClick={() => edit(EMPTY)}>Clear board</button>
                  <button
                    onClick={() => {
                      edit(new Chess().fen().replace(" KQkq ", " - "));
                      setNotice(
                        "Standard starting position loaded manually. Castling rights are unset.",
                      );
                    }}
                  >
                    Starting position
                  </button>
                </div>
              </div>
              {selected && recognition && (
                <div className="square-review">
                  <div
                    className="square-crop"
                    style={{
                      backgroundImage: `url(${recognition.rectified})`,
                      backgroundSize: "800% 800%",
                      backgroundPosition: `${("abcdefgh".indexOf(selected[0]) / 7) * 100}% ${((8 - Number(selected[1])) / 7) * 100}%`,
                    }}
                  />
                  <div>
                    <strong>
                      {selected} ·{" "}
                      {prediction?.piece ? glyph[prediction.piece] : "Empty"}
                    </strong>
                    <p>{prediction?.reason}</p>
                    <small>
                      Model-estimated confidence:{" "}
                      {prediction
                        ? Math.round(prediction.confidence * 100)
                        : "—"}
                      %
                      {prediction?.alternatives.length
                        ? " · Alternatives: " +
                          prediction.alternatives
                            .map((p) => p.piece || "empty")
                            .join(", ")
                        : ""}
                    </small>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="navigation">
              <button
                aria-label="Previous move"
                disabled={!cursor}
                onClick={() => navigate(cursor - 1)}
              >
                <ChevronLeft size={18} />
              </button>
              <span>
                Move {cursor} of {history.length - 1}
              </span>
              <button
                aria-label="Next move"
                disabled={cursor === history.length - 1}
                onClick={() => navigate(cursor + 1)}
              >
                <ChevronRight size={18} />
              </button>
              <button onClick={() => navigate(0)}>Reset analysis</button>
            </div>
          )}
          <div className="board-actions">
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(fen);
                  setNotice("FEN copied.");
                } catch {
                  setText(fen);
                  setNotice("Copy the FEN from the position field below.");
                }
              }}
            >
              <Copy size={14} />
              Copy FEN
            </button>
            <button
              onClick={async () => {
                try {
                  const { toPng } = await import("html-to-image");
                  if (boardRef.current) {
                    const url = await toPng(boardRef.current);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "boardlight.png";
                    a.click();
                  }
                } catch {
                  setError("Image export failed. Please try again.");
                }
              }}
            >
              <Download size={14} />
              Save board
            </button>
          </div>
        </section>
        <aside className="analysis-panel">
          <div className="panel-heading">
            <span className="step-number">03</span>
            <h2>Stockfish analysis</h2>
          </div>
          <div className="engine-label">
            <span className={thinking ? "pulse" : "status-dot"} />
            {thinking
              ? "Stockfish is searching"
              : result?.engine || "Stockfish analysis"}
          </div>
          <div className="evaluation">
            <span>
              {mode === "edit"
                ? "Position not analyzed"
                : result?.terminal?.replaceAll("_", " ").toLowerCase() ||
                  "White perspective"}
            </span>
            <strong>{thinking ? "…" : score(cp, mate)}</strong>
            <p>
              {best
                ? `Depth ${best.depth} · ${fields[1] === "w" ? "White" : "Black"} to move`
                : "Review the pieces and confirm the side to move."}
            </p>
          </div>
          {mode === "edit" ? (
            <div className="review-controls">
              <label>
                Whose turn is it?
                <select
                  value={fields[1]}
                  onChange={(e) => metadata(1, e.target.value)}
                >
                  <option value="w">White to move</option>
                  <option value="b">Black to move</option>
                </select>
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I confirm the side to move
              </label>
              {recognition && (
                <p className="small">
                  {recognition.uncertain.length} squares need review.
                  {recognition.orientation_uncertain
                    ? " Confirm board orientation before analyzing."
                    : ""}
                </p>
              )}
              <button
                disabled={busy}
                className="primary full"
                onClick={analyze}
              >
                Analyze with Stockfish <ArrowRight size={16} />
              </button>
            </div>
          ) : (
            <>
              <div className="candidate-heading">
                CANDIDATE MOVES{" "}
                <button
                  onClick={() => setArrow(!arrow)}
                  className="text-button"
                >
                  {arrow ? "Hide" : "Show"} best move
                </button>
              </div>
              <div className="candidates">
                {result?.lines.map((line, i) => (
                  <button
                    key={line.uci}
                    className={i === 0 ? "candidate best" : "candidate"}
                    onClick={() =>
                      play(
                        line.uci.slice(0, 2),
                        line.uci.slice(2, 4),
                        line.uci[4],
                      )
                    }
                  >
                    <div>
                      <span className="candidate-rank">{i + 1}</span>
                      <strong>{line.move}</strong>
                      <b>{score(line.cp, line.mate)}</b>
                    </div>
                    <p>{line.pv.join(" ")}</p>
                  </button>
                ))}
              </div>
              <div className="candidate-heading">YOUR EXPLORATION</div>
              <div className="move-history">
                {history.length === 1 ? (
                  <p className="muted small">
                    Make a move on the board to start a line.
                  </p>
                ) : (
                  history.slice(1).map((s, i) => (
                    <button
                      key={i}
                      className={cursor === i + 1 ? "active" : ""}
                      onClick={() => navigate(i + 1)}
                    >
                      {i + 1}. {s.san}
                    </button>
                  ))
                )}
              </div>
            </>
          )}
          <details className="settings" open>
            <summary>
              <Settings2 size={15} /> Analysis settings
            </summary>
            <label>
              Search depth
              <select
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
              >
                {[10, 14, 18, 22, 24].map((n) => (
                  <option key={n} value={n}>
                    {n} ply
                  </option>
                ))}
              </select>
            </label>
            <label>
              Candidate moves
              <select
                value={multipv}
                onChange={(e) => setMultipv(Number(e.target.value))}
              >
                {[1, 2, 3].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <p className="small muted">
              Search is time limited; achieved depth may be lower. Scores favor
              White when positive.
            </p>
          </details>
          <div className="service-status">
            <span className={health?.engine_ready ? "ready" : ""} />
            Engine {health?.engine_ready ? "available" : "needs setup"}
            <br />
            <span className={health?.vision_ready ? "ready" : ""} />
            AI {health?.vision_ready ? "configured" : "needs API key"}
          </div>
        </aside>
      </section>
      <div className="messages" aria-live="polite">
        {error && (
          <div role="alert" className="error">
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={15} />
            </button>
          </div>
        )}
        {notice && (
          <div className="notice">
            <Check size={15} />
            <span>{notice}</span>
          </div>
        )}
      </div>
      <section className="advanced">
        <details>
          <summary>Position details & import / export</summary>
          <div className="advanced-grid">
            <div>
              <label>
                FEN / PGN
                <textarea
                  aria-label="FEN or PGN to import"
                  placeholder={fen}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
              <div className="button-row">
                <button onClick={() => importText()}>Import FEN</button>
                <button onClick={() => importText(true)}>Import PGN</button>
                <button onClick={() => save("position.fen", fen)}>
                  Export FEN
                </button>
                <button onClick={exportPgn}>Export PGN</button>
              </div>
              <code>{fen}</code>
            </div>
            <div>
              <p className="small muted">
                A photo cannot establish game history. Set these explicitly;
                castling is off by default.
              </p>
              <fieldset disabled={mode !== "edit"}>
                <legend>Castling rights</legend>
                {["K", "Q", "k", "q"].map((right, i) => (
                  <label className="checkbox" key={right}>
                    <input
                      type="checkbox"
                      checked={fields[2].includes(right)}
                      onChange={(e) =>
                        metadata(
                          2,
                          ["K", "Q", "k", "q"]
                            .filter((r) =>
                              r === right
                                ? e.target.checked
                                : fields[2].includes(r),
                            )
                            .join("") || "-",
                        )
                      }
                    />
                    {
                      [
                        "White king side",
                        "White queen side",
                        "Black king side",
                        "Black queen side",
                      ][i]
                    }
                  </label>
                ))}
                <label>
                  En passant target
                  <input
                    value={fields[3]}
                    onChange={(e) => metadata(3, e.target.value)}
                    placeholder="-"
                  />
                </label>
                <label>
                  Halfmove clock
                  <input
                    type="number"
                    min={0}
                    value={fields[4]}
                    onChange={(e) => metadata(4, e.target.value)}
                  />
                </label>
                <label>
                  Fullmove number
                  <input
                    type="number"
                    min={1}
                    value={fields[5]}
                    onChange={(e) => metadata(5, e.target.value)}
                  />
                </label>
              </fieldset>
            </div>
          </div>
        </details>
      </section>
      <footer>
        <span className="brand">♞ boardlight.</span>
        {process.env.NEXT_PUBLIC_STATIC_HOST === "true" && (
          <a
            href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/engine/SOURCE.txt`}
          >
            Stockfish license & source
          </a>
        )}
      </footer>
      {promotion && (
        <div className="modal-backdrop">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Choose promotion piece"
            className="modal"
          >
            <h2>Promote your pawn</h2>
            <div className="piece-palette">
              {["q", "r", "b", "n"].map((p) => (
                <button
                  aria-label={`Promote to ${p}`}
                  key={p}
                  onClick={() => {
                    play(promotion.from, promotion.to, p);
                    setPromotion(null);
                  }}
                >
                  {glyph[fields[1] === "w" ? p.toUpperCase() : p]}
                </button>
              ))}
            </div>
            <button onClick={() => setPromotion(null)}>Cancel</button>
          </div>
        </div>
      )}
    </main>
  );
}
