import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Polices embarquées (fonctionnent hors connexion, utilisées aussi dans les pages exportées)
import "@fontsource/montserrat/latin-400.css";
import "@fontsource/montserrat/latin-600.css";
import "@fontsource/montserrat/latin-700.css";
import "@fontsource/playfair-display/latin-400.css";
import "@fontsource/playfair-display/latin-700.css";
import "@fontsource/great-vibes/latin-400.css";
import "@fontsource/anton/latin-400.css";
import "./index.css";
import App from "./App.tsx";
import { ClientViewer } from "./components/ClientViewer";

// Lien client : #album=JETON → visionneuse seule (aucun accès au reste de l'application)
const m = location.hash.match(/^#album=([A-Za-z0-9_-]{16,})$/);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {m ? <ClientViewer token={m[1]} /> : <App />}
  </StrictMode>,
);
