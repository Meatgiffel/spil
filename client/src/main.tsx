import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App.js";
import { LanguageProvider } from "./i18n/index.js";
import { SessionProvider } from "./session.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root findes ikke.");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <LanguageProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </LanguageProvider>
    </BrowserRouter>
  </StrictMode>,
);
