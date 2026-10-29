// Assistant de projet : création d'un nouveau projet, ou modification des réglages
// d'un projet en cours avec recomposition automatique.
import { useState } from "react";
import libJson from "../engine/templates.json";
import type { Library } from "../engine/types";
import { compatible, pagesFor, type Presentation } from "../engine/generate";
import { EVENT_TYPES } from "../engine/events";
import type { ProjectSettings } from "../lib/project";
import type { PhotoItem } from "../lib/photos";
import type { StoredProject } from "../lib/storage";

const lib = libJson as unknown as Library;
const PRES_LABEL: Record<Presentation, string> = { portrait: "Portrait", landscape: "Paysage", both: "Portrait et paysage" };
const plural = (n: number, w: string, ws = w + "s") => `${n} ${n > 1 ? ws : w}`;

interface Props {
  mode: "new" | "edit";
  settings: ProjectSettings;
  setSettings: (f: (s: ProjectSettings) => ProjectSettings) => void;
  photos: PhotoItem[];
  selectionCount: number;
  pagesInProject: number;
  formatChanged: boolean;
  hasProject: boolean;
  onImport: () => void;
  onImportDir: () => void;
  onCreate: () => void; // nouveau projet, ou recomposition en mode édition
  onSaveOnly: () => void; // mode édition : garder les pages, enregistrer les réglages
  onClose: () => void;
  mobile: boolean;
  recent: StoredProject[];
  currentId: string | null;
  onResume: (p: StoredProject) => void;
  onDelete: (p: StoredProject) => void;
}

function Stepper({ value, min = 1, max = 300, onChange }: { value: number; min?: number; max?: number; onChange: (n: number) => void }) {
  return (
    <div className="stepper">
      <button onClick={() => onChange(Math.max(min, value - 1))} aria-label="Moins">−</button>
      <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, +e.target.value || min)))} />
      <button onClick={() => onChange(Math.min(max, value + 1))} aria-label="Plus">＋</button>
    </div>
  );
}

