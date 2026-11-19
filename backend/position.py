import chess

from .models import Recognition, Validation


def validate(fen: str) -> Validation:
    try:
        b = chess.Board(fen)
    except ValueError as e:
        return Validation(valid=False, errors=[str(e)], warnings=[])
    status = b.status()
    descriptions = {
        chess.STATUS_NO_WHITE_KING: "Exactly one white king is required.",
        chess.STATUS_NO_BLACK_KING: "Exactly one black king is required.",
        chess.STATUS_TOO_MANY_KINGS: "There are too many kings.",
        chess.STATUS_TOO_MANY_WHITE_PAWNS: "White has more than eight pawns.",
        chess.STATUS_TOO_MANY_BLACK_PAWNS: "Black has more than eight pawns.",
        chess.STATUS_PAWNS_ON_BACKRANK: "Pawns cannot remain on ranks 1 or 8.",
        chess.STATUS_TOO_MANY_WHITE_PIECES: "White has more than sixteen pieces.",
        chess.STATUS_TOO_MANY_BLACK_PIECES: "Black has more than sixteen pieces.",
        chess.STATUS_BAD_CASTLING_RIGHTS: "Castling rights conflict with king or rook locations.",
        chess.STATUS_INVALID_EP_SQUARE: "En passant target is inconsistent with this position.",
        chess.STATUS_OPPOSITE_CHECK: "The side that just moved has left its king in check (or kings are adjacent).",
        chess.STATUS_TOO_MANY_CHECKERS: "Too many pieces are checking the king.",
        chess.STATUS_IMPOSSIBLE_CHECK: "This check configuration is impossible.",
        chess.STATUS_EMPTY: "The board is empty.",
    }
    errors = [message for flag, message in descriptions.items() if status & flag]
    if status and not errors:
        errors.append("Invalid standard chess position.")
    warnings = []
    for color, name in [(chess.WHITE, "White"), (chess.BLACK, "Black")]:
        if any(
            len(b.pieces(t, color)) > n
            for t, n in [
                (chess.QUEEN, 1),
                (chess.ROOK, 2),
                (chess.BISHOP, 2),
                (chess.KNIGHT, 2),
            ]
        ):
            warnings.append(
                f"{name} has unusual material; promotions may explain it. Review visually."
            )
    return Validation(valid=not status, errors=errors, warnings=warnings)


def candidate_fen(result: Recognition, turn="w") -> str:
    board = chess.Board(None)
    for s in result.squares:
        if s.piece:
            board.set_piece_at(
                chess.parse_square(s.square), chess.Piece.from_symbol(s.piece)
            )
    board.turn = turn == "w"
    return board.fen()
