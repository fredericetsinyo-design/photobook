// Calcul de la mise en page : indépendant de la résolution (tout est en mm ou en fractions de page).
import type { Library, Template, ResolvedSlot, ResolvedText, Rect, SlotDef, TextDef, Shape } from "./types";

export function pageSizeMm(lib: Library, t: Template, formatId: string): { w: number; h: number; px?: [number, number] } {
  const f = lib.formats.find((x) => x.id === formatId) ?? lib.formats[0];
  let [w, h] = f.mm;
  if (t.orientation === "landscape" && w < h) [w, h] = [h, w];
  if ((t.orientation === "portrait" || t.orientation === "any") && w > h && !f.spread) [w, h] = [h, w];
  return { w, h, px: f.px };
}

/** Pixels de sortie pour une résolution donnée (ou taille fixe pour les formats écran). */
export function pagePixels(lib: Library, t: Template, formatId: string, dpi: number): [number, number] {
  const { w, h, px } = pageSizeMm(lib, t, formatId);
  if (px) return px;
  return [Math.round((w / 25.4) * dpi), Math.round((h / 25.4) * dpi)];
}

function gridRect(t: Template, r: Rect, W: number, H: number, margin: number, gutter: number, label: boolean): Rect {
  const [c, rows] = t.grid!;
  const cw = (W - 2 * margin) / c, ch = (H - 2 * margin) / rows;
  const [x, y, w, h] = r;
  let x0 = margin + x * cw, y0 = margin + y * ch, x1 = margin + (x + w) * cw, y1 = margin + (y + h) * ch;
  if (x > 0) x0 += gutter / 2;
  if (y > 0) y0 += gutter / 2;
  if (x + w < c) x1 -= gutter / 2;
  if (y + h < rows) y1 -= gutter / 2;
  if (label) y1 -= Math.min(5, (y1 - y0) * 0.15);
  return [x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H];
}

export function shapePoints(shape: Shape, W = 1, H = 1): [number, number][] | null {
  if (shape.type === "poly") return shape.pts.map(([x, y]) => [x * W, y * H]);
  if (shape.type === "sector") {
    const cx = shape.c[0] * W, cy = shape.c[1] * H, r0 = shape.r0 * W, r1 = shape.r1 * W;
    const a0 = (shape.a0 * Math.PI) / 180, a1 = (shape.a1 * Math.PI) / 180, n = 32;
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)]); }
    for (let i = 0; i <= n; i++) { const a = a1 - ((a1 - a0) * i) / n; pts.push([cx + r0 * Math.cos(a), cy + r0 * Math.sin(a)]); }
    return pts;
  }
  return null;
}

