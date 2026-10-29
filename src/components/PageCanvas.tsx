import { useEffect, useMemo, useRef, useState } from "react";
import type { Library, PageDoc, ResolvedSlot } from "../engine/types";
import { pageSizeMm, resolveSlots, resolveTexts } from "../engine/layout";
import { renderPage } from "../engine/render";
import { previewProvider, type PhotoItem } from "../lib/photos";

interface Props {
  lib: Library;
  page: PageDoc;
  photos: Map<string, PhotoItem>;
  maxW: number;
  maxH: number;
  interactive?: boolean;
  selectedSlot?: number | null;
  onSelectSlot?: (i: number | null) => void;
  onPan?: (slotIndex: number, fx: number, fy: number) => void;
  onDropPhoto?: (slotIndex: number, photoId: string) => void;
  dupIds?: Set<string>;
  fontsReady: number;
}

export function usePageGeometry(lib: Library, page: PageDoc, photos: Map<string, PhotoItem>) {
  return useMemo(() => {
    const t = lib.templates.find((x) => x.id === page.templateId)!;
    const aspects = page.slots.map((s) => { const p = s.photoId ? photos.get(s.photoId) : undefined; return p ? p.width / p.height : 1.5; });
    const o = { margin: page.margin, gutter: page.gutter, seed: page.seed, aspects };
    return { t, slots: resolveSlots(lib, t, page.formatId, o), texts: resolveTexts(lib, t, page.formatId, o), size: pageSizeMm(lib, t, page.formatId) };
  }, [lib, page, photos]);
}

export function PageCanvas({ lib, page, photos, maxW, maxH, interactive, selectedSlot, onSelectSlot, onPan, onDropPhoto, dupIds, fontsReady }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { t, slots, texts, size } = usePageGeometry(lib, page, photos);
  const k = Math.min(maxW / size.w, maxH / size.h);
  const W = Math.max(40, Math.floor(size.w * k)), H = Math.max(40, Math.floor(size.h * k));
  const token = useRef(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const my = ++token.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const PW = Math.round(W * dpr), PH = Math.round(H * dpr);
    const off = document.createElement("canvas");
    off.width = PW; off.height = PH;
    const ctx = off.getContext("2d")!;
    renderPage(ctx, PW, PH, { lib, t, page, slots, texts, photos }, previewProvider(photos), { placeholder: "#d5dee3" }).then(() => {
      if (my !== token.current || !ref.current) return;
      const c = ref.current;
      c.width = PW; c.height = PH;
      c.getContext("2d")!.drawImage(off, 0, 0);
    });
  }, [lib, t, page, slots, texts, photos, W, H, fontsReady]);

  const drag = useRef<{ i: number; x: number; y: number; fx: number; fy: number; moved: boolean } | null>(null);

  const scaleFor = (s: ResolvedSlot) => {
    const st = page.slots[s.index]; const p = st?.photoId ? photos.get(st.photoId) : undefined;
    if (!p) return null;
    const w = s.box[2] * W, h = s.box[3] * H;
    const sc = Math.max(w / p.width, h / p.height) * (st.zoom || 1);
    return { iw: p.width * sc, ih: p.height * sc };
  };

  return (
    <div className="page-wrap" style={{ width: W, height: H }}>
      <canvas ref={ref} className="page-canvas" style={{ width: W, height: H }} />
      {interactive && slots.filter((s) => !s.isBackground).map((s) => {
        const pid = page.slots[s.index]?.photoId;
        const dup = !!pid && !!dupIds?.has(pid);
        return (
        <div
          key={s.index}
          className={`slot-hit ${selectedSlot === s.index ? "sel" : ""} ${hover === s.index ? "over" : ""} ${dup ? "dup" : ""}`}
          style={{ left: s.box[0] * W, top: s.box[1] * H, width: s.box[2] * W, height: s.box[3] * H, zIndex: (s.z ?? 1) + 2,
            transform: s.rotate && s.shape.type !== "poly" && s.shape.type !== "sector" ? `rotate(${s.rotate}deg)` : undefined }}
          onPointerDown={(e) => {
            onSelectSlot?.(s.index);
            const st = page.slots[s.index];
            drag.current = { i: s.index, x: e.clientX, y: e.clientY, fx: st?.fx ?? 0.5, fy: st?.fy ?? 0.38, moved: false };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current; if (!d || d.i !== s.index) return;
            const sc = scaleFor(s); if (!sc) return;
            const dx = e.clientX - d.x, dy = e.clientY - d.y;
            if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
            onPan?.(s.index, Math.min(1, Math.max(0, d.fx - dx / sc.iw)), Math.min(1, Math.max(0, d.fy - dy / sc.ih)));
          }}
          onPointerUp={() => (drag.current = null)}
          onDragOver={(e) => { e.preventDefault(); setHover(s.index); }}
          onDragLeave={() => setHover(null)}
          onDrop={(e) => { e.preventDefault(); setHover(null); const id = e.dataTransfer.getData("text/photo-id"); if (id) onDropPhoto?.(s.index, id); }}
        >{dup && <span className="dup-badge" title="Photo utilisée plusieurs fois dans le projet">⚠ doublon</span>}</div>
        );
      })}
    </div>
  );
}
