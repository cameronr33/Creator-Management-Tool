#!/usr/bin/env python3
"""
download_and_frame.py

Download an Instagram reel mp4 (or use a pre-downloaded local copy) and build a
frame montage (2x3 for short reels, 3x3 for reels longer than 90 seconds).

Handles the "URL signature mismatch" case explicitly: Apify's videoUrl fields
are signed CDN links that expire within a few hours. If the download body is
that error string, the script exits non-zero with a clear message so the
caller knows to re-fetch metadata from Apify.

Requires: ffmpeg on PATH, Python 3.8+.

Usage:
    python download_and_frame.py \\
        --video-url "https://scontent.cdninstagram.com/..." \\
        --out-dir ./montages \\
        --basename username_ABC123 \\
        --duration 42.5

    # Or, skip the download and montage a local file:
    python download_and_frame.py \\
        --video-url "" \\
        --local-video ./videos/username_ABC123.mp4 \\
        --out-dir ./montages \\
        --basename username_ABC123 \\
        --duration 42.5

On success prints the absolute path to the montage jpg on the last line of
stdout.
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request


SIGNATURE_MISMATCH_MARKER = b"URL signature mismatch"


def download_video(url: str, dest_path: str) -> None:
    """Download a video, raising on the signed-URL-expired signal."""
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/126.0.0.0 Safari/537.36"
            )
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()

    # Detect the tiny "URL signature mismatch" body Instagram serves when a
    # signed CDN URL has expired.
    if len(data) < 512 and SIGNATURE_MISMATCH_MARKER in data:
        raise RuntimeError(
            "Signed CDN URL expired ('URL signature mismatch'). "
            "Re-fetch the reel's videoUrl from Apify and retry."
        )

    with open(dest_path, "wb") as f:
        f.write(data)

    if os.path.getsize(dest_path) < 1024:
        raise RuntimeError(
            f"Downloaded file is suspiciously small ({os.path.getsize(dest_path)} bytes). "
            "Likely a bad/expired URL."
        )


def extract_frames(video_path: str, work_dir: str, num_frames: int, duration: float):
    """Extract num_frames evenly-spaced JPGs from video_path into work_dir."""
    frame_paths = []
    for i in range(1, num_frames + 1):
        ts = duration * i / (num_frames + 1)
        out_path = os.path.join(work_dir, f"f{i}.jpg")
        cmd = [
            "ffmpeg", "-y",
            "-ss", f"{ts:.3f}",
            "-i", video_path,
            "-vframes", "1",
            "-vf", "scale=640:-2",
            "-q:v", "5",
            out_path,
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        frame_paths.append(out_path)
    return frame_paths


def build_montage_2x3(frames, out_path):
    """3 frames on top row, 3 on bottom row."""
    assert len(frames) == 6, f"2x3 montage needs 6 frames, got {len(frames)}"
    cmd = [
        "ffmpeg", "-y",
        "-i", frames[0], "-i", frames[1], "-i", frames[2],
        "-i", frames[3], "-i", frames[4], "-i", frames[5],
        "-filter_complex",
        "[0][1][2]hstack=inputs=3[top];"
        "[3][4][5]hstack=inputs=3[bot];"
        "[top][bot]vstack[out]",
        "-map", "[out]",
        "-q:v", "5",
        out_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def build_montage_3x3(frames, out_path):
    """9 frames in a 3x3 grid (for reels > 90s)."""
    assert len(frames) == 9, f"3x3 montage needs 9 frames, got {len(frames)}"
    cmd = [
        "ffmpeg", "-y",
        "-i", frames[0], "-i", frames[1], "-i", frames[2],
        "-i", frames[3], "-i", frames[4], "-i", frames[5],
        "-i", frames[6], "-i", frames[7], "-i", frames[8],
        "-filter_complex",
        "[0][1][2]hstack=inputs=3[r1];"
        "[3][4][5]hstack=inputs=3[r2];"
        "[6][7][8]hstack=inputs=3[r3];"
        "[r1][r2][r3]vstack=inputs=3[out]",
        "-map", "[out]",
        "-q:v", "5",
        out_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def main():
    parser = argparse.ArgumentParser(
        description="Download a reel mp4 (or use a local copy) and build a frame montage."
    )
    parser.add_argument("--video-url", required=True, help="Signed CDN URL. Pass empty string to use --local-video.")
    parser.add_argument("--local-video", default="", help="Path to a pre-downloaded mp4. Skips download.")
    parser.add_argument("--out-dir", required=True, help="Directory to write the montage jpg into.")
    parser.add_argument("--basename", required=True, help="File stem for the montage, e.g. 'username_ABC123'.")
    parser.add_argument("--duration", type=float, required=True, help="Video duration in seconds.")
    args = parser.parse_args()

    if not shutil.which("ffmpeg"):
        print("ERROR: ffmpeg not found on PATH.", file=sys.stderr)
        sys.exit(2)

    os.makedirs(args.out_dir, exist_ok=True)

    # Resolve source video.
    if args.local_video:
        if not os.path.exists(args.local_video):
            print(f"ERROR: local video not found: {args.local_video}", file=sys.stderr)
            sys.exit(2)
        video_path = args.local_video
        tmp_download = None
    elif args.video_url:
        tmp_download = os.path.join(args.out_dir, f"{args.basename}.mp4")
        try:
            download_video(args.video_url, tmp_download)
        except Exception as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            sys.exit(3)
        video_path = tmp_download
    else:
        print("ERROR: pass either --video-url or --local-video.", file=sys.stderr)
        sys.exit(2)

    # Decide grid size.
    num_frames = 9 if args.duration > 90 else 6
    montage_path = os.path.join(args.out_dir, f"{args.basename}_montage.jpg")

    with tempfile.TemporaryDirectory() as tmp:
        try:
            frames = extract_frames(video_path, tmp, num_frames, args.duration)
        except subprocess.CalledProcessError as exc:
            print(f"ERROR: ffmpeg frame extraction failed: {exc.stderr.decode(errors='ignore')}", file=sys.stderr)
            sys.exit(4)

        try:
            if num_frames == 6:
                build_montage_2x3(frames, montage_path)
            else:
                build_montage_3x3(frames, montage_path)
        except subprocess.CalledProcessError as exc:
            print(f"ERROR: ffmpeg montage build failed: {exc.stderr.decode(errors='ignore')}", file=sys.stderr)
            sys.exit(5)

    print(os.path.abspath(montage_path))


if __name__ == "__main__":
    main()
