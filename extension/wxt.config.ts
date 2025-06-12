// wxt.config.ts
import { defineConfig } from "wxt";
import baseViteConfig from "./vite.config";

import { mergeConfig } from "vite";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: "src",
  vite: () =>
    mergeConfig(baseViteConfig, {
      envPrefix: "VITE_",
    }),
  manifest: {
    // See https://developer.chrome.com/docs/extensions/mv3/declare_permissions/
    permissions: [
      "storage",
      "sidePanel",
      "identity",
      "notifications",
      "tabs",
      "activeTab",
    ],
    host_permissions: [
      "<all_urls>",
      "http://127.0.0.1:8000/*", // VITE_API_URL (backend)
      "http://localhost:5173/*", // VITE_APP_ORIGIN (example)
      "https://*.supabase.co/*",   // VITE_SUPABASE_URL
    ],
    oauth2: {
      client_id: "1058215711784-livolddr65rfj8a36ara0knh8ctivi3s.apps.googleusercontent.com",
      scopes: ["email", "profile", "openid"]
    }
    // options_page: "options.html",
    // action: {
    //   default_popup: "popup.html",
    // },
  },
});
