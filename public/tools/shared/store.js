// Private storage for Hub tools (WhatIf). Opened directly, a tool uses this browser's localStorage. Embedded in the
// Hub, it runs in a sandboxed iframe with an opaque origin and no storage of its own, so the Hub parent keeps its keys
// (see public/hub.js "WhatIf storage"; only keys with an allowed prefix). Data never leaves this browser.

export function createStore(prefix) {
  const keyOk = (k) => typeof k === "string" && k.startsWith(prefix + "-") && /^[a-z]+-[a-z-]+$/.test(k);
  const framed = window.parent !== window;
  const localOk = (() => { try { localStorage.setItem(prefix + "-probe", "1"); localStorage.removeItem(prefix + "-probe"); return true; } catch { return false; } })();
  const memory = {};
  const store = {
    get(key, fallback) {
      try { const raw = localOk ? localStorage.getItem(key) : memory[key]; const v = raw == null ? null : JSON.parse(raw); return v ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      if (!keyOk(key)) return false;
      const raw = JSON.stringify(value);
      if (localOk) { try { localStorage.setItem(key, raw); return true; } catch { return false; } }
      memory[key] = raw;
      if (framed) window.parent.postMessage({ type: "whatif-store", op: "set", key, value: raw }, "*");
      return framed;
    },
    /** In a sandboxed frame, fetch this tool's saved keys from the Hub once at start-up (gives up after 1.5 s). */
    load() {
      if (localOk || !framed) return Promise.resolve();
      return new Promise((resolve) => {
        const done = (e) => {
          if (e.source !== window.parent || e.data?.type !== "whatif-store-all") return;
          for (const [k, v] of Object.entries(e.data.items || {})) if (keyOk(k) && typeof v === "string") memory[k] = v;
          window.removeEventListener("message", done); resolve();
        };
        window.addEventListener("message", done);
        window.parent.postMessage({ type: "whatif-store", op: "getAll", prefix }, "*");
        setTimeout(() => { window.removeEventListener("message", done); resolve(); }, 1500);
      });
    },
  };
  return store;
}

/** Saves text as a file the user chose to download (never uploaded). */
export function download(name, content, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type: type + ";charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
