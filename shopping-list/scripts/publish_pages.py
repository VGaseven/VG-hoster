#!/usr/bin/env python3
"""Publish a shopping list to GitHub Pages as a no-login link, and verify it signed-out.

  python3 scripts/publish_pages.py list.json            # first publish: new random id
  python3 scripts/publish_pages.py list.json            # again: same id, same URL (id is saved in list.json)

Uses your `gh` login. Lists live in the public repo <you>/cartflow-lists at /l/<random-id>/index.html
-> https://<you>.github.io/cartflow-lists/l/<random-id>/

Before printing the link it waits for Pages to deploy, downloads the page with no cookies and checks that every
item is there exactly once. Exit code 0 only when that check passed.

Testing hooks (no gh needed): --remote <git url> --base-url <http url>.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import listlib  # noqa: E402

CACHE = Path(os.environ.get("SHOPPING_LIST_CACHE", Path.home() / ".cache" / "shopping-list"))
PUBLIC_WARNING = ("Note: GitHub Pages lists are in a PUBLIC repo. Anyone who finds the repo can read every list in it "
                  "(the random id only keeps the link hard to guess). Don't publish personal details.")
ROOT_PAGE = "<!doctype html><meta charset=utf-8><meta name=robots content=noindex><title>Lists</title><p>Nothing here.</p>\n"


def run(cmd, cwd=None, check=True, capture=True):
    r = subprocess.run(cmd, cwd=cwd, text=True, capture_output=capture)
    if check and r.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)} failed: {(r.stderr or r.stdout).strip()}")
    return (r.stdout or "").strip()


def gh(*args, check=True):
    return run(["gh", *args], check=check)


def warn_once():
    marker = CACHE / "warned-public"
    if not marker.exists():
        print(PUBLIC_WARNING, file=sys.stderr)
        CACHE.mkdir(parents=True, exist_ok=True)
        marker.write_text("shown\n")


def ensure_repo(owner: str, repo: str) -> None:
    if subprocess.run(["gh", "repo", "view", f"{owner}/{repo}"], capture_output=True).returncode == 0:
        return
    print(f"Creating public repo {owner}/{repo} …", file=sys.stderr)
    gh("repo", "create", f"{owner}/{repo}", "--public", "--add-readme", "--description", "Shopping lists (no login needed)")


def ensure_pages(owner: str, repo: str, branch: str) -> None:
    r = subprocess.run(["gh", "api", f"repos/{owner}/{repo}/pages"], capture_output=True, text=True)
    if r.returncode == 0:
        return
    body = json.dumps({"source": {"branch": branch, "path": "/"}})
    p = subprocess.run(["gh", "api", "-X", "POST", f"repos/{owner}/{repo}/pages", "--input", "-"], input=body, text=True, capture_output=True)
    if p.returncode != 0 and "already" not in (p.stderr + p.stdout).lower():
        raise RuntimeError("Could not turn on GitHub Pages: " + (p.stderr or p.stdout).strip())


def checkout(remote: str, workdir: Path, use_gh: bool, slug: str) -> str:
    """Fresh copy of the repo's default branch in workdir. Returns branch name."""
    if (workdir / ".git").exists():
        run(["git", "fetch", "origin"], cwd=workdir)
    else:
        workdir.parent.mkdir(parents=True, exist_ok=True)
        if use_gh:
            gh("repo", "clone", slug, str(workdir))
        else:
            run(["git", "clone", remote, str(workdir)])
    heads = run(["git", "ls-remote", "--symref", "origin", "HEAD"], cwd=workdir, check=False)
    branch = "main"
    for line in heads.splitlines():
        if line.startswith("ref: refs/heads/"):
            branch = line.split("refs/heads/")[1].split()[0]
    if run(["git", "ls-remote", "--heads", "origin", branch], cwd=workdir, check=False):
        run(["git", "checkout", "-B", branch, f"origin/{branch}"], cwd=workdir)
        run(["git", "reset", "--hard", f"origin/{branch}"], cwd=workdir)
    else:  # empty repo
        run(["git", "checkout", "--orphan", branch], cwd=workdir, check=False)
    return branch


