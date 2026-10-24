// Usage: npm run release -- patch|minor|major
// Bumps the version (package.json and src/core/version.ts), commits, and tags `vX.Y.Z`.
// Pushing the tag triggers .github/workflows/publish.yml.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const bump = process.argv[2];
if (!["patch", "minor", "major"].includes(bump)) {
  console.error("Usage: npm run release -- patch|minor|major");
  process.exit(1);
}

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim();
if (dirty) {
  console.error("Working tree is not clean — commit or stash your changes first.");
  process.exit(1);
}

run(`npm version ${bump} --no-git-tag-version`);
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const tag = `v${version}`;

// the version the SDK reports in every event (test/version.test.ts checks they match)
const versionFile = "src/core/version.ts";
writeFileSync(versionFile, readFileSync(versionFile, "utf8").replace(/SDK_VERSION = "[^"]*"/, `SDK_VERSION = "${version}"`));

run(`git add package.json package-lock.json ${versionFile}`);
run(`git commit -m "@trappbuild/react ${version}"`);
// annotated tag — `git push --follow-tags` only pushes annotated tags
run(`git tag -a ${tag} -m "@trappbuild/react ${version}"`);

console.log(`\nTagged ${tag}. Publish with:\n  git push --follow-tags\n`);
