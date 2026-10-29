// Types du moteur PhotoBook — schéma de modèles v2 (voir templates.json "notes").

export type Rect = [number, number, number, number]; // x, y, w, h

export type Shape =
  | { type: "rect" }
  | { type: "rounded"; r: number }
  | { type: "ellipse" }
  | { type: "poly"; pts: [number, number][] }
  | { type: "sector"; c: [number, number]; r0: number; r1: number; a0: number; a1: number };

export interface SlotDef {
  r?: Rect; // grille
  b?: Rect; // libre (fractions de page)
  shape?: Shape;
  role?: "hero" | null;
  prefer?: "p" | "l" | "s";
  rotate?: number;
  frame?: "thin" | "polaroid";
  caption?: string;
  z?: number;
  split?: string;
  fade?: "bottom-dark" | "right-light";
}

export interface TextDef {
  r?: Rect;
  b?: Rect;
  kind?: "title" | "caption";
  content?: string;
  font?: FontKey;
  size?: number;
  color?: string;
  align?: "left" | "center" | "right";
  rotate?: number;
  stack?: boolean;
  tracking?: number;
  z?: number;
}

export interface DecoDef {
  type: "band" | "tape" | "pin" | "heart" | "poly";
  b?: Rect;
  pts?: [number, number][];
  color?: string;
  stroke?: string;
  outline?: boolean;
  rotate?: number;
  z?: number;
}

export type FontKey = "script" | "serif" | "serifBold" | "sans" | "sansBold" | "display";

export interface Template {
  id: string;
  name: string;
  category: string;
  orientation: "portrait" | "landscape" | "square" | "any";
  formats: string[];
  layout: "grid" | "free" | "generator";
  grid?: [number, number];
  defaults?: { margin?: number; gutter?: number; stroke?: number };
  slots?: SlotDef[] | "auto";
  slotDefaults?: Partial<SlotDef>;
  text?: TextDef[];
  deco?: DecoDef[];
  background?: { color?: string; photo?: boolean; fade?: "right-light" };
  generator?: "justified-rows" | "heart-grid" | "heart-scatter";
  photos: [number, number];
  labels?: boolean;
  fit?: "contain";
  sameImage?: boolean;
  repeat?: boolean;
}

export interface PageFormat {
  id: string;
  name: string;
  mm: [number, number];
  px?: [number, number];
  spread?: boolean;
}

export interface Library {
  schemaVersion: number;
  categories: { id: string; name: string }[];
  formats: PageFormat[];
  templates: Template[];
}

/** Emplacement résolu, en fractions de page. */
export interface ResolvedSlot extends SlotDef {
  index: number;
  box: Rect;
  shape: Shape;
  isBackground?: boolean;
}

export interface ResolvedText extends TextDef {
  index: number;
  box: Rect;
}

export interface SlotState {
  photoId?: string;
  fx: number; // point focal 0..1
  fy: number;
  zoom: number; // ≥ 1
}

export interface PageDoc {
  id: string;
  templateId: string;
  formatId: string;
  margin: number;
  gutter: number;
  background?: string;
  seed: number;
  slots: SlotState[]; // index = ResolvedSlot.index
  texts: Record<number, string>;
}

export interface PhotoMeta {
  id: string;
  name: string;
  width: number;
  height: number;
}
