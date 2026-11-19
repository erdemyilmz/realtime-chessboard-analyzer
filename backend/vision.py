"""Geometry is independent of the vision provider. Coordinates use source pixels."""

import base64

import cv2
import numpy as np

MAX_PIXELS = 24_000_000


def decode(data: bytes):
    if not (
        data.startswith((b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n"))
        or (data[:4] == b"RIFF" and data[8:12] == b"WEBP")
    ):
        raise ValueError("Use a JPEG, PNG, or WebP photograph.")
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("This image could not be decoded.")
    h, w = image.shape[:2]
    if w * h > MAX_PIXELS or min(w, h) < 80:
        raise ValueError("Use an image between 80 pixels and 24 megapixels.")
    return image


def ordered(points):
    p = np.array(points, dtype=np.float32)
    if p.shape != (4, 2) or not np.isfinite(p).all():
        raise ValueError("Provide exactly four finite corner coordinates.")
    # Order clockwise from top-left; callers preserve orientation separately.
    p = p[np.argsort(np.arctan2(p[:, 1] - p[:, 1].mean(), p[:, 0] - p[:, 0].mean()))]
    return np.roll(p, -int(np.argmin(p.sum(axis=1))), axis=0)


def rectify(image, corners):
    p = ordered(corners)
    h, w = image.shape[:2]
    if (p < 0).any() or (p[:, 0] >= w).any() or (p[:, 1] >= h).any():
        raise ValueError("Corners must stay inside the image.")
    if (
        not cv2.isContourConvex(p.reshape(-1, 1, 2))
        or abs(cv2.contourArea(p)) < w * h * 0.015
    ):
        raise ValueError("Corners must form a convex board with sufficient area.")
    transform = cv2.getPerspectiveTransform(
        p, np.float32([[0, 0], [799, 0], [799, 799], [0, 799]])
    )
    return cv2.warpPerspective(image, transform, (800, 800))


def detect(image):
    h, w = image.shape[:2]
    scale = min(1, 1200 / max(h, w))
    small = cv2.resize(image, None, fx=scale, fy=scale)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    if cv2.Laplacian(gray, cv2.CV_64F).var() < 18:
        raise ValueError(
            "The photograph is too blurry. Retake it or mark the corners manually."
        )
    found, points = cv2.findChessboardCornersSB(
        gray, (7, 7), cv2.CALIB_CB_NORMALIZE_IMAGE
    )
    if found:
        grid = points.reshape(7, 7, 2)
        src = np.array([[x, y] for y in range(1, 8) for x in range(1, 8)], np.float32)
        matrix, _ = cv2.findHomography(src, grid.reshape(-1, 2))
        corners = (
            cv2.perspectiveTransform(
                np.float32([[[0, 0], [8, 0], [8, 8], [0, 8]]]), matrix
            )[0]
            / scale
        )
        corners = ordered(corners)
        # Subpixel grid extrapolation may overshoot an image-edge board by <1px.
        if (
            corners[:, 0].min() < -2
            or corners[:, 1].min() < -2
            or corners[:, 0].max() > w + 1
            or corners[:, 1].max() > h + 1
        ):
            raise ValueError(
                "The detected board extends beyond the photograph. Retake it or mark the corners manually."
            )
        corners[:, 0] = np.clip(corners[:, 0], 0, w - 1)
        corners[:, 1] = np.clip(corners[:, 1], 0, h - 1)
        rectify(image, corners)
        return corners.tolist(), [
            "Confirm the detected boundary and which edge is White’s side."
        ]
    edges = cv2.Canny(gray, 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    for contour in contours:
        poly = cv2.approxPolyDP(contour, 0.025 * cv2.arcLength(contour, True), True)
        area = abs(cv2.contourArea(poly))
        if (
            len(poly) == 4
            and cv2.isContourConvex(poly)
            and area > small.shape[0] * small.shape[1] * 0.12
        ):
            p = ordered(poly.reshape(4, 2)) / scale
            if not any(
                np.linalg.norm(p - other) < max(w, h) * 0.08 for other in candidates
            ):
                candidates.append(p)
    if len(candidates) > 1:
        # Nested outlines are common; only report spatially separate boards.
        centers = [p.mean(axis=0) for p in candidates]
        if any(np.linalg.norm(c - centers[0]) > min(w, h) * 0.25 for c in centers[1:]):
            raise ValueError(
                "Multiple possible boards were found. Crop to one board or mark its corners."
            )
    if not candidates:
        raise ValueError(
            "No board boundary found. Mark the four board corners manually."
        )
    p = max(candidates, key=lambda p: abs(cv2.contourArea(p)))
    return p.tolist(), [
        "Boundary is a geometric proposal, not a verified chessboard. Adjust before recognition."
    ]


def data_url(image):
    ok, buffer = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        raise ValueError("Unable to encode the board image.")
    return "data:image/jpeg;base64," + base64.b64encode(buffer).decode()


def indexed(image):
    # Labels occupy a separate gutter in each tile and do not obscure the pieces.
    sheet = np.full((8 * 130, 8 * 110, 3), 245, np.uint8)
    for row in range(8):
        for col in range(8):
            x, y = col * 110, row * 130
            sheet[y + 25 : y + 125, x + 5 : x + 105] = image[
                row * 100 : (row + 1) * 100, col * 100 : (col + 1) * 100
            ]
            cv2.putText(
                sheet,
                f"{chr(97 + col)}{8 - row}",
                (x + 8, y + 19),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (30, 30, 30),
                1,
            )
    return sheet
