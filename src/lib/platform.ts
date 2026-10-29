// Détection de l'environnement et services de plateforme : PWA (service worker, installation), Tauri (bureau).
import { useEffect, useState } from "react";

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const inFrame = () => { try { return window.self !== window.top; } catch { return true; } };

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as InstallEvent; listeners.forEach((f) => f()); });
  window.addEventListener("appinstalled", () => { deferred = null; listeners.forEach((f) => f()); });
}

/** Bouton « Installer » : disponible quand le navigateur le propose (Chrome, Edge, Android). */
export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((x) => x + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  return { canInstall: !!deferred, install: async () => { if (!deferred) return; await deferred.prompt(); await deferred.userChoice; deferred = null; force((x) => x + 1); } };
}

export function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false);
    window.addEventListener("online", a); window.addEventListener("offline", b);
    return () => { window.removeEventListener("online", a); window.removeEventListener("offline", b); };
  }, []);
  return on;
}

/** Enregistre le service worker (hors cadre intégré et hors application de bureau). */
export function useServiceWorker() {
  const [state, setState] = useState<{ offlineReady: boolean; update: null | (() => void) }>({ offlineReady: false, update: null });
  useEffect(() => {
    if (isTauri() || inFrame() || !("serviceWorker" in navigator) || import.meta.env.DEV) return;
    import("virtual:pwa-register").then(({ registerSW }) => {
      const updateSW = registerSW({
        immediate: true,
        onOfflineReady: () => setState((s) => ({ ...s, offlineReady: true })),
        onNeedRefresh: () => setState((s) => ({ ...s, update: () => updateSW(true) })),
      });
    }).catch(() => { /* service worker indisponible : l'application fonctionne en ligne */ });
  }, []);
  return state;
}

// ---------------------------------------------------------------------------
// Version bureau (Tauri) : boîtes de dialogue natives et accès direct au disque.

const IMG = /\.(jpe?g|png|webp)$/i;
const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Enregistre un fichier à l'endroit choisi par l'utilisateur. Renvoie le chemin, ou null si annulé. */
export async function desktopSave(filename: string, data: Blob): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  const ext = filename.split(".").pop()!.toLowerCase();
  const label = { pdf: "Document PDF", png: "Image PNG", zip: "Archive ZIP" }[ext] ?? ext.toUpperCase();
  const path = await save({ defaultPath: filename, filters: [{ name: label, extensions: [ext] }] });
  if (!path) return null;
  await writeFile(path, new Uint8Array(await data.arrayBuffer()));
  return path;
}

/** Choisit un dossier et renvoie toutes ses photos (sous-dossiers compris), triées par nom. */
export async function desktopPickFolder(onFound?: (n: number) => void): Promise<File[]> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const { readDir, readFile } = await import("@tauri-apps/plugin-fs");
  const dir = await open({ directory: true, recursive: true, title: "Choisir un dossier de photos" });
  if (!dir || Array.isArray(dir)) return [];
  const paths: string[] = [];
  const sep = dir.includes("\\") ? "\\" : "/";
  const walk = async (d: string, depth: number) => {
    for (const e of await readDir(d)) {
      const p = `${d}${sep}${e.name}`;
      if (e.isDirectory && depth < 4) await walk(p, depth + 1);
      else if (e.isFile && IMG.test(e.name)) { paths.push(p); onFound?.(paths.length); }
    }
  };
  await walk(dir, 0);
  paths.sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  const files: File[] = [];
  for (const p of paths) {
    const name = p.split(sep).pop()!;
    const bytes = await readFile(p);
    files.push(new File([bytes as BlobPart], name, { type: MIME[name.split(".").pop()!.toLowerCase()] ?? "image/jpeg" }));
  }
  return files;
}
