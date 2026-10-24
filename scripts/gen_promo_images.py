"""Generate polished DTD promo banners + product cards with icons and data.

Banners are written to assets/promo-*.jpg so the live mirror auto-attaches them
to channel promos (MIRROR_PROMO_IMAGE_CHANCE). Product cards go to
assets/product-card-*.jpg for manual/advertising use.

Run:  python scripts/gen_promo_images.py
"""

import json
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BANNER_OUT = ROOT / "assets"
CARD_OUT = ROOT / "assets"
BANNER_OUT.mkdir(parents=True, exist_ok=True)
CARD_OUT.mkdir(parents=True, exist_ok=True)

FB = Path(r"C:\Windows\Fonts")
FONT_BOLD = FB / "segoeuib.ttf"
FONT_SEMI = FB / "seguisb.ttf"
FONT_BLACK = FB / "arialbd.ttf"
FONT_LIGHT = FB / "segoeuil.ttf"

DARK = (9, 13, 24)

PALETTE = [
    ("Bulk SMS Sender", "#16a34a", "Send bulk SMS at scale"),
    ("SMTP", "#0d9488", "Reliable email delivery"),
    ("Call Centre Development", "#7c3aed", "Setup & development"),
    ("Proxy Access", "#ea580c", "Rotating proxies"),
    ("HOSTING SERVICES", "#0284c7", "Servers & hosting"),
    ("RDP", "#d97706", "Remote desktop access"),
    ("DIGITAL SERVICES", "#db2777", "Digital services"),
    ("SC Sessions API", "#4f46e5", "Sessions API access"),
]

BANNERS = [
    ("#0d9488", "DTD MAIN STORE", "Digital products · Fast delivery", ("🛒", "Pay in seconds", "USDT · BTC · Card"), ("🚀", "Instant delivery", "to your inbox"), ("🤖", "Shop in Telegram", "via Mini App"), ("🛡", "Secure checkout", "tracked orders")),
    ("#ea580c", "PAY USDT · BTC · CARD", "Secure global checkout", ("₮", "USDT TRC20", "crypto ready"), ("₿", "Bitcoin", "accepted"), ("💳", "Card & Paystack", "KES/USD"), ("⚡", "Instant approval", "after payment")),
    ("#7c3aed", "DIGITAL PRODUCTS", "Shop in Telegram — delivery to your inbox", ("🤖", "Open the bot", "@DTDSTOREBOT"), ("🛒", "Pick a product", "from the store"), ("📩", "Get delivery", "to your email"), ("👤", "Real support", "track by ID")),
    ("#0284c7", "SHOP IN TELEGRAM", "One brand. One payments bot.", ("📱", "Mini App", "tap to open"), ("🔎", "Browse catalog", "27+ products"), ("💳", "Pay your way", "crypto or card"), ("🧾", "Track your order", "by order ID")),
    ("#16a34a", "MINI APP + BOT", "One brand. One payments bot.", ("🛍", "Browse & buy", "web or bot"), ("📬", "Instant delivery", "email & files"), ("🔒", "Encrypted checkout", "privacy first"), ("⭐", "Premium drops", "exclusive channel")),
    ("#db2777", "TRACKED DELIVERY", "Real support · Track every order by ID", ("🆔", "Order ID", "issued on pay"), ("📧", "Email delivery", "files attached"), ("💬", "Human support", "@Glock7money"), ("✓", "Confirmed send", "within minutes")),
    ("#d97706", "JOIN THE DTD COMMUNITY", "Drops, promos and store news", ("🎁", "Exclusive drops", "DTD PREMIUM"), ("📣", "Daily updates", "on this channel"), ("👥", "Growing store", "trusted buyers"), ("🏆", "Bulk deals", "talk to owner")),
    ("#4f46e5", "ONE BRAND, ONE PAYMENTS BOT", "USDT TRC20 · BTC · Paystack", ("💰", "Clear pricing", "in USD"), ("🚀", "Fast delivery", "steady ops"), ("🔁", "Lifetime access", "per purchase"), ("🌍", "Global support", "DV Technologies")),
]

