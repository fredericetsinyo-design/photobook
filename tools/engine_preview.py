"""Moteur de prévisualisation PhotoBook (schéma v2) — référence fonctionnelle pour le moteur TypeScript.
Usage : python3 engine_preview.py templates.json photos/ catalogue.jpg"""
import json, sys, glob, math, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FONT_FILES = {
    "script": "fonts/great-vibes-latin-400-normal.woff", "serif": "fonts/playfair-display-latin-400-normal.woff",
    "serifBold": "fonts/playfair-display-latin-700-normal.woff", "sans": "fonts/montserrat-latin-400-normal.woff",
    "sansBold": "fonts/montserrat-latin-700-normal.woff", "display": "fonts/anton-latin-400-normal.woff"}
_fc = {}
def font(name, px):
    k = (name, px)
    if k not in _fc:
        _fc[k] = ImageFont.truetype(FONT_FILES.get(name, FONT_FILES["sans"]), max(6, int(px)))
    return _fc[k]

def hexc(s, a=255):
    s = s.lstrip("#"); return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4)) + (a,)

# ---------------- géométrie ----------------
def page_mm(lib, t, fmt_id):
    f = next(f for f in lib["formats"] if f["id"] == fmt_id)
    w, h = f["mm"]
    if t["orientation"] == "landscape" and w < h: w, h = h, w
    if t["orientation"] == "portrait" and w > h: w, h = h, w
    return w, h

def grid_boxes(t, W, H, items):
    m, g = t["defaults"].get("margin", 8), t["defaults"].get("gutter", 3)
    c, r = t["grid"]
    cw, ch = (W - 2 * m) / c, (H - 2 * m) / r
    out = []
    for s in items:
        x, y, w, h = s["r"]
        x0, y0, x1, y1 = m + x * cw, m + y * ch, m + (x + w) * cw, m + (y + h) * ch
        if x > 0: x0 += g / 2
        if y > 0: y0 += g / 2
        if x + w < c: x1 -= g / 2
        if y + h < r: y1 -= g / 2
        if t.get("labels") and "content" not in s: y1 -= min(5, (y1 - y0) * .15)
        out.append(dict(s, box=(x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H)))
    return out