function heartInside(u: number, v: number) {
  const x = (u - 0.5) * 2.6, y = (0.55 - v) * 2.6;
  return (x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const rng = mulberry;

function justifiedRows(aspects: number[], W: number, H: number, m: number, g: number): Rect[] {
  const n = aspects.length, aw = W - 2 * m, ah = H - 2 * m;
  let best: { s: number; groups: number[][]; hs: number[]; tot: number } | null = null;
  for (let rows = 1; rows <= n; rows++) {
    const per = Math.ceil(n / rows), groups: number[][] = [];
    for (let i = 0; i < n; i += per) groups.push(aspects.slice(i, i + per));
    const hs = groups.map((gp) => (aw - g * (gp.length - 1)) / gp.reduce((a, b) => a + b, 0));
    const tot = hs.reduce((a, b) => a + b, 0) + g * (groups.length - 1);
    if (!best || Math.abs(tot - ah) < best.s) best = { s: Math.abs(tot - ah), groups, hs, tot };
  }
  const { groups, hs, tot } = best!;
  const k = (ah - g * (groups.length - 1)) / (tot - g * (groups.length - 1));
  const out: Rect[] = [];
  let y = m;
  groups.forEach((gp, gi) => {
    const h = hs[gi] * k; let x = m; const sum = gp.reduce((a, b) => a + b, 0);
    for (const a of gp) { const w = ((aw - g * (gp.length - 1)) * a) / sum; out.push([x / W, y / H, w / W, h / H]); x += w + g; }
    y += h + g;
  });
  return out;
}

export interface LayoutOptions { margin: number; gutter: number; seed: number; aspects?: number[] }

/** Résout les emplacements photo d'un modèle, en fractions de page, dans l'ordre d'indexation stable. */
export function resolveSlots(lib: Library, t: Template, formatId: string, o: LayoutOptions): ResolvedSlot[] {
  const { w: W, h: H } = pageSizeMm(lib, t, formatId);
  const out: ResolvedSlot[] = [];
  const push = (s: SlotDef, box: Rect, extra: Partial<ResolvedSlot> = {}) =>
    out.push({ ...s, ...extra, index: out.length, box, shape: s.shape ?? { type: "rect" } });
  if (t.background?.photo) push({}, [0, 0, 1, 1], { isBackground: true, z: -1 });
  if (t.layout === "grid") {
    const sd = t.slotDefaults ?? {};
    const items: SlotDef[] = t.slots === "auto"
      ? Array.from({ length: t.grid![0] * t.grid![1] }, (_, i) => ({ r: [i % t.grid![0], Math.floor(i / t.grid![0]), 1, 1] as Rect }))
      : (t.slots as SlotDef[]);
    for (const s of items) push({ ...sd, ...s }, gridRect(t, s.r!, W, H, o.margin, o.gutter, !!t.labels));
  } else if (t.layout === "free") {
    for (const s of t.slots as SlotDef[]) {
      if (s.b) push(s, s.b);
      else {
        const pts = shapePoints(s.shape!)!;
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        const x0 = Math.max(0, Math.min(...xs)), y0 = Math.max(0, Math.min(...ys));
        push(s, [x0, y0, Math.min(1, Math.max(...xs)) - x0, Math.min(1, Math.max(...ys)) - y0]);
      }
    }
  } else if (t.generator === "justified-rows") {
    const aspects = o.aspects?.length ? o.aspects.slice(0, 30) : [1.5, 0.67, 1.5, 1, 0.67, 1.5];
    for (const r of justifiedRows(aspects, W, H, o.margin, o.gutter)) push({}, r);
  } else if (t.generator === "heart-grid") {
    const cols = 11, rows = 11, top = 0.05, left = 0.05, cell = 0.9 / cols, ch = (cell * W) / H;
    const pad = 0.004, padY = (pad * W) / H;
    const add = (b: Rect, extra: Partial<SlotDef> = {}) => push(extra, [b[0] + pad, b[1] + padY, b[2] - 2 * pad, b[3] - 2 * padY]);
    add([left + 4 * cell, top + 3 * ch, 3 * cell, 3 * ch], { role: "hero" });
    for (let rr = 0; rr < rows; rr++) for (let cc = 0; cc < cols; cc++) {
      if (cc >= 4 && cc <= 6 && rr >= 3 && rr <= 5) continue;
      if (heartInside((cc + 0.5) / cols, ((rr + 0.5) / rows) * 0.95 + 0.03)) add([left + cc * cell, top + rr * ch, cell, ch]);
    }
  } else if (t.generator === "heart-scatter") {
    const rnd = mulberry(o.seed + 7);
    const pts: [number, number][] = [];
    for (let i = 0; i < 16; i++) {
      const a = (2 * Math.PI * i) / 16;
      const x = 16 * Math.sin(a) ** 3, y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
      pts.push([0.5 + x / 40, 0.43 - y / 40]);
    }
    pts.push([0.38, 0.36], [0.6, 0.36], [0.5, 0.52], [0.42, 0.62], [0.58, 0.6]);
    pts.forEach(([cx, cy], i) => {
      const sz = i < 16 ? 0.15 : 0.19, w = sz, h = sz * 1.1;
      push({ frame: "polaroid", rotate: rnd() * 24 - 12, z: 1 + Math.floor(rnd() * 5), role: i === 18 ? "hero" : null }, [cx - w / 2, cy - h / 2, w, h]);
    });
  }
  return out;
}

export function resolveTexts(lib: Library, t: Template, formatId: string, o: LayoutOptions): ResolvedText[] {
  const { w: W, h: H } = pageSizeMm(lib, t, formatId);
  return (t.text ?? []).map((x: TextDef, index) => ({
    ...x, index,
    box: x.b ?? gridRect(t, x.r!, W, H, o.margin, o.gutter, false),
  }));
}

export function defaultText(x: TextDef): string {
  return x.content ?? (x.kind === "title" ? "Titre" : x.kind === "caption" ? "Prénom · lieu · date" : "Texte");
}
