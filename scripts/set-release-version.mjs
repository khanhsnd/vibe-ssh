import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const tag = process.argv[2];
const number = "(?:0|[1-9][0-9]*)";
const identifier = "(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)";
const pattern = new RegExp(`^v(${number}\\.${number}\\.${number}(?:-${identifier}(?:\\.${identifier})*)?)$`);
const match = pattern.exec(tag ?? "");
if (!match) throw new Error("Expected a version tag such as v0.0.1 or v0.0.2-beta.1");
const version = match[1];

// Prepare every change before writing; keep dependency resolutions unchanged.
const changes = new Map();
for (const path of ["package.json", "package-lock.json", "src-tauri/tauri.conf.json"]) {
  const json = JSON.parse(readFileSync(root + path, "utf8"));
  json.version = version;
  if (path === "package-lock.json") json.packages[""].version = version;
  changes.set(path, JSON.stringify(json, null, 2) + "\n");
}
for (const [path, pattern] of [
  ["src-tauri/Cargo.toml", /(\[package\][\s\S]*?\nversion = ")[^"]+(")/],
  ["src-tauri/Cargo.lock", /(\[\[package\]\]\nname = "vibe-ssh"\nversion = ")[^"]+(")/],
]) {
  const source = readFileSync(root + path, "utf8");
  if (!pattern.test(source)) throw new Error(`Cannot locate application version in ${path}`);
  changes.set(path, source.replace(pattern, (_, prefix, suffix) => prefix + version + suffix));
}
for (const [path, contents] of changes) writeFileSync(root + path, contents);
console.log(`Release version: ${version}`);
