from __future__ import annotations

import math
import random
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "generated" / "three_cut_reels"
FRAMES_DIR = OUT_DIR / "frames"
VIDEO_PATH = OUT_DIR / "emerald_three_cut_reels.mp4"
POSTER_PATH = OUT_DIR / "emerald_three_cut_reels_poster.png"

W, H = 1080, 1920
FPS = 30
DURATION = 6.0
TOTAL_FRAMES = int(FPS * DURATION)
FONT = "/System/Library/Fonts/AppleSDGothicNeo.ttc"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    index = 8 if bold else 0
    return ImageFont.truetype(FONT, size=size, index=index)


F_TITLE = font(82, True)
F_SUB = font(34, True)
F_LABEL = font(35, True)
F_TEXT = font(38, True)
F_SMALL = font(29)
F_TINY = font(24)


def ease_out_back(x: float) -> float:
    x = max(0.0, min(1.0, x))
    c1 = 1.70158
    c3 = c1 + 1
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2


def fade_amount(t: float, start: float, length: float = 0.5) -> float:
    return max(0.0, min(1.0, (t - start) / length))


def jitter_line(draw: ImageDraw.ImageDraw, xy, fill, width=3, repeats=2):
    x1, y1, x2, y2 = xy
    for _ in range(repeats):
        j = [random.randint(-2, 2) for _ in range(4)]
        draw.line((x1 + j[0], y1 + j[1], x2 + j[2], y2 + j[3]), fill=fill, width=width)


def jitter_rect(draw: ImageDraw.ImageDraw, box, fill, width=4, radius=18):
    x1, y1, x2, y2 = box
    for offset in (0, 2):
        draw.rounded_rectangle(
            (x1 + offset, y1 + offset, x2 - offset, y2 - offset),
            radius=radius,
            outline=fill,
            width=width,
        )


def text_center(draw: ImageDraw.ImageDraw, pos, text: str, fnt, fill=(28, 28, 28)):
    x, y = pos
    box = draw.textbbox((0, 0), text, font=fnt)
    draw.text((x - (box[2] - box[0]) / 2, y - (box[3] - box[1]) / 2), text, font=fnt, fill=fill)


def draw_stick(draw: ImageDraw.ImageDraw, cx: int, cy: int, scale: float = 1.0, mood: str = "neutral"):
    r = int(28 * scale)
    ink = (25, 25, 25)
    draw.ellipse((cx - r, cy - 90 * scale - r, cx + r, cy - 90 * scale + r), outline=ink, width=max(2, int(4 * scale)))
    jitter_line(draw, (cx, cy - 60 * scale, cx, cy + 40 * scale), ink, max(2, int(4 * scale)))
    jitter_line(draw, (cx, cy - 25 * scale, cx - 58 * scale, cy + 4 * scale), ink, max(2, int(4 * scale)))
    jitter_line(draw, (cx, cy - 25 * scale, cx + 58 * scale, cy + 4 * scale), ink, max(2, int(4 * scale)))
    jitter_line(draw, (cx, cy + 40 * scale, cx - 42 * scale, cy + 100 * scale), ink, max(2, int(4 * scale)))
    jitter_line(draw, (cx, cy + 40 * scale, cx + 42 * scale, cy + 100 * scale), ink, max(2, int(4 * scale)))
    if mood == "sweat":
        draw.arc((cx - 14 * scale, cy - 102 * scale, cx + 14 * scale, cy - 82 * scale), 15, 165, fill=ink, width=2)
        draw.ellipse((cx + 34 * scale, cy - 125 * scale, cx + 46 * scale, cy - 108 * scale), fill=(65, 145, 210))
    elif mood == "panic":
        draw.line((cx - 13 * scale, cy - 98 * scale, cx - 2 * scale, cy - 87 * scale), fill=ink, width=2)
        draw.line((cx + 13 * scale, cy - 98 * scale, cx + 2 * scale, cy - 87 * scale), fill=ink, width=2)
        draw.ellipse((cx - 8 * scale, cy - 83 * scale, cx + 8 * scale, cy - 68 * scale), outline=ink, width=2)
    else:
        draw.arc((cx - 16 * scale, cy - 100 * scale, cx + 16 * scale, cy - 78 * scale), 20, 160, fill=ink, width=2)


