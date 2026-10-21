// Runs student SQL in real SQLite (sql.js WebAssembly) inside a Web Worker.
// Isolation: the worker has only the mission tables, sent by the page. It cannot see the Hub's data, tokens,
// cookies or files. Every run uses a fresh in-memory copy in read-only mode, so nothing a student types can
// change the data. The page terminates the worker after a time limit and starts a new one (cancel and reset).
/* global initSqlJs */
importScripts("vendor/sql-wasm-browser.js");

const MAX_ROWS = 1000;
let SQL = null, script = "";
const ready = initSqlJs({ locateFile: (f) => "vendor/" + f.replace("sql-wasm.wasm", "sql-wasm-browser.wasm") }).then((s) => (SQL = s));

self.onmessage = async ({ data }) => {
  await ready;
  if (data.type === "load") { script = data.script; self.postMessage({ type: "loaded" }); return; }
  if (data.type !== "run") return;
  const started = performance.now();
  const db = new SQL.Database();
  try {
    db.run(script);
    db.run("PRAGMA query_only = ON");
    const results = db.exec(data.sql);
    const last = results[results.length - 1] || { columns: [], values: [] };
    self.postMessage({ type: "result", id: data.id, columns: last.columns, values: last.values.slice(0, MAX_ROWS), rowCount: last.values.length,
      truncated: last.values.length > MAX_ROWS, statements: results.length, ms: Math.round(performance.now() - started) });
  } catch (e) {
    self.postMessage({ type: "error", id: data.id, message: explain(String(e.message || e)) });
  } finally {
    db.close();
  }
};

/** Plain-language versions of common SQLite errors. */
function explain(msg) {
  if (/readonly|query_only|attempt to write/i.test(msg)) return "This sandbox is read-only: queries can read the mission data but not change it. (" + msg + ")";
  if (/no such table: (\w+)/i.test(msg)) return `There is no table called "${msg.match(/no such table: (\w+)/i)[1]}". Check the table list in the evidence explorer. (${msg})`;
  if (/no such column: ([\w.]+)/i.test(msg)) return `There is no column called "${msg.match(/no such column: ([\w.]+)/i)[1]}". Check its spelling and which table it belongs to. (${msg})`;
  if (/syntax error/i.test(msg)) return "SQL syntax error: check commas, quotes and keywords near the point shown. (" + msg + ")";
  if (/ambiguous column/i.test(msg)) return "A column name exists in more than one table here. Prefix it with the table alias, e.g. s.product_id. (" + msg + ")";
  return msg;
}
