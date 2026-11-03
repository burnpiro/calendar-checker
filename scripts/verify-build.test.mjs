import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { verifyBuild } from "./verify-build.mjs";
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "calendar-build-audit-"));
  const directory = join(root, "build");
  try {
    await cp(resolve(".output/chrome-mv3"), directory, { recursive: true });
    await run(directory);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("build audit accepts the production bundle and rejects privilege/CSP/identity drift", async () =>
  fixture(async (directory) => {
    const report = await verifyBuild(directory);
    assert.ok(report.files.length > 10);
    assert.ok(report.javascriptBytes < 2_500_000);
    const path = join(directory, "manifest.json");
    const original = JSON.parse(await readFile(path, "utf8"));
    for (const change of [
      { permissions: [...original.permissions, "tabs"] },
      { host_permissions: ["https://*/*"] },
      { key: "different-public-key" },
      {
        content_security_policy: {
          extension_pages: "script-src 'self' 'unsafe-eval'",
        },
      },
      { externally_connectable: { matches: ["https://example.test/*"] } },
    ]) {
      await writeFile(path, JSON.stringify({ ...original, ...change }));
      await assert.rejects(verifyBuild(directory));
    }
  }));
test("build audit rejects local files, symlinks, provider fixtures and remote scripts", async () =>
  fixture(async (directory) => {
    const extra = join(directory, ".env.local");
    await writeFile(extra, "PUBLIC_ID=fixture");
    await assert.rejects(verifyBuild(directory), /Unexpected release file/);
    await unlink(extra);
    const link = join(directory, "chunks", "audit-link.js");
    await symlink(join(directory, "background.js"), link);
    await assert.rejects(verifyBuild(directory), /symbolic link/);
    await unlink(link);
    const script = join(directory, "chunks", "audit-extra.js");
    await writeFile(script, 'const account = "fixture-work-account"');
    await assert.rejects(verifyBuild(directory), /provider fixture/);
    await unlink(script);
    const html = join(directory, "options.html");
    const original = await readFile(html, "utf8");
    await writeFile(
      html,
      original.replace(
        "</head>",
        '<script src="https://example.test/remote.js"></script></head>',
      ),
    );
    await assert.rejects(verifyBuild(directory), /Remote executable/);
  }));
test("build audit enforces the native popup sizing stylesheet", async () =>
  fixture(async (directory) => {
    const path = join(directory, "popup.html");
    const original = await readFile(path, "utf8");
    await writeFile(
      path,
      original.replace(/<link[^>]*href="[^"]*popup[^"]*\.css"[^>]*>/, ""),
    );
    await assert.rejects(verifyBuild(directory), /sizing stylesheet/);
  }));
