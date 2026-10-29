// Côté photographe : envoi d'un album au client et suivi de ses retours (remarques, pages validées, décision).
import { useEffect, useRef, useState } from "react";
import type { Library, PageDoc } from "../engine/types";
import type { PhotoItem } from "../lib/photos";
import {
  sendAlbum, getFeedback, getOwnerPage, resolveComment, replyComment, extendAlbum, mailtoLink, whatsappLink,
  isConfigured, getStudioKey, setStudioKey, getConfig, setConfig, STATUS_LABEL, type SentAlbum, type Feedback,
} from "../lib/proofing";

const STUDIO_NAME = "Fredy Photography";

function useB64Canvas(b64: string | null, maxW: number, maxH: number) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: maxW, h: maxH });
  useEffect(() => {
    if (!b64 || !ref.current) return;
    const img = new Image();
    img.onload = () => {
      const k = Math.min(maxW / img.width, maxH / img.height);
      const w = Math.round(img.width * k), h = Math.round(img.height * k);
      setSize({ w, h });
      const c = ref.current!; c.width = w * 2; c.height = h * 2;
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    };
    img.src = `data:image/jpeg;base64,${b64}`;
  }, [b64, maxW, maxH]);
  return { ref, size };
}

function OwnerPage({ album, page, comments, maxW }: { album: SentAlbum; page: number; comments: (Feedback["comments"][number] & { n: number })[]; maxW: number }) {
  const [b64, setB64] = useState<string | null>(null);
  useEffect(() => { setB64(null); getOwnerPage(album, page).then((r) => setB64(r.image)).catch(() => null); }, [album, page]);
  const { ref, size } = useB64Canvas(b64, maxW, maxW * 1.2);
  return (
    <div className="proof-wrap" style={{ width: size.w, height: size.h }}>
      <canvas ref={ref} style={{ width: size.w, height: size.h, background: "#e9eef1" }} />
      {comments.filter((c) => c.x != null).map((c) => <span key={c.id} className={`pin ${c.from_client ? "mine" : "pro"} ${c.resolved ? "resolved" : ""}`} style={{ left: `${c.x! * 100}%`, top: `${c.y! * 100}%` }}>{c.n}</span>)}
    </div>
  );
}