ICON_SHAPES = {
    "🛒": "cart", "🚀": "rocket", "🤖": "robot", "🛡": "shield", "₮": "coins",
    "₿": "coin", "💳": "card", "⚡": "bolt", "📱": "phone", "🔎": "search",
    "🧾": "receipt", "🛍": "bag", "📬": "mail", "🔒": "lock", "⭐": "star",
    "🆔": "id", "📧": "mail", "💬": "chat", "✓": "check", "🎁": "gift",
    "📣": "megaphone", "👥": "users", "🏆": "trophy", "💰": "cash", "🔁": "sync",
    "🌍": "globe", "📩": "mail", "🔎": "search", "📱": "phone", "⚡": "bolt",
}


def rgb(hexstr):
    h = hexstr.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def font(path, size):
    return ImageFont.truetype(str(path), size)


def fit_text(dr, text, base, max_w, path=FONT_BLACK):
    size = base
    f = font(path, size)
    while size > 24:
        if dr.textlength(text, font=f) <= max_w:
            break
        size -= 4
        f = font(path, size)
    return f


def wrap(dr, text, f, max_w):
    lines, cur = [], ""
    for w in text.split():
        test = (cur + " " + w).strip()
        if dr.textlength(test, font=f) <= max_w:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def gradient(size, c1, c2, diag=True):
    w, h = size
    img = Image.new("RGB", size)
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x / w + y / h) / 2 if diag else y / h
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return img


