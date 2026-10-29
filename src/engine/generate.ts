// Génération automatique : choix des modèles compatibles, affectation des photos, variantes, pagination.
import type { Library, Template, PageDoc, PhotoMeta, ResolvedSlot } from "./types";
import { resolveSlots, rng, pageSizeMm } from "./layout";

let counter = 0;
export const uid = (p = "p") => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`;

export function slotCount(lib: Library, t: Template, formatId: string, n = 6): number {
  if (t.generator === "justified-rows") return Math.min(Math.max(n, t.photos[0]), t.photos[1]);
  return resolveSlots(lib, t, formatId, { margin: t.defaults?.margin ?? 8, gutter: t.defaults?.gutter ?? 3, seed: 1 }).length;
}

export function compatible(lib: Library, formatId: string, category: string, orientation: "all" | "portrait" | "landscape" | "square"): Template[] {
  return lib.templates.filter((t) => {
    if (!t.formats.includes(formatId)) return false;
    if (category !== "all" && t.category !== category) return false;
    if (orientation !== "all") {
      const { w, h } = pageSizeMm(lib, t, formatId);
      const o = Math.abs(w - h) < 1 ? "square" : w > h ? "landscape" : "portrait";
      if (o !== orientation) return false;
    }
    return true;
  });
}

const aspectOf = (p: PhotoMeta) => p.width / p.height;

/** Remplit un modèle avec des photos : la photo principale dans le plus grand emplacement, puis par proportions. */
export function fillTemplate(lib: Library, t: Template, formatId: string, photos: PhotoMeta[], seed: number, base?: Partial<PageDoc>): PageDoc {
  const margin = base?.margin ?? t.defaults?.margin ?? 8;
  const gutter = base?.gutter ?? t.defaults?.gutter ?? 3;
  const rnd = rng(seed);
  let pool = photos.slice();
  if (t.generator === "justified-rows") pool = pool.slice(0, Math.min(t.photos[1], Math.max(t.photos[0], pool.length)));
  const slots = resolveSlots(lib, t, formatId, { margin, gutter, seed, aspects: pool.map(aspectOf) });
  const { w: PWmm, h: PHmm } = pageSizeMm(lib, t, formatId);
  const state = slots.map(() => ({ fx: 0.5, fy: 0.38, zoom: 1 } as PageDoc["slots"][number]));
  if (!photos.length) return mk();

  if (t.generator === "justified-rows") {
    slots.forEach((s, i) => (state[s.index].photoId = pool[i % pool.length].id));
    return mk();
  }
  if (t.sameImage) { slots.forEach((s) => (state[s.index].photoId = photos[0].id)); return mk(); }

  const order = slots.slice().sort((a, b) =>
    Number(!!b.isBackground) - Number(!!a.isBackground) || Number(b.role === "hero") - Number(a.role === "hero") || b.box[2] * b.box[3] - a.box[2] * a.box[3]);
  let avail = photos.slice();
  const groupPhoto = new Map<string, string>();
  for (const s of order) {
    if (s.split && groupPhoto.has(s.split)) { state[s.index].photoId = groupPhoto.get(s.split); continue; }
    if (!avail.length) avail = photos.slice();
    const sa = slotAspect(s, slots, PWmm, PHmm);
    // la photo mise en avant (1re de la liste) va dans l'emplacement principal
    let pick: PhotoMeta;
    if ((s.role === "hero" || s === order[0]) && avail[0] === photos[0] && seed % 3 === 0) pick = avail[0];
    else {
      const ranked = avail.slice().sort((a, b) => Math.abs(Math.log(aspectOf(a) / sa)) - Math.abs(Math.log(aspectOf(b) / sa)));
      pick = ranked.length > 1 && rnd() < 0.35 ? ranked[1] : ranked[0];
    }
    avail = avail.filter((p) => p !== pick);
    state[s.index].photoId = pick.id;
    if (s.split) groupPhoto.set(s.split, pick.id);
  }
  return mk();

  function mk(): PageDoc {
    return { id: uid("pg"), templateId: t.id, formatId, margin, gutter, seed, slots: state, texts: { ...(base?.texts ?? {}) }, background: base?.background };
  }
}

function slotAspect(s: ResolvedSlot, all: ResolvedSlot[], PW: number, PH: number) {
  let [, , w, h] = s.box;
  if (s.split) {
    const g = all.filter((q) => q.split === s.split);
    const x0 = Math.min(...g.map((q) => q.box[0])), x1 = Math.max(...g.map((q) => q.box[0] + q.box[2]));
    const y0 = Math.min(...g.map((q) => q.box[1])), y1 = Math.max(...g.map((q) => q.box[1] + q.box[3]));
    w = x1 - x0; h = y1 - y0;
  }
  return (w * PW) / (h * PH);
}

/** Propositions variées pour une seule page à partir de la sélection. */
export function proposals(lib: Library, photos: PhotoMeta[], formatId: string, category: string, orientation: "all" | "portrait" | "landscape" | "square", count: number, seedBase: number): PageDoc[] {
  const n = photos.length;
  const cands = compatible(lib, formatId, category, orientation)
    .map((t) => ({ t, k: slotCount(lib, t, formatId, n) }))
    .filter(({ t }) => t.photos[0] <= Math.max(n, 1) || t.repeat || t.sameImage);
  if (!cands.length) return [];
  const rnd = rng(seedBase * 7919 + 13);
  // priorité aux modèles dont le nombre d'emplacements est proche de la sélection
  cands.sort((a, b) => score(a) - score(b) + (rnd() - 0.5) * 0.8);
  function score({ t, k }: { t: Template; k: number }) {
    if (t.repeat) return k >= n ? 1.5 : 9;
    if (t.sameImage) return n === 1 ? 0 : 6;
    return k <= n ? (n - k) / Math.max(n, 1) * 3 : (k - n) * 0.8;
  }
  const out: PageDoc[] = [];
  let round = 0;
  while (out.length < count && round < 6) {
    for (const { t } of cands) {
      if (out.length >= count) break;
      const seed = seedBase * 1000 + round * 97 + out.length;
      out.push(fillTemplate(lib, t, formatId, photos, seed));
    }
    round++;
  }
  return out;
}

/** Compose tout le projet : répartit toutes les photos sur des pages successives. */
export function autoPaginate(lib: Library, photos: PhotoMeta[], formatId: string, category: string, orientation: "all" | "portrait" | "landscape" | "square", seedBase: number): PageDoc[] {
  const cands = compatible(lib, formatId, category, orientation).filter((t) => !t.repeat && !t.sameImage && !t.background?.photo);
  if (!cands.length) return [];
  const rnd = rng(seedBase + 101);
  const pages: PageDoc[] = [];
  let rest = photos.slice(), guard = 0;
  while (rest.length && guard++ < 200) {
    const sized = cands.map((t) => ({ t, k: slotCount(lib, t, formatId, rest.length) })).filter((c) => c.k <= rest.length && c.k >= 1);
    let choice: { t: Template; k: number };
    if (sized.length) {
      // favorise des pages de 4 à 9 photos, en variant d'une page à l'autre
      sized.sort((a, b) => Math.abs(a.k - 6) - Math.abs(b.k - 6) + (rnd() - 0.5) * 6);
      const last = pages[pages.length - 1]?.templateId;
      choice = sized.find((c) => c.t.id !== last) ?? sized[0];
    } else {
      const all = cands.map((t) => ({ t, k: slotCount(lib, t, formatId, rest.length) })).sort((a, b) => a.k - b.k);
      choice = all[0];
    }
    const take = rest.slice(0, Math.max(1, Math.min(choice.k, rest.length)));
    pages.push(fillTemplate(lib, choice.t, formatId, take, seedBase * 31 + pages.length));
    rest = rest.slice(take.length);
  }
  return pages;
}

// ---------------------------------------------------------------------------
// Projet complet : répartition des photos sur un nombre de pages imposé.

export type Presentation = "portrait" | "landscape" | "both";

export interface ProjectPlan {
  pages: PageDoc[];
  unused: PhotoMeta[]; // photos qui n'ont pas trouvé de place
  repeated: boolean; // des photos ont dû être répétées (moins de photos que d'emplacements)
  orientationFallback: boolean; // la présentation demandée n'existe pas pour ce format
}

function orientationOf(lib: Library, t: Template, formatId: string): "portrait" | "landscape" | "square" {
  const { w, h } = pageSizeMm(lib, t, formatId);
  return Math.abs(w - h) < 1 ? "square" : w > h ? "landscape" : "portrait";
}

/** Modèles utilisables pour une mise en page automatique (hors planches contact, pochettes et cœurs à nombre fixe). */
function autoCandidates(lib: Library, formatId: string, category: string, pres: Presentation) {
  const base = lib.templates.filter((t) => t.formats.includes(formatId) && (category === "all" || t.category === category)
    && !t.sameImage && !(t.repeat && category !== "proof") && t.generator !== "heart-scatter" && t.generator !== "heart-grid");
  const fit = (t: Template) => { const o = orientationOf(lib, t, formatId); return pres === "both" || o === pres || o === "square"; };
  const list = base.filter(fit);
  return { list: list.length ? list : base, fallback: !list.length && base.length > 0 };
}

export function planProject(lib: Library, photos: PhotoMeta[], pageCount: number, formatId: string, pres: Presentation,
  category: string, mode: "auto" | "manual", seedBase: number): ProjectPlan {
  const { list: cands, fallback } = autoCandidates(lib, formatId, category, pres);
  const P = Math.max(1, Math.round(pageCount));
  const rnd = rng(seedBase + 977);
  const pages: PageDoc[] = [];
  if (!cands.length) return { pages, unused: photos.slice(), repeated: false, orientationFallback: fallback };
  const counts = new Map(cands.map((t) => [t.id, t.generator === "justified-rows" ? -1 : slotCount(lib, t, formatId)]));
  const capOf = (t: Template, want: number) => (counts.get(t.id)! < 0 ? Math.min(Math.max(want, t.photos[0]), t.photos[1]) : counts.get(t.id)!);
  const used = new Map<string, number>();
  const pick = (want: number, i: number, mustFit: boolean, avail = Infinity): Template => {
    const prev = pages[i - 1] ? lib.templates.find((t) => t.id === pages[i - 1].templateId) : undefined;
    const prevO = prev ? orientationOf(lib, prev, formatId) : null;
    const scored = cands.map((t) => {
      const k = capOf(t, want);
      let s = Math.abs(k - want) * 3;
      if (mustFit && k < want) s += 100; // la dernière page doit tout accueillir
      if (k > avail) s += 60 + (k - avail) * 5; // éviter de répéter des photos quand il en reste assez
      if (t.generator === "justified-rows") s += 2.5; // mosaïque auto : bon joker, mais on préfère des modèles dessinés
      s += (used.get(t.id) ?? 0) * 2.2; // variété
      if (prev && prev.id === t.id) s += 6;
      if (pres === "both" && prevO && orientationOf(lib, t, formatId) === prevO) s += 7; // alterner portrait / paysage
      return { t, s: s + rnd() * 1.2 };
    }).sort((a, b) => a.s - b.s);
    return scored[0].t;
  };

  if (mode === "manual") {
    // pages vides, modèles variés de 3 à 6 emplacements
    for (let i = 0; i < P; i++) {
      const t = pick(3 + (i % 4), i, false);
      used.set(t.id, (used.get(t.id) ?? 0) + 1);
      pages.push(fillTemplate(lib, t, formatId, [], seedBase + i));
    }
    return { pages, unused: photos.slice(), repeated: false, orientationFallback: fallback };
  }

  let rest = photos.slice();
  let repeated = false;
  for (let i = 0; i < P; i++) {
    const remainingPages = P - i;
    const want = Math.max(1, Math.round(rest.length / remainingPages) || 1);
    const last = remainingPages === 1;
    // garder au moins une photo pour chaque page restante
    const avail = Math.max(1, rest.length - (remainingPages - 1));
    const t = pick(last ? Math.max(rest.length, 1) : Math.min(want, avail), i, last, avail);
    used.set(t.id, (used.get(t.id) ?? 0) + 1);
    const k = capOf(t, last ? rest.length : Math.min(want, avail));
    let take = rest.slice(0, Math.min(k, rest.length));
    rest = rest.slice(take.length);
    if (take.length < k) {
      // pas assez de photos pour ce modèle : on complète avec des photos déjà placées
      repeated = true;
      const pool = photos.filter((p) => !take.includes(p));
      const extra: PhotoMeta[] = [];
      for (let j = 0; extra.length < k - take.length && pool.length; j++) extra.push(pool[(i * 3 + j) % pool.length]);
      take = take.concat(extra);
    }
    pages.push(fillTemplate(lib, t, formatId, take, seedBase * 31 + i));
  }
  return { pages, unused: rest, repeated, orientationFallback: fallback };
}

/** Nombre d'utilisations de chaque photo dans le projet (une photo répartie sur un groupe compte une fois). */
export function photoUsage(lib: Library, pages: PageDoc[]): Map<string, { count: number; pages: number[] }> {
  const m = new Map<string, { count: number; pages: number[] }>();
  pages.forEach((pg, pi) => {
    const t = lib.templates.find((x) => x.id === pg.templateId);
    const ids = pg.slots.map((s) => s.photoId).filter((x): x is string => !!x);
    const list = t?.sameImage || t?.layout === "free" && (t.slots as { split?: string }[] | undefined)?.some((s) => s.split) ? Array.from(new Set(ids)) : ids;
    for (const id of list) {
      const u = m.get(id) ?? { count: 0, pages: [] };
      u.count++; if (!u.pages.includes(pi + 1)) u.pages.push(pi + 1);
      m.set(id, u);
    }
  });
  return m;
}
