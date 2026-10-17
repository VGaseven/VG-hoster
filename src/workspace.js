// Private working copies for building tasks, and updating the bridge itself. Uses this computer's git sign-in.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const BRIDGE_DIR = process.env.BRIDGE_DIR || path.join(import.meta.dirname, "..");
const WORK_DIR = process.env.WORK_DIR || path.join(os.homedir(), "team-work");

function git(args, cwd, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    const c = spawn("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, windowsHide: true });
    let out = "", err = "";
    const t = setTimeout(() => c.kill(), timeout);
    c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d));
    c.on("error", reject);
    c.on("close", (code) => { clearTimeout(t); code === 0 ? resolve(out.trim()) : reject(new Error(`git ${args[0]}: ${(err || out).trim().slice(-400)}`)); });
  });
}

// "owner/name" from a GitHub remote URL.
const repoOf = (url) => url.match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1] || null;

// A fresh branch team/<id> in its own folder, based on the repo's main line, so the live bridge files are never touched.
export async function prepareWorkspace({ id, repo }) {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const bridgeRepo = repoOf(await git(["remote", "get-url", "origin"], BRIDGE_DIR));
  let src = BRIDGE_DIR, base;
  if (repo && repo.toLowerCase() !== String(bridgeRepo).toLowerCase()) {
    src = path.join(WORK_DIR, "repos", repo.replace("/", "__"));
    if (!fs.existsSync(src)) await git(["clone", `https://github.com/${repo}.git`, src], WORK_DIR, 600_000);
    base = (await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], src).catch(() => "origin/main")).replace(/^origin\//, "");
  } else {
    base = process.env.WORK_BASE_BRANCH || (await git(["rev-parse", "--abbrev-ref", "HEAD"], BRIDGE_DIR));
  }
  await git(["fetch", "origin", base], src, 300_000);
  const dir = path.join(WORK_DIR, id), branch = `team/${id}`;
  if (fs.existsSync(dir)) return { dir, branch, base, src, repo: repo || bridgeRepo };
  await git(["worktree", "add", "-B", branch, dir, `origin/${base}`], src);
  // Share the installed packages so tests can run in the copy (never committed: it's a link, and it's ignored below).
  const mods = path.join(src, "node_modules");
  if (fs.existsSync(mods) && !fs.existsSync(path.join(dir, "node_modules"))) {
    try { fs.symlinkSync(mods, path.join(dir, "node_modules"), "junction"); } catch { /* tests just won't find packages */ }
  }
  const exclude = path.join(src, ".git", "info", "exclude");
  try { if (!fs.readFileSync(exclude, "utf8").includes("\nnode_modules\n")) fs.appendFileSync(exclude, "\nnode_modules\n"); } catch { /* no exclude file */ }
  return { dir, branch, base, src, repo: repo || bridgeRepo };
}

// Commit anything left uncommitted, push the branch, and return a link to open the pull request.
export async function publishWorkspace({ dir, branch, base, repo, title }) {
  // Note: "git add -A" respects .git/info/exclude, so the shared node_modules link is never committed.
  await git(["add", "-A"], dir);
  const dirty = await git(["status", "--porcelain"], dir);
  if (dirty) await git(["-c", "user.name=Team Bridge", "-c", "user.email=team-bridge@users.noreply.github.com", "commit", "-m", title], dir);
  const ahead = Number(await git(["rev-list", "--count", `origin/${base}..HEAD`], dir));
  if (!ahead) return { changed: false };
  await git(["push", "-u", "origin", branch], dir, 300_000);
  return { changed: true, commits: ahead, url: `https://github.com/${repo}/compare/${base}...${branch}?expand=1` };
}

// ---- self-update: pull the newest bridge code and restart, so nobody has to do it by hand ----
export async function selfUpdate({ restart = process.env.SELF_UPDATE_NO_RESTART !== "1" } = {}) {
  const before = await git(["rev-parse", "--short", "HEAD"], BRIDGE_DIR);
  await git(["pull", "--ff-only"], BRIDGE_DIR, 300_000);
  const after = await git(["rev-parse", "--short", "HEAD"], BRIDGE_DIR);
  if (before === after) return { updated: false, version: after, note: "Already up to date." };
  const changed = await git(["diff", "--name-only", before, after], BRIDGE_DIR);
  try {
    // Reinstall packages when they changed, or when they've gone missing (e.g. something cleaned the folder).
    if (/package(-lock)?\.json/.test(changed) || (fs.existsSync(path.join(BRIDGE_DIR, "package.json")) && !fs.existsSync(path.join(BRIDGE_DIR, "node_modules", "express")))) {
      const npm = path.join(path.dirname(process.execPath), process.platform === "win32" ? "npm.cmd" : "npm");
      execFileSync(fs.existsSync(npm) ? npm : "npm", ["install", "--omit=dev"], { cwd: BRIDGE_DIR, stdio: "ignore", shell: process.platform === "win32" });
    }
    await trialStart(); // the new code must start and answer /health before we switch to it
  } catch (e) {
    await git(["reset", "--keep", before], BRIDGE_DIR).catch(() => {});
    return { updated: false, rolled_back: true, from: before, tried: after, error: `The new version didn't start, so I went back to ${before}: ${e.message}` };
  }
  if (restart) setTimeout(restartSelf, 1500);
  return { updated: true, from: before, to: after, changed_files: changed.split("\n").length, restarting: restart };
}

// Start the new code on a spare port for a few seconds (no Telegram, same settings) and check it answers.
function trialStart() {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const envFile = path.join(BRIDGE_DIR, ".env");
  const args = [...(fs.existsSync(envFile) ? [`--env-file=${envFile}`] : []), "server.js"];
  const child = spawn(process.execPath, args, { cwd: BRIDGE_DIR, env: { ...process.env, PORT: String(port), TELEGRAM_POLL: "0", TRIAL_START: "1" },
    stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  return new Promise((resolve, reject) => {
    const end = Date.now() + 20_000;
    const done = (ok, msg) => { clearInterval(t); child.kill(); ok ? resolve() : reject(new Error(msg)); };
    child.on("exit", (code) => done(false, `exited with code ${code}: ${err.trim().slice(-300)}`));
    const t = setInterval(async () => {
      try { if ((await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })).ok) done(true); } catch { /* not up yet */ }
      if (Date.now() > end) done(false, "it didn't answer within 20 seconds");
    }, 500);
  });
}

function restartSelf() {
  const label = process.env.XPC_SERVICE_NAME; // set when launchd (Mac login item) started the bridge
  const start = `cd "${BRIDGE_DIR}" && exec "${process.execPath}" --env-file=.env server.js >> bridge.log 2>&1`;
  const detach = (cmd, args) => spawn(cmd, args, { detached: true, stdio: "ignore", cwd: BRIDGE_DIR, windowsHide: true }).unref();
  if (process.platform === "win32") {
    detach("cmd", ["/c", "timeout /t 3 >nul & schtasks /run /tn \"Team Bridge\""]);
  } else if (process.platform === "darwin" && label && label !== "0") {
    // Ask launchd to restart the job; if that fails, start the new code ourselves once the port is free.
    detach("sh", ["-c", `sleep 2; launchctl kickstart -k "gui/$(id -u)/${label}" || { sleep 3; ${start}; }`]);
    return;
  } else {
    detach("sh", ["-c", `sleep 3; ${start}`]);
  }
  setTimeout(() => process.exit(0), 500);
}
