import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/", // <-- WICHTIG: Restaurant läuft auf eigener Domain
});
