import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During development, anything starting with /api is passed to the backend on port 8000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  // "npm run preview" serves the finished build, the way the live app will run.
  preview: {
    port: 4173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