def commit_and_push(workdir: Path, branch: str, message: str) -> str:
    run(["git", "add", "-A"], cwd=workdir)
    if run(["git", "status", "--porcelain"], cwd=workdir):
        ident = []
        if not run(["git", "config", "user.email"], cwd=workdir, check=False):
            ident = ["-c", "user.name=shopping-list", "-c", "user.email=shopping-list@users.noreply.github.com"]
        run(["git", *ident, "commit", "-m", message], cwd=workdir)
        run(["git", "push", "origin", f"HEAD:{branch}"], cwd=workdir)
    return run(["git", "rev-parse", "HEAD"], cwd=workdir)


def wait_for_build(owner: str, repo: str, sha: str, timeout: int) -> None:
    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        r = subprocess.run(["gh", "api", f"repos/{owner}/{repo}/pages/builds/latest"], capture_output=True, text=True)
        if r.returncode == 0:
            b = json.loads(r.stdout)
            last = f"{b.get('status')} @ {str(b.get('commit'))[:7]}"
            if b.get("commit") == sha and b.get("status") == "built":
                return
            if b.get("commit") == sha and b.get("status") == "errored":
                raise RuntimeError("Pages build failed: " + str((b.get("error") or {}).get("message")))
        time.sleep(5)
    raise RuntimeError(f"Pages did not finish deploying in {timeout}s (last: {last or 'no build yet'})")


def fetch_signed_out(url: str) -> tuple[int, str]:
    """Plain GET with no cookies, no auth headers."""
    req = urllib.request.Request(url, headers={"User-Agent": "shopping-list-verify", "Cache-Control": "no-cache"})
    opener = urllib.request.build_opener()  # no HTTPCookieProcessor -> no cookies sent or kept
    try:
        with opener.open(req, timeout=20) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except (urllib.error.URLError, TimeoutError, OSError):
        return 0, ""


def check_page(html: str, expected: dict) -> list[str]:
    """Problems found comparing the live page with what we published (empty list = OK)."""
    try:
        live = listlib.read_page_data(html)
    except (ValueError, json.JSONDecodeError) as e:
        return [f"page has no readable list data ({e})"]
    problems = []
    names = [it["name"] for it in live.get("items", [])]
    want = [it["name"] for it in expected["items"]]
    keys = [listlib.identity_key(it) for it in live.get("items", [])]
    if len(set(keys)) != len(keys):
        problems.append("duplicate items on the live page")
    missing = [n for n in want if n not in names]
    if missing:
        problems.append("missing on live page: " + ", ".join(missing))
    if len(names) != len(want):
        problems.append(f"live page has {len(names)} items, expected {len(want)}")
    if live.get("title") != expected.get("title"):
        problems.append("title differs (old version still cached?)")
    return problems


def verify_live(url: str, expected: dict, timeout: int, sha: str = "") -> None:
    deadline = time.time() + timeout
    problems = ["not fetched yet"]
    while time.time() < deadline:
        status, html = fetch_signed_out(url + (f"?v={sha[:7]}" if sha else ""))
        problems = [f"HTTP {status}"] if status != 200 else check_page(html, expected)
        if not problems:
            return
        time.sleep(4)
    raise RuntimeError("Signed-out check failed: " + "; ".join(problems))


def browser_check(url: str, expected_count: int) -> None:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context()  # brand-new context: no cookies, no storage
        page = ctx.new_page()
        page.goto(url, wait_until="load")
        n = page.locator("#items li").count()
        b.close()
    if n != expected_count:
        raise RuntimeError(f"browser shows {n} items, expected {expected_count}")


def load_index() -> dict:
    try:
        return json.loads((CACHE / "pages-index.json").read_text())
    except (OSError, ValueError):
        return {}


