// Mirrors dist/types/**/*.d.ts as *.d.cts so `require` consumers get CommonJS typings
// (under "type": "module", a .d.ts is treated as ESM and TS would reject it for require).
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../dist/types/", import.meta.url).pathname;

for (const entry of await readdir(root, { recursive: true })) {
  if (!entry.endsWith(".d.ts")) continue;
  const source = await readFile(join(root, entry), "utf8");
  const cjs = source.replace(/(from\s+["']\.{1,2}\/[^"']+)\.js(["'])/g, "$1.cjs$2");
  await writeFile(join(root, entry.replace(/\.d\.ts$/, ".d.cts")), cjs);
}
