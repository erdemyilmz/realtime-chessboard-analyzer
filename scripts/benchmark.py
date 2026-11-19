"""Offline scoring of real-photo recognition JSON against human placement labels."""

import json
import sys
from pathlib import Path

import chess


def score(manifest):
    records = json.loads(manifest.read_text(encoding="utf-8"))
    correct = exact = flagged_errors = errors = failures = 0
    for record in records:
        truth = chess.Board(record["truth_fen"])
        try:
            prediction = json.loads(
                (manifest.parent / record["prediction"]).read_text(encoding="utf-8")
            )
            if "squares" not in prediction:
                raise ValueError("No recognition squares")
            pieces = {p["square"]: p["piece"] for p in prediction["squares"]}
            if len(pieces) != 64:
                raise ValueError("Expected 64 unique squares")
            wrong = 0
            for square in chess.SQUARES:
                name = chess.square_name(square)
                expected = (
                    truth.piece_at(square).symbol() if truth.piece_at(square) else None
                )
                if pieces[name] == expected:
                    correct += 1
                else:
                    wrong += 1
                    errors += 1
                    if name in prediction.get("uncertain", []):
                        flagged_errors += 1
            exact += wrong == 0
        except (OSError, ValueError, KeyError):
            failures += 1
    n = len(records)
    return {
        "images": n,
        "failed_requests": failures,
        "square_accuracy_over_all_inputs": correct / (64 * n) if n else None,
        "exact_board_rate_over_all_inputs": exact / n if n else None,
        "fraction_of_classification_errors_flagged": flagged_errors / errors
        if errors
        else None,
        "confidence": "model-estimated; calibration not measured",
    }


if __name__ == "__main__":
    print(json.dumps(score(Path(sys.argv[1])), indent=2))
