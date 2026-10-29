# PhotoBook — Fredy Photography

Application de création automatique de planches photo, de pages d'album et de collages prêts à imprimer.
Un seul code source produit trois versions : **Web**, **PWA installable** et **application de bureau** (Windows, macOS).

Version : 0.3.0

---

## 1. Les trois versions

| | Web (navigateur) | PWA installée | Bureau (Tauri) |
|---|---|---|---|
| Installation | Aucune : une adresse Web | « Installer l'application » depuis Chrome ou Edge (ordinateur, Android) ; « Sur l'écran d'accueil » sur iPhone | Installateur Windows `.exe` / `.msi`, macOS `.dmg` |
| Hors connexion | Non | Oui, après la première ouverture | Oui, toujours |
| Import | Fichiers, dossier entier | Fichiers, dossier entier | Fichiers, dossier entier avec sous-dossiers (boîte de dialogue Windows / macOS) |
| Export | Téléchargement | Téléchargement | Enregistrement direct à l'endroit choisi (« Enregistrer sous ») |
| Sauvegarde des projets | Dans le navigateur (IndexedDB) | Idem, propre à l'application installée | Dans le profil de l'application |
| Mises à jour | Automatiques | Bandeau « Nouvelle version — Mettre à jour » | Nouvel installateur (mise à jour automatique prévue plus tard) |
| Grands formats (poster 40 × 50, double page) | Selon la mémoire du navigateur | Idem | Meilleure tenue (mémoire de l'ordinateur) |

Dans les trois versions, les photos restent sur l'appareil : rien n'est envoyé sur un serveur.

---

## 2. Installation pour le développement

Prérequis : Node.js 22, et pour la version bureau Rust (https://rustup.rs) plus, sous Windows, « Microsoft C++ Build Tools » et WebView2 (déjà présent sur Windows 10 et 11).

```bash
npm install          # dépendances
npm run dev          # version Web en développement : http://localhost:5173
npm run build        # version Web + PWA de production dans dist/
npm run preview      # tester dist/ (service worker actif) : http://localhost:4173
npm run desktop:dev  # application de bureau en développement
npm run desktop:build  # installateurs de bureau pour le système en cours
```

---

## 3. Publier la version Web / PWA

Le dossier `dist/` est un site statique. Il peut être hébergé tel quel sur Netlify, Vercel, GitHub Pages ou tout hébergeur HTTPS.
Le HTTPS est indispensable pour l'installation et le mode hors connexion.

Netlify : glisser-déposer le dossier `dist/` sur https://app.netlify.com/drop, ou relier le dépôt avec
la commande de build `npm run build` et le dossier de publication `dist`.

## 4. Produire l'installateur Windows (et macOS)

Les installateurs se construisent sur de vraies machines Windows et macOS grâce à GitHub Actions
(fichier `.github/workflows/desktop.yml`) :

1. Envoyer le projet dans un dépôt GitHub (privé de préférence).
2. Créer une étiquette de version : `git tag v0.3.0 && git push --tags`, ou lancer le flux « Installateurs bureau » depuis l'onglet **Actions**.
3. Après 10 à 15 minutes, une **version brouillon** apparaît dans l'onglet **Releases**, avec `PhotoBook_0.3.0_x64-setup.exe` (Windows),
   `PhotoBook_0.3.0_x64_fr-FR.msi` (Windows, déploiement en entreprise) et `PhotoBook_0.3.0_universal.dmg` (macOS).

Sur un PC Windows avec Rust installé, `npm run desktop:build` produit les mêmes fichiers dans `src-tauri/target/release/bundle/`.

**Signature** : sans certificat de signature de code, Windows SmartScreen affiche « Éditeur inconnu » au premier lancement
(« Informations complémentaires » → « Exécuter quand même »). Un certificat (≈ 100 à 300 € par an) supprime cet avertissement ;
il s'ajoute ensuite dans les secrets GitHub sans changer le code.

## 5. Mettre à jour

1. Modifier le code, puis changer le numéro de version dans `package.json`, `src-tauri/tauri.conf.json` et `src-tauri/Cargo.toml`.
2. Web / PWA : `npm run build` puis republier `dist/`. Les utilisateurs voient « Une nouvelle version de PhotoBook est prête — Mettre à jour ».
3. Bureau : `git tag vX.Y.Z && git push --tags`, puis publier la version brouillon créée par GitHub Actions.

Les projets enregistrés sont conservés d'une version à l'autre.

---

## 6. Architecture

```
src/
  engine/              moteur de composition, indépendant de l'interface
    templates.json     bibliothèque de 65 modèles (schéma v2), séparée du code
    layout.ts          emplacements en fractions de page (indépendants de la résolution)
    generate.ts        modèles compatibles, affectation des photos, variantes, répartition sur N pages, doublons
    render.ts          rendu Canvas commun à l'aperçu et à l'export
  lib/
    photos.ts          import : original conservé, vignette 1600 px pour l'aperçu, décodage pleine résolution à l'export
    export.ts          PNG (DPI inscrit), PDF par page, PDF multipage, ZIP
    pdf.ts             écrivain PDF (dimensions exactes, image sans perte ou JPEG 95 %)
    storage.ts         sauvegarde locale des projets et des photos (IndexedDB)
    platform.ts        PWA (service worker, installation, hors ligne) et bureau (dialogues natifs, disque)
  components/PageCanvas.tsx   aperçu interactif d'une page (sélection, recadrage, glisser-déposer)
  App.tsx              écrans : assistant de projet, atelier, propositions, export
src-tauri/             application de bureau (Rust + Tauri 2)
tools/                 scripts de conception de la bibliothèque de modèles (Python)
```

Trois niveaux séparés, comme prévu dans le cahier des charges :
1. **aperçu léger** (vignettes 1600 px, fluide) ;
2. **calcul de mise en page** en millimètres, sans lien avec la résolution ;
3. **rendu final** à 150 ou 300 DPI depuis les fichiers originaux, une photo décodée à la fois.

### Ajouter un modèle
Ajouter une entrée dans `src/engine/templates.json` (voir le champ `notes` en tête du fichier pour le format), puis `npm run build`.
Aucun autre fichier à modifier.

## 7. Tests réalisés (version 0.3.0)

- Export A4 300 DPI : PNG de 2480 × 3508 px, 300 DPI inscrits ; pages PDF de 210 × 297 mm exactement ; ZIP complet (PNG, PDF par page, PDF multipage).
- Netteté : une photo de 6000 × 4000 px reste nette à l'export (décodage depuis l'original, pas depuis l'aperçu).
- Répartition : 12 photos / 12 pages, 23 / 7, 40 / 8, 50 / 3, 66 / 10 → aucune photo oubliée ni répétée ; alternance portrait/paysage respectée.
- Doublons : signalés (bandeau, pages, cadres, liste des photos) sans blocage.
- Hors connexion : rechargement sans réseau, polices, import, composition, sauvegarde, export PDF et reprise de projet fonctionnent.
- Reprise : après rechargement, le projet se rouvre avec ses pages et ses photos.

## 8. Évolutions prévues

Détection de visages pour le recadrage automatique · modèles personnalisés enregistrés par l'utilisateur · logo et identité visuelle du studio ·
synchronisation facultative entre appareils (avec gestion des conflits) · mise à jour automatique de l'application de bureau ·
insertion des JPEG d'origine dans le PDF (sans recalcul) · pack de décorations (papier, feuillages, textures).
