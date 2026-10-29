// Import des photos : on garde le fichier original intact, une vignette 1600 px pour l'aperçu
// et une miniature 320 px pour l'interface. Le pleine résolution n'est décodé qu'à l'export.
import type { PhotoMeta } from "../engine/types";
import type { ImgSrc, Provider } from "../engine/render";
import { uid } from "../engine/generate";

export interface PhotoItem extends PhotoMeta {
  file: File;
  preview: ImageBitmap; // ≤ 1600 px, pour l'aperçu
  thumbUrl: string; // ≤ 320 px, pour les listes
}

const ACCEPT = /^image\/(jpeg|png|webp)$/i;

async function loadImg(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  try { await img.decode(); } finally { URL.revokeObjectURL(url); }
  return img;
}

export async function importFiles(files: File[], onProgress?: (done: number, total: number) => void, ids?: string[]): Promise<PhotoItem[]> {
  const list = ids ? files : files.filter((f) => ACCEPT.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name));
  const out: PhotoItem[] = [];
  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    try {
      const img = await loadImg(file);
      const w = img.naturalWidth, h = img.naturalHeight;
      const k = Math.min(1, 1600 / Math.max(w, h));
      const preview = await createImageBitmap(img, { resizeWidth: Math.round(w * k), resizeHeight: Math.round(h * k), resizeQuality: "high" });
      const k2 = Math.min(1, 320 / Math.max(w, h));
      const c = document.createElement("canvas");
      c.width = Math.round(w * k2); c.height = Math.round(h * k2);
      c.getContext("2d")!.drawImage(preview, 0, 0, c.width, c.height);
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.85));
      img.src = "";
      out.push({ id: ids?.[i] ?? uid("ph"), name: file.name, width: w, height: h, file, preview, thumbUrl: URL.createObjectURL(blob) });
    } catch (e) {
      console.warn("Import impossible :", file.name, e);
    }
    onProgress?.(i + 1, list.length);
  }
  return out;
}

/** Source d'aperçu : vignettes déjà en mémoire. */
export function previewProvider(map: Map<string, PhotoItem>): Provider {
  return async (id) => map.get(id)?.preview ?? null;
}

/** Source d'export : décode chaque photo à la taille exacte requise, depuis le fichier original. */
export function exportProvider(map: Map<string, PhotoItem>): { provider: Provider; release: () => void } {
  const open: ImageBitmap[] = [];
  const provider: Provider = async (id, needW, needH) => {
    const p = map.get(id);
    if (!p) return null;
    const w = Math.min(p.width, Math.max(needW, 1)), h = Math.min(p.height, Math.max(needH, 1));
    const full = w >= p.width * 0.98;
    // décodage direct depuis le fichier (pas de recompression), redimensionnement en haute qualité si besoin
    const bmp = full
      ? await createImageBitmap(p.file)
      : await createImageBitmap(p.file, { resizeWidth: Math.round(w), resizeHeight: Math.round((w * p.height) / p.width) || Math.round(h), resizeQuality: "high" });
    open.push(bmp);
    return bmp as ImgSrc;
  };
  return { provider, release: () => { open.forEach((b) => b.close()); open.length = 0; } };
}
