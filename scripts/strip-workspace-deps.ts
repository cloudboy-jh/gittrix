#!/usr/bin/env bun
/**
 * The root `gittrix` package publishes as a single tarball that bundles every
 * `packages/*` dist. The subpackage package.json files declare `@gittrix/*`
 * dependencies that only exist as bun workspace links — they are NOT on the npm
 * registry and are satisfied at runtime via relative imports inside the tarball.
 *
 * When those nested package.jsons ship as-is, npm's arborist tries to resolve
 * the `@gittrix/*` deps and crashes with:
 *   TypeError: Cannot destructure property 'package' of 'node.target' as it is null.
 *
 * This script strips (prepack) and restores (postpack) those workspace-only deps
 * so the published artifact is self-contained and installs cleanly.
 *
 * Usage:
 *   bun scripts/strip-workspace-deps.ts strip
 *   bun scripts/strip-workspace-deps.ts restore
 */
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(root, "packages");
const BACKUP_SUFFIX = ".gittrix-bak";

function subpackages(): string[] {
  return readdirSync(packagesDir)
    .map((name) => join(packagesDir, name, "package.json"))
    .filter((p) => existsSync(p));
}

function strip() {
  for (const pkgPath of subpackages()) {
    const raw = readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
    };
    if (!pkg.dependencies) continue;

    const workspaceDeps = Object.keys(pkg.dependencies).filter((d) =>
      d.startsWith("@gittrix/"),
    );
    if (workspaceDeps.length === 0) continue;

    // Back up the original so postpack can restore it verbatim.
    writeFileSync(pkgPath + BACKUP_SUFFIX, raw);

    for (const dep of workspaceDeps) delete pkg.dependencies[dep];
    if (Object.keys(pkg.dependencies).length === 0) delete pkg.dependencies;

    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`stripped ${workspaceDeps.join(", ")} from ${pkgPath}`);
  }
}

function restore() {
  for (const pkgPath of subpackages()) {
    const backup = pkgPath + BACKUP_SUFFIX;
    if (!existsSync(backup)) continue;
    writeFileSync(pkgPath, readFileSync(backup, "utf8"));
    rmSync(backup);
    console.log(`restored ${pkgPath}`);
  }
}

const mode = process.argv[2];
if (mode === "strip") strip();
else if (mode === "restore") restore();
else {
  console.error("usage: strip-workspace-deps.ts <strip|restore>");
  process.exit(1);
}
