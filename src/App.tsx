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
import { ProjectSetup } from "./components/ProjectSetup";
import { ClientAlbums } from "./components/ClientAlbums";
import type { SentAlbum } from "./lib/proofing";
import { defaultSettings, migrateSettings, type ProjectSettings } from "./lib/project";
import { EVENT_TYPES } from "./engine/events";
import { useInstall, useOnline, useServiceWorker, isTauri, desktopPickFolder } from "./lib/platform";

const lib = libJson as unknown as Library;
type MobileTab = "photos" | "modeles" | "reglages" | "pages";
type Usage = Map<string, { count: number; pages: number[] }>;



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
  // mise en page selon l'écran : très grand écran, ordinateur, tablette, téléphone (portrait ou paysage)
  const phoneLand = vp.w > vp.h && vp.h < 560;
  const layout: "xl" | "desktop" | "tablet" | "phone" | "phoneLand" = phoneLand ? "phoneLand" : vp.w < 900 ? "phone" : vp.w < 1180 ? "tablet" : vp.w >= 1680 ? "xl" : "desktop";
  const mobile = layout === "phone" || layout === "phoneLand";
  const [leftOpen, setLeftOpen] = useState(false);
  const fontsReady = useFonts();
  const sw = useServiceWorker();
  const { canInstall, install } = useInstall();
  const online = useOnline();
  const dirRef = useRef<HTMLInputElement>(null);

  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [star, setStar] = useState<string | null>(null);
  const [settings, setSettings] = useState<ProjectSettings>(defaultSettings);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error" | "off">("idle");
  const [recent, setRecent] = useState<StoredProject[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [albums, setAlbums] = useState<SentAlbum[]>([]);
  const [clientsOpen, setClientsOpen] = useState(false);
  const [category, setCategory] = useState("project"); // filtre des modèles et propositions : « project » = catégories du projet
  const [undo, setUndo] = useState<{ pages: PageDoc[]; settings: ProjectSettings } | null>(null);
  const [pages, setPages] = useState<PageDoc[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [selSlot, setSelSlot] = useState<number | null>(null);
  const [props, setProps] = useState<{ list: PageDoc[]; seed: number; mode: "add" | "replace" } | null>(null);
  const [wizard, setWizard] = useState<null | "new" | "edit">("new");
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
  const effCats = category === "project" ? settings.categories : category;
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
    const plan = planProject(lib, selection, pageCount, formatId, pres, settings.categories, mode, Date.now() % 10000, settings.perPage);
    if (!plan.pages.length) { notify("Aucun modèle disponible pour ces catégories et ce format. Ajoutez des catégories."); return; }
    const recompose = wizard === "edit" && !!projectId;
    if (recompose) setUndo({ pages, settings: lastSettings.current ?? settings });
    setPages(plan.pages); goTo(plan.pages[0].id); setWizard(null); setCategory("project");
    lastSettings.current = settings;
    if (!recompose) {
      const id = uid("prj"); setProjectId(id); projectIdRef.current = id; createdAt.current = Date.now();
      askPersistence();
      savePhotos(id, photos).catch(() => setSaveState("error"));
      setUndo(null);
    }
    const msgs = [recompose ? `Projet recomposé : ${plural(plan.pages.length, "page")}` : `Projet créé : ${plural(plan.pages.length, "page")}`];
    if (plan.orientationFallback) msgs.push(`aucun modèle « ${PRES_LABEL[pres].toLowerCase()} » pour ce format, tous les modèles ont été utilisés`);
    if (plan.unused.length) msgs.push(`${plural(plan.unused.length, "photo non placée", "photos non placées")}`);
    if (plan.repeated) msgs.push("certaines photos sont répétées (voir l'alerte)");
    notify(msgs.join(" · "), 6000);
    if (mobile) setMTab("pages");
  };
  const lastSettings = useRef<ProjectSettings | null>(null);
  const undoRecompose = () => { if (!undo) return; setPages(undo.pages); setSettings(undo.settings); lastSettings.current = undo.settings; goTo(undo.pages[0]?.id ?? null); setUndo(null); notify("Composition précédente restaurée"); };
  const startNew = () => {
    // le projet en cours est déjà enregistré automatiquement
    photos.forEach((ph) => URL.revokeObjectURL(ph.thumbUrl));
    setPhotos([]); setSelected(new Set()); setStar(null); setPages([]); goTo(null);
    setProjectId(null); projectIdRef.current = null; setUndo(null); lastSettings.current = null;
    setSettings(defaultSettings()); setCategory("project"); setSaveState("idle"); setWizard("new"); setAlbums([]);
  };

  // ----- enregistrement automatique (après 1 s sans modification)
  useEffect(() => {
    if (!projectId || saveState === "off") return;
    setSaveState("saving");
    const h = window.setTimeout(() => {
      saveProject({ id: projectId, name: settings.name || "Projet sans nom", createdAt: createdAt.current, updatedAt: Date.now(), settings, pages,
        photoIds: photos.map((p) => p.id), selected: Array.from(selected), star, albums })
        .then(() => { setSaveState("saved"); refreshRecent(); }).catch(() => setSaveState("error"));
    }, 1000);
    return () => window.clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, pages, settings, photos, selected, star, albums]);

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
      { const ms = migrateSettings(p.settings as Partial<ProjectSettings>); setSettings(ms); lastSettings.current = ms; } setUndo(null); setAlbums(p.albums ?? []); setPages(p.pages); setProjectId(p.id); projectIdRef.current = p.id; createdAt.current = p.createdAt;
      goTo(p.pages[0]?.id ?? null); setWizard(null);
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
    const list = proposals(lib, pool, formatId, effCats, presToOrient(settings.pres), 12, seed);
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

  const templatesList = useMemo(() => compatible(lib, formatId, effCats, presToOrient(settings.pres)), [formatId, effCats, settings.pres]);
  const modelsPanel = (
    <div className="panel-body">
      <select value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="project">Catégories du projet{settings.categories.length ? ` (${settings.categories.length})` : " (toutes)"}</option>
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

  const dupBanner = pages.length > 0 && (dupIds.size > 0 || unusedCount > 0 || undo) && (
    <div className="alerts">
      {undo && <button className="alert undo" onClick={undoRecompose}>↶ Annuler la recomposition</button>}
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
  const sideL = layout === "xl" ? 340 : 300, sideR = layout === "xl" ? 360 : layout === "tablet" ? 300 : 320;
  const stageW = layout === "phone" ? vp.w - 24 : layout === "phoneLand" ? vp.w * 0.56 - 16 : layout === "tablet" ? vp.w - sideR - 48 : vp.w - sideL - sideR - 64;
  const stageH = layout === "phone" ? Math.min(vp.h * 0.52, 560) : layout === "phoneLand" ? vp.h - 52 : vp.h - 64 - 150 - 48;
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
          <button className="btn primary" onClick={() => setWizard("new")}>Commencer</button>
        </div>
      )}
    </div>
  );

  const projectBar = (
    <div className="toolbar">
      {pages.length > 0 && (
        <div className="proj-chip">
          <b>{settings.name} · {plural(pages.length, "page")}</b>
          {settings.eventType !== "all" && <span>{EVENT_TYPES.find((e) => e.id === settings.eventType)?.name}</span>}
          <span>{lib.formats.find((f) => f.id === formatId)?.name.split(" (")[0]} · {PRES_LABEL[settings.pres]}</span>
        </div>
      )}
      <div className="row gap tb-actions">
        {pages.length > 0 && <button className="btn" onClick={() => setWizard("edit")} title="Format, nombre de pages, photos par page, catégories…">☰ Réglages du projet</button>}
        <button className="btn" onClick={pages.length ? startNew : () => setWizard("new")}>Nouveau projet</button>
        {pages.length > 0 && <SaveBadge state={saveState} />}
        {pages.length > 0 && <button className="btn" onClick={() => openProposals("add")}>Ajouter une page</button>}
        {pages.length > 0 && <button className="btn" onClick={() => setClientsOpen(true)}>✉ Client{albums.length ? ` (${albums.length})` : ""}</button>}
        {pages.length > 0 && <button className="btn primary" onClick={() => setExportOpen(true)}>Exporter</button>}
      </div>
    </div>
  );

  return (
    <div className={`app ${mobile ? "mobile" : ""} layout-${layout}`} style={{ ["--side-l" as string]: `${sideL}px`, ["--side-r" as string]: `${sideR}px` }}>
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
        {layout === "tablet" && <button className="btn drawer-btn" onClick={() => setLeftOpen((v) => !v)}>{leftOpen ? "✕ Fermer" : "▤ Photos & modèles"}</button>}
        {!mobile && projectBar}
      </header>
      {mobile && <div className="glass mobile-tools">{projectBar}</div>}

      {!mobile ? (
        <div className="workspace">
          {layout === "tablet" && leftOpen && <div className="drawer-backdrop" onClick={() => setLeftOpen(false)} />}
          <aside className={`left glass ${layout === "tablet" ? `drawer ${leftOpen ? "open" : ""}` : ""}`}>
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
          <div className="m-stage">{stage}</div>
          <div className="m-side">
          <div className="tabs m-tabs glass">
            {(["photos", "modeles", "reglages", "pages"] as MobileTab[]).map((k) => (
              <button key={k} className={mTab === k ? "on" : ""} onClick={() => setMTab(k)}>
                <i className="tab-ico">{{ photos: "▦", modeles: "◫", reglages: "⚙", pages: "❐" }[k]}</i>
                <span>{{ photos: `Photos${photos.length ? ` (${photos.length})` : ""}`, modeles: "Modèles", reglages: "Réglages", pages: `Pages${pages.length ? ` (${pages.length})` : ""}` }[k]}</span>
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
        </div>
      )}

      {wizard && (
        <ProjectSetup mode={wizard} settings={settings} setSettings={setSettings} photos={photos} selectionCount={selection.length}
          pagesInProject={pages.length} formatChanged={!!pages[0] && pages[0].formatId !== settings.formatId} hasProject={pages.length > 0} recent={recent} currentId={projectId} onResume={resumeProject} onDelete={removeProject}
          onImport={() => fileRef.current?.click()} onImportDir={pickFolder} onCreate={createProject}
          onSaveOnly={() => { lastSettings.current = settings; setWizard(null); notify("Réglages enregistrés, pages conservées"); }}
          onClose={() => { if (wizard === "edit" && lastSettings.current) setSettings(lastSettings.current); setWizard(null); }} mobile={mobile} />
      )}

      {clientsOpen && pages.length > 0 && (
        <ClientAlbums lib={lib} pages={pages} photos={photoMap} projectName={settings.name} albums={albums} onAlbums={setAlbums} mobile={mobile}
          onClose={() => setClientsOpen(false)} onGoToPage={(n) => { setClientsOpen(false); goTo(pages[n - 1]?.id ?? null); }} />
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
