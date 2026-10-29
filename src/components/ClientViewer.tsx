// Visionneuse client : affiche uniquement l'album envoyé, sans téléchargement.
// Protections : images dessinées sur canevas (aucune URL d'image à enregistrer), filigrane au nom du client,
// clic droit / glisser / sélection / impression bloqués, contenu masqué quand la fenêtre perd le focus ou
// lors d'une capture d'écran détectable. Une capture reste possible sur téléphone : le filigrane et la basse
// résolution la rendent inutilisable pour un tirage.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clientOpen, clientPage, clientComment, clientUncomment, clientSetPage, clientDecide, type ClientAlbum, type ProofComment, ProofError } from "../lib/proofing";

type Bmp = ImageBitmap;
async function decode(b64: string): Promise<Bmp> {
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return createImageBitmap(new Blob([u], { type: "image/jpeg" }));
}

function useProtection(setHidden: (v: boolean) => void) {
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    const key = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && ["s", "p", "c", "u", "a"].includes(k)) { e.preventDefault(); }
      if (e.key === "PrintScreen" || (e.metaKey && e.shiftKey && ["3", "4", "5", "s"].includes(k))) {
        setHidden(true); navigator.clipboard?.writeText("").catch(() => null); setTimeout(() => setHidden(false), 2500);
      }
    };
    const blur = () => setHidden(true), focus = () => setHidden(false);
    const vis = () => setHidden(document.visibilityState !== "visible");
    document.addEventListener("contextmenu", stop); document.addEventListener("dragstart", stop); document.addEventListener("selectstart", stop);
    document.addEventListener("copy", stop); window.addEventListener("keydown", key); window.addEventListener("keyup", key);
    window.addEventListener("blur", blur); window.addEventListener("focus", focus); document.addEventListener("visibilitychange", vis);
    return () => {
      document.removeEventListener("contextmenu", stop); document.removeEventListener("dragstart", stop); document.removeEventListener("selectstart", stop);
      document.removeEventListener("copy", stop); window.removeEventListener("keydown", key); window.removeEventListener("keyup", key);
      window.removeEventListener("blur", blur); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", vis);
    };
  }, [setHidden]);
}

function ProofCanvas({ bmp, maxW, maxH, stamp, onTap, pins, className }: {
  bmp: Bmp | null; maxW: number; maxH: number; stamp: string; onTap?: (x: number, y: number) => void;
  pins?: { n: number; x: number; y: number; mine: boolean }[]; className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ar = bmp ? bmp.width / bmp.height : 0.707;
  const W = Math.floor(Math.min(maxW, maxH * ar)), H = Math.floor(W / ar);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#e9eef1"; ctx.fillRect(0, 0, c.width, c.height);
    if (!bmp) return;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    // second filigrane, au nom du client, ajouté à l'affichage
    ctx.save(); ctx.globalAlpha = 0.13; ctx.fillStyle = "#000";
    const fs = Math.max(10, Math.round(c.width * 0.022)); ctx.font = `600 ${fs}px "Montserrat"`;
    ctx.translate(c.width / 2, c.height / 2); ctx.rotate(Math.PI / 7);
    for (let y = -c.height; y < c.height; y += fs * 6) for (let x = -c.width; x < c.width; x += fs * stamp.length * 0.9 + fs * 4) ctx.fillText(stamp, x, y);
    ctx.restore();
  }, [bmp, W, H, stamp]);
  return (
    <div className={`proof-wrap ${className ?? ""}`} style={{ width: W, height: H }}
      onClick={(e) => { if (!onTap) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onTap((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); }}>
      <canvas ref={ref} style={{ width: W, height: H }} />
      <div className="proof-shield" />
      {pins?.map((p) => <span key={p.n} className={`pin ${p.mine ? "mine" : "pro"}`} style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}>{p.n}</span>)}
    </div>
  );
}

