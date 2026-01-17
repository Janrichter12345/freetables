import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // WICHTIG: kein base "/partner/" wenn die App auf eigener Domain läuft
});
