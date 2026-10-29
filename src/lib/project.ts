// Réglages d'un projet PhotoBook (enregistrés avec le projet).
import type { Presentation, PerPage } from "../engine/generate";

export interface ProjectSettings {
  name: string;
  pageCount: number;
  formatId: string;
  pres: Presentation;
  eventType: string; // voir engine/events.ts
  categories: string[]; // vide = toutes les catégories
  perPage: PerPage | null; // null = automatique
  mode: "auto" | "manual";
  /** @deprecated ancienne version (une seule catégorie) */
  category?: string;
}

export const today = () => new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

export const defaultSettings = (): ProjectSettings => ({
  name: `Projet du ${today()}`, pageCount: 10, formatId: "A4", pres: "both",
  eventType: "all", categories: [], perPage: null, mode: "auto",
});

/** Reprend les projets enregistrés par les versions précédentes. */
export function migrateSettings(s: Partial<ProjectSettings> | undefined): ProjectSettings {
  const d = defaultSettings();
  const m = { ...d, ...(s ?? {}) } as ProjectSettings;
  if (!Array.isArray(m.categories)) m.categories = s?.category && s.category !== "all" ? [s.category] : [];
  if (m.perPage === undefined) m.perPage = null;
  if (!m.eventType) m.eventType = "all";
  return m;
}
