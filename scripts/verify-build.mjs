import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const permissions = [
  "identity",
  "storage",
  "alarms",
  "notifications",
  "offscreen",
];
const scopes = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
];
const hash = (data) => createHash("sha256").update(data).digest("hex");
const equalSet = (a, b) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const requireThat = (condition, message) => {
  if (!condition) throw new Error(message);
};
export async function verifyBuild(
  directory = resolve(root, ".output/chrome-mv3"),
  expected,
) {
  const pkg =
    expected ??
    JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const publicKey =
    expected?.publicKey ??
    JSON.parse(
      await readFile(resolve(root, "config/extension-key.json"), "utf8"),
    ).publicKey;
  const manifest = JSON.parse(
    await readFile(resolve(directory, "manifest.json"), "utf8"),
  );
  requireThat(
    manifest.manifest_version === 3 && manifest.version === pkg.version,
    "Manifest version does not match the release.",
  );
  requireThat(manifest.key === publicKey, "Extension identity changed.");
  requireThat(
    equalSet(manifest.permissions ?? [], permissions),
    "Unexpected extension permissions.",
  );
  requireThat(
    equalSet(manifest.host_permissions ?? [], ["https://www.googleapis.com/*"]),
    "Unexpected network host permissions.",
  );
  for (const key of [
    "content_scripts",
    "externally_connectable",
    "sandbox",
    "web_accessible_resources",
    "optional_permissions",
    "optional_host_permissions",
    "update_url",
    "devtools_page",
    "chrome_url_overrides",
  ])
    requireThat(!manifest[key], `Unexpected manifest capability: ${key}`);
  if (manifest.oauth2) {
    requireThat(
      /^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(
        manifest.oauth2.client_id,
      ),
      "Invalid public OAuth client ID.",
    );
    requireThat(
      equalSet(manifest.oauth2.scopes ?? [], scopes),
      "Unexpected OAuth scopes.",
    );
  }
  const policy = new Map(
    (manifest.content_security_policy?.extension_pages ?? "")
      .split(";")
      .filter((s) => s.trim())
      .map((s) => {
        const [name, ...values] = s.trim().split(/\s+/);
        return [name, values];
      }),
  );
  const expectedPolicy = {
    "default-src": ["'self'"],
    "script-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'none'"],
    "connect-src": ["'self'", "https://www.googleapis.com"],
    "img-src": ["'self'", "data:"],
    "media-src": ["'self'", "blob:"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "font-src": ["'self'"],
    "frame-src": ["'none'"],
  };
  requireThat(
    policy.size === Object.keys(expectedPolicy).length,
    "Unexpected or missing CSP directives.",
  );
  for (const [name, values] of Object.entries(expectedPolicy))
    requireThat(
      equalSet(policy.get(name) ?? [], values),
      `Unsafe CSP directive: ${name}`,
    );
  const files = [];
  async function visit(path) {
    for (const name of await readdir(path)) {
      const absolute = resolve(path, name);
      const stat = await lstat(absolute);
      requireThat(!stat.isSymbolicLink(), "Release contains a symbolic link.");
      if (stat.isDirectory()) await visit(absolute);
      else {
        const name = relative(directory, absolute).replaceAll("\\", "/");
        requireThat(
          /^(manifest\.json|LICENSE\.txt|third-party-notices\.txt|(?:chunks|assets|icon|sounds)\/[A-Za-z0-9_./-]+\.(?:js|css|png|wav)|[a-z-]+\.(?:html|js))$/.test(
            name,
          ),
          `Unexpected release file: ${name}`,
        );
        const data = await readFile(absolute);
        if ([".html", ".js", ".css", ".json", ".txt"].includes(extname(name))) {
          const content = data.toString("utf8");
          requireThat(
            !/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|ya29\.[A-Za-z0-9_-]{20,}|availability-fixture-token|fixture-work-account|Fictional provider event used only by automated tests/.test(
              content,
            ),
            `Potential private material or provider fixture in ${name}`,
          );
          requireThat(
            !/(?:import\s*\(|importScripts\s*\()\s*["']https?:/.test(content),
            `Remote executable import in ${name}`,
          );
          if (name.endsWith(".html")) {
            requireThat(
              !/<script\b(?![^>]*\bsrc=)[^>]*>\s*[^<\s]/i.test(content),
              `Inline script in ${name}`,
            );
            requireThat(
              !/<(?:script|link)\b[^>]*(?:src|href)=["'](?:https?:)?\/\//i.test(
                content,
              ),
              `Remote executable/style reference in ${name}`,
            );
          }
        }
        files.push({ path: name, bytes: data.length, sha256: hash(data) });
      }
    }
  }
  await visit(directory);
  const names = new Set(files.map((f) => f.path));
  for (const path of [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    "calendar.html",
    "offscreen.html",
    "third-party-notices.txt",
    "LICENSE.txt",
  ])
    requireThat(
      typeof path === "string" && names.has(path),
      "Missing release entry point.",
    );
  requireThat(
    manifest.action.default_popup === "popup.html" &&
      manifest.options_ui.page === "options.html",
    "Unexpected extension entry point.",
  );
  const popup = await readFile(resolve(directory, "popup.html"), "utf8");
  const sizing = popup
    .slice(0, popup.indexOf("</head>"))
    .match(/<link[^>]*href=["']([^"']*popup[^"']*\.css)["']/i);
  requireThat(
    sizing && names.has(sizing[1].replace(/^\//, "")),
    "Popup document sizing stylesheet is missing from its head.",
  );
  const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
  const javascriptBytes = files
    .filter((f) => f.path.endsWith(".js"))
    .reduce((n, f) => n + f.bytes, 0);
  requireThat(
    totalBytes <= 5_000_000 && javascriptBytes <= 2_500_000,
    "Release exceeds the reviewed size budget.",
  );
  const id = [
    ...createHash("sha256")
      .update(Buffer.from(publicKey, "base64"))
      .digest()
      .subarray(0, 16),
  ]
    .map((b) => String.fromCharCode(97 + (b >> 4), 97 + (b & 15)))
    .join("");
  return {
    version: manifest.version,
    extensionId: id,
    oauthConfigured: Boolean(manifest.oauth2),
    totalBytes,
    javascriptBytes,
    permissions,
    hostPermissions: manifest.host_permissions,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const report = await verifyBuild(
    process.argv[2] ? resolve(process.argv[2]) : undefined,
  );
  console.log(
    `Verified ${report.files.length} build files · ${report.totalBytes} bytes · extension ${report.extensionId} · v${report.version}`,
  );
}