def save_index(idx: dict) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / "pages-index.json").write_text(json.dumps(idx, indent=1))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("list_json")
    ap.add_argument("--repo", default="cartflow-lists")
    ap.add_argument("--owner", help="GitHub user/org (default: your gh login)")
    ap.add_argument("--id", help="update this list id (default: the id saved in list.json, else a new random id)")
    ap.add_argument("--add", action="store_true", help="merge these items into the published list instead of replacing it")
    ap.add_argument("--timeout", type=int, default=600, help="seconds to wait for deploy + signed-out check")
    ap.add_argument("--browser-check", action="store_true", help="also open it in a fresh Playwright browser (no cookies)")
    ap.add_argument("--remote", help=argparse.SUPPRESS)    # tests: plain git remote, skips gh
    ap.add_argument("--base-url", help=argparse.SUPPRESS)  # tests: where the site is served
    ap.add_argument("--workdir", help=argparse.SUPPRESS)
    args = ap.parse_args(argv)

    src = Path(args.list_json)
    data = json.loads(src.read_text(encoding="utf-8"))
    use_gh = not args.remote
    if use_gh and not shutil.which("gh"):
        print("ERROR: GitHub CLI `gh` not found. Install it and run `gh auth login`.", file=sys.stderr)
        return 2

    try:
        if use_gh:
            owner = args.owner or gh("api", "user", "-q", ".login")
            slug = f"{owner}/{args.repo}"
            ensure_repo(owner, args.repo)
            gh("auth", "setup-git", check=False)
            remote = f"https://github.com/{slug}.git"
            base = args.base_url or f"https://{owner.lower()}.github.io/{args.repo}"
        else:
            owner, slug, remote, base = "local", args.repo, args.remote, args.base_url
        warn_once()

        idx = load_index()
        key = f"{slug}:{listlib.slug(data.get('title', ''))}"
        list_id = args.id or data.get("pagesId") or idx.get(key) or listlib.new_list_id()
        if not re.fullmatch(r"[A-Za-z0-9_-]{6,40}", list_id):
            raise ValueError(f"bad list id: {list_id!r}")

        workdir = Path(args.workdir) if args.workdir else CACHE / "repos" / slug.replace("/", "__")
        branch = checkout(remote, workdir, use_gh, slug)
        page_path = workdir / "l" / list_id / "index.html"
        if args.add and page_path.exists():
            old = listlib.read_page_data(page_path.read_text(encoding="utf-8"))
            data = {**old, **{k: v for k, v in data.items() if k != "items"}, "items": old["items"] + data["items"]}
        data = {k: v for k, v in data.items() if k not in ("pagesId", "pagesUrl")}
        html = listlib.build_page(data)  # validates + removes duplicates
        expected = listlib.read_page_data(html)

        page_path.parent.mkdir(parents=True, exist_ok=True)
        page_path.write_text(html, encoding="utf-8")
        (workdir / ".nojekyll").write_text("")
        if not (workdir / "index.html").exists():
            (workdir / "index.html").write_text(ROOT_PAGE)
        sha = commit_and_push(workdir, branch, f"List {list_id}: {expected['title']} ({len(expected['items'])} items)")

        url = f"{base}/l/{list_id}/"
        if use_gh:
            ensure_pages(owner, args.repo, branch)
            wait_for_build(owner, args.repo, sha, args.timeout)
        verify_live(url, expected, args.timeout, sha if use_gh else "")
        if args.browser_check:
            browser_check(url, len(expected["items"]))
    except (RuntimeError, ValueError) as e:
        print("ERROR:", e, file=sys.stderr)
        return 1

    idx[key] = list_id
    save_index(idx)
    saved = json.loads(src.read_text(encoding="utf-8"))
    saved.update({"pagesId": list_id, "pagesUrl": url})
    src.write_text(json.dumps(saved, ensure_ascii=False, indent=2), encoding="utf-8")
    t = listlib.totals(expected["items"])
    print(json.dumps({"url": url, "id": list_id, "items": len(expected["items"]), "verified_signed_out": True,
                      "ticked_total": listlib.format_halalas(t["total"], expected["currency"]), "total_complete": t["complete"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
