// Rendu d'une page sur un canevas 2D. Le même code produit l'aperçu (vignettes) et l'export haute
// résolution : seule change la source d'image fournie par `provider` et la taille du canevas.
import type { Library, Template, PageDoc, ResolvedSlot, ResolvedText, DecoDef, FontKey, PhotoMeta, Rect } from "./types";
import { shapePoints, defaultText } from "./layout";

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type ImgSrc = CanvasImageSource & { width: number; height: number };
/** Fournit l'image d'une photo, décodée au moins à needW × needH pixels pour l'image entière. */
export type Provider = (photoId: string, needW: number, needH: number) => Promise<ImgSrc | null>;

export const FONTS: Record<FontKey, { family: string; weight: number }> = {
  script: { family: "Great Vibes", weight: 400 },
  serif: { family: "Playfair Display", weight: 400 },
  serifBold: { family: "Playfair Display", weight: 700 },
  sans: { family: "Montserrat", weight: 400 },
  sansBold: { family: "Montserrat", weight: 700 },
  display: { family: "Anton", weight: 400 },
};

export interface RenderInput {
  lib: Library;
  t: Template;
  page: PageDoc;
  slots: ResolvedSlot[];
  texts: ResolvedText[];
  photos: Map<string, PhotoMeta>;
}

export interface RenderOptions {
  placeholder?: string; // couleur des emplacements vides
  onProgress?: (done: number, total: number) => void;
}

const DEFAULT_FOCUS = { fx: 0.5, fy: 0.38, zoom: 1 };

function pathFor(ctx: Ctx, s: ResolvedSlot, X: number, Y: number, W: number, H: number, pw: number, ph: number) {
  ctx.beginPath();
  const sh = s.shape;
  if (sh.type === "poly" || sh.type === "sector") {
    const pts = shapePoints(sh, pw, ph)!;
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  } else if (sh.type === "ellipse") {
    ctx.ellipse(X + W / 2, Y + H / 2, W / 2, H / 2, 0, 0, Math.PI * 2);
  } else if (sh.type === "rounded") {
    ctx.roundRect(X, Y, W, H, sh.r * Math.min(W, H));
  } else ctx.rect(X, Y, W, H);
}

/** Dessine `img` en mode « cover » dans le rectangle (X,Y,W,H) avec point focal et zoom. */
function drawCover(ctx: Ctx, img: ImgSrc, meta: PhotoMeta, X: number, Y: number, W: number, H: number, fx: number, fy: number, zoom: number) {
  const s = Math.max(W / meta.width, H / meta.height) * zoom;
  const cw = Math.min(1, W / (meta.width * s)), chh = Math.min(1, H / (meta.height * s));
  const left = Math.min(Math.max(fx - cw / 2, 0), 1 - cw), top = Math.min(Math.max(fy - chh / 2, 0), 1 - chh);
  ctx.drawImage(img, left * img.width, top * img.height, cw * img.width, chh * img.height, X, Y, W, H);
}

function drawContain(ctx: Ctx, img: ImgSrc, meta: PhotoMeta, X: number, Y: number, W: number, H: number) {
  const s = Math.min(W / meta.width, H / meta.height);
  const w = meta.width * s, h = meta.height * s;
  ctx.drawImage(img, 0, 0, img.width, img.height, X + (W - w) / 2, Y + (H - h) / 2, w, h);
}

export function needSize(meta: PhotoMeta, W: number, H: number, zoom = 1): [number, number] {
  const s = Math.min(1, Math.max(W / meta.width, H / meta.height) * zoom);
  return [Math.ceil(meta.width * s), Math.ceil(meta.height * s)];
}

