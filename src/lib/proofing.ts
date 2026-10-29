// Validation client : envoi d'un album d'épreuves (basse résolution, filigrané) et lecture des retours.
// Le serveur (Supabase) n'expose que des fonctions protégées par des secrets ; voir supabase/migrations.
import type { Library, PageDoc } from "../engine/types";
import { renderPage } from "../engine/render";
import { pageSizeMm, resolveSlots, resolveTexts } from "../engine/layout";
import { previewProvider, type PhotoItem } from "./photos";

// ---------- configuration du service ----------
export interface ProofConfig { url: string; key: string; publicUrl: string }
const LS = "photobook.proofing";
export function getConfig(): ProofConfig {
  let saved: Partial<ProofConfig> = {};
  try { saved = JSON.parse(localStorage.getItem(LS) || "{}"); } catch { /* stockage indisponible */ }
  return {
    url: (saved.url || import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, ""),
    key: saved.key || import.meta.env.VITE_SUPABASE_ANON_KEY || "",
    publicUrl: (saved.publicUrl || import.meta.env.VITE_PUBLIC_APP_URL || "https://photobook-fredy.netlify.app/").replace(/#.*$/, ""),
  };
}
export function setConfig(c: Partial<ProofConfig>) {
  try { localStorage.setItem(LS, JSON.stringify({ ...JSON.parse(localStorage.getItem(LS) || "{}"), ...c })); } catch { /* ignoré */ }
}
export const isConfigured = () => { const c = getConfig(); return !!(c.url && c.key); };

const STUDIO = "photobook.studioKey";
export const getStudioKey = () => { try { return localStorage.getItem(STUDIO) || ""; } catch { return ""; } };
export const setStudioKey = (k: string) => { try { localStorage.setItem(STUDIO, k.trim()); } catch { /* ignoré */ } };

export class ProofError extends Error {}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const c = getConfig();
  if (!c.url || !c.key) throw new ProofError("Le service d'envoi aux clients n'est pas encore configuré.");
  let res: Response;
  try {
    res = await fetch(`${c.url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  } catch { throw new ProofError("Connexion impossible : vérifiez votre accès à Internet."); }
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = JSON.parse(text).message || msg; } catch { /* texte brut */ }
    throw new ProofError(msg || `Erreur ${res.status}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

// ---------- types ----------
export type AlbumStatus = "draft" | "sent" | "viewed" | "validated" | "changes";
export interface ProofComment { id: number; page_no: number; x: number | null; y: number | null; body: string; author: string; from_client: boolean; resolved?: boolean; created_at: string }
export interface ProofPageInfo { page_no: number; status: "ok" | "change" | null; width?: number; height?: number }
export interface SentAlbum { albumId: string; ownerKey: string; token: string; clientName: string; clientEmail: string; title: string; sentAt: number; pageCount: number; link: string; expiresAt?: string }
export interface Feedback {
  album: { id: string; title: string; client_name: string; client_email: string; status: AlbumStatus; page_count: number; expires_at: string; sent_at: string | null;
    first_viewed_at: string | null; last_viewed_at: string | null; view_count: number; decided_at: string | null; client_note: string };
  pages: ProofPageInfo[];
  comments: ProofComment[];
}
export interface ClientAlbum {
  album: { title: string; client_name: string; message: string; watermark: string; allow_comments: boolean; page_count: number; status: AlbumStatus; expires_at: string; client_note: string };
  pages: ProofPageInfo[];
  comments: ProofComment[];
}

export const STATUS_LABEL: Record<AlbumStatus, string> = {
  draft: "En préparation", sent: "Envoyé, pas encore ouvert", viewed: "Consulté par le client", validated: "Validé par le client", changes: "Modifications demandées",
};

// ---------- épreuves : rendu basse résolution avec filigrane ----------
const PROOF_PX = 1600;

function watermark(ctx: CanvasRenderingContext2D, W: number, H: number, text: string) {
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-Math.PI / 6);
  const size = Math.max(14, Math.round(Math.min(W, H) * 0.035));
  ctx.font = `600 ${size}px "Montserrat"`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const stepX = ctx.measureText(text).width + size * 3, stepY = size * 4.2;
  const R = Math.hypot(W, H);
  for (let y = -R, row = 0; y < R; y += stepY, row++) {
    for (let x = -R + (row % 2) * stepX / 2; x < R; x += stepX) {
      ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.fillText(text, x, y);
      ctx.fillStyle = "rgba(0,0,0,0.10)"; ctx.fillText(text, x + 1, y + 1);
    }
  }
  ctx.restore();
  // bandeau bas
  const bh = Math.round(H * 0.035);
  ctx.fillStyle = "rgba(57,64,75,0.72)"; ctx.fillRect(0, H - bh, W, bh);
  ctx.fillStyle = "#ECF4F7"; ctx.font = `600 ${Math.round(bh * 0.45)}px "Montserrat"`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(`ÉPREUVE · ${text}`, W / 2, H - bh / 2);
}

export async function renderProof(lib: Library, page: PageDoc, photos: Map<string, PhotoItem>, wm: string) {
  const t = lib.templates.find((x) => x.id === page.templateId)!;
  const { w, h } = pageSizeMm(lib, t, page.formatId);
  const k = PROOF_PX / Math.max(w, h);
  const W = Math.round(w * k), H = Math.round(h * k);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  const aspects = page.slots.map((s) => { const p = s.photoId ? photos.get(s.photoId) : undefined; return p ? p.width / p.height : 1.5; });
  const o = { margin: page.margin, gutter: page.gutter, seed: page.seed, aspects };
  await renderPage(ctx, W, H, { lib, t, page, slots: resolveSlots(lib, t, page.formatId, o), texts: resolveTexts(lib, t, page.formatId, o), photos }, previewProvider(photos), { placeholder: "#d5dee3" });
  watermark(ctx, W, H, wm || "ÉPREUVE");
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.8));
  const b64 = await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); });
  c.width = c.height = 1;
  return { width: W, height: H, image: b64 };
}

