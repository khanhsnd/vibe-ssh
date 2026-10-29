import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const script = fileURLToPath(new URL("./set-release-version.mjs", import.meta.url));
for (const eol of ["\n", "\r\n"]) {
  test(`release version handles ${JSON.stringify(eol)} and preserves dependency versions`, () => {
    const root = mkdtempSync(join(tmpdir(), "vibe-release-"));
    try {
      mkdirSync(join(root, "src-tauri"));
      for (const path of ["package.json", "package-lock.json", "src-tauri/tauri.conf.json"]) {
        writeFileSync(join(root, path), JSON.stringify({ version: "0.0.1", packages: { "": { version: "0.0.1" } } }));
      }
      const toml = '[package]\nname = "vibe-ssh"\nversion = "0.0.1"\n';
      const dependency = '[[package]]\nname = "another-crate"\nversion = "1.0.0"\n';
      const lock = dependency + '\n[[package]]\nname = "vibe-ssh"\nversion = "0.0.1"\n';
      writeFileSync(join(root, "src-tauri/Cargo.toml"), toml.replaceAll("\n", eol));
      writeFileSync(join(root, "src-tauri/Cargo.lock"), lock.replaceAll("\n", eol));
      const result = spawnSync(process.execPath, [script, "v0.0.2-beta.1", root], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      for (const path of ["package.json", "package-lock.json", "src-tauri/tauri.conf.json"]) {
        assert.equal(JSON.parse(readFileSync(join(root, path))).version, "0.0.2-beta.1");
      }
      assert.equal(JSON.parse(readFileSync(join(root, "package-lock.json"))).packages[""].version, "0.0.2-beta.1");
      assert.equal(readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8"), toml.replace('"0.0.1"', '"0.0.2-beta.1"').replaceAll("\n", eol));
      assert.equal(readFileSync(join(root, "src-tauri/Cargo.lock"), "utf8"), lock.replace('"0.0.1"', '"0.0.2-beta.1"').replaceAll("\n", eol));
      const before = readFileSync(join(root, "package.json"), "utf8");
      assert.notEqual(spawnSync(process.execPath, [script, "v01.2.3", root]).status, 0);
      assert.equal(readFileSync(join(root, "package.json"), "utf8"), before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
