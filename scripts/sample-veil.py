#!/usr/bin/env python3
"""采样画面配色，用于给新皮肤挑"晕影底色"。

晕影（对话栏底下那层有色玻璃）的底色不该拍脑袋定，应该从画里取 ——
否则要么压成一层黑，要么跟画面打架。

做法：取画面**中心区域**（对话栏实际覆盖的那块）最暗的 40% 像素求平均，
再压暗、加饱和到适合做底色的深度。中心区域是关键：整幅画的最暗部
可能在边角（那里反而被四边带遮住），而用户看到的是中心。

用法：
    python scripts/sample-veil.py assets/skin-spring.jpg

依赖 Pillow（可选工具，不参与构建、不进包）：
    pip install Pillow
"""

import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("需要 Pillow：pip install Pillow")


def hex_of(rgb):
    return "#%02X%02X%02X" % tuple(int(v) for v in rgb)


def luminance(p):
    return p[0] * 0.299 + p[1] * 0.587 + p[2] * 0.114


def sample(path, target_luma=72.0, saturation=1.35):
    image = Image.open(path).convert("RGB")
    width, height = image.size

    # 对话栏覆盖的中心区域：宽度中间 50%，高度中间 70%
    box = (int(width * 0.25), int(height * 0.15), int(width * 0.75), int(height * 0.85))
    region = image.crop(box).resize((120, 80))
    pixels = list(region.getdata())
    pixels.sort(key=luminance)
    darkest = pixels[: int(len(pixels) * 0.4)]

    mean = [sum(p[i] for p in darkest) / len(darkest) for i in range(3)]

    # 压暗到目标亮度（保留色相），再加一点饱和让它在界面上"看得出颜色"
    scale = target_luma / max(1e-6, luminance(mean))
    pushed = [min(255.0, max(0.0, v * scale)) for v in mean]
    average = sum(pushed) / 3
    pushed = [min(255.0, max(0.0, average + (v - average) * saturation)) for v in pushed]

    return mean, pushed


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for path in sys.argv[1:]:
        mean, suggested = sample(path)
        print(f"{path}")
        print(f"  中心区最暗40%平均 = {hex_of(mean)}")
        print(f"  建议晕影底色      = {hex_of(suggested)}")
        print("  -> 填进 client.js 对应调色板的 veil（明暗两套各取一次）\n")


if __name__ == "__main__":
    main()
