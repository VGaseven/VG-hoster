// Runs the BizData Sandbox (biz-data-sandbox/media, shared with the VS Code extension) inside Shahed's Hub.
// It stands in for the VS Code webview API: state stays in this browser, "Copy" uses the clipboard and
// "Open in editor" becomes a file download. The sandbox reads no Hub data and calls no Hub API.
(async function () {
  "use strict";
  const STATE_KEY = "hub-bizdata-state";
  const EXT = { sql: "sql", r: "R", eviews: "prg" };

  function download(name, content) {
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function flash(button, label) {
    const before = button.textContent;
    button.textContent = label;
    setTimeout(() => (button.textContent = before), 1500);
  }

  window.acquireVsCodeApi = () => ({
    getState() {
      try { return JSON.parse(localStorage.getItem(STATE_KEY) || "null") || undefined; } catch { return undefined; }
    },
    setState(value) {
      try { localStorage.setItem(STATE_KEY, JSON.stringify(value)); } catch {}
    },
    async postMessage(message) {
      if (message.type === "copy") {
        try { await navigator.clipboard.writeText(message.code); flash(document.getElementById("copyBtn"), "Copied ✓"); }
        catch { flash(document.getElementById("copyBtn"), "Copy blocked"); }
      } else if (message.type === "openInEditor") {
        download(`bizdata-${message.language}.${EXT[message.language] || "txt"}`, message.code);
      }
    },
  });

  const res = await fetch("media/body.html");
  document.body.innerHTML = await res.text();
  const open = document.getElementById("openBtn");
  open.textContent = "Download";
  open.title = "Save this snippet as a file to open in your editor, R or EViews";

  for (const src of ["media/scenarios.js", "media/main.js"]) {
    await new Promise((resolve, reject) => {
      const s = Object.assign(document.createElement("script"), { src, onload: resolve, onerror: reject });
      document.body.append(s);
    });
  }
})();