def panel_one(layer: Image.Image, box):
    draw = ImageDraw.Draw(layer)
    x1, y1, x2, y2 = box
    jitter_rect(draw, (x1, y1, x2, y2), (26, 26, 26))
    draw.text((x1 + 28, y1 + 22), "1컷", font=F_LABEL, fill=(10, 110, 92))
    draw.text((x1 + 120, y1 + 23), "에메랄드 1 앞에서 멈칫", font=F_TEXT, fill=(25, 25, 25))
    draw.rounded_rectangle((x1 + 70, y1 + 105, x1 + 455, y1 + 245), radius=16, outline=(30, 30, 30), width=4)
    draw.text((x1 + 95, y1 + 128), "랭크 승급전", font=F_SMALL, fill=(30, 30, 30))
    draw.text((x1 + 95, y1 + 173), "EMERALD 1 ?", font=font(44, True), fill=(0, 120, 100))
    draw_stick(draw, x1 + 710, y1 + 285, 1.0)
    draw.rounded_rectangle((x1 + 565, y1 + 92, x1 + 955, y1 + 172), radius=18, outline=(30, 30, 30), width=3)
    draw.text((x1 + 590, y1 + 111), "오늘은 진짜 간다", font=F_SMALL, fill=(30, 30, 30))
    draw.text((x1 + 630, y1 + 372), "탑 라인에 진심인 남자", font=F_SMALL, fill=(80, 80, 80))


def panel_two(layer: Image.Image, box):
    draw = ImageDraw.Draw(layer)
    x1, y1, x2, y2 = box
    jitter_rect(draw, (x1, y1, x2, y2), (26, 26, 26))
    draw.text((x1 + 28, y1 + 22), "2컷", font=F_LABEL, fill=(180, 60, 45))
    draw.text((x1 + 120, y1 + 23), "협곡에서 0/8/0", font=F_TEXT, fill=(25, 25, 25))
    draw.rounded_rectangle((x1 + 66, y1 + 100, x1 + 500, y1 + 255), radius=16, outline=(30, 30, 30), width=4)
    draw.text((x1 + 100, y1 + 124), "K / D / A", font=F_SMALL, fill=(30, 30, 30))
    draw.text((x1 + 100, y1 + 166), "0 / 8 / 0", font=font(70, True), fill=(180, 45, 35))
    draw_stick(draw, x1 + 745, y1 + 310, 1.0, mood="sweat")
    draw.rounded_rectangle((x1 + 585, y1 + 92, x1 + 955, y1 + 170), radius=18, outline=(30, 30, 30), width=3)
    draw.text((x1 + 658, y1 + 112), "어... 몸푸는 중", font=F_SMALL, fill=(30, 30, 30))
    for i in range(7):
        sx = x1 + 560 + i * 55
        jitter_line(draw, (sx, y1 + 345, sx + 24, y1 + 380), (100, 100, 100), 2, 1)


def panel_three(layer: Image.Image, box):
    draw = ImageDraw.Draw(layer)
    x1, y1, x2, y2 = box
    jitter_rect(draw, (x1, y1, x2, y2), (26, 26, 26))
    draw.text((x1 + 28, y1 + 22), "3컷", font=F_LABEL, fill=(45, 75, 190))
    draw.text((x1 + 120, y1 + 23), "버스도 못 막은 역캐리 머신", font=F_TEXT, fill=(25, 25, 25))
    bus = (x1 + 80, y1 + 195, x1 + 620, y1 + 340)
    draw.rounded_rectangle(bus, radius=22, outline=(30, 30, 30), width=5)
    draw.text((x1 + 125, y1 + 225), "DUO BUS", font=font(45, True), fill=(30, 30, 30))
    draw.ellipse((x1 + 160, y1 + 315, x1 + 225, y1 + 380), outline=(30, 30, 30), width=5)
    draw.ellipse((x1 + 480, y1 + 315, x1 + 545, y1 + 380), outline=(30, 30, 30), width=5)
    draw_stick(draw, x1 + 770, y1 + 292, 0.9, mood="panic")
    draw.rounded_rectangle((x1 + 640, y1 + 92, x1 + 955, y1 + 165), radius=18, outline=(30, 30, 30), width=3)
    draw.text((x1 + 664, y1 + 111), "버스 좀...", font=F_SMALL, fill=(30, 30, 30))
    draw.arc((x1 + 650, y1 + 205, x1 + 1040, y1 + 395), 190, 340, fill=(210, 40, 40), width=9)
    draw.polygon([(x1 + 645, y1 + 238), (x1 + 710, y1 + 215), (x1 + 695, y1 + 275)], fill=(210, 40, 40))
    draw.text((x1 + 705, y1 + 373), "역캐리 머신 ON", font=font(40, True), fill=(190, 35, 35))


