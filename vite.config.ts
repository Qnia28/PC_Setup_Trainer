import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { setupTestVitePlugin } from "./vite/setupTestVitePlugin";

function sfinderRoutePlugin() {
  const installRewrite = (server: { middlewares: { use: (handler: (request: { url?: string }, response: unknown, next: () => void) => void) => void } }) => {
    server.middlewares.use((request, _response, next) => {
      const pathname = request.url?.split("?", 1)[0];
      if (pathname === "/sfinder" || pathname?.startsWith("/sfinder/")) request.url = "/sfinder.html";
      next();
    });
  };
  return {
    name: "sfinder-command-routes",
    configureServer: installRewrite,
    configurePreviewServer: installRewrite,
  };
}

export default defineConfig({
  plugins: [sfinderRoutePlugin(), setupTestVitePlugin(), react()],
  // Limit dependency discovery to the declared HTML entry points.
  optimizeDeps: {
    entries: ["index.html", "replay.html", "licence.html", "solver.html", "sfinder.html", "setup_test.html"],
  },
  build: {
    rollupOptions: {
      input: {
        game: "index.html",
        replay: "replay.html",
        licence: "licence.html",
        solver: "solver.html",
        sfinder: "sfinder.html",
        setupTest: "setup_test.html",
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
