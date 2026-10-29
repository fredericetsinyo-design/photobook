// Écrivain PDF minimal : une image pleine page par page, aux dimensions exactes du format choisi.
// Les pages sont écrites au fur et à mesure (morceaux de Blob) pour ne pas tout garder en mémoire.
import { zlibSync } from "fflate";

const enc = new TextEncoder();

export type PdfImage =
  | { kind: "jpeg"; data: Uint8Array; width: number; height: number } // DCTDecode
  | { kind: "rgb"; data: Uint8Array; width: number; height: number }; // FlateDecode, sans perte

export class PdfWriter {
  private parts: BlobPart[] = [];
  private offset = 0;
  private offsets: number[] = [];
  private pageRefs: number[] = [];
  private next = 3; // 1 = catalogue, 2 = arbre des pages

  private title: string;
  constructor(title = "PhotoBook") {
    this.title = title;
    this.raw("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  }

  private raw(s: string | Uint8Array) {
    const b = typeof s === "string" ? enc.encode(s) : s;
    this.parts.push(b as BlobPart); this.offset += b.length;
  }
  private obj(n: number, body: string, stream?: Uint8Array) {
    this.offsets[n] = this.offset;
    if (stream) { this.raw(`${n} 0 obj\n${body}\nstream\n`); this.raw(stream); this.raw("\nendstream\nendobj\n"); }
    else this.raw(`${n} 0 obj\n${body}\nendobj\n`);
  }

  /** Ajoute une page de wMm × hMm millimètres remplie par l'image. */
  addPage(wMm: number, hMm: number, img: PdfImage) {
    const W = (wMm / 25.4) * 72, H = (hMm / 25.4) * 72;
    const imgN = this.next++, contentN = this.next++, pageN = this.next++;
    const filter = img.kind === "jpeg" ? "/DCTDecode" : "/FlateDecode";
    const data = img.kind === "jpeg" ? img.data : zlibSync(img.data, { level: 6 });
    this.obj(imgN, `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${filter} /Length ${data.length} >>`, data);
    const content = enc.encode(`q ${W.toFixed(3)} 0 0 ${H.toFixed(3)} 0 0 cm /Im0 Do Q`);
    this.obj(contentN, `<< /Length ${content.length} >>`, content);
    const box = `[0 0 ${W.toFixed(3)} ${H.toFixed(3)}]`;
    this.obj(pageN, `<< /Type /Page /Parent 2 0 R /MediaBox ${box} /TrimBox ${box} /Resources << /XObject << /Im0 ${imgN} 0 R >> >> /Contents ${contentN} 0 R >>`);
    this.pageRefs.push(pageN);
  }

  get pageCount() { return this.pageRefs.length; }

  finish(): Blob {
    this.obj(2, `<< /Type /Pages /Kids [${this.pageRefs.map((n) => `${n} 0 R`).join(" ")}] /Count ${this.pageRefs.length} >>`);
    this.obj(1, `<< /Type /Catalog /Pages 2 0 R >>`);
    const infoN = this.next++;
    const esc = this.title.replace(/[\\()]/g, (c) => "\\" + c).replace(/[^\x20-\x7e]/g, "");
    this.obj(infoN, `<< /Title (${esc}) /Producer (PhotoBook - Fredy Photography) >>`);
    const xref = this.offset;
    const count = this.next;
    let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let i = 1; i < count; i++) x += `${String(this.offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`;
    this.raw(x + `trailer\n<< /Size ${count} /Root 1 0 R /Info ${infoN} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const blob = new Blob(this.parts, { type: "application/pdf" });
    this.parts = [];
    return blob;
  }
}

/** Extrait les pixels RVB d'un canevas (sans canal alpha) pour une image sans perte. */
export function canvasToRgb(canvas: HTMLCanvasElement): PdfImage {
  const ctx = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
  const rgb = new Uint8Array(w * h * 3);
  const band = 256; // par bandes pour limiter la mémoire temporaire
  for (let y = 0; y < h; y += band) {
    const bh = Math.min(band, h - y);
    const d = ctx.getImageData(0, y, w, bh).data;
    let o = y * w * 3;
    for (let i = 0; i < d.length; i += 4) { rgb[o++] = d[i]; rgb[o++] = d[i + 1]; rgb[o++] = d[i + 2]; }
  }
  return { kind: "rgb", data: rgb, width: w, height: h };
}

export async function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.95): Promise<PdfImage> {
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Encodage JPEG impossible"))), "image/jpeg", quality));
  return { kind: "jpeg", data: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
}
