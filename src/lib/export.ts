// Export haute résolution : PNG (avec DPI), PDF par page, PDF multipage, archive ZIP.
import { Zip, ZipPassThrough } from "fflate";
import type { Library, PageDoc } from "../engine/types";
import { renderPage } from "../engine/render";
import { pagePixels, pageSizeMm, resolveSlots, resolveTexts } from "../engine/layout";
import { exportProvider, type PhotoItem } from "./photos";
import { PdfWriter, canvasToRgb, canvasToJpeg } from "./pdf";
import { isTauri, desktopSave } from "./platform";

// --- CRC32 pour le bloc pHYs du PNG
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf: Uint8Array) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** Ajoute la résolution physique du PNG pour que l'imprimeur lise le bon DPI. */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const at = 33; // après la signature et le bloc IHDR
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, at)); out.set(chunk, at); out.set(png.subarray(at), at + chunk.length);
  return out;
}

/** Rend une page à la résolution finale, en décodant chaque photo depuis son fichier original. */
export async function renderPageCanvas(lib: Library, page: PageDoc, photos: Map<string, PhotoItem>, dpi: number, onProgress?: (d: number, t: number) => void) {
  const t = lib.templates.find((x) => x.id === page.templateId)!;
  const [PW, PH] = pagePixels(lib, t, page.formatId, dpi);
  const canvas = document.createElement("canvas");
  canvas.width = PW; canvas.height = PH;
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: false })!;
  if (!ctx || canvas.width !== PW) throw new Error("Canevas trop grand pour ce navigateur");
  const aspects = page.slots.map((s) => { const p = s.photoId ? photos.get(s.photoId) : undefined; return p ? p.width / p.height : 1.5; });
  const o = { margin: page.margin, gutter: page.gutter, seed: page.seed, aspects };
  const slots = resolveSlots(lib, t, page.formatId, o), texts = resolveTexts(lib, t, page.formatId, o);
  const { provider, release } = exportProvider(photos);
  try {
    const oneAtATime: typeof provider = async (...a) => { release(); return provider(...a); };
    await renderPage(ctx, PW, PH, { lib, t, page, slots, texts, photos }, oneAtATime, { onProgress });
  } finally { release(); }
  const mm = pageSizeMm(lib, t, page.formatId);
  return { canvas, mm, px: [PW, PH] as [number, number] };
}

async function canvasPng(canvas: HTMLCanvasElement, dpi: number) {
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Canevas trop grand pour ce navigateur"))), "image/png"));
  return setPngDpi(new Uint8Array(await blob.arrayBuffer()), dpi);
}

export interface ExportOptions {
  dpi: number;
  png: boolean;
  pdfEach: boolean;
  pdfAll: boolean;
  pdfQuality: "lossless" | "jpeg95";
  baseName: string;
}

export interface ExportResult { filename: string; blob: Blob; files: number }

/** Exporte une liste de pages. Un seul fichier → fichier direct ; plusieurs → archive ZIP. */
export async function exportPages(lib: Library, pages: { page: PageDoc; number: number }[], photos: Map<string, PhotoItem>, opt: ExportOptions,
  progress: (label: string, done: number, total: number) => void): Promise<ExportResult> {
  const nFiles = (opt.png ? pages.length : 0) + (opt.pdfEach ? pages.length : 0) + (opt.pdfAll ? 1 : 0);
  if (!nFiles) throw new Error("Choisissez au moins un format");
  const single = nFiles === 1;
  const zipParts: BlobPart[] = [];
  let zip: Zip | null = null;
  let zipErr: Error | null = null;
  let singleOut: ExportResult | null = null;
  if (!single) {
    zip = new Zip((err, chunk) => { if (err) zipErr = err; else zipParts.push(chunk as BlobPart); });
  }
  const addFile = (name: string, data: Uint8Array) => {
    if (!zip) return;
    const f = new ZipPassThrough(name); // fichiers déjà compressés : stockage sans recompression
    zip.add(f); f.push(data, true);
  };
  const multi = opt.pdfAll ? new PdfWriter(opt.baseName) : null;
  const pad = (n: number) => String(n).padStart(2, "0");

  for (let i = 0; i < pages.length; i++) {
    const { page, number } = pages[i];
    progress(`Page ${i + 1} / ${pages.length} : rendu`, i, pages.length);
    const { canvas, mm } = await renderPageCanvas(lib, page, photos, opt.dpi);
    const stem = `${opt.baseName}-page-${pad(number)}`;
    if (opt.png) {
      progress(`Page ${i + 1} / ${pages.length} : PNG`, i + 0.4, pages.length);
      const png = await canvasPng(canvas, opt.dpi);
      if (single) singleOut = { filename: `${stem}-${opt.dpi}dpi.png`, blob: new Blob([png as BlobPart], { type: "image/png" }), files: 1 };
      else addFile(`PNG/${stem}-${opt.dpi}dpi.png`, png);
    }
    if (opt.pdfEach || multi) {
      progress(`Page ${i + 1} / ${pages.length} : PDF`, i + 0.7, pages.length);
      const img = opt.pdfQuality === "lossless" ? canvasToRgb(canvas) : await canvasToJpeg(canvas, 0.95);
      if (opt.pdfEach) {
        const w = new PdfWriter(`${opt.baseName} – page ${number}`);
        w.addPage(mm.w, mm.h, img);
        const blob = w.finish();
        if (single) singleOut = { filename: `${stem}.pdf`, blob, files: 1 };
        else addFile(`PDF/${stem}.pdf`, new Uint8Array(await blob.arrayBuffer()));
      }
      multi?.addPage(mm.w, mm.h, img);
    }
    canvas.width = canvas.height = 1; // libère la mémoire
    await new Promise((r) => setTimeout(r, 0));
  }
  if (multi) {
    const blob = multi.finish();
    if (single) singleOut = { filename: `${opt.baseName}-${pages.length}-pages.pdf`, blob, files: 1 };
    else addFile(`${opt.baseName}-${pages.length}-pages.pdf`, new Uint8Array(await blob.arrayBuffer()));
  }
  progress("Finalisation", pages.length, pages.length);
  if (single) return singleOut!;
  zip!.end();
  if (zipErr) throw zipErr;
  return { filename: `${opt.baseName}.zip`, blob: new Blob(zipParts, { type: "application/zip" }), files: nFiles };
}

// --- enregistrement : capacité « downloads » dans Claude, sinon lien de téléchargement classique
type Downloads = { save: (r: { filename: string; data: Blob }) => Promise<{ status: string }> };
let dl: Promise<Downloads | null> | null = null;
function downloads(): Promise<Downloads | null> {
  const w = window as unknown as { claude?: { use: (n: string) => Promise<unknown> } };
  if (!dl) dl = w.claude?.use ? (w.claude.use("downloads") as Promise<Downloads | null>).catch(() => null) : Promise.resolve(null);
  return dl;
}

export async function saveFile(filename: string, data: Blob): Promise<"saved" | "declined"> {
  if (isTauri()) return (await desktopSave(filename, data)) ? "saved" : "declined";
  const d = await downloads();
  if (d) {
    try { await d.save({ filename, data }); return "saved"; }
    catch (e) { const code = (e as { code?: string }).code; if (code === "declined") return "declined"; if (code !== "unavailable") throw new Error((e as { message?: string }).message ?? String(code)); }
  }
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return "saved";
}

export function safeName(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9-_ ]/g, "").trim().replace(/\s+/g, "-") || "PhotoBook";
}
