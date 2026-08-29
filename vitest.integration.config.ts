import { defineConfig } from "vitest/config";
import { sfinderHighsEsmPlugin } from "./vite/sfinderHighsEsmPlugin";

export default defineConfig({
  plugins: [sfinderHighsEsmPlugin()],
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts", "tests/integration/**/*.test.tsx"],
  },
});
