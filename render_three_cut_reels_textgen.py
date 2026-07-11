from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "generated" / "three_cut_reels_textgen"
FRAMES_DIR = OUT_DIR / "frames"
SOURCE = OUT_DIR / "source_text_generated.png"
VIDEO_PATH = OUT_DIR / "emerald_three_cut_reels_textgen.mp4"
POSTER_PATH = OUT_DIR / "emerald_three_cut_reels_textgen_poster.png"

W, H = 1080, 1920
FPS = 30
DURATION = 8.0
TOTAL_FRAMES = int(FPS * DURATION)
FONT = "/System/Library/Fonts/AppleSDGothicNeo.ttc"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, size=size, index=8 if bold else 0)


def fit_source() -> Image.Image:
    src = Image.open(SOURCE).convert("RGB")
    return src.resize((W, H), Image.Resampling.LANCZOS)


def text_center(draw: ImageDraw.ImageDraw, y: int, text: str, fnt, fill=(24, 24, 24)):
    box = draw.textbbox((0, 0), text, font=fnt)
    draw.text(((W - (box[2] - box[0])) / 2, y - (box[3] - box[1]) / 2), text, font=fnt, fill=fill)


def final_composite() -> Image.Image:
    img = fit_source().convert("RGBA")
    draw = ImageDraw.Draw(img, "RGBA")
    text_center(draw, 155, "에메랄드 가는 길", font(90, True))
    return img


def _bands(values, threshold: float, min_len: int = 3):
    found = []
    in_band = False
    for i, value in enumerate(values):
        if value > threshold and not in_band:
            start = i
            in_band = True
        if in_band and (value <= threshold or i == len(values) - 1):
            end = i - 1
            in_band = False
            if end - start + 1 >= min_len:
                found.append((start, end))
    return found


def detect_panel_boxes(img: Image.Image) -> list[tuple[int, int, int, int]]:
    """Detect the generated comic's thick rectangular panel borders."""
    import numpy as np

    rgb = img.convert("RGB")
    arr = np.array(rgb)
    dark = (arr[:, :, 0] < 55) & (arr[:, :, 1] < 55) & (arr[:, :, 2] < 55)
    row_density = dark.mean(axis=1)
    full_width_bands = [(s, e) for s, e in _bands(row_density, 0.85) if s > 380]

    # Generated three-panel comics usually have five strong horizontal borders:
    # panel1 top/bottom, panel2 top/bottom, panel3 bottom. The panel2 bottom
    # and panel3 top are visually adjacent, so reusing that border preserves text.
    if len(full_width_bands) >= 5:
        ys = [
            (full_width_bands[0][0], full_width_bands[1][1]),
            (full_width_bands[2][0], full_width_bands[3][1]),
            (full_width_bands[3][0], full_width_bands[-1][1]),
        ]
    else:
        ys = [(453, 925), (942, 1396), (1392, 1856)]

    boxes = []
    for y1, y2 in ys:
        col_density = dark[y1 : y2 + 1].mean(axis=0)
        left_candidates = [i for i, v in enumerate(col_density[:120]) if v > 0.55]
        right_candidates = [i for i, v in enumerate(col_density[W - 120 :], start=W - 120) if v > 0.55]
        x1 = min(left_candidates) if left_candidates else 15
        x2 = max(right_candidates) if right_candidates else W - 15
        boxes.append((max(0, x1 - 2), max(0, y1 - 2), min(W, x2 + 3), min(H, y2 + 3)))

    # Adjacent generated panels can share a thick border. Keep masks from
    # overlapping so a hidden lower panel never covers the visible panel above.
    if len(boxes) == 3:
        first, second, third = boxes
        second_y2 = second[3]
        boxes = [
            first,
            (second[0], second[1], second[2], second_y2),
            (third[0], second_y2 + 1, third[2], third[3]),
        ]
    return boxes


STARTS = [0.45, 2.85, 5.15]
REVEAL_SECONDS = 1.25


def smoothstep(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def reveal_amount(t: float, start: float) -> float:
    return smoothstep((t - start) / REVEAL_SECONDS)


def make_frame(t: float, final_img: Image.Image, panel_boxes: list[tuple[int, int, int, int]]) -> Image.Image:
    base = final_img.copy()
    draw = ImageDraw.Draw(base, "RGBA")
    paper = (255, 255, 255, 248)

    for idx, (x1, y1, x2, y2) in enumerate(panel_boxes):
        amount = reveal_amount(t, STARTS[idx])
        if amount >= 1:
            continue
        draw.rectangle((x1, y1, x2, y2), fill=paper)
        if amount > 0:
            crop = final_img.crop((x1, y1, x2, y2))
            layer = Image.new("RGBA", crop.size, (255, 255, 255, 0))
            layer.alpha_composite(crop, (0, 0))
            alpha = int(255 * amount)
            layer.putalpha(layer.getchannel("A").point(lambda a: int(a * alpha / 255)))
            base.alpha_composite(layer, (x1, y1))

    if t < 0.25:
        overlay = Image.new("RGBA", (W, H), (255, 255, 255, int(255 * (1 - t / 0.25))))
        base = Image.alpha_composite(base, overlay)
    return base.convert("RGB")


def main():
    if FRAMES_DIR.exists():
        shutil.rmtree(FRAMES_DIR)
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)

    final_img = final_composite()
    panel_boxes = detect_panel_boxes(final_img)
    print("Detected panel boxes:", panel_boxes)
    final_img.convert("RGB").save(POSTER_PATH)

    for frame_no in range(TOTAL_FRAMES):
        make_frame(frame_no / FPS, final_img, panel_boxes).save(FRAMES_DIR / f"frame_{frame_no:04d}.png")

    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-framerate",
            str(FPS),
            "-i",
            str(FRAMES_DIR / "frame_%04d.png"),
            "-vf",
            "format=yuv420p",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-movflags",
            "+faststart",
            str(VIDEO_PATH),
        ],
        check=True,
    )
    print(VIDEO_PATH)
    print(POSTER_PATH)


if __name__ == "__main__":
    main()