export function ClientViewer({ token }: { token: string }) {
  const [data, setData] = useState<ClientAlbum | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bmps, setBmps] = useState<Record<number, Bmp>>({});
  const [cur, setCur] = useState(1);
  const [hidden, setHidden] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [draft, setDraft] = useState<{ x: number | null; y: number | null; text: string } | null>(null);
  const [decide, setDecide] = useState<null | "validated" | "changes">(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => { const f = () => setVp({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  const hide = useCallback((v: boolean) => setHidden(v), []);
  useProtection(hide);
  const say = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3200); };

  useEffect(() => {
    document.title = "Votre album — Fredy Photography";
    clientOpen(token).then(async (d) => {
      setData(d);
      for (const p of d.pages) { // chargement progressif, la page en cours d'abord
        try { const r = await clientPage(token, p.page_no); const b = await decode(r.image); setBmps((m) => ({ ...m, [p.page_no]: b })); } catch { /* page suivante */ }
      }
    }).catch((e) => setError(e instanceof ProofError ? e.message : "Album indisponible."));
  }, [token]);

  const locked = data ? data.album.status === "validated" || data.album.status === "changes" : true;
  const stamp = useMemo(() => `${data?.album.client_name || "Client"} · ${new Date().toLocaleDateString("fr-FR")} · Fredy Photography`, [data]);
  if (error) return <div className="cv cv-center"><div className="glass cv-card"><div className="empty-mark">PB</div><h2>Album indisponible</h2><p className="muted">{error}</p></div></div>;
  if (!data) return <div className="cv cv-center"><div className="glass cv-card"><div className="empty-mark">PB</div><p>Ouverture de votre album…</p></div></div>;

  const n = data.album.page_count;
  const pageInfo = data.pages.find((p) => p.page_no === cur);
  const pageComments = data.comments.filter((c) => c.page_no === cur);
  const numbered = data.comments.map((c, i) => ({ ...c, n: i + 1 }));
  const pins = numbered.filter((c) => c.page_no === cur && c.x != null && c.y != null).map((c) => ({ n: c.n, x: c.x!, y: c.y!, mine: c.from_client }));
  const okCount = data.pages.filter((p) => p.status === "ok").length, chCount = data.pages.filter((p) => p.status === "change").length;
  const wide = vp.w >= 980;
  const stageW = wide ? vp.w - 380 - 64 : vp.w - 24, stageH = wide ? vp.h - 190 : vp.h * 0.6;

  const setStatus = async (s: "ok" | "change") => {
    const next = pageInfo?.status === s ? null : s;
    try { await clientSetPage(token, cur, next); setData((d) => d && { ...d, pages: d.pages.map((p) => (p.page_no === cur ? { ...p, status: next } : p)) }); }
    catch (e) { say((e as Error).message); }
  };
  const saveComment = async () => {
    if (!draft?.text.trim()) return;
    setBusy(true);
    try {
      const c = await clientComment(token, cur, draft.x, draft.y, draft.text, data.album.client_name);
      setData((d) => d && { ...d, comments: [...d.comments, c] }); setDraft(null); setPinMode(false); say("Remarque enregistrée");
    } catch (e) { say((e as Error).message); } finally { setBusy(false); }
  };
  const removeComment = async (c: ProofComment) => {
    try { await clientUncomment(token, c.id); setData((d) => d && { ...d, comments: d.comments.filter((x) => x.id !== c.id) }); } catch (e) { say((e as Error).message); }
  };
  const sendDecision = async () => {
    if (!decide) return; setBusy(true);
    try { await clientDecide(token, decide, note); setData((d) => d && { ...d, album: { ...d.album, status: decide, client_note: note } }); setDecide(null); }
    catch (e) { say((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className={`cv ${hidden ? "cv-hidden" : ""} ${wide ? "wide" : ""}`}>
      <header className="glass cv-head">
        <div className="brand"><span className="logo">Fredy Photography</span><span className="by">Album privé · {data.album.client_name}</span></div>
        <div className="cv-title"><b>{data.album.title}</b><span className="muted small">Page {cur} / {n} · {okCount} validée{okCount > 1 ? "s" : ""}{chCount ? ` · ${chCount} à modifier` : ""}</span></div>
      </header>

      {data.album.message && cur === 1 && !locked && <div className="glass cv-msg">{data.album.message}</div>}
      {locked && (
        <div className={`glass cv-msg ${data.album.status === "validated" ? "ok" : "warn"}`}>
          {data.album.status === "validated" ? "✓ Vous avez validé cet album. Merci ! Votre photographe a reçu votre réponse." : "✎ Votre demande de modifications a été transmise à votre photographe. Merci !"}
          {data.album.client_note && <div className="small muted">Votre message : « {data.album.client_note} »</div>}
        </div>
      )}

      <div className="cv-main">
        <div className="cv-stage">
          <ProofCanvas bmp={bmps[cur] ?? null} maxW={stageW} maxH={stageH} stamp={stamp} pins={pins} className={pinMode ? "picking" : ""}
            onTap={pinMode ? (x, y) => setDraft({ x, y, text: "" }) : undefined} />
          {!bmps[cur] && <div className="cv-loading">Chargement de la page…</div>}
          {hidden && <div className="cv-veil">Album masqué<br /><span className="small">Revenez sur cette fenêtre pour continuer.</span></div>}
          <div className="cv-nav">
            <button className="btn" disabled={cur <= 1} onClick={() => { setCur(cur - 1); setPinMode(false); setDraft(null); }}>‹ Précédente</button>
            <span>{cur} / {n}</span>
            <button className="btn" disabled={cur >= n} onClick={() => { setCur(cur + 1); setPinMode(false); setDraft(null); }}>Suivante ›</button>
          </div>
        </div>

        <aside className="glass cv-side">
          {!locked && (
            <section>
              <h4>Cette page</h4>
              <div className="seg two">
                <button className={pageInfo?.status === "ok" ? "on ok" : ""} onClick={() => setStatus("ok")}>✓ Elle me plaît</button>
                <button className={pageInfo?.status === "change" ? "on" : ""} onClick={() => setStatus("change")}>✎ À modifier</button>
              </div>
              {data.album.allow_comments && (
                <div className="row gap wrap cv-actions">
                  <button className={`btn sm ${pinMode ? "primary" : ""}`} onClick={() => { setPinMode(!pinMode); setDraft(null); }}>{pinMode ? "Touchez la photo concernée…" : "📍 Remarque sur une photo"}</button>
                  <button className="btn sm" onClick={() => { setPinMode(false); setDraft({ x: null, y: null, text: "" }); }}>Remarque sur la page</button>
                </div>
              )}
              {draft && (
                <div className="cv-draft">
                  <textarea autoFocus rows={3} placeholder={draft.x != null ? "Votre remarque sur cette photo (recadrage, retouche, remplacement…)" : "Votre remarque sur la page"} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
                  <div className="row gap"><button className="btn sm primary" disabled={busy || !draft.text.trim()} onClick={saveComment}>Enregistrer</button><button className="btn sm ghost" onClick={() => setDraft(null)}>Annuler</button></div>
                </div>
              )}
            </section>
          )}
          <section>
            <h4>Remarques sur cette page</h4>
            {pageComments.length === 0 ? <p className="small muted">Aucune remarque pour l'instant.</p> : (
              <ul className="cv-comments">
                {numbered.filter((c) => c.page_no === cur).map((c) => (
                  <li key={c.id} className={c.from_client ? "" : "pro"}>
                    <span className={`pin static ${c.from_client ? "mine" : "pro"}`}>{c.x != null ? c.n : "•"}</span>
                    <div className="grow"><div>{c.body}</div><span className="small muted">{c.from_client ? "Vous" : "Votre photographe"} · {new Date(c.created_at).toLocaleDateString("fr-FR")}</span></div>
                    {c.from_client && !locked && <button className="link" onClick={() => removeComment(c)}>Retirer</button>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h4>Toutes les pages</h4>
            <div className="cv-thumbs">
              {data.pages.map((p) => (
                <button key={p.page_no} className={`cv-thumb ${p.page_no === cur ? "on" : ""}`} onClick={() => { setCur(p.page_no); setPinMode(false); setDraft(null); }}>
                  <ProofCanvas bmp={bmps[p.page_no] ?? null} maxW={wide ? 70 : 64} maxH={wide ? 70 : 64} stamp={stamp} />
                  <span>{p.page_no}{p.status === "ok" ? " ✓" : p.status === "change" ? " ✎" : ""}{data.comments.some((c) => c.page_no === p.page_no) ? " 💬" : ""}</span>
                </button>
              ))}
            </div>
          </section>
          {!locked && (
            <section className="cv-final">
              <button className="btn primary full" onClick={() => setDecide("validated")}>Valider l'album</button>
              <button className="btn full" onClick={() => setDecide("changes")}>Demander des modifications</button>
              <p className="hint">Vous pouvez ajouter des remarques autant que nécessaire avant d'envoyer votre réponse.</p>
            </section>
          )}
        </aside>
      </div>

      {decide && (
        <div className="overlay" onClick={() => setDecide(null)}>
          <div className="sheet glass cv-decide" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head"><h3>{decide === "validated" ? "Valider l'album" : "Demander des modifications"}</h3>
              <p className="muted small">{okCount} page{okCount > 1 ? "s" : ""} validée{okCount > 1 ? "s" : ""}, {chCount} à modifier, {data.comments.filter((c) => c.from_client).length} remarque{data.comments.filter((c) => c.from_client).length > 1 ? "s" : ""}.</p></div>
            <div className="wiz-body"><textarea rows={4} placeholder="Un message pour votre photographe (facultatif)" value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <div className="wiz-foot"><button className="btn ghost" onClick={() => setDecide(null)}>Retour</button>
              <button className="btn primary" disabled={busy} onClick={sendDecision}>{decide === "validated" ? "Confirmer la validation" : "Envoyer ma demande"}</button></div>
          </div>
        </div>
      )}
      {toast && <div className="toast glass">{toast}</div>}
    </div>
  );
}