export interface SendOptions { title: string; clientName: string; clientEmail: string; message: string; watermark: string; allowComments: boolean; expiresDays: number }

export async function sendAlbum(lib: Library, pages: PageDoc[], photos: Map<string, PhotoItem>, o: SendOptions, progress: (d: number, t: number) => void): Promise<SentAlbum> {
  const studio = getStudioKey();
  if (!studio) throw new ProofError("Renseignez d'abord votre clé studio.");
  const r = await rpc<{ album_id: string; client_token: string; owner_key: string }>("photobook_create_album", {
    p_studio_key: studio, p_title: o.title, p_client_name: o.clientName, p_client_email: o.clientEmail, p_message: o.message,
    p_watermark: o.watermark, p_allow_comments: o.allowComments, p_expires_days: o.expiresDays, p_page_count: pages.length,
  });
  for (let i = 0; i < pages.length; i++) {
    progress(i, pages.length);
    const img = await renderProof(lib, pages[i], photos, o.watermark);
    await rpc("photobook_put_page", { p_album: r.album_id, p_owner: r.owner_key, p_page_no: i + 1, p_width: img.width, p_height: img.height, p_image: img.image });
  }
  const pub = await rpc<{ expires_at: string }>("photobook_publish", { p_album: r.album_id, p_owner: r.owner_key });
  progress(pages.length, pages.length);
  return { albumId: r.album_id, ownerKey: r.owner_key, token: r.client_token, clientName: o.clientName, clientEmail: o.clientEmail, title: o.title,
    sentAt: Date.now(), pageCount: pages.length, link: clientLink(r.client_token), expiresAt: pub.expires_at };
}

export const clientLink = (token: string) => `${getConfig().publicUrl}#album=${token}`;

export function mailtoLink(a: SentAlbum, studioName: string, message: string) {
  const subject = `${a.title} — votre album à valider`;
  const body = `Bonjour ${a.clientName},\n\n${message}\n\nVoici le lien privé pour consulter votre album, laisser vos remarques et le valider :\n${a.link}\n\nCe lien est personnel : merci de ne pas le partager.\n\n${studioName}`;
  return `mailto:${encodeURIComponent(a.clientEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
export function whatsappLink(a: SentAlbum, studioName: string) {
  return `https://wa.me/?text=${encodeURIComponent(`Bonjour ${a.clientName}, voici votre album « ${a.title} » à consulter et valider : ${a.link} — ${studioName}`)}`;
}

// ---------- suivi côté photographe ----------
export const getFeedback = (a: SentAlbum) => rpc<Feedback>("photobook_owner_feedback", { p_album: a.albumId, p_owner: a.ownerKey });
export const getOwnerPage = (a: SentAlbum, n: number) => rpc<{ width: number; height: number; image: string }>("photobook_owner_page", { p_album: a.albumId, p_owner: a.ownerKey, p_page_no: n });
export const resolveComment = (a: SentAlbum, id: number, v: boolean) => rpc("photobook_owner_resolve", { p_album: a.albumId, p_owner: a.ownerKey, p_comment: id, p_resolved: v });
export const replyComment = (a: SentAlbum, page: number, body: string) => rpc("photobook_owner_comment", { p_album: a.albumId, p_owner: a.ownerKey, p_page_no: page, p_body: body });
export const extendAlbum = (a: SentAlbum, days: number) => rpc("photobook_owner_extend", { p_album: a.albumId, p_owner: a.ownerKey, p_days: days });
export const deleteAlbum = (a: SentAlbum) => rpc("photobook_owner_delete", { p_album: a.albumId, p_owner: a.ownerKey });

// ---------- côté client ----------
export const clientOpen = (token: string) => rpc<ClientAlbum>("photobook_client_open", { p_token: token });
export const clientPage = (token: string, n: number) => rpc<{ width: number; height: number; image: string }>("photobook_client_page", { p_token: token, p_page_no: n });
export const clientComment = (token: string, n: number, x: number | null, y: number | null, body: string, author: string) =>
  rpc<ProofComment>("photobook_client_comment", { p_token: token, p_page_no: n, p_x: x, p_y: y, p_body: body, p_author: author });
export const clientUncomment = (token: string, id: number) => rpc("photobook_client_uncomment", { p_token: token, p_comment: id });
export const clientSetPage = (token: string, n: number, status: "ok" | "change" | null) => rpc("photobook_client_set_page", { p_token: token, p_page_no: n, p_status: status });
export const clientDecide = (token: string, decision: "validated" | "changes", note: string) => rpc("photobook_client_decide", { p_token: token, p_decision: decision, p_note: note });
