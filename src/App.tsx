import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import libJson from "./engine/templates.json";
import type { Library, PageDoc, Template } from "./engine/types";
import { compatible, fillTemplate, proposals, uid, slotCount, planProject, photoUsage, type Presentation } from "./engine/generate";
import { defaultText, pagePixels } from "./engine/layout";
import { FONTS } from "./engine/render";
import { importFiles, type PhotoItem } from "./lib/photos";
import { exportPages, saveFile, safeName, type ExportOptions } from "./lib/export";
import { listProjects, saveProject, savePhotos, loadPhotos, deleteProject, askPersistence, storageAvailable, type StoredProject } from "./lib/storage";
import { PageCanvas, usePageGeometry } from "./components/PageCanvas";
import { useInstall, useOnline, useServiceWorker, isTauri, desktopPickFolder } from "./lib/platform";

const lib = libJson as unknown as Library;
type MobileTab = "photos" | "modeles" | "reglages" | "pages";
type Usage = Map<string, { count: number; pages: number[] }>;

export interface ProjectSettings { pageCount: number; formatId: string; pres: Presentation; category: string; mode: "auto" | "manual"; name: string }
const today = () => new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

const SWATCHES = [
  { c: "#ffffff", n: "Blanc" }, { c: "#ECF4F7", n: "Alice Blue" }, { c: "#39404B", n: "Charcoal" },
  { c: "#910029", n: "Burgundy" }, { c: "#f4efe6", n: "Crème" }, { c: "#d9b8a0", n: "Kraft" }, { c: "#111111", n: "Noir" },
];
const PRES_LABEL: Record<Presentation, string> = { portrait: "Portrait", landscape: "Paysage", both: "Portrait et paysage" };
const presToOrient = (p: Presentation) => (p === "both" ? "all" : p) as "all" | "portrait" | "landscape";