function heartPath(ctx: Ctx, x: number, y: number, w: number, h: number) {
  ctx.beginPath();
  for (let i = 0; i <= 60; i++) {
    const a = (2 * Math.PI * i) / 60;
    const hx = 16 * Math.sin(a) ** 3, hy = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
    const px = x + w / 2 + (hx / 34) * w, py = y + h * 0.45 - (hy / 34) * h;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}

function fontString(key: FontKey | undefined, px: number) {
  const f = FONTS[key ?? "sans"];
  return `${f.weight} ${Math.max(4, px)}px "${f.family}"`;
}

function drawText(ctx: Ctx, x: ResolvedText, content: string, PW: number, PH: number) {
  const [bx, by, bw, bh] = x.box;
  const X = bx * PW, Y = by * PH, W = bw * PW, H = bh * PH;
  let size = (x.size ?? (x.kind === "title" ? 0.035 : 0.022)) * PH;
  const font = x.font ?? (x.kind === "title" ? "serif" : "sans");
  const lines = x.stack ? content.replace(/\n/g, "").split("") : content.split("\n");
  ctx.save();
  ctx.fillStyle = x.color ?? "#222222";
  ctx.textBaseline = "middle";
  const tracking = x.tracking ?? 0;
  const anyCtx = ctx as unknown as { letterSpacing?: string };
  const measure = () => {
    ctx.font = fontString(font, size);
    if ("letterSpacing" in anyCtx) anyCtx.letterSpacing = `${tracking * size}px`;
    return Math.max(...lines.map((l) => ctx.measureText(l).width));
  };
  const lh = x.stack ? 0.95 : 1.25;
  // réduit la taille si le texte déborde de sa zone (sauf texte pivoté)
  if (!x.rotate) { let guard = 0; while ((measure() > W * 1.02 || lines.length * size * lh > H * 1.05) && guard++ < 30) size *= 0.92; }
  else measure();
  const totalH = lines.length * size * lh;
  const align = x.align ?? "left";
  ctx.textAlign = align;
  ctx.translate(X + W / 2, Y + H / 2);
  if (x.rotate) ctx.rotate((-x.rotate * Math.PI) / 180);
  const ax = align === "left" ? -W / 2 : align === "right" ? W / 2 : 0;
  lines.forEach((l, i) => ctx.fillText(l, ax, -totalH / 2 + size * lh * (i + 0.5)));
  ctx.restore();
}

function drawDeco(ctx: Ctx, d: DecoDef, PW: number, PH: number) {
  ctx.save();
  if (d.type === "poly" && d.pts) {
    ctx.beginPath();
    d.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * PW, y * PH) : ctx.moveTo(x * PW, y * PH)));
    ctx.closePath();
    ctx.fillStyle = d.color ?? "#cccccc"; ctx.fill();
    if (d.stroke) { ctx.strokeStyle = d.stroke; ctx.lineWidth = PW * 0.012; ctx.stroke(); }
    ctx.restore(); return;
  }
  const [x, y, w, h] = d.b!;
  const X = x * PW, Y = y * PH, W = w * PW, H = h * PH;
  ctx.translate(X + W / 2, Y + H / 2);
  if (d.rotate) ctx.rotate((d.rotate * Math.PI) / 180);
  ctx.translate(-W / 2, -H / 2);
  if (d.type === "band") { ctx.fillStyle = d.color ?? "#eee"; ctx.fillRect(0, 0, W, H); }
  else if (d.type === "tape") { ctx.fillStyle = "rgba(236,224,200,0.7)"; ctx.fillRect(0, 0, W, H); }
  else if (d.type === "pin") {
    const r = Math.min(W, H) * 0.45;
    const g = ctx.createRadialGradient(W / 2 - r / 3, H / 2 - r / 3, r / 6, W / 2, H / 2, r);
    g.addColorStop(0, "#f6dc8a"); g.addColorStop(1, "#a8801f");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2); ctx.fill();
  } else if (d.type === "heart") {
    heartPath(ctx, 0, 0, W, H);
    if (d.outline) { ctx.strokeStyle = d.color ?? "#900"; ctx.lineWidth = Math.max(1, W * 0.03); ctx.stroke(); }
    else { ctx.fillStyle = d.color ?? "#e3a7a7"; ctx.globalAlpha = 0.86; ctx.fill(); }
  }
  ctx.restore();
}

