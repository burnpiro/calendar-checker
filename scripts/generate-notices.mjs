import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const paths = [
  ...new Set(
    execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], {
      cwd: root,
      encoding: "utf8",
    })
      .trim()
      .split("\n"),
  ),
].filter((p) => p !== root.replace(/\/$/, ""));
const rows = [];
for (const path of paths) {
  const pkg = JSON.parse(await readFile(resolve(path, "package.json"), "utf8"));
  const files = (await readdir(path))
    .filter((name) => /^(licen[sc]e|notice|copyright)(?:[.-]|$)/i.test(name))
    .sort();
  const notices = [];
  for (const name of files)
    notices.push(await readFile(resolve(path, name), "utf8"));
  if (
    !notices.length &&
    pkg.name === "react-remove-scroll-bar" &&
    pkg.version === "2.3.8"
  )
    notices.push(
      await readFile(
        resolve(root, "docs/licenses/react-remove-scroll-bar.LICENSE.txt"),
        "utf8",
      ),
    );
  if (!notices.length)
    throw new Error(
      `Missing upstream license text for ${pkg.name}@${pkg.version}.`,
    );
  rows.push({
    name: pkg.name,
    text: `${pkg.name}@${pkg.version}\nLicense: ${pkg.license ?? "See upstream notice"}\n\n${notices.map((text) => text.replaceAll("\r\n", "\n").trimEnd()).join("\n\n")}`,
  });
}
rows.sort((a, b) => a.name.localeCompare(b.name));
await writeFile(
  resolve(root, "public/third-party-notices.txt"),
  `Calendar Checker — third-party runtime notices\nGenerated from the installed production dependency tree. Development test tools are not bundled.\nThe react-remove-scroll-bar fallback notice is from its upstream master/LICENSE, retrieved 2026-11-03.\n\n${rows.map((r) => r.text).join("\n\n" + "=".repeat(72) + "\n\n")}\n`,
);
console.log(`Generated runtime notices for ${rows.length} packages.`);
