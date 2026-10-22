// English / Arabic for WhatIf tools. Translations sit next to the English text: L("Text", "نص").
// The language comes from ?lang= in the page URL (the Hub passes it; the in-tool switch reloads with it). It is read
// when this module loads, so texts built at import time (tasks, schema notes, rubric) are already in that language.
// In Node (tests) there is no location, so everything stays English unless a test calls setLang.
let current = (() => {
  try { return new URLSearchParams(globalThis.location?.search || "").get("lang") === "ar" ? "ar" : "en"; } catch { return "en"; }
})();
export const setLang = (lang) => { current = lang === "ar" ? "ar" : "en"; };
export const lang = () => current;
export const L = (en, ar) => (current === "ar" && ar ? ar : en);

/**
 * Applies lang/dir to <html>. If the page was opened without ?lang= but the user chose Arabic before, reloads once
 * with ?lang=ar (returns true) so import-time texts are built in Arabic.
 */
export function applyLang(store, key) {
  const fromUrl = new URLSearchParams(location.search).get("lang");
  if (!fromUrl && store.get(key, "en") === "ar") {
    const url = new URL(location.href); url.searchParams.set("lang", "ar"); location.replace(url.href); return true;
  }
  document.documentElement.lang = current;
  document.documentElement.dir = current === "ar" ? "rtl" : "ltr";
  return false;
}

/** Switches language by reloading the page with ?lang= so every screen re-renders in one pass. */
export function switchLang(store, key) {
  const next = current === "ar" ? "en" : "ar";
  store.set(key, next);
  const url = new URL(location.href);
  url.searchParams.set("lang", next);
  location.replace(url.href);
}

/** Western digits in both languages (clearer for money and IDs); Arabic month names when Arabic is shown. */
export const dateLocale = () => (current === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB");
