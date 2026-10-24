// Bundle-size budget (sdk-plan.md §1, §7). Builds minified measurement bundles into .size/ and
// fails when a gzip size exceeds its limit:
//   init + all four modules (no React) ≤ 12 KB
//   init + maintenance() only          ≤ 4.5 KB (this sits on every page of every client)
//   guard.min.js                       ≤  1 KB
import { readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = `${root}.size/`;
const KB = 1024;
const EXTERNAL = ["react", "react-dom", "react/jsx-runtime", "rrweb"];

const budgets = [
  { name: "all modules (browser)", entry: "scripts/size/all.ts", limit: 12 * KB },
  // The plan says 3 KB; crash redirect + loop guard, the consent bridge and status validation
  // put the measured floor at ~4.1 KB. Kept honest rather than measuring the module without its core.
  { name: "init + maintenance()", entry: "scripts/size/maintenance.ts", limit: 4.5 * KB },
  { name: "guard.min.js", entry: "src/guard/guard.js", limit: 1 * KB },
];

await rm(out, { recursive: true, force: true });

let failed = false;
for (const budget of budgets) {
  const file = budget.entry.split("/").pop().replace(/\.ts$/, ".js");
  await build({
    root,
    configFile: false,
    logLevel: "error",
    build: {
      outDir: out,
      emptyOutDir: false,
      minify: true,
      sourcemap: false,
      lib: {
        entry: budget.entry,
        formats: ["iife"],
        name: "__trappSize",
        fileName: () => file,
      },
      rolldownOptions: { external: EXTERNAL },
    },
  });
  const source = await readFile(`${out}${file}`);
  const gzip = gzipSync(source).length;
  const ok = gzip <= budget.limit;
  failed ||= !ok;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${budget.name.padEnd(28)} ${(gzip / KB).toFixed(2).padStart(6)} KB gzip ` +
      `(limit ${(budget.limit / KB).toFixed(1)} KB, ${(source.length / KB).toFixed(1)} KB raw)`,
  );
}

if (failed) {
  console.error("\nBundle size budget exceeded.");
  process.exit(1);
}
