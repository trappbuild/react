// Verify the built public entry points: React client boundary, the React-free browser and server
// entries, the guard snippet, React Server Component resolution, and that `npm pack` ships them all.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));

const noReact = (source, entry) => {
  assert.doesNotMatch(source, /['"]use client['"]/, `the ${entry} entry must not be a client module`);
  assert.doesNotMatch(source, /['"]react(?:\/[^'"]*)?['"]/, `the ${entry} entry must not import React`);
};

for (const entry of [".", "./browser", "./server"]) {
  for (const format of ["import", "require"]) {
    const exported = manifest.exports[entry][format];
    await access(new URL(exported.types, root));
    const source = await readFile(new URL(exported.default, root), "utf8");
    if (entry === ".") {
      assert.match(source, /^['"]use client['"];/, "the React entry must retain its client boundary");
    } else {
      noReact(source, entry);
    }
    if (entry === "./server") {
      assert.doesNotMatch(source, /\b(?:window|document|navigator|location)\b/, "the server entry must not include browser helpers");
    }
    // rrweb is an optional peer: it must never be bundled, only imported on demand.
    assert.doesNotMatch(source, /rrweb-snapshot|function record\(/, `the ${entry} entry must not bundle rrweb`);
  }
}

const guard = await readFile(new URL("dist/guard.min.js", root), "utf8");
assert.match(guard, /__trapp/, "guard.min.js must expose window.__trapp");
assert.ok(guard.length < 4096, "guard.min.js must stay tiny");
assert.doesNotMatch(guard, /\bimport\b|\bexport\b/, "guard.min.js must be a self-contained IIFE");

// What `npm publish` would upload.
const pack = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: fileURLToPath(root), encoding: "utf8" }));
const shipped = new Set(pack[0].files.map((f) => f.path));
for (const required of ["dist/index.js", "dist/index.cjs", "dist/browser.js", "dist/browser.cjs", "dist/server.js", "dist/server.cjs", "dist/guard.min.js", "dist/types/index.d.ts", "dist/types/browser.d.ts", "dist/types/server.d.ts", "LICENSE", "package.json"]) {
  assert.ok(shipped.has(required), `npm pack would not include ${required}`);
}
assert.equal(manifest.license, "MIT");

const assertions = `
  const record = {
    id: "server-test", version: 1, timestamp: "2026-01-01T00:00:00.000Z", method: "custom",
    categories: { necessary: true, preferences: false, statistics: true, marketing: false },
  };
  assert.deepEqual(Object.keys(api).sort(), ["CONSENT_CATEGORIES", "parseConsentCookie"]);
  assert.deepEqual(api.CONSENT_CATEGORIES, Object.keys(record.categories));
  assert.deepEqual(api.parseConsentCookie(JSON.stringify(record)), record);
  assert.deepEqual(api.parseConsentCookie(encodeURIComponent(JSON.stringify(record))), record);
  assert.equal(api.parseConsentCookie("%invalid"), null);
`;

for (const format of ["module", "commonjs"]) {
  const imports = format === "module"
    ? 'import assert from "node:assert/strict"; import * as api from "@trappbuild/react/server";'
    : 'const assert = require("node:assert/strict"); const api = require("@trappbuild/react/server");';
  execFileSync(process.execPath, ["--conditions=react-server", `--input-type=${format}`, "--eval", imports + assertions], {
    cwd: fileURLToPath(root),
    stdio: "inherit",
  });
}

// Type-check each consumer format with NodeNext package resolution, without DOM or React types.
const options = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  lib: ["lib.es2022.d.ts"],
  types: [],
  strict: true,
  noEmit: true,
};
for (const extension of ["mts", "cts"]) {
  const consumer = fileURLToPath(new URL(`__server_types_check__.${extension}`, root));
  const source = `
    import { parseConsentCookie, CONSENT_CATEGORIES, type ConsentRecord, type ConsentCategory } from "@trappbuild/react/server";
    const record: ConsentRecord | null = parseConsentCookie(undefined);
    const category: ConsentCategory = CONSENT_CATEGORIES[0];
  `;
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile;
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => fileName === consumer
    ? ts.createSourceFile(fileName, source, languageVersion, true)
    : getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([consumer], options, host));
  assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, host));
}

console.log(`Package checks passed: ${shipped.size} files, React/browser/server entries, guard, ESM/CJS server imports and types.`);