def radial_glow(img, center, radius, color, alpha=120):
    w, h = img.size
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dr = ImageDraw.Draw(glow)
    for i in range(radius, 0, -14):
        a = int(alpha * (radius - i) / radius)
        dr.ellipse((center[0] - i, center[1] - i, center[0] + i, center[1] + i), fill=(*color, a))
    glow = glow.filter(ImageFilter.GaussianBlur(24))
    img.paste(Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB"), (0, 0))
    return img


def dot_grid(img, color, step=46, alpha=16):
    dr = ImageDraw.Draw(img, "RGBA")
    w, h = img.size
    for y in range(30, h, step):
        for x in range(30, w, step):
            dr.ellipse((x - 2, y - 2, x + 2, y + 2), fill=(*color, alpha))


def ring(dr, center, radius, color, width=8, alpha=60):
    dr.ellipse((center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius),
               outline=(*color, alpha), width=width)


def draw_icon(dr, cx, cy, size, kind, color, bg):
    """Draw a simple vector icon centered at (cx, cy)."""
    s = size
    half = s / 2
    fill = (*bg, 235)
    dr.rounded_rectangle((cx - half, cy - half, cx + half, cy + half), radius=s * 0.28, fill=fill)

    def P(*pts):
        return [(cx + pts[i], cy + pts[i + 1]) for i in range(0, len(pts), 2)]

    if kind == "bolt":
        dr.polygon(P(-6, -18, 4, -18, -2, 0, 6, 0, -6, 18, 2, 0, -6, 0), fill=color)
    elif kind == "cart":
        dr.rounded_rectangle(P(-14, -6, 14, 2), radius=3, fill=color)
        dr.rounded_rectangle(P(-4, -14, 10, -6), radius=3, fill=color)
        dr.ellipse(P(-11, 5, -5, 11), fill=color)
        dr.ellipse(P(7, 5, 13, 11), fill=color)
    elif kind == "rocket":
        dr.polygon(P(0, -16, 8, 2, -8, 2), fill=color)
        dr.ellipse(P(-4, -2, 4, 10), fill=color)
        dr.polygon(P(-10, 4, -2, 4, -6, 12), fill=color)
        dr.polygon(P(10, 4, 2, 4, 6, 12), fill=color)
    elif kind == "robot":
        dr.rounded_rectangle(P(-12, -10, 12, 10), radius=6, fill=color)
        dr.rectangle(P(-4, -16, 4, -10), fill=color)
        dr.ellipse(P(-8, -4, -3, 1), fill=bg)
        dr.ellipse(P(3, -4, 8, 1), fill=bg)
        dr.rectangle(P(-4, 4, 4, 7), fill=bg)
    elif kind == "shield":
        dr.polygon(P(0, -16, 14, -10, 14, 2, 0, 14, -14, 2, -14, -10), fill=color)
        dr.line(P(-5, 0, -1, 5, 6, -5), fill=bg, width=3)
    elif kind == "coins":
        dr.ellipse(P(-8, -8, 8, 8), fill=color)
        dr.ellipse(P(-5, -5, 5, 5), fill=bg)
        dr.ellipse(P(-8, 6, 8, 22), fill=(*color, 180))
    elif kind == "coin":
        dr.ellipse(P(-12, -12, 12, 12), fill=color)
        dr.ellipse(P(-8, -8, 8, 8), fill=bg)
        dr.text((cx, cy + 1), "₿", font=font(FONT_BOLD, int(s * 0.5)), fill=color, anchor="mm")
    elif kind == "card":
        dr.rounded_rectangle(P(-14, -10, 14, 10), radius=4, fill=color)
        dr.rectangle(P(-14, -5, 14, -2), fill=(*bg, 200))
        dr.ellipse(P(-6, 2, -2, 6), fill=(*bg, 200))
        dr.ellipse(P(0, 2, 4, 6), fill=(*bg, 200))
    elif kind == "bag":
        dr.rectangle(P(-12, -6, 12, 14), fill=color)
        dr.rounded_rectangle(P(-7, -14, 7, -6), radius=3, outline=color, width=3)
        dr.line(P(0, 1, 0, 8), fill=bg, width=3)
    elif kind == "mail":
        dr.rounded_rectangle(P(-14, -11, 14, 11), radius=4, fill=color)
        dr.polygon(P(-14, -11, 0, 3, 14, -11), fill=bg)
    elif kind == "lock":
        dr.rounded_rectangle(P(-11, -3, 11, 14), radius=4, fill=color)
        dr.arc(P(-7, -17, 7, -3), 180, 360, fill=color, width=4)
        dr.ellipse(P(-3, 3, 3, 9), fill=bg)
    elif kind == "star":
        import math as _m
        pts = []
        for i in range(10):
            r = 15 if i % 2 == 0 else 6
            a = _m.radians(i * 36 - 90)
            pts.append((cx + r * _m.cos(a), cy + r * _m.sin(a)))
        dr.polygon(pts, fill=color)
    elif kind == "check":
        dr.line(P(-10, 0, -2, 9, 11, -8), fill=color, width=5)
    elif kind == "chat":
        dr.rounded_rectangle(P(-13, -10, 13, 8), radius=6, fill=color)
        dr.polygon(P(-4, 8, -4, 14, 2, 8), fill=color)
    elif kind == "phone":
        dr.rounded_rectangle(P(-8, -16, 8, 16), radius=5, fill=color)
        dr.rounded_rectangle(P(-5, -12, 5, -6), radius=2, fill=bg)
    elif kind == "search":
        dr.ellipse(P(-11, -11, 5, 5), outline=color, width=4)
        dr.line(P(4, 4, 13, 13), fill=color, width=5)
    elif kind == "id":
        dr.rounded_rectangle(P(-12, -8, 12, 12), radius=4, fill=color)
        dr.line(P(-8, 6, 8, 6), fill=bg, width=2)
        dr.line(P(-8, -4, 4, -4), fill=bg, width=2)
    elif kind == "gift":
        dr.rectangle(P(-12, -4, 12, 14), fill=color)
        dr.polygon(P(-8, -16, 0, -4, 8, -16, 12, -12, 4, 0, -12, -12), fill=color)
        dr.line(P(0, -4, 0, 14), fill=bg, width=3)
        dr.line(P(-12, 4, 12, 4), fill=bg, width=3)
    elif kind == "megaphone":
        dr.polygon(P(-16, -6, 2, -14, 2, 4, -16, -2), fill=color)
        dr.ellipse(P(-20, -6, -12, 2), fill=color)
        dr.polygon(P(2, -6, 8, -6, 8, 2, 2, 4), fill=color)
    elif kind == "users":
        dr.ellipse(P(-10, -14, -2, -6), fill=color)
        dr.ellipse(P(2, -14, 10, -6), fill=color)
        dr.arc(P(-11, -8, 11, 14), 180, 360, fill=color, width=4)
    elif kind == "trophy":
        dr.rectangle(P(-8, -14, 8, -4), fill=color)
        dr.polygon(P(-8, -14, -16, -14, -16, -6, -8, -6), fill=color)
        dr.polygon(P(8, -14, 16, -14, 16, -6, 8, -6), fill=color)
        dr.rectangle(P(-12, 0, 12, 8), fill=color)
        dr.rectangle(P(-6, 8, 6, 16), fill=color)
    elif kind == "cash":
        dr.rounded_rectangle(P(-14, -10, 14, 10), radius=4, fill=color)
        dr.ellipse(P(-4, -4, 4, 4), fill=bg)
        dr.rounded_rectangle(P(-16, -6, 16, 6), radius=3, outline=color, width=3)
    elif kind == "sync":
        dr.arc(P(-12, -12, 12, 12), 20, 150, fill=color, width=5)
        dr.arc(P(-12, -12, 12, 12), 200, 330, fill=color, width=5)
        dr.polygon(P(8, -13, 14, -10, 9, -6), fill=color)
        dr.polygon(P(-8, 13, -14, 10, -9, 6), fill=color)
    elif kind == "globe":
        dr.ellipse(P(-13, -13, 13, 13), outline=color, width=4)
        dr.ellipse(P(-8, -13, 8, 13), outline=color, width=2)
        dr.line(P(-13, 0, 13, 0), fill=color, width=3)
    else:
        dr.ellipse(P(-10, -10, 10, 10), fill=color)


def draw_brand(dr, size, center, accent):
    s = size
    x, y = center
    dr.rounded_rectangle((x - s / 2, y - s / 2, x + s / 2, y + s / 2), radius=s * 0.24, fill=accent)
    f = font(FONT_BLACK, int(s * 0.4))
    for i, ch in enumerate("DTD"):
        dr.text((x + (i - 1) * s * 0.34, y - s * 0.26), ch, font=f, fill=(10, 15, 26), anchor="mm")


def make_banner(index, accent_hex, heading, sub, chips, out):
    accent = rgb(accent_hex)
    w, h = 1280, 720
    img = gradient((w, h), (42, 48, 80), DARK)
    img = radial_glow(img, (int(w * 0.78), int(h * 0.18)), 460, accent, alpha=135)
    img = radial_glow(img, (int(w * 0.15), int(h * 0.88)), 380, (16, 26, 48), alpha=170)
    dot_grid(img, (200, 210, 235))
    dr = ImageDraw.Draw(img, "RGBA")
    ring(dr, (int(w * 0.9), int(h * 0.16)), 150, accent, 8, 55)
    ring(dr, (int(w * 0.9), int(h * 0.16)), 105, accent, 6, 40)

    draw_brand(dr, 92, (96, 96), accent)

    f = fit_text(dr, heading, 116, int(w * 0.86))
    lines = wrap(dr, heading, f, int(w * 0.86))
    ty = h * 0.30 - (len(lines) - 1) * 60
    for line in lines:
        dr.text((w / 2, ty), line, font=f, fill=(250, 252, 255), anchor="mm")
        ty += 120
    f2 = font(FONT_SEMI, 44)
    dr.text((w / 2, h * 0.46), sub, font=f2, fill=(168, 178, 198), anchor="mm")

    # Feature chips
    chip_w, chip_h = 268, 118
    gap = 28
    total = chip_w * 4 + gap * 3
    x0 = (w - total) / 2
    cy = h * 0.64
    for i, (emoji, label, detail) in enumerate(chips):
        cx = x0 + chip_w / 2 + i * (chip_w + gap)
        dr.rounded_rectangle((cx - chip_w / 2, cy - chip_h / 2, cx + chip_w / 2, cy + chip_h / 2),
                             radius=26, fill=(24, 30, 46, 235), outline=(*accent, 90), width=2)
        draw_icon(dr, cx - chip_w / 2 + 34, cy - 12, 40, ICON_SHAPES.get(emoji, "check"), accent, (24, 30, 46))
        f3 = font(FONT_SEMI, 28)
        dr.text((cx + 12, cy - 18), label, font=f3, fill=(240, 244, 250), anchor="lm")
        f4 = font(FONT_LIGHT, 22)
        dr.text((cx + 12, cy + 16), detail, font=f4, fill=(140, 150, 172), anchor="lm")

    f5 = font(FONT_SEMI, 24)
    dr.text((w / 2, h - 44), "DTD MAIN STORE  ·  USDT TRC20  ·  BTC  ·  CARD  ·  @DTDSTOREBOT",
            font=f5, fill=(116, 126, 150), anchor="mm")

    img.save(out, "JPEG", quality=92)
    print("wrote", out.name, img.size, img.size[0] * img.size[1] // 1024 // 8, "KB")


def make_product(name, hexc, tagline, price_txt, out):
    accent = rgb(hexc)
    w = h = 1024
    img = gradient((w, h), (52, 58, 90), DARK)
    img = radial_glow(img, (int(w * 0.8), int(h * 0.15)), 420, accent, alpha=130)
    img = radial_glow(img, (int(w * 0.1), int(h * 0.9)), 300, (20, 30, 55), alpha=150)
    dot_grid(img, (200, 210, 235))
    dr = ImageDraw.Draw(img, "RGBA")
    ring(dr, (int(w * 0.82), int(h * 0.18)), 170, accent, 12, 50)
    ring(dr, (int(w * 0.82), int(h * 0.18)), 130, accent, 10, 36)

    chip_y = int(h * 0.22)
    chip = 300
    dr.rounded_rectangle((w / 2 - chip / 2, chip_y, w / 2 + chip / 2, chip_y + chip), radius=72, fill=(*accent, 235))
    draw_brand(dr, int(chip * 0.46), (w / 2, chip_y + chip / 2), (10, 15, 26))

    dr = ImageDraw.Draw(img, "RGBA")
    f = fit_text(dr, name, 84, int(w * 0.82))
    lines = wrap(dr, name, f, int(w * 0.82))
    ty = h * 0.55 - (len(lines) - 1) * 48
    for line in lines:
        dr.text((w / 2, ty), line, font=f, fill=(245, 247, 252), anchor="mm")
        ty += 104

    f2 = font(FONT_SEMI, 40)
    dr.text((w / 2, h * 0.68), tagline, font=f2, fill=(165, 175, 195), anchor="mm")

    pw, ph = 420, 92
    dr.rounded_rectangle((w / 2 - pw / 2, h * 0.76 - ph / 2, w / 2 + pw / 2, h * 0.76 + ph / 2),
                         radius=ph / 2, fill=(*accent, 235))
    f3 = font(FONT_BLACK, 44)
    dr.text((w / 2, h * 0.76), price_txt, font=f3, fill=(255, 255, 255), anchor="mm")

    f4 = font(FONT_SEMI, 26)
    dr.text((w / 2, h - 96), "₮ USDT (TRC20)  ·  ₿ BTC  ·  💳 CARD", font=f4, fill=(150, 160, 185), anchor="mm")
    f5 = font(FONT_SEMI, 22)
    dr.text((w / 2, h - 46), "DTD STORE  ·  DV TECHNOLOGIES", font=f5, fill=(105, 115, 140), anchor="mm")

    img.save(out, "JPEG", quality=92)
    print("wrote", out.name, img.size, img.size[0] * img.size[1] // 1024 // 8, "KB")


def main():
    for i, (name, hexc, tagline) in enumerate(PALETTE, 1):
        make_product(name, hexc, tagline, "PRICE ON REQUEST", CARD_OUT / f"product-card-{i}.jpg")
    for i, (hexc, heading, sub, *chips) in enumerate(BANNERS, 1):
        make_banner(i, hexc, heading, sub, chips, BANNER_OUT / f"promo-{i}.jpg")


if __name__ == "__main__":
    main()
