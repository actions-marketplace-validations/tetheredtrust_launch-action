// Tethered Trust Launch: the release-day steps every agent-tool developer repeats, in one step that runs with your
// own credentials in your own workflow. Nothing here needs a Tethered Trust account; checks beyond the free daily
// allowance can use an API key with credits.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const env = process.env;
const API = (env.TT_API_BASE || "https://tetheredtrust.com").replace(/\/+$/, "");
const lines = (s) => String(s || "").split("\n").map((x) => x.trim()).filter(Boolean);
const rows = [];
let worst = "pass";
const rank = { pass: 0, warn: 1, skip: 0, fail: 2 };
const note = (step, result, detail) => {
  rows.push({ step, result, detail: String(detail || "").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 400) });
  if (rank[result] > rank[worst]) worst = result;
  const icon = { pass: "OK", warn: "WARN", fail: "FAIL", skip: "SKIP" }[result];
  console.log(`[${icon}] ${step}: ${detail}`);
};
const output = (k, v) => env.GITHUB_OUTPUT && appendFileSync(env.GITHUB_OUTPUT, `${k}=${v}\n`);

const ref = env.GITHUB_REF_NAME || "";
const version = (env.TT_VERSION || (env.GITHUB_REF_TYPE === "tag" ? ref : "")).replace(/^v(?=\d)/, "");

async function tt(path, body) {
  const headers = { "Content-Type": "application/json", Accept: "application/json", "X-TT-Client": "launch-action" };
  if (env.TT_API_KEY) headers.Authorization = `Bearer ${env.TT_API_KEY}`;
  const res = await fetch(`${API}${path}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const allowanceUsed = (r) => r.status === 402 ? "Free daily allowance used. Add api-key (a Tethered Trust key with credits) to keep this check on every release." : null;

// 1. Does the server work?
if (env.TT_URL) {
  try {
    const r = await tt("/v1/verify/mcp", { url: env.TT_URL });
    if (allowanceUsed(r)) note("MCP server works", "skip", allowanceUsed(r));
    else if (r.status !== 200) note("MCP server works", "warn", `Check couldn't run (HTTP ${r.status}): ${r.data?.error || ""}`);
    else {
      const d = r.data;
      const failed = (d.checks || []).filter((c) => c.result === "fail").map((c) => `${c.type}: ${c.detail}`);
      note("MCP server works", d.result === "pass" ? "pass" : d.result === "fail" ? "fail" : "warn", d.result === "pass" ? `${d.summary || "All checks passed."}` : failed.join("; ") || d.summary);
    }
  } catch (e) { note("MCP server works", "warn", `Check couldn't run: ${e.message}`); }
}

