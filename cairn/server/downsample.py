"""Series downsampling for the UI.

The server enforces a ``max_points`` bound on sequence-value responses so the
UI never drowns in data. We use Largest-Triangle-Three-Buckets (LTTB) as the
default because it preserves visual peaks/troughs far better than uniform
bucketing, and a simple uniform bucket as fallback.
"""

from __future__ import annotations

from math import fabs
from typing import Sequence, Tuple

Point = Tuple[float, float]


def lttb(points: Sequence[Point], threshold: int) -> list[Point]:
    """Largest-Triangle-Three-Buckets downsampling.

    Preserves the first and last point exactly; within each interior bucket,
    selects the point forming the largest triangle with the previous kept
    point and the next bucket's mean. Runs in O(n).
    """
    n = len(points)
    if threshold >= n or threshold <= 2:
        return list(points)

    sampled: list[Point] = [points[0]]

    bucket_size = (n - 2) / (threshold - 2)

    a = 0  # index of previously kept point
    for i in range(threshold - 2):
        # Next bucket average point
        avg_start = int((i + 1) * bucket_size) + 1
        avg_end = int((i + 2) * bucket_size) + 1
        avg_end = min(avg_end, n)
        avg_x = 0.0
        avg_y = 0.0
        count = max(avg_end - avg_start, 1)
        for j in range(avg_start, avg_end):
            avg_x += float(points[j][0])
            avg_y += float(points[j][1])
        avg_x /= count
        avg_y /= count

        # Current bucket range
        range_start = int(i * bucket_size) + 1
        range_end = int((i + 1) * bucket_size) + 1
        range_end = min(range_end, n)

        point_a_x = float(points[a][0])
        point_a_y = float(points[a][1])

        max_area = -1.0
        next_a = range_start
        max_point = points[range_start]
        for j in range(range_start, range_end):
            x = float(points[j][0])
            y = float(points[j][1])
            area = fabs(
                (point_a_x - avg_x) * (y - point_a_y)
                - (point_a_x - x) * (avg_y - point_a_y)
            ) * 0.5
            if area > max_area:
                max_area = area
                max_point = points[j]
                next_a = j
        sampled.append(max_point)
        a = next_a

    sampled.append(points[-1])
    return sampled


def uniform_bucket(points: Sequence[Point], threshold: int) -> list[Point]:
    """Take ``threshold`` evenly-spaced points (first + last always kept)."""
    n = len(points)
    if threshold >= n or threshold <= 2:
        return list(points)
    step = (n - 1) / (threshold - 1)
    out: list[Point] = []
    last_idx = -1
    for i in range(threshold):
        idx = int(round(i * step))
        if idx == last_idx:
            continue
        out.append(points[idx])
        last_idx = idx
    # Ensure last point is included (rounding can miss it).
    if out[-1] != points[-1]:
        out.append(points[-1])
    return out


def downsample(
    points: Sequence[Point],
    max_points: int | None,
    method: str = "lttb",
) -> list[Point]:
    """Reduce ``points`` to at most ``max_points`` samples.

    ``max_points=None`` or ``<=0`` returns the input unchanged.
    """
    if max_points is None or max_points <= 0 or len(points) <= max_points:
        return list(points)
    if method == "uniform":
        return uniform_bucket(points, max_points)
    return lttb(points, max_points)
