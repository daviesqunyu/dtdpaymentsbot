"""Generate promo banner JPEGs for the mirror promo system."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import hashlib, os

OUT = Path(r"C:\Users\davie\dtdpaymentsbot\assets")
OUT.mkdir(exist_ok=True)

ACCENTS = [
    ((124, 58, 237), "DTD STORE - Premium Digital Products"),
    ((13, 148, 136), "DTD STORE - Fast & Verified Delivery"),
    ((234, 88, 12), "DTD STORE - Flash Deals & Drops"),
    ((2, 132, 199), "DTD STORE - USDT BTC Card Payments"),
    ((22, 163, 74), "DTD STORE - Trusted Since Day One"),
    ((219, 39, 119), "DTD STORE - Premium Members Get More"),
    ((217, 119, 6), "DTD STORE - Shop Now & Save"),
    ((79, 70, 229), "DTD STORE - Instant Checkout"),
]

W, H = 1280, 720
gold = (255, 209, 84)

for i, (accent, tagline) in enumerate(ACCENTS):
    img = Image.new("RGB", (W, H))
    dr0 = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        r = int(accent[0] * (1 - t) * 0.3)
        g = int(accent[1] * (1 - t) * 0.3)
        b = int(accent[2] * (1 - t) * 0.3)
        bg = (r + int(12 * t), g + int(14 * t), b + int(26 * t))
        dr0.line([(0, y), (W, y)], fill=bg)

    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    drg = ImageDraw.Draw(glow)
    drg.ellipse((W//2 - 300, H//2 - 200, W//2 + 300, H//2 + 200), fill=(*accent, 40))
    drg.ellipse((100, 50, 400, 350), fill=(*accent, 25))
    drg.ellipse((W - 400, H - 350, W - 100, H - 50), fill=(*gold, 20))
    glow = glow.filter(ImageFilter.GaussianBlur(50))
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")

    vig = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    drv = ImageDraw.Draw(vig)
    rad = int(W * 0.62)
    for i2 in range(rad, W, 6):
        a = int(70 * (i2 - rad) / (W - rad))
        drv.ellipse((W/2-i2, H/2-i2, W/2+i2, H/2+i2), fill=(0, 0, 0, a))
    vig = vig.filter(ImageFilter.GaussianBlur(18))
    img = Image.alpha_composite(img.convert("RGBA"), vig).convert("RGB")

    dr = ImageDraw.Draw(img, "RGBA")

    dr.rounded_rectangle((80, 50, 300, 110), radius=30, fill=accent)
    try:
        fb = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 38)
        fm = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 56)
        fs = ImageFont.truetype(r"C:\Windows\Fonts\seguisb.ttf", 30)
        ft = ImageFont.truetype(r"C:\Windows\Fonts\seguisb.ttf", 24)
    except Exception:
        fb = fm = fs = ft = ImageFont.load_default()

    dr.text((190, 80), "DTD", font=fm, fill=(255, 255, 255), anchor="mm")
    dr.rounded_rectangle((W-300, 50, W-80, 110), radius=30, outline=gold, width=3)
    dr.text((W-190, 80), "STORE", font=fb, fill=gold, anchor="mm")

    dr.line([(W//2-300, 200), (W//2+300, 200)], fill=(*accent, 180), width=3)

    dr.text((W//2, 310), "PREMIUM DIGITAL PRODUCTS", font=fm, fill=(245, 247, 252), anchor="mm")
    dr.text((W//2, 380), tagline, font=fs, fill=(170, 180, 200), anchor="mm")

    dr.line([(W//2-250, 430), (W//2+250, 430)], fill=(*accent, 80), width=2)

    bullets = ["USDT (TRC20) · BTC · Card · Stars", "Instant Delivery · Verified Seller", "488+ Members · No Scammers"]
    by = 470
    for b in bullets:
        dr.text((W//2, by), f"✓  {b}", font=fs, fill=(200, 210, 225), anchor="mm")
        by += 48

    dr.rounded_rectangle((W//2-200, H-130, W//2+200, H-60), radius=35, fill=(*accent, 230))
    dr.text((W//2, H-95), "SHOP NOW", font=fm, fill=(255, 255, 255), anchor="mm")
    dr.text((W//2, H-25), "DTD STORE  ·  DV TECHNOLOGIES  ·  dtdpaymentsbot.pages.dev", font=ft, fill=(105, 115, 140), anchor="mm")

    out_path = OUT / f"promo-banner-{i+1}.jpg"
    img.save(str(out_path), "JPEG", quality=92)
    print(f"Generated: {out_path.name}")

print(f"Done! Generated {len(ACCENTS)} promo banners")
