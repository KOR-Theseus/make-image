from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "generated" / "three_cut_reels_hq"
FRAMES_DIR = OUT_DIR / "frames"
SOURCE = OUT_DIR / "source_generated.png"
VIDEO_PATH = OUT_DIR / "emerald_three_cut_reels_hq.mp4"
POSTER_PATH = OUT_DIR / "emerald_three_cut_reels_hq_poster.png"

W, H = 1080, 1920
FPS = 30
DURATION = 6.5
TOTAL_FRAMES = int(FPS * DURATION)
FONT = "/System/Library/Fonts/AppleSDGothicNeo.ttc"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, size=size, index=8 if bold else 0)


F_TITLE = font(88, True)
F_CONCLUSION = font(35, True)
F_PANEL = font(34, True)
F_SCORE = font(60, True)
F_SMALL = font(28, True)


def fit_source() -> Image.Image:
    src = Image.open(SOURCE).convert("RGB")
    src_ratio = src.width / src.height
    target_ratio = W / H
    if src_ratio > target_ratio:
        new_h = H
        new_w = round(new_h * src_ratio)
    else:
        new_w = W
        new_h = round(new_w / src_ratio)
    resized = src.resize((new_w, new_h), Image.Resampling.LANCZOS)
    x = (new_w - W) // 2
    y = (new_h - H) // 2
    return resized.crop((x, y, x + W, y + H))


def text_center(draw: ImageDraw.ImageDraw, y: int, text: str, fnt, fill=(25, 25, 25)):
    box = draw.textbbox((0, 0), text, font=fnt)
    draw.text(((W - (box[2] - box[0])) / 2, y - (box[3] - box[1]) / 2), text, font=fnt, fill=fill)


def text_center_at(draw: ImageDraw.ImageDraw, x: int, y: int, text: str, fnt, fill=(25, 25, 25)):
    box = draw.textbbox((0, 0), text, font=fnt)
    draw.text((x - (box[2] - box[0]) / 2, y - (box[3] - box[1]) / 2), text, font=fnt, fill=fill)


def label(draw: ImageDraw.ImageDraw, box, text: str, fill=(255, 255, 255, 235)):
    x1, y1, x2, y2 = box
    draw.rounded_rectangle((x1, y1, x2, y2), radius=18, fill=fill, outline=(25, 25, 25, 230), width=3)
    draw.text((x1 + 22, y1 + 13), text, font=F_PANEL, fill=(24, 24, 24))


def final_composite() -> Image.Image:
    img = fit_source().convert("RGBA")
    draw = ImageDraw.Draw(img, "RGBA")

    text_center(draw, 155, "에메랄드 가는 길", F_TITLE)
    text_center(draw, 475, "결론: 버스를 불러도 역캐리 머신은 멈추지 않았다", F_CONCLUSION)

    label(draw, (55, 528, 612, 592), "1컷  에메랄드 1 앞에서 멈칫")
    label(draw, (55, 975, 424, 1039), "2컷  협곡에서 0/8/0")
    label(draw, (55, 1428, 630, 1492), "3컷  버스도 못 막은 역캐리 머신")

    draw.rounded_rectangle((575, 1088, 895, 1168), radius=18, fill=(255, 255, 255, 222), outline=(35, 35, 35, 210), width=3)
    text_center_at(draw, 735, 1130, "0 / 8 / 0", F_SCORE, (185, 45, 38))

    draw.rounded_rectangle((55, 1806, 407, 1862), radius=18, fill=(255, 255, 255, 225), outline=(35, 35, 35, 210), width=3)
    draw.text((82, 1819), "역캐리 머신 ON", font=F_SMALL, fill=(190, 35, 35))
    return img


PANEL_RANGES = [
    (500, 930),
    (948, 1388),
    (1398, 1848),
]
STARTS = [0.45, 2.05, 3.72]


def smoothstep(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def reveal_amount(t: float, start: float) -> float:
    return smoothstep((t - start) / 0.55)


def make_frame(t: float, final_img: Image.Image) -> Image.Image:
    base = final_img.copy()
    draw = ImageDraw.Draw(base, "RGBA")
    paper = (252, 249, 241, 246)

    for idx, (y1, y2) in enumerate(PANEL_RANGES):
        amt = reveal_amount(t, STARTS[idx])
        if amt >= 1:
            continue
        draw.rounded_rectangle((24, y1 - 9, W - 24, y2 + 9), radius=8, fill=paper)
        if amt > 0:
            crop = final_img.crop((0, y1 - 24, W, y2 + 24))
            alpha = int(255 * amt)
            layer = Image.new("RGBA", crop.size, (255, 255, 255, 0))
            layer.alpha_composite(crop, (0, int((1 - amt) * 30)))
            layer.putalpha(layer.getchannel("A").point(lambda a: int(a * alpha / 255)))
            base.alpha_composite(layer, (0, y1 - 24))

    if t < 0.28:
        overlay = Image.new("RGBA", (W, H), (252, 249, 241, int(255 * (1 - t / 0.28))))
        base = Image.alpha_composite(base, overlay)
    return base.convert("RGB")


def main():
    if FRAMES_DIR.exists():
        shutil.rmtree(FRAMES_DIR)
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)

    final_img = final_composite()
    final_img.convert("RGB").save(POSTER_PATH)

    for frame_no in range(TOTAL_FRAMES):
        frame = make_frame(frame_no / FPS, final_img)
        frame.save(FRAMES_DIR / f"frame_{frame_no:04d}.png")

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