export function ClientAlbums({ lib, pages, photos, projectName, albums, onAlbums, onClose, onGoToPage, mobile }: {
  lib: Library; pages: PageDoc[]; photos: Map<string, PhotoItem>; projectName: string; albums: SentAlbum[];
  onAlbums: (a: SentAlbum[]) => void; onClose: () => void; onGoToPage: (n: number) => void; mobile: boolean;
}) {
  const [view, setView] = useState<"list" | "send" | "sent" | "detail">(albums.length ? "list" : "send");
  const [cfgOpen, setCfgOpen] = useState(!isConfigured() || !getStudioKey());
  const [cfg, setCfg] = useState(() => ({ ...getConfig(), studio: getStudioKey() }));
  const [form, setForm] = useState({ clientName: "", clientEmail: "", title: projectName, message: "Votre album est prêt. Parcourez les pages, laissez vos remarques sur les photos à revoir, puis validez.", watermark: "FREDY PHOTOGRAPHY", allowComments: true, expiresDays: 30 });
  const [progress, setProgress] = useState<{ d: number; t: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<SentAlbum | null>(null);
  const [sel, setSel] = useState<SentAlbum | null>(null);
  const [fb, setFb] = useState<Feedback | null>(null);
  const [fbPage, setFbPage] = useState(1);
  const [reply, setReply] = useState("");
  const [copied, setCopied] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, Feedback | null>>({});

  const saveCfg = () => { setConfig({ url: cfg.url.trim(), key: cfg.key.trim(), publicUrl: cfg.publicUrl.trim() }); setStudioKey(cfg.studio); setCfgOpen(false); setErr(null); };

  useEffect(() => { // état de chaque album envoyé
    if (view !== "list" || !isConfigured()) return;
    albums.forEach((a) => getFeedback(a).then((f) => setStatuses((s) => ({ ...s, [a.albumId]: f }))).catch(() => setStatuses((s) => ({ ...s, [a.albumId]: null }))));
  }, [view, albums]);

  const doSend = async () => {
    setErr(null);
    if (!form.clientName.trim()) { setErr("Indiquez le nom du client."); return; }
    if (!/^\S+@\S+\.\S+$/.test(form.clientEmail.trim())) { setErr("Indiquez une adresse e-mail valide."); return; }
    try {
      setProgress({ d: 0, t: pages.length });
      const a = await sendAlbum(lib, pages, photos, { ...form, clientName: form.clientName.trim(), clientEmail: form.clientEmail.trim() }, (d, t) => setProgress({ d, t }));
      setProgress(null); setLast(a); onAlbums([a, ...albums]); setView("sent");
    } catch (e) { setProgress(null); setErr((e as Error).message); }
  };
  const openDetail = async (a: SentAlbum) => {
    setSel(a); setView("detail"); setFb(null); setFbPage(1); setErr(null);
    try { setFb(await getFeedback(a)); } catch (e) { setErr((e as Error).message); }
  };
  const refresh = async () => { if (sel) try { setFb(await getFeedback(sel)); } catch (e) { setErr((e as Error).message); } };
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setErr("Copie impossible : sélectionnez le lien et copiez-le."); } };

  const numbered = (fb?.comments ?? []).map((c, i) => ({ ...c, n: i + 1 }));

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet glass clients" onClick={(e) => e.stopPropagation()}>
        <div className="row between sheet-head">
          <div><h3>{view === "detail" ? `Retours de ${sel?.clientName}` : view === "send" ? "Envoyer l'album au client" : view === "sent" ? "Album prêt à envoyer" : "Albums clients"}</h3>
            <p className="muted small">{view === "detail" ? sel?.title : "Le client consulte l'album dans son navigateur, laisse ses remarques et valide."}</p></div>
          <div className="row gap">
            {view !== "list" && albums.length > 0 && <button className="btn ghost" onClick={() => setView("list")}>‹ Albums</button>}
            {view === "list" && <button className="btn primary" onClick={() => setView("send")}>Nouvel envoi</button>}
            <button className="btn ghost" onClick={onClose}>Fermer</button>
          </div>
        </div>
        <div className="wiz-body">
          {(cfgOpen || !isConfigured() || !getStudioKey()) && view !== "detail" && (
            <section>
              <h4>Connexion au service</h4>
              <p className="small muted">À faire une seule fois sur cet appareil. Ces informations vous ont été données à la mise en service.</p>
              <label className="field"><span>Clé studio</span><input type="text" value={cfg.studio} onChange={(e) => setCfg({ ...cfg, studio: e.target.value })} placeholder="clé secrète du studio" /></label>
              {!import.meta.env.VITE_SUPABASE_URL && <>
                <label className="field"><span>Adresse du service</span><input type="text" value={cfg.url} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} placeholder="https://xxxx.supabase.co" /></label>
                <label className="field"><span>Clé publique</span><input type="text" value={cfg.key} onChange={(e) => setCfg({ ...cfg, key: e.target.value })} placeholder="sb_publishable_…" /></label>
              </>}
              <button className="btn sm primary" onClick={saveCfg}>Enregistrer</button>
            </section>
          )}

          {view === "send" && (
            <section className="send-form">
              <div className="wiz-grid two">
                <label className="field"><span>Nom du client</span><input type="text" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} placeholder="Aïcha Mensah" /></label>
                <label className="field"><span>E-mail du client</span><input type="text" inputMode="email" value={form.clientEmail} onChange={(e) => setForm({ ...form, clientEmail: e.target.value })} placeholder="aicha@exemple.com" /></label>
              </div>
              <label className="field"><span>Titre de l'album</span><input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
              <label className="field"><span>Message au client</span><textarea rows={3} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
              <div className="wiz-grid two">
                <label className="field"><span>Filigrane</span><input type="text" value={form.watermark} onChange={(e) => setForm({ ...form, watermark: e.target.value })} /></label>
                <label className="field"><span>Lien valable</span>
                  <select value={form.expiresDays} onChange={(e) => setForm({ ...form, expiresDays: +e.target.value })}>
                    {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} jours</option>)}
                  </select></label>
              </div>
              <label className="check-row"><input type="checkbox" checked={form.allowComments} onChange={(e) => setForm({ ...form, allowComments: e.target.checked })} /><span><b>Autoriser les remarques</b><small>Le client peut épingler une remarque sur une photo ou sur une page.</small></span></label>
              <div className="info-box small">
                <b>Ce que reçoit le client :</b> les {pages.length} pages en épreuve (1600 px, filigrane « {form.watermark || "ÉPREUVE"} » et son nom). Vos photos originales restent sur votre appareil.
                Dans la visionneuse : pas de téléchargement, clic droit, copie ni impression, et l'album se masque si la fenêtre perd le focus.
                <br /><b>À savoir :</b> aucun site ne peut empêcher totalement une capture d'écran, surtout sur téléphone. Le filigrane et la basse résolution rendent une capture inutilisable pour un tirage.
              </div>
              {err && <p className="warn small">{err}</p>}
              {progress && <div className="row gap"><div className="bar grow"><i style={{ width: `${(progress.d / Math.max(1, progress.t)) * 100}%` }} /></div><span className="small">Envoi des pages {progress.d} / {progress.t}</span></div>}
            </section>
          )}

          {view === "sent" && last && (
            <section>
              <p>L'album <b>{last.title}</b> ({last.pageCount} pages) est en ligne pour <b>{last.clientName}</b>.</p>
              <div className="link-box"><code>{last.link}</code><button className="btn sm" onClick={() => copy(last.link)}>{copied ? "Copié ✓" : "Copier le lien"}</button></div>
              <div className="row gap wrap">
                <a className="btn primary" href={mailtoLink(last, STUDIO_NAME, form.message)}>✉ Ouvrir ma messagerie</a>
                <a className="btn" href={whatsappLink(last, STUDIO_NAME)} target="_blank" rel="noreferrer">WhatsApp</a>
              </div>
              <p className="hint">« Ouvrir ma messagerie » prépare l'e-mail pour {last.clientEmail} dans votre application de messagerie (Gmail, Outlook…) : relisez-le puis envoyez-le.</p>
            </section>
          )}

          {view === "list" && (
            <section>
              {albums.length === 0 ? <p className="muted small">Aucun album envoyé pour ce projet.</p> : (
                <div className="recent">
                  {albums.map((a) => {
                    const f = statuses[a.albumId];
                    const open = f?.comments.filter((c) => c.from_client && !c.resolved).length ?? 0;
                    return (
                      <div key={a.albumId} className="recent-item">
                        <div className="grow"><b>{a.clientName} · {a.title}</b>
                          <span className="small muted">Envoyé le {new Date(a.sentAt).toLocaleDateString("fr-FR")} · {f ? STATUS_LABEL[f.album.status] : f === null ? "état indisponible" : "…"}{open ? ` · ${open} remarque${open > 1 ? "s" : ""} à traiter` : ""}</span></div>
                        <span className={`badge st-${f?.album.status ?? "none"}`}>{f ? (f.album.status === "validated" ? "Validé" : f.album.status === "changes" ? "Modifs" : f.album.status === "viewed" ? "Vu" : "Envoyé") : ""}</span>
                        <button className="btn sm" onClick={() => openDetail(a)}>Voir les retours</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {view === "detail" && sel && (
            <section>
              {err && <p className="warn small">{err}</p>}
              {!fb ? <p className="muted small">Chargement des retours…</p> : (
                <>
                  <div className="fb-summary">
                    <span className={`badge st-${fb.album.status}`}>{STATUS_LABEL[fb.album.status]}</span>
                    <span className="small muted">{fb.album.view_count} consultation{fb.album.view_count > 1 ? "s" : ""}{fb.album.last_viewed_at ? ` · dernière le ${new Date(fb.album.last_viewed_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}` : ""} · lien valable jusqu'au {new Date(fb.album.expires_at).toLocaleDateString("fr-FR")}</span>
                    <button className="link" onClick={refresh}>Actualiser</button>
                    <button className="link" onClick={() => copy(sel.link)}>{copied ? "Lien copié ✓" : "Copier le lien"}</button>
                    <button className="link" onClick={async () => { await extendAlbum(sel, 30).catch(() => null); refresh(); }}>Prolonger de 30 jours</button>
                  </div>
                  {fb.album.client_note && <div className="info-box">Message du client : « {fb.album.client_note} »</div>}
                  <div className={`fb-grid ${mobile ? "stack" : ""}`}>
                    <div>
                      <div className="fb-pages">
                        {fb.pages.map((p) => {
                          const k = fb.comments.filter((c) => c.page_no === p.page_no && c.from_client && !c.resolved).length;
                          return <button key={p.page_no} className={`chip-btn ${fbPage === p.page_no ? "on" : ""}`} onClick={() => setFbPage(p.page_no)}>
                            {p.page_no}{p.status === "ok" ? " ✓" : p.status === "change" ? " ✎" : ""}{k ? ` · ${k}💬` : ""}</button>;
                        })}
                      </div>
                      <OwnerPage album={sel} page={fbPage} comments={numbered.filter((c) => c.page_no === fbPage)} maxW={mobile ? 300 : 380} />
                      <button className="btn sm" style={{ marginTop: 8 }} onClick={() => onGoToPage(fbPage)} disabled={fbPage > pages.length}>Ouvrir la page {fbPage} du projet</button>
                    </div>
                    <div>
                      <h4>Remarques · page {fbPage}</h4>
                      {numbered.filter((c) => c.page_no === fbPage).length === 0 && <p className="small muted">Aucune remarque sur cette page.</p>}
                      <ul className="cv-comments">
                        {numbered.filter((c) => c.page_no === fbPage).map((c) => (
                          <li key={c.id} className={`${c.resolved ? "done" : ""} ${c.from_client ? "" : "pro"}`}>
                            <span className={`pin static ${c.from_client ? "mine" : "pro"}`}>{c.x != null ? c.n : "•"}</span>
                            <div className="grow"><div>{c.body}</div><span className="small muted">{c.from_client ? c.author || "Client" : "Vous"} · {new Date(c.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span></div>
                            {c.from_client && <label className="small resolve"><input type="checkbox" checked={!!c.resolved} onChange={async (e) => { await resolveComment(sel, c.id, e.target.checked).catch(() => null); refresh(); }} /> Traité</label>}
                          </li>
                        ))}
                      </ul>
                      <div className="cv-draft"><textarea rows={2} placeholder="Répondre au client sur cette page…" value={reply} onChange={(e) => setReply(e.target.value)} />
                        <button className="btn sm" disabled={!reply.trim()} onClick={async () => { await replyComment(sel, fbPage, reply).catch((e) => setErr((e as Error).message)); setReply(""); refresh(); }}>Envoyer la réponse</button></div>
                    </div>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
        {view === "send" && (
          <div className="wiz-foot">
            {!cfgOpen && isConfigured() && <button className="link" onClick={() => setCfgOpen(true)}>Connexion au service</button>}
            <span className="grow" />
            <button className="btn primary big" disabled={!!progress || !pages.length} onClick={doSend}>{progress ? "Envoi en cours…" : `Envoyer ${pages.length} pages au client`}</button>
          </div>
        )}
      </div>
    </div>
  );
}