def heart_inside(u, v):  # u,v dans [0,1] -> repère du cœur
    x = (u - .5) * 2.6; y = (.55 - v) * 2.6
    return (x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0

def gen_heart_grid(t, W, H):
    cols, rows = 11, 11; top, left, size = .05, .05, .9
    cell = size / cols; ch = cell * W / H
    hero = {(cc, rr) for cc in range(4, 7) for rr in range(3, 6)}
    slots = [{"b": [left + 4 * cell, top + 3 * ch, 3 * cell, 3 * ch], "role": "hero"}]
    for rr in range(rows):
        for cc in range(cols):
            if (cc, rr) in hero: continue
            if heart_inside((cc + .5) / cols, (rr + .5) / rows * .95 + .03):
                slots.append({"b": [left + cc * cell, top + rr * ch, cell, ch]})
    pad = .004
    for s in slots:
        x, y, w, h = s["b"]; s["box"] = (x + pad, y + pad * W / H, w - 2 * pad, h - 2 * pad * W / H)
    return slots

def gen_heart_scatter(t, W, H):
    rnd = random.Random(7); slots = []
    pts = []
    for i in range(16):
        a = 2 * math.pi * i / 16
        x = 16 * math.sin(a) ** 3; y = 13 * math.cos(a) - 5 * math.cos(2 * a) - 2 * math.cos(3 * a) - math.cos(4 * a)
        pts.append((.5 + x / 40, .43 - y / 40))
    pts += [(.38, .36), (.6, .36), (.5, .52), (.42, .62), (.58, .6)]
    for i, (cx, cy) in enumerate(pts):
        sz = .15 if i < 16 else .19
        w, h = sz, sz * 1.1
        slots.append({"box": (cx - w / 2, cy - h / 2, w, h * W / H * 1.0), "frame": "polaroid", "rotate": rnd.uniform(-12, 12),
                      "z": rnd.randint(1, 5), "role": "hero" if i == 18 else None})
    return slots

def justified_rows(n, W, H, m, g, ratios):
    aw, ah = W - 2 * m, H - 2 * m; best = None
    for rows in range(1, n + 1):
        per = math.ceil(n / rows); groups = [ratios[i:i + per] for i in range(0, n, per)]
        hs = [(aw - g * (len(gp) - 1)) / sum(gp) for gp in groups]
        tot = sum(hs) + g * (len(groups) - 1)
        if best is None or abs(tot - ah) < best[0]: best = (abs(tot - ah), groups, hs, tot)
    _, groups, hs, tot = best
    k = (ah - g * (len(groups) - 1)) / (tot - g * (len(groups) - 1)); out = []; y = m
    for gp, h in zip(groups, hs):
        h *= k; x = m
        for a in gp:
            w = (aw - g * (len(gp) - 1)) * a / sum(gp)
            out.append({"box": (x / W, y / H, w / W, h / H)}); x += w + g
        y += h + g
    return out

def shape_poly_px(shape, Wp, Hp):
    if shape["type"] == "poly":
        return [(x * Wp, y * Hp) for x, y in shape["pts"]]
    if shape["type"] == "sector":
        cx, cy = shape["c"][0] * Wp, shape["c"][1] * Hp; r0, r1 = shape["r0"] * Wp, shape["r1"] * Wp
        a0, a1 = math.radians(shape["a0"]), math.radians(shape["a1"]); n = 24
        outer = [(cx + r1 * math.cos(a0 + (a1 - a0) * i / n), cy + r1 * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]
        inner = [(cx + r0 * math.cos(a1 - (a1 - a0) * i / n), cy + r0 * math.sin(a1 - (a1 - a0) * i / n)) for i in range(n + 1)]
        return outer + inner
    return None

# ---------------- rendu photo ----------------
def cover(im, w, h, focus=(.5, .38)):
    w, h = max(1, int(round(w))), max(1, int(round(h)))
    iw, ih = im.size; s = max(w / iw, h / ih); nw, nh = iw * s, ih * s
    l = min(max(focus[0] * nw - w / 2, 0), nw - w); tp = min(max(focus[1] * nh - h / 2, 0), nh - h)
    return im.resize((max(w, round(nw)), max(h, round(nh))), Image.LANCZOS).crop((round(l), round(tp), round(l) + w, round(tp) + h))

def apply_fade(tile, kind):
    w, h = tile.size; ov = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    if kind == "bottom-dark":
        for yy in range(int(h * .45), h):
            a = int(230 * max(0.0, (yy - h * .45) / (h * .55)) ** 1.3); d.line([(0, yy), (w, yy)], fill=(10, 10, 10, a))
    elif kind == "right-light":
        for xx in range(int(w * .5), w):
            a = int(255 * min(1, ((xx - w * .5) / (w * .3)))); d.line([(xx, 0), (xx, h)], fill=(250, 250, 250, a))
    return Image.alpha_composite(tile.convert("RGBA"), ov)

def rounded_mask(w, h, r):
    m = Image.new("L", (w, h), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], radius=int(r), fill=255); return m

def paste_rgba(page, tile, cx, cy, rotate=0, shadow=False):
    if shadow:
        sh = Image.new("RGBA", (tile.size[0] + 20, tile.size[1] + 20), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rectangle([10, 12, tile.size[0] + 10, tile.size[1] + 12], fill=(0, 0, 0, 70))
        sh = sh.filter(ImageFilter.GaussianBlur(5))
        if rotate: sh = sh.rotate(rotate, resample=Image.BICUBIC, expand=True)
        page.alpha_composite(sh, (int(cx - sh.size[0] / 2 + 2), int(cy - sh.size[1] / 2 + 3)))
    if rotate: tile = tile.rotate(rotate, resample=Image.BICUBIC, expand=True)
    page.alpha_composite(tile, (int(cx - tile.size[0] / 2), int(cy - tile.size[1] / 2)))

def draw_text(page, el, Wp, Hp):
    x, y, w, h = el["box"]; X, Y, Wb, Hb = x * Wp, y * Hp, w * Wp, h * Hp
    fnt = font(el.get("font", "sans"), el.get("size", .03) * Hp)
    col = hexc(el.get("color", "#222222"))
    txt = el.get("content") or {"title": "Titre", "caption": "Prénom · lieu · date"}.get(el.get("kind"), "Texte")
    if not el.get("font") and el.get("kind") == "title": fnt = font("serif", .035 * Hp)
    if el.get("stack"): txt = "\n".join(txt)
    if el.get("tracking"): txt = "\n".join((" " if el["tracking"] > .2 else " ").join(line) for line in txt.split("\n"))
    rot = el.get("rotate", 0)
    align = el.get("align", "left")
    sp = 0 if el.get("stack") else int(fnt.size * .15)
    bb = ImageDraw.Draw(Image.new("L", (1, 1))).multiline_textbbox((0, 0), txt, font=fnt, align=align, spacing=sp)
    tile = Image.new("RGBA", (int(bb[2] - bb[0]) + 40, int(bb[3] - bb[1]) + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    d.multiline_text((tile.size[0] / 2 - tw / 2 - bb[0], tile.size[1] / 2 - th / 2 - bb[1]), txt, font=fnt, fill=col, align=align, spacing=sp)
    tile = tile.crop(tile.getbbox() or (0, 0, 1, 1))
    if rot: tile = tile.rotate(rot, resample=Image.BICUBIC, expand=True)
    if align == "left" and not rot: cx = X + tile.size[0] / 2
    else: cx = X + Wb / 2
    page.alpha_composite(tile, (int(cx - tile.size[0] / 2), int(Y + Hb / 2 - tile.size[1] / 2)))

def heart_pts(x, y, w, h):
    pts = []
    for i in range(60):
        a = 2 * math.pi * i / 60
        hx = 16 * math.sin(a) ** 3; hy = 13 * math.cos(a) - 5 * math.cos(2 * a) - 2 * math.cos(3 * a) - math.cos(4 * a)
        pts.append((x + w / 2 + hx / 34 * w, y + h * .45 - hy / 34 * h))
    return pts

def draw_deco(page, el, Wp, Hp):
    t = el["type"]
    if t == "poly":
        pts = [(a * Wp, b * Hp) for a, b in el["pts"]]
        d = ImageDraw.Draw(page); d.polygon(pts, fill=hexc(el["color"]))
        if el.get("stroke"): d.line(pts + [pts[0]], fill=hexc(el["stroke"]), width=max(2, int(Wp * .012)))
        return
    x, y, w, h = el["b"]; X, Y, W_, H_ = x * Wp, y * Hp, w * Wp, h * Hp
    tile = Image.new("RGBA", (max(2, int(W_)), max(2, int(H_))), (0, 0, 0, 0)); d = ImageDraw.Draw(tile)
    if t == "band": d.rectangle([0, 0, W_, H_], fill=hexc(el["color"]))
    elif t == "tape": d.rectangle([0, 0, W_, H_], fill=(236, 224, 200, 170))
    elif t == "pin":
        r = min(W_, H_) * .9; d.ellipse([W_ / 2 - r / 2, H_ / 2 - r / 2, W_ / 2 + r / 2, H_ / 2 + r / 2], fill=(200, 160, 60, 255), outline=(150, 115, 40, 255))
        d.ellipse([W_ / 2 - r / 5, H_ / 2 - r / 4, W_ / 2, H_ / 2 - r / 12], fill=(250, 225, 150, 255))
    elif t == "heart":
        pts = heart_pts(0, 0, W_, H_)
        if el.get("outline"): d.line(pts + [pts[0]], fill=hexc(el["color"]), width=max(2, int(W_ * .03)))
        else: d.polygon(pts, fill=hexc(el["color"], 220))
    paste_rgba(page, tile, X + W_ / 2, Y + H_ / 2, el.get("rotate", 0))

def render(lib, t, photos, fmt=None, max_px=640, seed=0):
    fmt = fmt or t["formats"][0]
    Wmm, Hmm = page_mm(lib, t, fmt)
    k = max_px / max(Wmm, Hmm); Wp, Hp = int(Wmm * k), int(Hmm * k)
    bg = t.get("background", {})
    page = Image.new("RGBA", (Wp, Hp), hexc(bg.get("color", "#ffffff")))
    # --- emplacements
    if t["layout"] == "grid":
        sd = t.get("slotDefaults", {})
        items = t["slots"] if t["slots"] != "auto" else [{"r": [i % t["grid"][0], i // t["grid"][0], 1, 1]} for i in range(t["grid"][0] * t["grid"][1])]
        slots = grid_boxes(t, Wmm, Hmm, [dict(sd, **s) for s in items])
        texts = grid_boxes(t, Wmm, Hmm, t.get("text", []))
    elif t["layout"] == "free":
        slots = []
        for s in t["slots"]:
            s = dict(s)
            if "b" in s: s["box"] = tuple(s["b"])
            else:
                pts = shape_poly_px(s["shape"], 1, 1); xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
                s["box"] = (min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))
            slots.append(s)
        texts = [dict(x, box=tuple(x["b"])) for x in t.get("text", [])]
    else:
        g = t["generator"]
        if g == "justified-rows":
            sel = photos[:11]; m, gg = t["defaults"]["margin"], t["defaults"]["gutter"]
            slots = justified_rows(len(sel), Wmm, Hmm, m, gg, [p.size[0] / p.size[1] for p in sel])
        elif g == "heart-grid": slots = gen_heart_grid(t, Wp, Hp)
        else: slots = gen_heart_scatter(t, Wp, Hp)
        texts = [dict(x, box=tuple(x["b"])) for x in t.get("text", [])]
    # --- affectation photos (hero d'abord, puis proportions)
    pool = list(range(len(photos)))
    def take(aspect):
        nonlocal pool
        if not pool: pool = list(range(len(photos)))
        j = min(pool, key=lambda q: abs(math.log((photos[q].size[0] / photos[q].size[1]) / aspect)))
        pool.remove(j); return photos[j]
    if bg.get("photo"):
        bgim = take(Wp / Hp)
        tile = apply_fade(cover(bgim, Wp, Hp), bg.get("fade")) if bg.get("fade") else cover(bgim, Wp, Hp).convert("RGBA")
        page.alpha_composite(tile)
    groups = {}
    for s in sorted(slots, key=lambda s: (s.get("role") != "hero", -(s["box"][2] * s["box"][3]))):
        asp = (s["box"][2] * Wp) / max(1e-6, s["box"][3] * Hp)
        if s.get("split"):
            if s["split"] not in groups:
                gs = [q for q in slots if q.get("split") == s["split"]]
                x0 = min(q["box"][0] for q in gs); y0 = min(q["box"][1] for q in gs)
                x1 = max(q["box"][0] + q["box"][2] for q in gs); y1 = max(q["box"][1] + q["box"][3] for q in gs)
                gb = (x0, y0, x1 - x0, y1 - y0); im = take(gb[2] * Wp / (gb[3] * Hp))
                groups[s["split"]] = (gb, cover(im, gb[2] * Wp, gb[3] * Hp))
            continue
        if t.get("sameImage"):
            s["img"] = photos[0]
        else:
            s["img"] = take(asp)
    stroke = t.get("defaults", {}).get("stroke", 0) * Wp / 600
    bgcol = hexc(bg.get("color", "#ffffff"))
    # --- composition par ordre z
    layers = [("slot", s) for s in slots] + [("text", x) for x in texts] + [("deco", d) for d in t.get("deco", [])]
    zdef = {"slot": 1, "deco": 5, "text": 20}
    layers.sort(key=lambda L: L[1].get("z", zdef[L[0]] if not (L[0] == "deco" and L[1]["type"] == "pin") else 30))
    num = 0
    for kind, el in layers:
        if kind == "text": draw_text(page, el, Wp, Hp); continue
        if kind == "deco": draw_deco(page, el, Wp, Hp); continue
        s = el; x, y, w, h = s["box"]; X, Y, W_, H_ = x * Wp, y * Hp, w * Wp, h * Hp
        shape = s.get("shape", {"type": "rect"})
        if shape["type"] in ("poly", "sector"):
            pts = shape_poly_px(shape, Wp, Hp)
            tile = cover(s["img"], W_, H_).convert("RGBA")
            mask = Image.new("L", tile.size, 0)
            ImageDraw.Draw(mask).polygon([(px - X, py - Y) for px, py in pts], fill=255)
            page.paste(tile, (int(X), int(Y)), mask)
            if stroke: ImageDraw.Draw(page).line(pts + [pts[0]], fill=bgcol, width=max(1, int(stroke)), joint="curve")
            continue
        frame = s.get("frame")
        Wi, Hi = int(round(W_)), int(round(H_))
        if frame == "polaroid":
            pad = W_ * .06; bottom = H_ * (.2 if s.get("caption") else .14)
            ph = cover(s["img"], W_ - 2 * pad, H_ - pad - bottom)
            tile = Image.new("RGBA", (Wi, Hi), (252, 251, 248, 255)); tile.paste(ph, (int(pad), int(pad)))
            if s.get("caption"):
                d = ImageDraw.Draw(tile); f = font("script", bottom * .55)
                d.text((Wi / 2, Hi - bottom / 2), s["caption"], font=f, fill=(30, 30, 30, 255), anchor="mm")
        elif frame == "thin":
            pad = max(2, min(W_, H_) * .025)
            tile = Image.new("RGBA", (Wi, Hi), (255, 255, 255, 255)); tile.paste(cover(s["img"], W_ - 2 * pad, H_ - 2 * pad), (int(pad), int(pad)))
        else:
            if s.get("split"):
                gb, gim = groups[s["split"]]
                ox, oy = int((x - gb[0]) * Wp), int((y - gb[1]) * Hp)
                tile = gim.crop((ox, oy, ox + Wi, oy + Hi)).convert("RGBA")
            else:
                ph = cover(s["img"], Wi, Hi)
                if t.get("fit") == "contain":
                    ph = s["img"].copy(); ph.thumbnail((Wi, Hi), Image.LANCZOS)
                    tl = Image.new("RGBA", (Wi, Hi), (0, 0, 0, 0)); tl.paste(ph, ((Wi - ph.size[0]) // 2, (Hi - ph.size[1]) // 2)); ph = tl
                tile = ph.convert("RGBA")
            if s.get("fade"): tile = apply_fade(tile, s["fade"])
            if shape["type"] == "rounded": tile.putalpha(rounded_mask(Wi, Hi, shape["r"] * min(Wi, Hi)))
            elif shape["type"] == "ellipse":
                m = Image.new("L", (Wi, Hi), 0); ImageDraw.Draw(m).ellipse([0, 0, Wi - 1, Hi - 1], fill=255)
                if stroke: ImageDraw.Draw(page).ellipse([X - stroke, Y - stroke, X + Wi + stroke, Y + Hi + stroke], fill=bgcol)
                tile.putalpha(m)
        paste_rgba(page, tile, X + W_ / 2, Y + H_ / 2, s.get("rotate", 0), shadow=frame in ("polaroid", "thin") and bg.get("color", "#ffffff") != "#ffffff" or bool(s.get("rotate")))
        if t.get("labels"):
            num += 1; ImageDraw.Draw(page).text((X + W_ / 2, Y + H_ + 1), f"{num:03d}", fill=(90, 90, 90, 255), anchor="mt", font=font("sans", Hp * .012))
    return page.convert("RGB")

if __name__ == "__main__":
    lib = json.load(open(sys.argv[1]))
    files = sorted(glob.glob(sys.argv[2] + "/*.jpg"))
    photos = [Image.open(f).convert("RGB") for f in files]
    for p in photos: p.thumbnail((900, 900))
    cats = {c["id"]: c["name"] for c in lib["categories"]}
    only = sys.argv[4].split(",") if len(sys.argv) > 4 else None
    tiles = []
    for i, t in enumerate(lib["templates"]):
        if only and t["id"] not in only: continue
        rnd = random.Random(i * 13); ph = photos[:]; rnd.shuffle(ph)
        pg = render(lib, t, ph)
        pg.thumbnail((270, 250), Image.LANCZOS)
        cell = Image.new("RGB", (300, 340), (244, 241, 236)); cd = ImageDraw.Draw(cell)
        ox, oy = (300 - pg.size[0]) // 2, 10 + (250 - pg.size[1]) // 2
        cd.rectangle([ox + 3, oy + 3, ox + pg.size[0] + 3, oy + pg.size[1] + 3], fill=(212, 206, 198)); cell.paste(pg, (ox, oy))
        n = t["photos"]; ns = f"{n[0]}" if n[0] == n[1] else f"{n[0]}–{n[1]}"
        fname = next(f["name"] for f in lib["formats"] if f["id"] == t["formats"][0]).split(" (")[0]
        cd.text((150, 270), t["name"], fill=(30, 30, 30), anchor="mt", font=font("sansBold", 14))
        cd.text((150, 292), cats[t["category"]], fill=(120, 110, 95), anchor="mt", font=font("sans", 11))
        cd.text((150, 310), f"{ns} photo{'s' if n[1] > 1 else ''} · {fname}", fill=(120, 110, 95), anchor="mt", font=font("sans", 11))
        tiles.append(cell)
    cols = 5; rows = math.ceil(len(tiles) / cols)
    sheet = Image.new("RGB", (cols * 300, rows * 340), (244, 241, 236))
    for q, c in enumerate(tiles): sheet.paste(c, ((q % cols) * 300, (q // cols) * 340))
    sheet.save(sys.argv[3], quality=88)
    print(len(tiles), "modèles rendus")