def draw_header(base: Image.Image):
    draw = ImageDraw.Draw(base)
    text_center(draw, (W / 2, 94), "에메랄드 가는 길", F_TITLE, (20, 20, 20))
    draw.rounded_rectangle((95, 160, 985, 225), radius=24, outline=(30, 30, 30), width=3)
    text_center(draw, (W / 2, 191), "결론: 버스를 불러도 역캐리 머신은 멈추지 않았다", F_SUB, (35, 35, 35))
    draw.text((96, 252), "스케치 컷툰 · 9:16", font=F_TINY, fill=(100, 100, 100))


PANEL_BOXES = [
    (60, 315, 1020, 765),
    (60, 815, 1020, 1265),
    (60, 1315, 1020, 1765),
]
PANEL_FUNCS = [panel_one, panel_two, panel_three]
STARTS = [0.35, 1.95, 3.55]


def render_panel(idx: int) -> Image.Image:
    layer = Image.new("RGBA", (W, H), (255, 255, 255, 0))
    PANEL_FUNCS[idx](layer, PANEL_BOXES[idx])
    return layer


def make_frame(frame_no: int, panels: list[Image.Image]) -> Image.Image:
    random.seed(9000 + frame_no)
    t = frame_no / FPS
    base = Image.new("RGB", (W, H), (250, 248, 240))
    draw = ImageDraw.Draw(base)
    for y in range(0, H, 42):
        draw.line((0, y, W, y + random.randint(-2, 2)), fill=(242, 238, 228), width=1)
    draw_header(base)

    for i, panel in enumerate(panels):
        amount = fade_amount(t, STARTS[i])
        if amount <= 0:
            continue
        alpha = int(255 * min(1.0, amount))
        scale = 0.92 + 0.08 * min(1.0, ease_out_back(amount))
        layer = panel.copy()
        if scale < 0.999:
            x1, y1, x2, y2 = PANEL_BOXES[i]
            crop = layer.crop((x1 - 12, y1 - 12, x2 + 12, y2 + 12))
            sw = int(crop.width * scale)
            sh = int(crop.height * scale)
            crop = crop.resize((sw, sh), Image.Resampling.LANCZOS)
            layer = Image.new("RGBA", (W, H), (255, 255, 255, 0))
            px = int((x1 + x2) / 2 - sw / 2)
            py = int((y1 + y2) / 2 - sh / 2)
            layer.alpha_composite(crop, (px, py))
        layer.putalpha(layer.getchannel("A").point(lambda a: int(a * alpha / 255)))
        base = Image.alpha_composite(base.convert("RGBA"), layer).convert("RGB")

    if t > 5.15:
        overlay = Image.new("RGBA", (W, H), (250, 248, 240, int(180 * min(1, (t - 5.15) / 0.6))))
        base = Image.alpha_composite(base.convert("RGBA"), overlay).convert("RGB")
        draw = ImageDraw.Draw(base)
        text_center(draw, (W / 2, 1840), "끝.", font(52, True), (25, 25, 25))
    return base


def main():
    if FRAMES_DIR.exists():
        shutil.rmtree(FRAMES_DIR)
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)
    panels = [render_panel(i) for i in range(3)]
    for frame_no in range(TOTAL_FRAMES):
        frame = make_frame(frame_no, panels)
        frame.save(FRAMES_DIR / f"frame_{frame_no:04d}.png")
        if frame_no == int(FPS * 4.7):
            frame.save(POSTER_PATH)

    cmd = [
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
    ]
    subprocess.run(cmd, check=True)
    print(VIDEO_PATH)
    print(POSTER_PATH)


if __name__ == "__main__":
    main()