// 2. Official MCP Registry.
let published = false;
const sjPath = env.TT_SERVER_JSON || "server.json";
const mode = (env.TT_REGISTRY || "github-oidc").toLowerCase();
if (mode === "none") note("MCP Registry", "skip", "registry: none");
else if (!existsSync(sjPath)) note("MCP Registry", "skip", `No ${sjPath} in the repo. Create one (see https://tetheredtrust.com/launch/playbook) or set registry: none.`);
else if (!version) note("MCP Registry", "warn", "No version: run on a release tag or set version.");
else {
  try {
    const sj = JSON.parse(readFileSync(sjPath, "utf8"));
    sj.version = version;
    for (const p of sj.packages || []) if (p.version) p.version = version;
    writeFileSync(sjPath, JSON.stringify(sj, null, 2) + "\n");
    if (mode === "github-oidc" && !String(sj.name || "").toLowerCase().startsWith(`io.github.${String(env.GITHUB_REPOSITORY_OWNER || "").toLowerCase()}/`)) throw new Error(`registry: github-oidc can only publish io.github.${env.GITHUB_REPOSITORY_OWNER}/* names; ${sj.name} needs registry: dns or http with your domain key.`);
    if ((mode === "dns" || mode === "http") && (!env.TT_REGISTRY_DOMAIN || !env.TT_REGISTRY_KEY)) throw new Error(`registry: ${mode} needs registry-domain and registry-private-key.`);
    const dir = mkdtempSync(join(tmpdir(), "mcp-publisher-"));
    const os = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
    const arch = process.arch === "arm64" ? "arm64" : "amd64";
    execFileSync("bash", ["-c", `curl -fsSL "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_${os}_${arch}.tar.gz" | tar xz -C "${dir}" mcp-publisher`], { stdio: "inherit" });
    const bin = join(dir, "mcp-publisher");
    const login = mode === "github-oidc" ? ["login", "github-oidc"] : ["login", mode, "--domain", env.TT_REGISTRY_DOMAIN, "--private-key", env.TT_REGISTRY_KEY];
    execFileSync(bin, login, { cwd: dir, stdio: ["ignore", "ignore", "inherit"] });
    // mcp-publisher reads ./server.json: run it from a folder holding this release's copy.
    writeFileSync(join(dir, "server.json"), JSON.stringify(sj, null, 2) + "\n");
    const out = execFileSync(bin, ["publish"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    published = true;
    note("MCP Registry", "pass", `Published ${sj.name} ${version}. Directories that import the registry (Glama, PulseMCP and others) pick it up within days. ${out.trim().split("\n").pop()}`);
  } catch (e) {
    const msg = String(e.stderr || e.message || e);
    if (/duplicate version|already exists/i.test(msg)) note("MCP Registry", "pass", `${version} is already published.`);
    else note("MCP Registry", "fail", msg.trim().split("\n").slice(-3).join(" "));
  }
}
output("registry-published", published);

// 3. Will agents' payments go through?
for (const line of lines(env.TT_X402)) {
  const [m, u] = /^(GET|POST)\s+/i.test(line) ? line.split(/\s+/, 2) : ["GET", line];
  try {
    const r = await tt("/v1/x402/check", { url: u, method: m.toUpperCase() });
    if (allowanceUsed(r)) { note(`x402 ${u}`, "skip", allowanceUsed(r)); continue; }
    if (r.status !== 200) { note(`x402 ${u}`, "warn", `Check couldn't run (HTTP ${r.status}): ${r.data?.error || ""}`); continue; }
    note(`x402 ${u}`, r.data.result, r.data.result === "pass" ? r.data.summary : (r.data.fixes || []).join("; ") || r.data.summary);
  } catch (e) { note(`x402 ${u}`, "warn", `Check couldn't run: ${e.message}`); }
}

// 4. Did the packages reach npm and PyPI?
if (env.TT_NPM && version) {
  const r = await fetch(`https://registry.npmjs.org/${encodeURIComponent(env.TT_NPM).replace("%40", "@")}/${version}`).catch(() => null);
  note(`npm ${env.TT_NPM}`, r?.ok ? "pass" : "warn", r?.ok ? `${version} is on npm.` : `${version} isn't on npm yet (publish runs before this step?).`);
}
if (env.TT_PYPI && version) {
  const r = await fetch(`https://pypi.org/pypi/${encodeURIComponent(env.TT_PYPI)}/${version}/json`).catch(() => null);
  note(`PyPI ${env.TT_PYPI}`, r?.ok ? "pass" : "warn", r?.ok ? `${version} is on PyPI.` : `${version} isn't on PyPI yet.`);
}

// 5. Tell search engines.
const urls = lines(env.TT_INDEXNOW_URLS);
if (env.TT_INDEXNOW_KEY && urls.length) {
  try {
    const host = new URL(urls[0]).host;
    const r = await fetch("https://api.indexnow.org/indexnow", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ host, key: env.TT_INDEXNOW_KEY, keyLocation: `https://${host}/${env.TT_INDEXNOW_KEY}.txt`, urlList: urls.slice(0, 1000) }) });
    note("IndexNow", r.status === 200 || r.status === 202 ? "pass" : "warn", `HTTP ${r.status} for ${urls.length} URL${urls.length === 1 ? "" : "s"}${r.status === 403 ? " (key file not found at keyLocation)" : ""}.`);
  } catch (e) { note("IndexNow", "warn", e.message); }
}

// 6. Where is it listed? (report only)
if (env.TT_URL) {
  try {
    const r = await tt("/v1/launch/check", { url: env.TT_URL, ...(env.TT_NPM ? { npm: env.TT_NPM } : {}), ...(env.TT_PYPI ? { pypi: env.TT_PYPI } : {}) });
    if (r.status === 200) {
      const missing = (r.data.checks || []).filter((c) => ["missing", "stale", "broken", "blocking"].includes(c.status)).map((c) => `${c.where}: ${c.status}`);
      note("Listings", missing.length ? "warn" : "pass", missing.length ? missing.join("; ") : `Found in ${r.data.score?.found} of ${r.data.score?.of} places.`);
    } else if (allowanceUsed(r)) note("Listings", "skip", allowanceUsed(r));
  } catch {}
}

output("result", worst);
if (env.GITHUB_STEP_SUMMARY) {
  appendFileSync(env.GITHUB_STEP_SUMMARY, `## Launch${version ? ` ${version}` : ""}: ${worst}\n\n| Step | Result | Detail |\n|---|---|---|\n${rows.map((r) => `| ${r.step} | ${r.result} | ${r.detail} |`).join("\n")}\n\nKeep it working between releases: [Launch Plan](${API}/launch/plan) · [playbook](${API}/launch/playbook)\n`);
}
if (worst === "fail" && (env.TT_FAIL_ON || "broken") !== "never") process.exit(1);
