// Injected into every page before it loads. Two jobs:
// 1. A soft cursor dot with a click ripple, so viewers can follow the pointer
//    (headless Chromium draws no cursor of its own).
// 2. window.__tut: read-only helpers that find the site's real controls by
//    their visible Arabic labels and tag them with data-tut="<name>" so the
//    Node side can target them. Nothing on the page is created or relabelled.
(() => {
  const CURSOR_ID = '__tutCursor';

  function installCursor() {
    if (document.getElementById(CURSOR_ID) || !document.documentElement) return;
    const c = document.createElement('div');
    c.id = CURSOR_ID;
    Object.assign(c.style, {
      position: 'fixed', left: '0', top: '0', width: '26px', height: '26px',
      marginLeft: '-13px', marginTop: '-13px', borderRadius: '50%',
      background: 'rgba(30,41,59,.30)', border: '2px solid rgba(255,255,255,.95)',
      boxShadow: '0 2px 10px rgba(0,0,0,.28)', pointerEvents: 'none',
      zIndex: '2147483647', transform: 'translate(-200px,-200px)',
      transition: 'scale .12s ease-out, opacity .25s ease',
    });
    document.documentElement.appendChild(c);
  }

  function ripple(x, y) {
    const r = document.createElement('div');
    Object.assign(r.style, {
      position: 'fixed', left: x + 'px', top: y + 'px', width: '16px', height: '16px',
      marginLeft: '-8px', marginTop: '-8px', borderRadius: '50%',
      border: '3px solid rgba(45,140,120,.9)', pointerEvents: 'none',
      zIndex: '2147483646', transition: 'transform .55s ease-out, opacity .55s ease-out',
    });
    document.documentElement.appendChild(r);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      r.style.transform = 'scale(4)';
      r.style.opacity = '0';
    }));
    setTimeout(() => r.remove(), 700);
  }

  addEventListener('mousemove', (e) => {
    installCursor();
    const c = document.getElementById(CURSOR_ID);
    if (c) c.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  }, true);
  addEventListener('mousedown', (e) => {
    ripple(e.clientX, e.clientY);
    const c = document.getElementById(CURSOR_ID);
    if (c) c.style.scale = '0.82';
  }, true);
  addEventListener('mouseup', () => {
    const c = document.getElementById(CURSOR_ID);
    if (c) c.style.scale = '1';
  }, true);
  // Frameworks that own <html> can drop foreign nodes on hydration; re-add.
  setInterval(installCursor, 400);

  const T = {
    vis(el) {
      if (!el || el.id === CURSOR_ID) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
    },
    text(el) {
      return (el.innerText || el.value || '').trim().replace(/\s+/g, ' ');
    },
    clickables() {
      return [...document.querySelectorAll(
        'button,[role=button],[role=tab],[role=radio],[role=switch],a,label,summary,select,[onclick],[tabindex]'
      )].filter((el) => T.vis(el));
    },
    mark(el, tag) {
      document.querySelectorAll(`[data-tut="${tag}"]`).forEach((e) => e.removeAttribute('data-tut'));
      if (el) el.setAttribute('data-tut', tag);
      return !!el;
    },
    // Deepest visible element whose text matches.
    findLabel(reSrc, maxLen = 80) {
      const re = new RegExp(reSrc);
      let best = null;
      for (const el of document.body.querySelectorAll('*')) {
        if (!T.vis(el)) continue;
        const t = T.text(el);
        if (t.length && t.length <= maxLen && re.test(t) && (!best || best.contains(el))) best = el;
      }
      return best;
    },
    markLabel(reSrc, tag, maxLen = 80) {
      return T.mark(T.findLabel(reSrc, maxLen), tag);
    },
    // Smallest clickable whose text, aria-label or title matches.
    markClickable(reSrc, tag, maxLen = 40) {
      const re = new RegExp(reSrc);
      const hits = T.clickables().filter((el) => {
        const t = T.text(el);
        const names = [t.length <= maxLen ? t : '', el.getAttribute('aria-label') || '', el.getAttribute('title') || ''];
        return names.some((n) => n && re.test(n));
      });
      hits.sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return ra.width * ra.height - rb.width * rb.height;
      });
      return T.mark(hits[0] || null, tag);
    },
    // Clickable matching targetRe that sits closest below the label matching labelRe.
    markNear(labelRe, targetRe, tag) {
      const label = T.findLabel(labelRe);
      const re = new RegExp(targetRe);
      const cands = T.clickables().filter((el) => T.text(el).length <= 40 && re.test(T.text(el)));
      if (!cands.length) return T.mark(null, tag);
      if (!label) return T.mark(cands[0], tag);
      const lr = label.getBoundingClientRect();
      const score = (el) => {
        const r = el.getBoundingClientRect();
        const dy = r.top - lr.bottom;
        return (dy < -10 ? 5000 - dy : dy) + Math.abs((r.left + r.right) / 2 - (lr.left + lr.right) / 2) * 0.2;
      };
      cands.sort((a, b) => score(a) - score(b));
      return T.mark(cands[0], tag);
    },
    markTitle() {
      let el = [...document.querySelectorAll('h1')].find((e) => T.vis(e));
      if (!el) {
        let bestSize = 0;
        for (const e of document.body.querySelectorAll('*')) {
          if (!T.vis(e) || !T.text(e) || e.children.length) continue;
          const r = e.getBoundingClientRect();
          if (r.top > 700) continue;
          const fs = parseFloat(getComputedStyle(e).fontSize);
          if (fs > bestSize) { bestSize = fs; el = e; }
        }
      }
      return T.mark(el || null, 'title');
    },
    // The control that belongs to the «الموضوع» label: a <select>, or a group of chips.
    markTopicControl() {
      const label = T.findLabel('^\\s*الموضوع\\s*[:：]?\\s*$', 20);
      if (!label) return null;
      T.mark(label, 'topicLabel');
      let node = label;
      for (let depth = 0; depth < 5 && node; depth++, node = node.parentElement) {
        const sel = [...node.querySelectorAll('select')].find((e) => T.vis(e));
        if (sel) {
          T.mark(sel, 'topic');
          T.mark(node, 'topicBox');
          return { kind: 'select', options: [...sel.options].map((o) => o.text.trim()), selected: sel.selectedIndex };
        }
        const chips = [...node.querySelectorAll('button,[role=button],[role=radio],label')]
          .filter((e) => T.vis(e) && !e.contains(label) && T.text(e) && T.text(e).length <= 60);
        if (chips.length >= 2) {
          const isOn = (e) => e.getAttribute('aria-pressed') === 'true' || e.getAttribute('aria-checked') === 'true'
            || e.getAttribute('aria-selected') === 'true' || /\b(active|selected|on)\b/i.test(e.className || '');
          const pick = chips.find((e) => !isOn(e) && !/الكل|جميع|كل المواضيع/.test(T.text(e))) || chips[0];
          T.mark(pick, 'topic');
          T.mark(node, 'topicBox');
          return { kind: 'chips', options: chips.map((e) => T.text(e)), picked: T.text(pick) };
        }
      }
      return null;
    },
    // The flashcard: a large clickable block in the content area.
    markCard() {
      const nav = /التالية|السابقة|عرفتها|أراجعها|ابدأ|اختبار|من البداية/;
      const cands = [...document.body.querySelectorAll('*')].filter((el) => {
        if (!T.vis(el)) return false;
        const r = el.getBoundingClientRect();
        const area = r.width * r.height;
        if (area < 40000 || area > 1500000 || r.bottom < 0 || r.top > innerHeight) return false;
        const s = getComputedStyle(el);
        const clickable = s.cursor === 'pointer' || el.getAttribute('role') === 'button' || el.hasAttribute('tabindex') || el.onclick;
        const named = /card|flip|بطاقة/i.test(`${el.className} ${el.id} ${el.getAttribute('aria-label') || ''}`);
        if (!clickable && !named) return false;
        return !nav.test(T.text(el).slice(0, 30)) || named;
      });
      const score = (el) => {
        const r = el.getBoundingClientRect();
        const named = /card|flip|بطاقة/i.test(`${el.className} ${el.id}`) ? 2 : 1;
        return named * r.width * r.height;
      };
      cands.sort((a, b) => score(b) - score(a));
      return T.mark(cands[0] || null, 'card');
    },
    cardState() {
      const el = document.querySelector('[data-tut="card"]');
      if (!el) return null;
      const deep = [el, ...el.querySelectorAll('*')].slice(0, 60);
      return JSON.stringify({
        text: T.text(el),
        cls: deep.map((e) => e.className && String(e.className)).join('|'),
        tf: deep.map((e) => getComputedStyle(e).transform).join('|'),
        vis: deep.map((e) => (T.vis(e) ? 1 : 0)).join(''),
      });
    },
    markQuizToggle() {
      return T.markClickable('^\\s*(وضع\\s*)?(ال)?اختبار\\s*\\S{0,3}\\s*$', 'quiz', 24)
        || T.markClickable('(^|\\s)(ال)?اختبار(\\s|$)', 'quiz', 24);
    },
    rememberButtons() {
      T.clickables().forEach((el) => el.setAttribute('data-tut-seen', '1'));
    },
    // Answer options that appeared after rememberButtons(): 2..6 sibling buttons.
    markOptions() {
      const fresh = T.clickables().filter((el) => !el.hasAttribute('data-tut-seen') && T.text(el).length > 0 && T.text(el).length <= 200);
      const groups = new Map();
      for (const el of fresh) {
        const p = el.parentElement;
        if (!groups.has(p)) groups.set(p, []);
        groups.get(p).push(el);
      }
      const best = [...groups.entries()].filter(([, v]) => v.length >= 2 && v.length <= 6).sort((a, b) => b[1].length - a[1].length)[0];
      if (!best) return null;
      T.mark(best[0], 'optBox');
      T.mark(best[1][0], 'opt');
      return best[1].map((e) => T.text(e));
    },
    optState() {
      const box = document.querySelector('[data-tut="optBox"]');
      if (!box) return null;
      const scope = box.parentElement || box;
      const parts = [...box.querySelectorAll('*')].concat([box]).map((e) => {
        const s = getComputedStyle(e);
        return `${e.className}|${s.backgroundColor}|${s.color}|${s.borderColor}`;
      });
      return JSON.stringify({ parts, text: T.text(scope) });
    },
    markThemeToggle() {
      const re = /ليلي|الليلي|داكن|الداكن|مظلم|نهاري|فاتح|الوضع|السمة|dark|light|theme|night/i;
      const icons = /^(🌙|☀️|☀|☾|🌓|🌗|◐|◑|🌞|🌚)$/;
      const hit = T.clickables().find((el) => {
        const names = [T.text(el), el.getAttribute('aria-label') || '', el.getAttribute('title') || ''];
        return names.some((n) => n && n.length <= 30 && (re.test(n) || icons.test(n.trim())));
      });
      return T.mark(hit || null, 'theme');
    },
    themeState() {
      const h = document.documentElement;
      return JSON.stringify({
        cls: h.className, data: { ...h.dataset }, scheme: h.style.colorScheme,
        bg: getComputedStyle(document.body).backgroundColor,
      });
    },
    hideCursor(on) {
      const c = document.getElementById(CURSOR_ID);
      if (c) c.style.opacity = on ? '0' : '1';
    },
    inventory() {
      const sel = 'h1,h2,h3,h4,h5,h6,button,a,[role=button],[role=tab],label,select,summary,input,[aria-label],[title]';
      const items = [];
      for (const el of document.querySelectorAll(sel)) {
        if (!T.vis(el)) continue;
        const r = el.getBoundingClientRect();
        items.push({
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || undefined,
          text: T.text(el).slice(0, 120),
          aria: el.getAttribute('aria-label') || undefined,
          title: el.getAttribute('title') || undefined,
          options: el.tagName === 'SELECT' ? [...el.options].map((o) => o.text.trim()) : undefined,
          rect: [r.x + scrollX, r.y + scrollY, r.width, r.height].map(Math.round),
        });
      }
      return { url: location.href, title: document.title, items, text: document.body.innerText.slice(0, 20000) };
    },
  };
  window.__tut = T;
})();