/** Rend la page complète. PW × PH = taille du canevas en pixels. */
export async function renderPage(ctx: Ctx, PW: number, PH: number, inp: RenderInput, provider: Provider, opt: RenderOptions = {}) {
  const { t, page, slots, texts, photos } = inp;
  const bg = page.background ?? t.background?.color ?? "#ffffff";
  ctx.save();
  ctx.fillStyle = bg; ctx.fillRect(0, 0, PW, PH);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  const stroke = ((t.defaults?.stroke ?? 0) * PW) / 600;

  // groupes « split » : une photo répartie sur plusieurs emplacements
  const groups = new Map<string, Rect>();
  for (const s of slots) if (s.split) {
    const g = groups.get(s.split);
    const [x, y, w, h] = s.box;
    if (!g) groups.set(s.split, [x, y, w, h]);
    else { const x0 = Math.min(g[0], x), y0 = Math.min(g[1], y); groups.set(s.split, [x0, y0, Math.max(g[0] + g[2], x + w) - x0, Math.max(g[1] + g[3], y + h) - y0]); }
  }

  type Layer = { z: number; kind: "slot" | "text" | "deco"; i: number };
  const layers: Layer[] = [
    ...slots.map((s, i) => ({ z: s.z ?? (s.isBackground ? -1 : 1), kind: "slot" as const, i })),
    ...texts.map((x, i) => ({ z: x.z ?? 20, kind: "text" as const, i })),
    ...(t.deco ?? []).map((d, i) => ({ z: d.z ?? (d.type === "pin" ? 30 : 5), kind: "deco" as const, i })),
  ].sort((a, b) => a.z - b.z || (a.kind === b.kind ? a.i - b.i : 0));

  let done = 0;
  const totalSlots = slots.length;
  let num = 0;
  for (const L of layers) {
    if (L.kind === "text") { const x = texts[L.i]; drawText(ctx, x, page.texts[x.index] ?? defaultText(x), PW, PH); continue; }
    if (L.kind === "deco") { drawDeco(ctx, t.deco![L.i], PW, PH); continue; }
    const s = slots[L.i];
    const st = page.slots[s.index] ?? { ...DEFAULT_FOCUS };
    const meta = st.photoId ? photos.get(st.photoId) : undefined;
    const [bx, by, bw, bh] = s.box;
    const X = bx * PW, Y = by * PH, W = bw * PW, H = bh * PH;
    ctx.save();
    const rotated = !!s.rotate && s.shape.type !== "poly" && s.shape.type !== "sector";
    if (rotated) { ctx.translate(X + W / 2, Y + H / 2); ctx.rotate((s.rotate! * Math.PI) / 180); ctx.translate(-(X + W / 2), -(Y + H / 2)); }
    // cadre (fin ou polaroïd)
    let ix = X, iy = Y, iw = W, ih = H;
    if (s.frame) {
      ctx.save();
      if (rotated || bg.toLowerCase() !== "#ffffff") { ctx.shadowColor = "rgba(0,0,0,0.28)"; ctx.shadowBlur = Math.min(W, H) * 0.04; ctx.shadowOffsetY = Math.min(W, H) * 0.012; }
      ctx.fillStyle = "#fcfbf8"; ctx.fillRect(X, Y, W, H); ctx.restore();
      if (s.frame === "polaroid") {
        const pad = W * 0.06, bottom = H * (s.caption ? 0.2 : 0.14);
        ix = X + pad; iy = Y + pad; iw = W - 2 * pad; ih = H - pad - bottom;
        if (s.caption) {
          ctx.save(); ctx.fillStyle = "#1e1e1e"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.font = fontString("script", bottom * 0.55); ctx.fillText(s.caption, X + W / 2, Y + H - bottom / 2, W * 0.9); ctx.restore();
        }
      } else { const pad = Math.max(2, Math.min(W, H) * 0.025); ix = X + pad; iy = Y + pad; iw = W - 2 * pad; ih = H - 2 * pad; }
    }
    // zone de découpe
    const clipSlot = { ...s, box: s.box };
    if (s.frame) ctx.beginPath(), ctx.rect(ix, iy, iw, ih);
    else pathFor(ctx, clipSlot, X, Y, W, H, PW, PH);
    ctx.save(); ctx.clip();
    if (meta && st.photoId) {
      let dx = ix, dy = iy, dw = iw, dh = ih;
      if (s.split && groups.has(s.split)) { const g = groups.get(s.split)!; dx = g[0] * PW; dy = g[1] * PH; dw = g[2] * PW; dh = g[3] * PH; }
      const fit = t.fit === "contain";
      const [nw, nh] = fit ? needSize(meta, dw, dh, 0.0001) : needSize(meta, dw, dh, st.zoom);
      const img = await provider(st.photoId, Math.max(nw, 1), Math.max(nh, 1));
      if (img) fit ? drawContain(ctx, img, meta, dx, dy, dw, dh) : drawCover(ctx, img, meta, dx, dy, dw, dh, st.fx, st.fy, st.zoom);
      if (s.fade === "bottom-dark") {
        const g = ctx.createLinearGradient(0, iy + ih * 0.45, 0, iy + ih);
        g.addColorStop(0, "rgba(10,10,10,0)"); g.addColorStop(1, "rgba(10,10,10,0.9)");
        ctx.fillStyle = g; ctx.fillRect(ix, iy, iw, ih);
      }
      if (s.isBackground && t.background?.fade === "right-light") {
        const g = ctx.createLinearGradient(PW * 0.5, 0, PW * 0.8, 0);
        g.addColorStop(0, "rgba(250,250,250,0)"); g.addColorStop(1, "rgba(250,250,250,1)");
        ctx.fillStyle = g; ctx.fillRect(0, 0, PW, PH);
      }
    } else if (opt.placeholder) {
      ctx.fillStyle = opt.placeholder; ctx.fillRect(ix, iy, iw, ih);
    }
    ctx.restore(); // clip
    if (stroke && !s.frame && s.shape.type !== "rect" && s.shape.type !== "rounded") {
      pathFor(ctx, s, X, Y, W, H, PW, PH);
      ctx.strokeStyle = bg; ctx.lineWidth = stroke; ctx.lineJoin = "round"; ctx.stroke();
    }
    ctx.restore(); // rotation
    if (t.labels && !s.isBackground) {
      num++;
      ctx.save(); ctx.fillStyle = "#555"; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.font = fontString("sans", PH * 0.011); ctx.fillText(String(num).padStart(3, "0"), X + W / 2, Y + H + PH * 0.002); ctx.restore();
    }
    done++; opt.onProgress?.(done, totalSlots);
  }
  ctx.restore();
}
