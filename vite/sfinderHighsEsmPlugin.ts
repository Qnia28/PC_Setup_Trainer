import type { Plugin } from "vite";

const HIGHS_VENDOR_SUFFIX = "/vendor/sfinder-wasm/upstream/src/vendor/highs.mjs";
const COMMONJS_EXPORT_TAIL = /if\(typeof exports==="object"&&typeof module==="object"\)\{module\.exports=Module;module\.exports\.default=Module\}else if\(typeof define==="function"&&define\["amd"\]\)define\(\[\],\(\)=>Module\);/;

/**
 * highs-js ships an ESM default export plus a legacy CommonJS/AMD tail.
 * Vite's test transform supplies a read-only `module` namespace, so that tail
 * tries to assign `module.exports.default` before HiGHS is ever lazy-loaded.
 * Strip only that redundant wrapper while keeping the vendored file unchanged.
 */
export function sfinderHighsEsmPlugin(): Plugin {
  return {
    name: "sfinder-highs-esm",
    enforce: "pre",
    transform(code, id) {
      const cleanId = id.split("?", 1)[0]!.replaceAll("\\", "/");
      if (!cleanId.endsWith(HIGHS_VENDOR_SUFFIX)) return null;
      if (!COMMONJS_EXPORT_TAIL.test(code)) {
        throw new Error("The vendored highs.mjs wrapper changed; review the QniaPC ESM adapter.");
      }
      return { code: code.replace(COMMONJS_EXPORT_TAIL, ""), map: null };
    },
  };
}
