import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const output = resolve(process.argv[2] ?? "artifacts");
const stage = mkdtempSync(join(tmpdir(), "clawpanel-release-"));
try {
  mkdirSync(output, { recursive: true });
  mkdirSync(join(stage, "package", "dist"), { recursive: true });
  const bundle = await build({
    entryPoints: ["src/cli.ts"],
    outfile: join(stage, "package", "dist", "cli.js"),
    bundle: true,
    metafile: true,
    platform: "node",
    target: "node24",
    define: { __CLAWPANEL_BUNDLE_VERSION__: JSON.stringify(version) },
    format: "esm",
    legalComments: "inline",
    banner: { js: 'import { createRequire as bundleRequire } from "node:module"; const require = bundleRequire(import.meta.url);' },
  });
  writeFileSync(join(stage, "package", "package.json"), JSON.stringify({ name: "clawpanel", version, type: "module" }) + "\n");
  copyFileSync("LICENSE", join(stage, "package", "LICENSE"));
  execFileSync(process.execPath, [join(stage, "package", "dist", "cli.js"), "--version"], { stdio: "inherit" });
  const dependencies = new Set();
  for (const input of Object.keys(bundle.metafile.inputs).filter(path => path.startsWith("node_modules/"))) {
    let root = dirname(input);
    while (root !== ".") {
      const metadata = join(root, "package.json");
      if (existsSync(metadata) && JSON.parse(readFileSync(metadata, "utf8")).name) {
        dependencies.add(root);
        break;
      }
      root = dirname(root);
    }
    if (root === ".") throw new Error(`No package metadata for ${input}`);
  }
  const notices = [];
  for (const root of [...dependencies].sort()) {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const files = readdirSync(root).filter(file => /^(license|licence|notice)(\.|$)/i.test(file));
    if (!files.length) throw new Error(`Missing license notice for ${pkg.name}`);
    notices.push(`${pkg.name} ${pkg.version} (${pkg.license})\n` + files.map(file => readFileSync(join(root, file), "utf8")).join("\n"));
  }
  writeFileSync(join(stage, "package", "THIRD-PARTY-NOTICES.txt"), notices.join("\n\n---\n\n") + "\n");
  const cli = join(stage, "package", "dist", "cli.js");
  execFileSync(process.execPath, [cli, "skills", "sync"], { cwd: stage });
  execFileSync(process.execPath, [cli, "skills", "run", "analytics-dashboard"], { cwd: stage });
  const answer = execFileSync(process.execPath, [cli, "serve"], {
    cwd: stage, encoding: "utf8", timeout: 5000,
    input: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "package-smoke", version: "1" } } }) + "\n",
  });
  if (JSON.parse(answer).result?.serverInfo?.name !== "clawpanel") throw new Error("Bundled MCP smoke failed");
  const asset = `clawpanel-cli-${version}.tgz`;
  const tar = join(output, asset);
  execFileSync("tar", ["-czf", tar, "-C", stage, "package"]);
  const digest = createHash("sha256").update(readFileSync(tar)).digest("hex");
  writeFileSync(tar + ".sha256", `${digest}  ${asset}\n`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
