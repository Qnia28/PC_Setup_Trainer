import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import type { Plugin } from "vite";

const root = fileURLToPath(new URL("../vendor/sfinder-wasm/upstream/", import.meta.url));

function noticeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return ["source", "build"].includes(entry.name) ? [] : noticeFiles(path);
    return /LICENSE|COPYING|COPYRIGHT|NOTICE|\.txt$/i.test(entry.name) ? [path] : [];
  });
}

/** Ship actual licence texts with the browser binaries, not only in Git. */
export function sfinderNoticesPlugin(): Plugin {
  const text = () => [join(root, "LICENSE"), join(root, "NOTICE"), ...noticeFiles(join(root, "third_party")).sort()]
    .map((path) => `===== ${relative(root, path).replaceAll("\\", "/")} =====\n\n${readFileSync(path, "utf8")}`)
    .join("\n\n");
  return {
    name: "sfinder-distribution-notices",
    configureServer(server) {
      server.middlewares.use("/licences/sfinder.txt", (_request, response) => {
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.end(text());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "licences/sfinder.txt", source: text() });
    },
  };
}
