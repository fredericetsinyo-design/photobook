// Sauvegarde locale des projets (IndexedDB) : rien ne quitte l'appareil.
// Base « photobook » : projets (état + réglages) et photos (fichier original + dimensions).
import type { PageDoc } from "../engine/types";

export interface StoredProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: unknown;
  pages: PageDoc[];
  photoIds: string[];
  selected: string[];
  star: string | null;
  cover?: Blob; // miniature de la 1re page pour la liste
  albums?: import("./proofing").SentAlbum[]; // albums envoyés aux clients (avec leur clé album)
}
export interface StoredPhoto { id: string; projectId: string; name: string; width: number; height: number; blob: Blob }

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) dbp = new Promise((res, rej) => {
    if (!("indexedDB" in window)) { rej(new Error("Stockage local indisponible")); return; }
    const r = indexedDB.open("photobook", 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("projects")) d.createObjectStore("projects", { keyPath: "id" });
      if (!d.objectStoreNames.contains("photos")) d.createObjectStore("photos", { keyPath: "id" }).createIndex("projectId", "projectId");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error ?? new Error("Ouverture du stockage impossible"));
  });
  return dbp;
}
const done = (t: IDBTransaction) => new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error ?? new Error("Enregistrement annulé (espace insuffisant ?)")); });
const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function storageAvailable(): Promise<boolean> {
  try { await db(); return true; } catch { return false; }
}

export async function listProjects(): Promise<StoredProject[]> {
  const d = await db();
  const all = await req(d.transaction("projects").objectStore("projects").getAll() as IDBRequest<StoredProject[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveProject(p: StoredProject) {
  const d = await db();
  const t = d.transaction("projects", "readwrite");
  t.objectStore("projects").put(p);
  await done(t);
}

export async function savePhotos(projectId: string, photos: { id: string; name: string; width: number; height: number; file: Blob }[]) {
  if (!photos.length) return;
  const d = await db();
  const t = d.transaction("photos", "readwrite");
  const st = t.objectStore("photos");
  for (const p of photos) st.put({ id: p.id, projectId, name: p.name, width: p.width, height: p.height, blob: p.file } satisfies StoredPhoto);
  await done(t);
}

export async function loadPhotos(projectId: string): Promise<StoredPhoto[]> {
  const d = await db();
  return req(d.transaction("photos").objectStore("photos").index("projectId").getAll(projectId) as IDBRequest<StoredPhoto[]>);
}

export async function deleteProject(id: string) {
  const d = await db();
  const keys = await req(d.transaction("photos").objectStore("photos").index("projectId").getAllKeys(id));
  const t = d.transaction(["projects", "photos"], "readwrite");
  t.objectStore("projects").delete(id);
  for (const k of keys) t.objectStore("photos").delete(k);
  await done(t);
}

/** Demande au navigateur de ne pas effacer les données en cas de manque d'espace. */
export async function askPersistence() {
  try { await navigator.storage?.persist?.(); } catch { /* facultatif */ }
}