function useViewport() {
  const [v, setV] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => { const f = () => setV({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return v;
}
function useFonts() {
  const [n, setN] = useState(0);
  useEffect(() => {
    Promise.all(Object.values(FONTS).map((f) => document.fonts.load(`${f.weight} 32px "${f.family}"`).catch(() => null))).then(() => setN((x) => x + 1));
  }, []);
  return n;
}
const plural = (n: number, w: string, ws = w + "s") => `${n} ${n > 1 ? ws : w}`;

export default function App() {
  const vp = useViewport();
  const mobile = vp.w < 900;
  const fontsReady = useFonts();
  const sw = useServiceWorker();
  const { canInstall, install } = useInstall();
  const online = useOnline();
  const dirRef = useRef<HTMLInputElement>(null);

  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [star, setStar] = useState<string | null>(null);
  const [settings, setSettings] = useState<ProjectSettings>({ pageCount: 10, formatId: "A4", pres: "both", category: "all", mode: "auto", name: `Projet du ${today()}` });
  const [projectId, setProjectId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error" | "off">("idle");
  const [recent, setRecent] = useState<StoredProject[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [category, setCategory] = useState("all"); // filtre des modèles et propositions
  const [pages, setPages] = useState<PageDoc[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [selSlot, setSelSlot] = useState<number | null>(null);
  const [props, setProps] = useState<{ list: PageDoc[]; seed: number; mode: "add" | "replace" } | null>(null);
  const [wizard, setWizard] = useState(true);
  const [busy, setBusy] = useState<{ label: string; done: number; total: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<"photos" | "modeles">("photos");
  const [mTab, setMTab] = useState<MobileTab>("photos");
  const [dpi, setDpi] = useState(300);
  const [dupCursor, setDupCursor] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const projectIdRef = useRef<string | null>(null);
  useEffect(() => { projectIdRef.current = projectId; }, [projectId]);
  const [dragOver, setDragOver] = useState(false);

  const formatId = settings.formatId;
  const refreshRecent = useCallback(() => { listProjects().then(setRecent).catch(() => setSaveState("off")); }, []);
  useEffect(() => { storageAvailable().then((ok) => { if (ok) refreshRecent(); else setSaveState("off"); }); }, [refreshRecent]);
  const photoMap = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const page = pages.find((p) => p.id === current) ?? null;
  const pageIndex = page ? pages.indexOf(page) : -1;
  const notify = (m: string, ms = 3600) => { setToast(m); window.setTimeout(() => setToast(null), ms); };

  // ----- doublons (alerte non bloquante) et photos non utilisées
  const usage: Usage = useMemo(() => photoUsage(lib, pages), [pages]);
  const dupIds = useMemo(() => new Set([...usage].filter(([, u]) => u.count > 1).map(([id]) => id)), [usage]);
  const dupPages = useMemo(() => Array.from(new Set([...dupIds].flatMap((id) => usage.get(id)!.pages))).sort((a, b) => a - b), [dupIds, usage]);
  const unusedCount = useMemo(() => photos.filter((p) => !usage.has(p.id)).length, [photos, usage]);

  const selection = useMemo(() => {
    const list = photos.filter((p) => selected.has(p.id));
    const s = list.find((p) => p.id === star);
    return s ? [s, ...list.filter((p) => p !== s)] : list;
  }, [photos, selected, star]);

  const onFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setBusy({ label: "Import des photos", done: 0, total: files.length });
    const items = await importFiles(files, (d, t) => setBusy({ label: "Import des photos", done: d, total: t }));
    setBusy(null);
    if (!items.length) { notify("Aucune photo JPEG, PNG ou WebP reconnue."); return; }
    setPhotos((p) => [...p, ...items]);
    setSelected((s) => { const n = new Set(s); items.forEach((i) => n.add(i.id)); return n; });
    if (projectIdRef.current) savePhotos(projectIdRef.current, items).catch(() => setSaveState("error"));
    notify(`${plural(items.length, "photo importée", "photos importées")}`);
  }, []);

  const pickFolder = async () => {
    if (!isTauri()) { dirRef.current?.click(); return; }
    try {
      setBusy({ label: "Lecture du dossier", done: 0, total: 0 });
      const files = await desktopPickFolder((n) => setBusy({ label: `Lecture du dossier : ${n} photo${n > 1 ? "s" : ""}`, done: 0, total: 0 }));
      setBusy(null);
      if (files.length) onFiles(files);
    } catch (e) { setBusy(null); notify(`Lecture du dossier impossible : ${(e as Error).message}`); }
  };
  const updatePage = (id: string, f: (p: PageDoc) => PageDoc) => setPages((ps) => ps.map((p) => (p.id === id ? f(p) : p)));
  const goTo = (id: string | null) => { setCurrent(id); setSelSlot(null); };

  // ----- création du projet
  const createdAt = useRef(Date.now());
  const createProject = () => {
    const { pageCount, pres, mode } = settings;
    if (mode === "auto" && !selection.length) { notify("Importez au moins une photo pour la mise en page automatique."); return; }
    const plan = planProject(lib, selection, pageCount, formatId, pres, settings.category, mode, Date.now() % 10000);
    if (!plan.pages.length) { notify("Aucun modèle disponible pour ce format et cette catégorie."); return; }
    setPages(plan.pages); goTo(plan.pages[0].id); setWizard(false); setCategory(settings.category);
    const id = uid("prj"); setProjectId(id); projectIdRef.current = id; createdAt.current = Date.now();
    askPersistence();
    savePhotos(id, photos).catch(() => setSaveState("error"));
    const msgs = [`Projet créé : ${plural(plan.pages.length, "page")}`];
    if (plan.orientationFallback) msgs.push(`aucun modèle « ${PRES_LABEL[pres].toLowerCase()} » pour ce format, tous les modèles ont été utilisés`);
    if (plan.unused.length) msgs.push(`${plural(plan.unused.length, "photo non placée", "photos non placées")}`);
    if (plan.repeated) msgs.push("certaines photos sont répétées (voir l'alerte)");
    notify(msgs.join(" · "), 6000);
    if (mobile) setMTab("pages");
  };

  // ----- enregistrement automatique (après 1 s sans modification)
  useEffect(() => {
    if (!projectId || saveState === "off") return;
    setSaveState("saving");
    const h = window.setTimeout(() => {
      saveProject({ id: projectId, name: settings.name || "Projet sans nom", createdAt: createdAt.current, updatedAt: Date.now(), settings, pages,
        photoIds: photos.map((p) => p.id), selected: Array.from(selected), star })
        .then(() => { setSaveState("saved"); refreshRecent(); }).catch(() => setSaveState("error"));
    }, 1000);
    return () => window.clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, pages, settings, photos, selected, star]);

  const resumeProject = async (p: StoredProject) => {
    try {
      const stored = await loadPhotos(p.id);
      const order = new Map(p.photoIds.map((id, i) => [id, i]));
      stored.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
      setBusy({ label: "Ouverture du projet", done: 0, total: stored.length });
      const files = stored.map((x) => new File([x.blob], x.name, { type: x.blob.type || "image/jpeg" }));
      const items = await importFiles(files, (d, t) => setBusy({ label: "Ouverture du projet", done: d, total: t }), stored.map((x) => x.id));
      setBusy(null);
      photos.forEach((ph) => URL.revokeObjectURL(ph.thumbUrl));
      setPhotos(items); setSelected(new Set(p.selected.filter((id) => items.some((i) => i.id === id)))); setStar(p.star);
      setSettings(p.settings as ProjectSettings); setPages(p.pages); setProjectId(p.id); projectIdRef.current = p.id; createdAt.current = p.createdAt;
      goTo(p.pages[0]?.id ?? null); setWizard(false);
      notify(`« ${p.name} » rouvert : ${plural(p.pages.length, "page")}, ${plural(items.length, "photo")}`);
    } catch (e) { setBusy(null); notify(`Ouverture impossible : ${(e as Error).message}`); }
  };
  const removeProject = async (p: StoredProject) => {
    await deleteProject(p.id).catch(() => null);
    if (p.id === projectId) { setProjectId(null); projectIdRef.current = null; }
    refreshRecent();
  };

  // ----- propositions : ajouter une page, ou remettre en page la page courante
  const openProposals = (mode: "add" | "replace", seed = 1) => {
    const pool = mode === "replace" && page
      ? Array.from(new Set(page.slots.map((s) => s.photoId).filter(Boolean))).map((id) => photoMap.get(id!)!).filter(Boolean)
      : selection;
    if (!pool.length) { notify(mode === "replace" ? "Cette page n'a pas encore de photos." : "Sélectionnez d'abord des photos."); return; }
    const list = proposals(lib, pool, formatId, category, presToOrient(settings.pres), 12, seed);
    if (!list.length) { notify("Aucun modèle pour ce format et cette catégorie."); return; }
    setProps((prev) => ({ list: prev && seed > 1 ? [...prev.list, ...list] : list, seed, mode }));
  };
  const pickProposal = (pg: PageDoc) => {
    if (props?.mode === "replace" && page) { updatePage(page.id, () => ({ ...pg, id: page.id, texts: page.texts, background: page.background })); setSelSlot(null); }
    else { const copy = { ...pg, id: uid("pg") }; setPages((ps) => [...ps, copy]); goTo(copy.id); }
    setProps(null);
  };

  const applyTemplate = (t: Template) => {
    const src = page ? Array.from(new Set(page.slots.map((s) => s.photoId).filter(Boolean))).map((id) => photoMap.get(id!)!).filter(Boolean) : [];
    const pool = src.length ? src : page ? [] : selection;
    const pg = fillTemplate(lib, t, formatId, pool, Math.floor(Math.random() * 1000), page ? { texts: {}, background: page.background } : undefined);
    if (page) { updatePage(page.id, () => ({ ...pg, id: page.id })); setSelSlot(null); }
    else { setPages((ps) => [...ps, pg]); goTo(pg.id); }
  };

  const placePhoto = (slotIndex: number, photoId: string) => {
    if (!page) return;
    updatePage(page.id, (p) => ({ ...p, slots: p.slots.map((s, i) => (i === slotIndex ? { photoId, fx: 0.5, fy: 0.38, zoom: 1 } : s)) }));
    const u = usage.get(photoId);
    if (u && !page.slots.some((s) => s.photoId === photoId)) notify(`Attention : cette photo est déjà utilisée (page${u.pages.length > 1 ? "s" : ""} ${u.pages.join(", ")}).`);
  };

  const nextDuplicate = () => {
    if (!dupPages.length) return;
    const n = dupPages[dupCursor % dupPages.length];
    setDupCursor((c) => c + 1);
    goTo(pages[n - 1]?.id ?? null);
    if (mobile) setMTab("reglages");
  };

  const runExport = async (scope: "page" | "all", opt: Omit<ExportOptions, "baseName">) => {
    const list = scope === "page" && page ? [{ page, number: pageIndex + 1 }] : pages.map((p, i) => ({ page: p, number: i + 1 }));
    if (!list.length) return;
    setExportOpen(false);
    try {
      setBusy({ label: "Préparation de l'export", done: 0, total: list.length });
      const res = await exportPages(lib, list, photoMap, { ...opt, baseName: safeName(settings.name) }, (label, d, t) => setBusy({ label, done: Math.round(d * 10) / 10, total: t }));
      setBusy(null);
      const mb = (res.blob.size / 1048576).toFixed(1);
      const r = await saveFile(res.filename, res.blob);
      notify(r === "saved" ? `Export terminé : ${res.filename} (${mb} Mo${res.files > 1 ? `, ${res.files} fichiers` : ""})` : "Export annulé", 6000);
    } catch (e) { setBusy(null); notify(`Export impossible : ${(e as Error).message}`, 6000); }
  };

  // ---------- panneaux ----------
  const photosPanel = (
    <div className="panel-body">
      <div className="row gap">
        <button className="btn primary grow" onClick={() => fileRef.current?.click()}>Importer des photos</button>
        <button className="btn" title="Importer toutes les photos d'un dossier" onClick={pickFolder}>Dossier</button>
      </div>
      {photos.length > 0 && (
        <div className="row between small muted">
          <span>{selected.size} / {photos.length} sélectionnées{pages.length ? ` · ${unusedCount} non utilisée${unusedCount > 1 ? "s" : ""}` : ""}</span>
          <span className="links">
            <button className="link" onClick={() => setSelected(new Set(photos.map((p) => p.id)))}>Tout</button>
            <button className="link" onClick={() => setSelected(new Set())}>Aucune</button>
          </span>
        </div>
      )}
      {!photos.length && <p className="muted small">Formats acceptés : JPEG, PNG, WebP. Les photos restent sur votre appareil : rien n'est envoyé sur un serveur.</p>}
      <div className="photo-grid">
        {photos.map((p) => {
          const u = usage.get(p.id)?.count ?? 0;
          return (
            <div key={p.id} className={`ph ${selected.has(p.id) ? "on" : ""}`} draggable
              onDragStart={(e) => e.dataTransfer.setData("text/photo-id", p.id)}
              onClick={() => {
                if (page && selSlot != null) { placePhoto(selSlot, p.id); return; }
                setSelected((s) => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; });
              }}>
              <img src={p.thumbUrl} alt={p.name} loading="lazy" />
              <button className={`star ${star === p.id ? "on" : ""}`} title="Photo principale" onClick={(e) => { e.stopPropagation(); setStar(star === p.id ? null : p.id); }}>★</button>
              {pages.length > 0 && <span className={`use ${u > 1 ? "dup" : u === 1 ? "one" : "none"}`} title={u ? `Utilisée ${u} fois` : "Non utilisée"}>{u > 1 ? `×${u}` : u === 1 ? "✓" : "–"}</span>}
              {!pages.length && <span className="check">{selected.has(p.id) ? "✓" : ""}</span>}
            </div>
          );
        })}
      </div>
      {page && selSlot != null && <p className="hint">Touchez une photo pour la placer dans le cadre sélectionné.</p>}
      {pages.length > 0 && <p className="hint">✓ utilisée une fois · ×2 utilisée plusieurs fois · – pas encore utilisée</p>}
    </div>
  );

  const templatesList = useMemo(() => compatible(lib, formatId, category, presToOrient(settings.pres)), [formatId, category, settings.pres]);
  const modelsPanel = (
    <div className="panel-body">
      <select value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="all">Toutes les catégories</option>
        {lib.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <p className="muted small">{templatesList.length} modèles · {lib.formats.find((f) => f.id === formatId)?.name.split(" (")[0]} · {PRES_LABEL[settings.pres]}. Touchez un modèle pour l'appliquer à la page courante.</p>
      <div className="tpl-grid">
        {templatesList.map((t) => <TemplateThumb key={t.id} t={t} formatId={formatId} onPick={() => applyTemplate(t)} fontsReady={fontsReady} active={page?.templateId === t.id} />)}
      </div>
    </div>
  );

  const settingsPanel = page ? (
    <SettingsPanel page={page} pageNo={pageIndex + 1} photos={photoMap} usage={usage} fontsReady={fontsReady} selSlot={selSlot} dpi={dpi} setDpi={setDpi}
      onChange={(f) => updatePage(page.id, f)} onExport={() => setExportOpen(true)} onClearSel={() => setSelSlot(null)} onRelayout={() => openProposals("replace")} />
  ) : <div className="panel-body"><p className="muted small">Créez un projet pour accéder aux réglages.</p></div>;

  const dupBanner = pages.length > 0 && (dupIds.size > 0 || unusedCount > 0) && (
    <div className="alerts">
      {dupIds.size > 0 && (
        <button className="alert warn" onClick={nextDuplicate} title="Aller à la page suivante contenant une photo répétée">
          ⚠ {plural(dupIds.size, "photo utilisée", "photos utilisées")} plusieurs fois · page{dupPages.length > 1 ? "s" : ""} {dupPages.join(", ")} <b>Voir</b>
        </button>
      )}
      {unusedCount > 0 && <span className="alert info">{plural(unusedCount, "photo non utilisée", "photos non utilisées")}</span>}
    </div>
  );

  const pagesStrip = (
    <div className="strip">
      {pages.map((p, i) => {
        const hasDup = p.slots.some((s) => s.photoId && dupIds.has(s.photoId));
        return (
          <div key={p.id} className={`strip-item ${p.id === current ? "on" : ""}`} onClick={() => goTo(p.id)}>
            {hasDup && <span className="dup-dot" title="Contient une photo répétée">⚠</span>}
            <PageCanvas lib={lib} page={p} photos={photoMap} maxW={mobile ? 90 : 96} maxH={mobile ? 90 : 76} fontsReady={fontsReady} />
            <div className="strip-meta">
              <span>{i + 1}</span>
              <button title="Monter" disabled={i === 0} onClick={(e) => { e.stopPropagation(); setPages((ps) => { const n = ps.slice(); [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; }); }}>‹</button>
              <button title="Descendre" disabled={i === pages.length - 1} onClick={(e) => { e.stopPropagation(); setPages((ps) => { const n = ps.slice(); [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; }); }}>›</button>
              <button title="Dupliquer" onClick={(e) => { e.stopPropagation(); const c = { ...p, id: uid("pg"), slots: p.slots.map((s) => ({ ...s })), texts: { ...p.texts } }; setPages((ps) => { const n = ps.slice(); n.splice(i + 1, 0, c); return n; }); }}>⧉</button>
              <button title="Supprimer" onClick={(e) => { e.stopPropagation(); setPages((ps) => ps.filter((x) => x.id !== p.id)); if (current === p.id) goTo(pages[i - 1]?.id ?? pages[i + 1]?.id ?? null); }}>✕</button>
            </div>
          </div>
        );
      })}
      {pages.length > 0 && <button className="strip-add" onClick={() => openProposals("add")}>＋<span>Page</span></button>}
    </div>
  );

  // ---------- zone centrale ----------
  const stageW = mobile ? vp.w - 24 : vp.w - 300 - 320 - 64;
  const stageH = mobile ? Math.min(vp.h * 0.55, 560) : vp.h - 64 - 150 - 48;
  const stage = (
    <div className={`stage ${dragOver ? "drag" : ""}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setDragOver(false); onFiles(Array.from(e.dataTransfer.files)); } }}
      onClick={(e) => { if (e.target === e.currentTarget) setSelSlot(null); }}>
      {page ? (
        <>
          <div className="page-nav">
            <button className="btn sm ghost" disabled={pageIndex <= 0} onClick={() => goTo(pages[pageIndex - 1].id)}>‹ Précédente</button>
            <span className="small">Page {pageIndex + 1} / {pages.length}</span>
            <button className="btn sm ghost" disabled={pageIndex >= pages.length - 1} onClick={() => goTo(pages[pageIndex + 1].id)}>Suivante ›</button>
          </div>
          <PageCanvas lib={lib} page={page} photos={photoMap} maxW={stageW} maxH={stageH - 40} interactive fontsReady={fontsReady}
            selectedSlot={selSlot} onSelectSlot={setSelSlot} dupIds={dupIds}
            onPan={(i, fx, fy) => updatePage(page.id, (p) => ({ ...p, slots: p.slots.map((s, k) => (k === i ? { ...s, fx, fy } : s)) }))}
            onDropPhoto={placePhoto} />
        </>
      ) : (
        <div className="empty glass">
          <div className="empty-mark">PB</div>
          <h2>Nouveau projet</h2>
          <p className="muted">Indiquez le nombre de pages, le format et la présentation, puis laissez PhotoBook composer les pages ou composez-les vous-même.</p>
          <button className="btn primary" onClick={() => setWizard(true)}>Commencer</button>
        </div>
      )}
    </div>
  );

  const projectBar = (
    <div className="toolbar">
      {pages.length > 0 && (
        <div className="proj-chip">
          <b>{settings.name} · {plural(pages.length, "page")}</b>
          <span>{lib.formats.find((f) => f.id === formatId)?.name.split(" (")[0]} · {PRES_LABEL[settings.pres]}</span>
        </div>
      )}
      <div className="row gap tb-actions">
        <button className="btn" onClick={() => setWizard(true)}>Nouveau projet</button>
        {pages.length > 0 && <SaveBadge state={saveState} />}
        {pages.length > 0 && <button className="btn" onClick={() => openProposals("add")}>Ajouter une page</button>}
        {pages.length > 0 && <button className="btn primary" onClick={() => setExportOpen(true)}>Exporter</button>}
      </div>
    </div>
  );

  return (
    <div className={`app ${mobile ? "mobile" : ""}`}>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
        onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      <input ref={dirRef} type="file" multiple hidden {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={(e) => { onFiles(Array.from(e.target.files ?? []).sort((a, b) => a.name.localeCompare(b.name, "fr", { numeric: true }))); e.target.value = ""; }} />
      <header className="topbar glass">
        <div className="brand"><span className="logo">PhotoBook</span><span className="by">Fredy Photography</span></div>
        <div className="status-row">
          {!online && <span className="chip offline" title="Toutes les fonctions restent disponibles sans connexion">Hors connexion</span>}
          {sw.offlineReady && online && <span className="chip ok" title="L'application est prête à fonctionner sans Internet">Disponible hors connexion</span>}
          {canInstall && !isTauri() && <button className="btn sm" onClick={install}>Installer l'application</button>}
        </div>
        {!mobile && projectBar}
      </header>
      {mobile && <div className="glass mobile-tools">{projectBar}</div>}

      {!mobile ? (
        <div className="workspace">
          <aside className="left glass">
            <div className="tabs">
              <button className={leftTab === "photos" ? "on" : ""} onClick={() => setLeftTab("photos")}>Photos {photos.length ? `(${photos.length})` : ""}</button>
              <button className={leftTab === "modeles" ? "on" : ""} onClick={() => setLeftTab("modeles")}>Modèles</button>
            </div>
            {leftTab === "photos" ? photosPanel : modelsPanel}
          </aside>
          <main className="center">
            {stage}
            <div className="glass pages-bar">{dupBanner}{pagesStrip}</div>
          </main>
          <aside className="right glass">{settingsPanel}</aside>
        </div>
      ) : (
        <div className="m-layout">
          {dupBanner && <div className="glass m-alerts">{dupBanner}</div>}
          {stage}
          <div className="tabs m-tabs glass">
            {(["photos", "modeles", "reglages", "pages"] as MobileTab[]).map((k) => (
              <button key={k} className={mTab === k ? "on" : ""} onClick={() => setMTab(k)}>
                {{ photos: `Photos${photos.length ? ` (${photos.length})` : ""}`, modeles: "Modèles", reglages: "Réglages", pages: `Pages${pages.length ? ` (${pages.length})` : ""}` }[k]}
              </button>
            ))}
          </div>
          <div className="glass m-panel">
            {mTab === "photos" && photosPanel}
            {mTab === "modeles" && modelsPanel}
            {mTab === "reglages" && settingsPanel}
            {mTab === "pages" && pagesStrip}
          </div>
        </div>
      )}

      {wizard && (
        <Wizard settings={settings} setSettings={setSettings} photos={photos} selectionCount={selection.length} hasProject={pages.length > 0}
          recent={recent} currentId={projectId} onResume={resumeProject} onDelete={removeProject}
          onImport={() => fileRef.current?.click()} onImportDir={pickFolder} onCreate={createProject} onClose={() => setWizard(false)} mobile={mobile} />
      )}

      {exportOpen && pages.length > 0 && (
        <ExportDialog pageNo={pageIndex + 1} total={pages.length} onClose={() => setExportOpen(false)} onRun={runExport}
          sizeLabel={(dpi2) => { const t = lib.templates.find((x) => x.id === (page ?? pages[0]).templateId)!; const [w, h] = pagePixels(lib, t, (page ?? pages[0]).formatId, dpi2); return `${w} × ${h} px`; }} />
      )}

      {props && (
        <div className="overlay" onClick={() => setProps(null)}>
          <div className="sheet glass" onClick={(e) => e.stopPropagation()}>
            <div className="row between sheet-head">
              <div>
                <h3>{props.mode === "replace" ? `Remettre en page la page ${pageIndex + 1}` : "Ajouter une page"}</h3>
                <p className="muted small">{props.mode === "replace" ? "Mêmes photos, autre disposition. Touchez une proposition pour remplacer la page." : `${plural(selection.length, "photo sélectionnée", "photos sélectionnées")} · touchez une proposition pour l'ajouter à la fin du projet`}</p>
              </div>
              <div className="row gap">
                <button className="btn" onClick={() => openProposals(props.mode, props.seed + 1)}>Autres variantes</button>
                <button className="btn ghost" onClick={() => setProps(null)}>Fermer</button>
              </div>
            </div>
            <div className="prop-grid">
              {props.list.map((p) => {
                const t = lib.templates.find((x) => x.id === p.templateId)!;
                return (
                  <button key={p.id} className="prop" onClick={() => pickProposal(p)}>
                    <PageCanvas lib={lib} page={p} photos={photoMap} maxW={mobile ? (vp.w - 120) / 2 : 230} maxH={mobile ? 200 : 230} fontsReady={fontsReady} />
                    <span className="prop-name">{t.name}</span>
                    <span className="prop-cat">{lib.categories.find((c) => c.id === t.category)?.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {busy && (
        <div className="busy glass">
          <span>{busy.label}</span>
          <div className="bar"><i style={{ width: `${(busy.done / Math.max(1, busy.total)) * 100}%` }} /></div>
          <span className="muted small">{busy.done} / {busy.total}</span>
        </div>
      )}
      {toast && <div className="toast glass">{toast}</div>}
      {sw.update && <div className="update glass"><span>Une nouvelle version de PhotoBook est prête.</span><button className="btn sm primary" onClick={() => sw.update?.()}>Mettre à jour</button></div>}
    </div>
  );
}

// ---------- assistant de création de projet ----------
function Wizard({ settings, setSettings, photos, selectionCount, hasProject, onImport, onImportDir, onCreate, onClose, mobile, recent, currentId, onResume, onDelete }: {
  settings: ProjectSettings; setSettings: (f: (s: ProjectSettings) => ProjectSettings) => void; photos: PhotoItem[]; selectionCount: number;
  hasProject: boolean; onImport: () => void; onImportDir: () => void; onCreate: () => void; onClose: () => void; mobile: boolean;
  recent: StoredProject[]; currentId: string | null; onResume: (p: StoredProject) => void; onDelete: (p: StoredProject) => void;
}) {
  const [delAsk, setDelAsk] = useState<string | null>(null);
  const others = recent.filter((p) => p.id !== currentId);
  const [confirm, setConfirm] = useState(false);
  const set = <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  const fmt = lib.formats.find((f) => f.id === settings.formatId)!;
  const square = Math.abs(fmt.mm[0] - fmt.mm[1]) < 1;
  const P = Math.max(1, settings.pageCount || 1), n = selectionCount;
  const per = n / P;
  const nTpl = compatible(lib, settings.formatId, settings.category, square || fmt.spread ? "all" : presToOrient(settings.pres)).length;
  let note = "";
  if (settings.mode === "auto") {
    if (!n) note = "Importez vos photos pour lancer la mise en page automatique.";
    else if (n < P) note = `Moins de photos que de pages : certaines photos seront répétées. PhotoBook vous le signalera.`;
    else note = `${n} photos sur ${plural(P, "page")} : environ ${Math.floor(per)}${Math.ceil(per) !== Math.floor(per) ? ` à ${Math.ceil(per)}` : ""} photo${Math.ceil(per) > 1 ? "s" : ""} par page.`;
    if (n && per > 30) note += " C'est beaucoup par page : augmentez le nombre de pages pour des photos plus grandes.";
  } else note = `${plural(P, "page vide", "pages vides")} avec des modèles variés, à remplir en glissant vos photos.`;
  return (
    <div className="overlay" onClick={hasProject ? onClose : undefined}>
      <div className="sheet glass wizard" onClick={(e) => e.stopPropagation()}>
        <div className="row between sheet-head">
          <div><h3>Nouveau projet</h3><p className="muted small">Définissez votre projet, PhotoBook s'occupe du reste.</p></div>
          {hasProject && <button className="btn ghost" onClick={onClose}>Fermer</button>}
        </div>
        <div className="wiz-body">
          {others.length > 0 && (
            <section>
              <h4>Reprendre un projet</h4>
              <div className="recent">
                {others.slice(0, 6).map((p) => (
                  <div key={p.id} className="recent-item">
                    <div className="grow"><b>{p.name}</b><span className="small muted">{plural(p.pages.length, "page")} · {plural(p.photoIds.length, "photo")} · modifié le {new Date(p.updatedAt).toLocaleDateString("fr-FR")} à {new Date(p.updatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span></div>
                    {delAsk === p.id
                      ? <><button className="btn sm danger" onClick={() => { onDelete(p); setDelAsk(null); }}>Supprimer</button><button className="btn sm ghost" onClick={() => setDelAsk(null)}>Annuler</button></>
                      : <><button className="btn sm primary" onClick={() => onResume(p)}>Reprendre</button><button className="btn sm ghost" title="Supprimer" onClick={() => setDelAsk(p.id)}>✕</button></>}
                  </div>
                ))}
              </div>
            </section>
          )}
          <section>
            <h4><span className="num">1</span> Photos</h4>
            <div className="row gap wrap">
              <button className="btn primary" onClick={onImport}>Importer des photos</button>
              <button className="btn" onClick={onImportDir}>Importer un dossier</button>
              <span className="small">{photos.length ? `${photos.length} importée${photos.length > 1 ? "s" : ""} · ${selectionCount} sélectionnée${selectionCount > 1 ? "s" : ""}` : "Aucune photo pour l'instant"}</span>
            </div>
            {photos.length > 0 && <div className="wiz-thumbs">{photos.slice(0, mobile ? 8 : 14).map((p) => <img key={p.id} src={p.thumbUrl} alt="" />)}{photos.length > (mobile ? 8 : 14) && <span>+{photos.length - (mobile ? 8 : 14)}</span>}</div>}
          </section>
          <section>
            <h4><span className="num">2</span> Pages</h4>
            <label className="field name-field"><span>Nom du projet</span>
              <input type="text" value={settings.name} onChange={(e) => set("name", e.target.value)} placeholder="Mariage Aïcha & Koffi" />
            </label>
            <div className="wiz-grid">
              <label className="field"><span>Nombre de pages</span>
                <div className="stepper">
                  <button onClick={() => set("pageCount", Math.max(1, P - 1))}>−</button>
                  <input type="number" min={1} max={300} value={settings.pageCount} onChange={(e) => set("pageCount", Math.max(1, Math.min(300, +e.target.value || 1)))} />
                  <button onClick={() => set("pageCount", Math.min(300, P + 1))}>＋</button>
                </div>
              </label>
              <label className="field"><span>Format</span>
                <select value={settings.formatId} onChange={(e) => set("formatId", e.target.value)}>
                  {lib.formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>
              <label className="field"><span>Catégorie de modèles</span>
                <select value={settings.category} onChange={(e) => set("category", e.target.value)}>
                  <option value="all">Toutes les catégories</option>
                  {lib.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            </div>
            <div className="field"><span>Présentation</span></div>
            <div className="seg">
              {(["portrait", "landscape", "both"] as Presentation[]).map((p) => (
                <button key={p} className={settings.pres === p ? "on" : ""} disabled={square || fmt.spread} onClick={() => set("pres", p)}>
                  <i className={`ico ${p}`} />{PRES_LABEL[p]}
                </button>
              ))}
            </div>
            {(square || fmt.spread) && <p className="hint">{square ? "Format carré : la présentation ne s'applique pas." : "Double page d'album : toujours en paysage."}</p>}
          </section>
          <section>
            <h4><span className="num">3</span> Mise en page</h4>
            <div className="choices">
              <button className={`choice ${settings.mode === "auto" ? "on" : ""}`} onClick={() => set("mode", "auto")}>
                <b>Automatique</b><span>PhotoBook répartit toutes vos photos sur les {plural(P, "page")} avec des modèles variés. Vous retouchez ensuite page par page.</span>
              </button>
              <button className={`choice ${settings.mode === "manual" ? "on" : ""}`} onClick={() => set("mode", "manual")}>
                <b>Manuelle</b><span>PhotoBook prépare les pages avec des modèles. Vous placez vous-même les photos.</span>
              </button>
            </div>
            <p className={`summary ${settings.mode === "auto" && n && n < P ? "warn" : ""}`}>{note} <span className="muted">· {nTpl} modèles disponibles</span></p>
          </section>
        </div>
        <div className="wiz-foot">
          {hasProject && confirm && <span className="small warn">Le projet actuel sera remplacé.</span>}
          <button className="btn primary big" disabled={settings.mode === "auto" && !selectionCount}
            onClick={() => { if (hasProject && !confirm) { setConfirm(true); return; } onCreate(); }}>
            {hasProject && confirm ? "Remplacer le projet" : settings.mode === "auto" ? `Composer ${plural(P, "page")}` : `Créer ${plural(P, "page")}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- miniature de modèle ----------
function TemplateThumb({ t, formatId, onPick, fontsReady, active }: { t: Template; formatId: string; onPick: () => void; fontsReady: number; active: boolean }) {
  const page = useMemo(() => fillTemplate(lib, t, formatId, [], 3), [t, formatId]);
  const empty = useMemo(() => new Map<string, PhotoItem>(), []);
  const n = t.photos[0] === t.photos[1] ? `${t.photos[0]}` : `${t.photos[0]}–${t.photos[1]}`;
  return (
    <button className={`tpl ${active ? "on" : ""}`} onClick={onPick} title={t.name}>
      <PageCanvas lib={lib} page={page} photos={empty} maxW={112} maxH={112} fontsReady={fontsReady} />
      <span className="tpl-name">{t.name}</span>
      <span className="tpl-n">{n} photo{t.photos[1] > 1 ? "s" : ""}</span>
    </button>
  );
}

// ---------- panneau de réglages ----------
function SettingsPanel({ page, pageNo, photos, usage, selSlot, onChange, onExport, dpi, onClearSel, onRelayout }: {
  page: PageDoc; pageNo: number; photos: Map<string, PhotoItem>; usage: Usage; fontsReady: number; selSlot: number | null; dpi: number; setDpi: (n: number) => void;
  onChange: (f: (p: PageDoc) => PageDoc) => void; onExport: () => void; onClearSel: () => void; onRelayout: () => void;
}) {
  const geo = usePageGeometry(lib, page, photos);
  const { t, texts } = geo;
  const fmt = lib.formats.find((f) => f.id === page.formatId)!;
  const [pw, ph] = pagePixels(lib, t, page.formatId, dpi);
  const st = selSlot != null ? page.slots[selSlot] : null;
  const sp = st?.photoId ? photos.get(st.photoId) : undefined;
  const usesGrid = t.layout === "grid" || t.generator === "justified-rows";
  let effDpi: number | null = null;
  if (sp && selSlot != null) {
    const s = geo.slots.find((x) => x.index === selSlot)!;
    const wmm = s.box[2] * geo.size.w, hmm = s.box[3] * geo.size.h;
    effDpi = Math.round(25.4 / (Math.max(wmm / sp.width, hmm / sp.height) * (st!.zoom || 1)));
  }
  const u = sp ? usage.get(sp.id) : undefined;
  const slotTotal = slotCount(lib, t, page.formatId, page.slots.length);
  const pageDups = Array.from(new Set(page.slots.map((s) => s.photoId).filter((id): id is string => !!id && (usage.get(id)?.count ?? 0) > 1)));
  return (
    <div className="panel-body settings">
      <section>
        <h4>Page {pageNo}</h4>
        <p className="small"><b>{t.name}</b><br /><span className="muted">{fmt.name.split(" (")[0]} · {plural(slotTotal, "emplacement")}</span></p>
        <button className="btn sm full-sm" onClick={onRelayout}>Changer la mise en page</button>
        {pageDups.length > 0 && <p className="dup-note">⚠ {plural(pageDups.length, "photo de cette page est", "photos de cette page sont")} aussi utilisée{pageDups.length > 1 ? "s" : ""} ailleurs (cadres marqués). Vous pouvez la{pageDups.length > 1 ? "s" : ""} garder ou la{pageDups.length > 1 ? "s" : ""} remplacer.</p>}
        {usesGrid && <>
          <label className="slider"><span>Marges <b>{page.margin} mm</b></span>
            <input type="range" min={0} max={30} step={1} value={page.margin} onChange={(e) => onChange((p) => ({ ...p, margin: +e.target.value }))} /></label>
          <label className="slider"><span>Espacement <b>{page.gutter} mm</b></span>
            <input type="range" min={0} max={15} step={0.5} value={page.gutter} onChange={(e) => onChange((p) => ({ ...p, gutter: +e.target.value }))} /></label>
        </>}
        <div className="swatches">
          <span className="small muted">Fond</span>
          {SWATCHES.map((s) => (
            <button key={s.c} title={s.n} className={`sw ${(page.background ?? t.background?.color ?? "#ffffff").toLowerCase() === s.c.toLowerCase() ? "on" : ""}`} style={{ background: s.c }}
              onClick={() => onChange((p) => ({ ...p, background: s.c }))} />
          ))}
          <input type="color" value={page.background ?? t.background?.color ?? "#ffffff"} onChange={(e) => onChange((p) => ({ ...p, background: e.target.value }))} />
        </div>
      </section>

      {texts.length > 0 && (
        <section>
          <h4>Textes</h4>
          {texts.map((x) => (
            <textarea key={x.index} rows={Math.min(3, (page.texts[x.index] ?? defaultText(x)).split("\n").length)} value={page.texts[x.index] ?? defaultText(x)}
              onChange={(e) => onChange((p) => ({ ...p, texts: { ...p.texts, [x.index]: e.target.value } }))} />
          ))}
        </section>
      )}

      <section>
        <h4>Cadre sélectionné</h4>
        {st ? (
          <>
            {sp ? <div className="row gap"><img className="sel-thumb" src={sp.thumbUrl} alt="" /><div className="small"><div className="ellipsis">{sp.name}</div>
              <span className="muted">{sp.width} × {sp.height} px</span>
              {effDpi != null && <div className={effDpi < 200 ? "warn" : "ok"}>{effDpi} DPI effectifs {effDpi < 200 ? "· risque de flou" : "· bon pour l'impression"}</div>}
              {u && u.count > 1 && <div className="warn">Utilisée {u.count} fois · page{u.pages.length > 1 ? "s" : ""} {u.pages.join(", ")}</div>}
            </div></div> : <p className="small muted">Cadre vide : touchez une photo de la liste pour le remplir.</p>}
            <label className="slider"><span>Zoom <b>{Math.round((st.zoom || 1) * 100)} %</b></span>
              <input type="range" min={1} max={3} step={0.01} value={st.zoom || 1}
                onChange={(e) => onChange((p) => ({ ...p, slots: p.slots.map((s, i) => (i === selSlot ? { ...s, zoom: +e.target.value } : s)) }))} /></label>
            <div className="row gap wrap">
              <button className="btn sm" onClick={() => onChange((p) => ({ ...p, slots: p.slots.map((s, i) => (i === selSlot ? { ...s, fx: 0.5, fy: 0.38, zoom: 1 } : s)) }))}>Recentrer</button>
              <button className="btn sm" onClick={() => onChange((p) => ({ ...p, slots: p.slots.map((s, i) => (i === selSlot ? { fx: 0.5, fy: 0.38, zoom: 1 } : s)) }))}>Vider</button>
              <button className="btn sm ghost" onClick={onClearSel}>Désélectionner</button>
            </div>
            <p className="hint">Glissez dans le cadre pour recadrer. Touchez une photo de la liste pour la remplacer.</p>
          </>
        ) : <p className="small muted">Touchez un cadre de la page pour le recadrer ou changer sa photo.</p>}
      </section>

      <section>
        <h4>Export</h4>
        <p className="small muted">Page {pageNo} à {dpi} DPI : {pw} × {ph} px</p>
        <button className="btn primary full" onClick={onExport}>Exporter…</button>
        <p className="hint">PNG, PDF par page, PDF multipage ou archive ZIP, pour cette page ou tout le projet.</p>
      </section>
    </div>
  );
}

// ---------- état d'enregistrement ----------
function SaveBadge({ state }: { state: "idle" | "saving" | "saved" | "error" | "off" }) {
  const label = { idle: "", saving: "Enregistrement…", saved: "Enregistré sur cet appareil", error: "Échec de l'enregistrement", off: "Enregistrement indisponible" }[state];
  if (!label) return null;
  return <span className={`save-badge ${state}`} title={state === "off" ? "Ce navigateur ne permet pas le stockage local : exportez votre travail avant de fermer." : ""}>{state === "saved" ? "✓ " : state === "error" || state === "off" ? "⚠ " : ""}{label}</span>;
}

// ---------- fenêtre d'export ----------
function ExportDialog({ pageNo, total, onClose, onRun, sizeLabel }: {
  pageNo: number; total: number; onClose: () => void; sizeLabel: (dpi: number) => string;
  onRun: (scope: "page" | "all", o: Omit<ExportOptions, "baseName">) => void;
}) {
  const [scope, setScope] = useState<"page" | "all">(total > 1 ? "all" : "page");
  const [dpi, setDpi] = useState(300);
  const [png, setPng] = useState(false);
  const [pdfEach, setPdfEach] = useState(false);
  const [pdfAll, setPdfAll] = useState(true);
  const [q, setQ] = useState<"lossless" | "jpeg95">("lossless");
  const n = scope === "page" ? 1 : total;
  const files = (png ? n : 0) + (pdfEach ? n : 0) + (pdfAll ? 1 : 0);
  const pdfUsed = pdfEach || pdfAll;
  const out = files === 0 ? "Choisissez au moins un format." : files === 1 ? "Un seul fichier sera enregistré." : `${files} fichiers regroupés dans une archive ZIP.`;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet glass export" onClick={(e) => e.stopPropagation()}>
        <div className="row between sheet-head"><div><h3>Exporter</h3><p className="muted small">Rendu à la résolution finale, depuis vos fichiers originaux.</p></div>
          <button className="btn ghost" onClick={onClose}>Fermer</button></div>
        <div className="wiz-body">
          <section>
            <h4>Pages</h4>
            <div className="seg two">
              <button className={scope === "page" ? "on" : ""} onClick={() => { setScope("page"); }}>Page {pageNo}</button>
              <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>Tout le projet ({plural(total, "page")})</button>
            </div>
          </section>
          <section>
            <h4>Formats</h4>
            <label className="check-row"><input type="checkbox" checked={pdfAll} onChange={(e) => setPdfAll(e.target.checked)} /><span><b>PDF multipage</b><small>Un seul document, une page par composition, au format papier exact.</small></span></label>
            <label className="check-row"><input type="checkbox" checked={pdfEach} onChange={(e) => setPdfEach(e.target.checked)} /><span><b>PDF par page</b><small>Un fichier PDF par composition.</small></span></label>
            <label className="check-row"><input type="checkbox" checked={png} onChange={(e) => setPng(e.target.checked)} /><span><b>PNG haute résolution</b><small>Une image par page, résolution inscrite dans le fichier.</small></span></label>
          </section>
          <section>
            <h4>Qualité</h4>
            <div className="seg two">
              <button className={dpi === 300 ? "on" : ""} onClick={() => setDpi(300)}>300 DPI · impression</button>
              <button className={dpi === 150 ? "on" : ""} onClick={() => setDpi(150)}>150 DPI · écran, épreuve</button>
            </div>
            <p className="hint">Taille d'une page : {sizeLabel(dpi)}</p>
            {pdfUsed && <>
              <div className="seg two" style={{ marginTop: 10 }}>
                <button className={q === "lossless" ? "on" : ""} onClick={() => setQ("lossless")}>PDF sans perte</button>
                <button className={q === "jpeg95" ? "on" : ""} onClick={() => setQ("jpeg95")}>PDF allégé (JPEG 95 %)</button>
              </div>
              <p className="hint">{q === "lossless" ? "Aucune compression destructive : fichier lourd (≈ 10 à 25 Mo par page A4)." : "Compression très légère, invisible à l'impression : fichier 5 à 10 fois plus léger."}</p>
            </>}
          </section>
          <p className={`summary ${files ? "" : "warn"}`}>{out}</p>
        </div>
        <div className="wiz-foot">
          <button className="btn primary big" disabled={!files} onClick={() => onRun(scope, { dpi, png, pdfEach, pdfAll, pdfQuality: q })}>Lancer l'export</button>
        </div>
      </div>
    </div>
  );
}
