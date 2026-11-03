import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyBuild } from "./verify-build.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const report = await verifyBuild();
const zip = resolve(
  root,
  `.output/calendar-checker-${report.version}-chrome.zip`,
);
// Validate in memory: do not extract paths from an archive into the workspace.
const entries = JSON.parse(
  execFileSync(
    "python3",
    [
      "-c",
      `import hashlib,json,sys,zipfile,stat
with zipfile.ZipFile(sys.argv[1]) as z:
 names=z.namelist()
 if len(names)!=len(set(names)): raise ValueError('Duplicate ZIP entry')
 if any(stat.S_ISLNK(i.external_attr >> 16) or i.flag_bits & 1 for i in z.infolist()): raise ValueError('Symlink or encrypted ZIP entry')
 if any(n.startswith(('/', '\\\\')) or '..' in n.split('/') or '\\\\' in n for n in names): raise ValueError('Unsafe ZIP entry')
 print(json.dumps([{'path':i.filename,'bytes':i.file_size,'sha256':hashlib.sha256(z.read(i)).hexdigest()} for i in z.infolist() if not i.is_dir()],sort_keys=True))
`,
      zip,
    ],
    { encoding: "utf8" },
  ),
);
const ordered = (rows) =>
  rows
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(({ path, bytes, sha256 }) => [path, bytes, sha256]);
if (JSON.stringify(ordered(entries)) !== JSON.stringify(ordered(report.files)))
  throw new Error("ZIP does not match the verified unpacked build.");
const directory = resolve(root, `.output/releases/${report.version}`);
await mkdir(directory, { recursive: true });
await copyFile(zip, resolve(directory, basename(zip)));
const zipBytes = await readFile(zip);
const sha256 = createHash("sha256").update(zipBytes).digest("hex");
await writeFile(
  resolve(directory, `${basename(zip)}.sha256`),
  `${sha256}  ${basename(zip)}\n`,
);
await writeFile(
  resolve(directory, "release-report.json"),
  JSON.stringify(
    {
      ...report,
      archive: { file: basename(zip), bytes: zipBytes.length, sha256 },
      acceptance:
        "Local package only; see docs/STAGE-6.md for live acceptance gates.",
    },
    null,
    2,
  ) + "\n",
);
console.log(`Verified local package: ${directory}\nSHA-256: ${sha256}`);
