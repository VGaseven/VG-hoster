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
  return { dir, branch, base, src, repo: repo || bridgeRepo };
}

// Commit anything left uncommitted, push the branch, and return a link to open the pull request.
export async function publishWorkspace({ dir, branch, base, repo, title }) {
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
  if (/package(-lock)?\.json/.test(changed)) {
    const npm = path.join(path.dirname(process.execPath), process.platform === "win32" ? "npm.cmd" : "npm");
    execFileSync(fs.existsSync(npm) ? npm : "npm", ["install", "--omit=dev"], { cwd: BRIDGE_DIR, stdio: "ignore", shell: process.platform === "win32" });
  }
  if (restart) setTimeout(restartSelf, 1500);
  return { updated: true, from: before, to: after, changed_files: changed.split("\n").length, restarting: restart };
}

function restartSelf() {
  const label = process.env.XPC_SERVICE_NAME; // set when launchd (Mac login item) started the bridge
  const detach = (cmd, args) => spawn(cmd, args, { detached: true, stdio: "ignore", cwd: BRIDGE_DIR, windowsHide: true }).unref();
  if (process.platform === "darwin" && label && label !== "0") {
    detach("launchctl", ["kickstart", "-k", `gui/${process.getuid()}/${label}`]);
    return; // launchd stops this process and starts the new code
  }
  if (process.platform === "win32") {
    detach("cmd", ["/c", "timeout /t 3 >nul & schtasks /run /tn \"Team Bridge\""]);
  } else {
    detach("sh", ["-c", `sleep 3; cd "${BRIDGE_DIR}" && exec "${process.execPath}" --env-file=.env server.js >> bridge.log 2>&1`]);
  }
  setTimeout(() => process.exit(0), 500);
}