export function ProjectSetup(p: Props) {
  const { settings, setSettings, mode } = p;
  const [delAsk, setDelAsk] = useState<string | null>(null);
  const [showCats, setShowCats] = useState(settings.eventType !== "all" || settings.categories.length > 0);
  const set = <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  const fmt = lib.formats.find((f) => f.id === settings.formatId)!;
  const square = Math.abs(fmt.mm[0] - fmt.mm[1]) < 1;
  const P = Math.max(1, settings.pageCount || 1), n = p.selectionCount;
  const cats = settings.categories;
  const nTpl = compatible(lib, settings.formatId, cats, square || fmt.spread ? "all" : settings.pres === "both" ? "all" : settings.pres).length;
  const others = p.recent.filter((r) => r.id !== p.currentId);

  const pickEvent = (id: string) => {
    const ev = EVENT_TYPES.find((e) => e.id === id)!;
    setSettings((s) => ({ ...s, eventType: id, categories: ev.categories.slice(), perPage: ev.perPage ? { min: ev.perPage[0], max: ev.perPage[1] } : s.perPage }));
    setShowCats(true);
  };
  const toggleCat = (id: string) => setSettings((s) => {
    const has = s.categories.includes(id);
    return { ...s, categories: has ? s.categories.filter((c) => c !== id) : [...s.categories, id] };
  });

  // résumé et conseils
  let note = "";
  let suggest: number | null = null;
  if (settings.mode === "auto") {
    if (!n) note = "Importez vos photos pour lancer la mise en page automatique.";
    else if (n < P) note = "Moins de photos que de pages : certaines photos seront répétées. PhotoBook vous le signalera.";
    else {
      const per = n / P;
      note = `${n} photos sur ${plural(P, "page")} : environ ${Math.floor(per)}${Math.ceil(per) !== Math.floor(per) ? ` à ${Math.ceil(per)}` : ""} photo${Math.ceil(per) > 1 ? "s" : ""} par page.`;
    }
    if (n && settings.perPage) {
      const r = pagesFor(n, settings.perPage);
      if (P < r.min || P > r.max) { suggest = Math.min(Math.max(P, r.min), r.max); note += ` Avec ${settings.perPage.min === settings.perPage.max ? settings.perPage.min : `${settings.perPage.min} à ${settings.perPage.max}`} photos par page, il faut ${r.min === r.max ? r.min : `${r.min} à ${r.max}`} pages.`; }
    }
  } else note = `${plural(P, "page", "pages")} préparée${P > 1 ? "s" : ""} avec des modèles, à remplir en plaçant vos photos.`;

  const editing = mode === "edit";
  return (
    <div className="overlay" onClick={p.hasProject ? p.onClose : undefined}>
      <div className="sheet glass wizard" onClick={(e) => e.stopPropagation()}>
        <div className="row between sheet-head">
          <div><h3>{editing ? "Réglages du projet" : "Nouveau projet"}</h3>
            <p className="muted small">{editing ? "Modifiez les paramètres de base, puis recomposez automatiquement." : "Définissez votre projet, PhotoBook s'occupe du reste."}</p></div>
          {p.hasProject && <button className="btn ghost" onClick={p.onClose}>Fermer</button>}
        </div>
        <div className="wiz-body">
          {!editing && others.length > 0 && (
            <section>
              <h4>Reprendre un projet</h4>
              <div className="recent">
                {others.slice(0, 6).map((r) => (
                  <div key={r.id} className="recent-item">
                    <div className="grow"><b>{r.name}</b><span className="small muted">{plural(r.pages.length, "page")} · {plural(r.photoIds.length, "photo")} · modifié le {new Date(r.updatedAt).toLocaleDateString("fr-FR")} à {new Date(r.updatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span></div>
                    {delAsk === r.id
                      ? <><button className="btn sm danger" onClick={() => { p.onDelete(r); setDelAsk(null); }}>Supprimer</button><button className="btn sm ghost" onClick={() => setDelAsk(null)}>Annuler</button></>
                      : <><button className="btn sm primary" onClick={() => p.onResume(r)}>Reprendre</button><button className="btn sm ghost" title="Supprimer" onClick={() => setDelAsk(r.id)}>✕</button></>}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h4><span className="num">1</span> Photos</h4>
            <div className="row gap wrap">
              <button className="btn primary" onClick={p.onImport}>{p.photos.length ? "Ajouter des photos" : "Importer des photos"}</button>
              <button className="btn" onClick={p.onImportDir}>Importer un dossier</button>
              <span className="small">{p.photos.length ? `${p.photos.length} importée${p.photos.length > 1 ? "s" : ""} · ${n} sélectionnée${n > 1 ? "s" : ""}` : "Aucune photo pour l'instant"}</span>
            </div>
            {p.photos.length > 0 && <div className="wiz-thumbs">{p.photos.slice(0, p.mobile ? 8 : 14).map((ph) => <img key={ph.id} src={ph.thumbUrl} alt="" />)}{p.photos.length > (p.mobile ? 8 : 14) && <span>+{p.photos.length - (p.mobile ? 8 : 14)}</span>}</div>}
            {editing && <p className="hint">Pour choisir les photos à utiliser, cochez-les dans l'onglet Photos. La recomposition utilise les photos sélectionnées.</p>}
          </section>

          <section>
            <h4><span className="num">2</span> Type de séance ou d'événement</h4>
            <div className="events">
              {EVENT_TYPES.map((ev) => (
                <button key={ev.id} className={`event ${settings.eventType === ev.id ? "on" : ""}`} onClick={() => pickEvent(ev.id)}>
                  <span className="ev-ico">{ev.icon}</span><span>{ev.name}</span>
                </button>
              ))}
            </div>
            <button className="link cats-toggle" onClick={() => setShowCats((v) => !v)}>
              {showCats ? "Masquer les catégories" : "Choisir les catégories de collage"} · {cats.length ? plural(cats.length, "catégorie retenue", "catégories retenues") : "toutes les catégories"}
            </button>
            {showCats && (
              <div className="cat-chips">
                <button className={`chip-btn ${cats.length === 0 ? "on" : ""}`} onClick={() => setSettings((s) => ({ ...s, categories: [], eventType: "all" }))}>Toutes</button>
                {lib.categories.map((c) => (
                  <button key={c.id} className={`chip-btn ${cats.includes(c.id) ? "on" : ""}`} onClick={() => toggleCat(c.id)}>{cats.includes(c.id) ? "✓ " : ""}{c.name}</button>
                ))}
              </div>
            )}
          </section>

          <section>
            <h4><span className="num">3</span> Pages</h4>
            <label className="field name-field"><span>Nom du projet</span>
              <input type="text" value={settings.name} onChange={(e) => set("name", e.target.value)} placeholder="Mariage Aïcha & Koffi" />
            </label>
            <div className="wiz-grid">
              <label className="field"><span>Nombre de pages</span><Stepper value={settings.pageCount} onChange={(v) => set("pageCount", v)} /></label>
              <label className="field"><span>Format</span>
                <select value={settings.formatId} onChange={(e) => set("formatId", e.target.value)}>
                  {lib.formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>
              <div className="field"><span>Photos par page</span>
                <div className="seg two compact">
                  <button className={!settings.perPage ? "on" : ""} onClick={() => set("perPage", null)}>Auto</button>
                  <button className={settings.perPage ? "on" : ""} onClick={() => set("perPage", settings.perPage ?? { min: 3, max: 6 })}>Choisir</button>
                </div>
              </div>
            </div>
            {settings.perPage && (
              <div className="perpage">
                <label className="field"><span>Minimum</span><Stepper value={settings.perPage.min} max={48} onChange={(v) => set("perPage", { min: v, max: Math.max(v, settings.perPage!.max) })} /></label>
                <label className="field"><span>Maximum</span><Stepper value={settings.perPage.max} max={48} onChange={(v) => set("perPage", { min: Math.min(v, settings.perPage!.min), max: v })} /></label>
                <p className="hint">Pour la même quantité de photos sur chaque page, mettez le même chiffre aux deux.</p>
              </div>
            )}
            <div className="field"><span>Présentation</span></div>
            <div className="seg">
              {(["portrait", "landscape", "both"] as Presentation[]).map((pr) => (
                <button key={pr} className={settings.pres === pr ? "on" : ""} disabled={square || fmt.spread} onClick={() => set("pres", pr)}>
                  <i className={`ico ${pr}`} />{PRES_LABEL[pr]}
                </button>
              ))}
            </div>
            {(square || fmt.spread) && <p className="hint">{square ? "Format carré : la présentation ne s'applique pas." : "Double page d'album : toujours en paysage."}</p>}
          </section>

          <section>
            <h4><span className="num">4</span> Mise en page</h4>
            <div className="choices">
              <button className={`choice ${settings.mode === "auto" ? "on" : ""}`} onClick={() => set("mode", "auto")}>
                <b>Automatique</b><span>PhotoBook répartit vos photos sur les {plural(P, "page")} avec des modèles variés. Vous retouchez ensuite page par page.</span>
              </button>
              <button className={`choice ${settings.mode === "manual" ? "on" : ""}`} onClick={() => set("mode", "manual")}>
                <b>Manuelle</b><span>PhotoBook prépare les pages avec des modèles. Vous placez vous-même les photos.</span>
              </button>
            </div>
            <p className={`summary ${(settings.mode === "auto" && n && n < P) || suggest ? "warn" : ""}`}>
              {note} <span className="muted">· {nTpl} modèles disponibles</span>
              {suggest != null && <button className="link" onClick={() => set("pageCount", suggest!)}>Passer à {plural(suggest, "page")}</button>}
            </p>
          </section>
        </div>
        <div className="wiz-foot">
          {editing && <span className="small muted grow">{p.pagesInProject} pages actuelles. La recomposition les remplace ; vous pourrez annuler.</span>}
          {editing && <button className="btn" disabled={p.formatChanged} title={p.formatChanged ? "Le format a changé : il faut recomposer les pages" : ""} onClick={p.onSaveOnly}>Garder mes pages</button>}
          <button className="btn primary big" disabled={settings.mode === "auto" && !n} onClick={p.onCreate}>
            {editing ? (settings.mode === "auto" ? `Recomposer ${plural(P, "page")}` : `Recréer ${plural(P, "page")}`) : settings.mode === "auto" ? `Composer ${plural(P, "page")}` : `Créer ${plural(P, "page")}`}
          </button>
        </div>
      </div>
    </div>
  );
}
