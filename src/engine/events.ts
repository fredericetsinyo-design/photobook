// Types d'événements ou de séances : chacun présélectionne les catégories de modèles les plus adaptées.
// Le photographe peut ensuite cocher ou décocher librement chaque catégorie.
export interface EventType { id: string; name: string; icon: string; categories: string[]; perPage?: [number, number] }

export const EVENT_TYPES: EventType[] = [
  { id: "all", name: "Tous les modèles", icon: "✦", categories: [] },
  { id: "wedding", name: "Mariage", icon: "💍", categories: ["wedding", "album", "couple", "editorial", "minimal", "classic"], perPage: [2, 6] },
  { id: "couple", name: "Couple & fiançailles", icon: "♡", categories: ["couple", "minimal", "editorial", "modern", "shapes"], perPage: [1, 5] },
  { id: "family", name: "Famille", icon: "⌂", categories: ["family", "classic", "creative", "poster", "scrapbook"], perPage: [3, 8] },
  { id: "maternity", name: "Grossesse & naissance", icon: "✿", categories: ["family", "minimal", "album", "couple", "portrait"], perPage: [1, 5] },
  { id: "portrait", name: "Portrait & studio", icon: "◐", categories: ["portrait", "minimal", "editorial", "classic"], perPage: [1, 4] },
  { id: "school", name: "Scolaire & fin d'année", icon: "✎", categories: ["school", "classic", "proof", "poster"], perPage: [4, 12] },
  { id: "party", name: "Cérémonie & fête", icon: "✶", categories: ["party", "wedding", "classic", "modern", "creative"], perPage: [3, 8] },
  { id: "church", name: "Église & culte", icon: "✝", categories: ["party", "editorial", "classic", "modern", "poster"], perPage: [3, 8] },
  { id: "corporate", name: "Entreprise & événement pro", icon: "▣", categories: ["editorial", "modern", "classic", "minimal", "poster"], perPage: [2, 6] },
  { id: "social", name: "Réseaux sociaux", icon: "▯", categories: ["story", "minimal", "couple"], perPage: [2, 9] },
  { id: "proof", name: "Planche de sélection client", icon: "▦", categories: ["proof"], perPage: [12, 35] },
];
