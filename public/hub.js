/* Milestone 1 uses the existing authenticated API. Only language is persisted. */
const $ = (id) => document.getElementById(id);
const copy = {
  en: {
    conversation: "TEAM CONVERSATION", together: "A place to work together.",
    recordedWork: "Recorded work", workHint: "Task records, not live presence.",
    noWork: "No task records in this project.", workUnavailable: "Task records unavailable.",
    syncing: "Refreshing…", connected: "Up to date", reconnecting: "Reconnecting…",
    statusOpen: "Open", in_progress: "In progress", done: "Done", blocked: "Blocked",
    participants: "Authors in this conversation", requestRecorded: "Reply request recorded",

    skip: "Skip to content",
    brand: "Shahed’s Hub",
    classic: "Classic dashboard",
    lock: "Lock hub",
    private: "YOUR OWN LITTLE CORNER",
    welcome: "Welcome home, Shahed.",
    loginIntro:
      "Your projects, conversations and files, together in one calm place.",
    token: "Bridge access token",
    loginNote: "Paste it once. The token itself is never saved in this browser.",
    rememberDevice: "Remember this device for a year",
    unlock: "Open my hub",
    eyebrow: "A LITTLE SPACE FOR BIG IDEAS",
    headline: "Everything you’re making.",
    intro: "Pick a project. Find its files. Keep the conversation going.",
    projects: "Your projects",
    newProject: "+ New project",
    search: "Find a project",
    back: "← All projects",
    projectSpace: "PROJECT SPACE",
    chat: "Chat",
    files: "Files",
    message: "Message your team",
    mention: "Mention @claude, @codex or @local to invite a reply.",
    send: "Send message",
    savedFiles: "Saved files",
    refresh: "Refresh",
    download: "Download",
    newTitle: "Make room for a new idea",
    name: "Project name",
    description: "A short description",
    cancel: "Cancel",
    create: "Create project",
    noProjects: "No projects here yet. Start with one small idea.",
    noMatches: "No projects match your search.",
    noMessages: "A fresh page. Start the conversation with your team.",
    noFiles:
      "No files saved here yet. Files your team saves to this project will appear here.",
    open: "Open project →",
    projectCount: "projects, all in one place",
    noDescription: "A space to make something meaningful.",
    loading: "Loading…",
    error: "Couldn’t load this. Please try again.",
    invalid: "That token did not open the hub. Please try again.",
    sent: "Message sent.",
    sendFailed:
      "Could not confirm delivery. Refresh the chat before trying again.",
    waiting: "Reply requested from",
    duplicate: "A project with this name already exists.",
    working: "Working…",
    locked: "Hub locked.",
    version: "Version",
    lastUpdated: "Saved",
    projectMissing: "This project is no longer available.",
    pollFailed: "Couldn’t refresh replies. Reopen this project to try again.",
  },
  ar: {
    conversation: "محادثة الفريق", together: "مكان للعمل معًا.",
    recordedWork: "العمل المسجّل", workHint: "سجلات المهام، وليست حالة اتصال مباشرة.",
    noWork: "لا توجد مهام مسجّلة في هذا المشروع.", workUnavailable: "تعذّر تحميل سجلات المهام.",
    syncing: "جارٍ التحديث…", connected: "محدّثة", reconnecting: "جارٍ إعادة الاتصال…",
    statusOpen: "مفتوحة", in_progress: "قيد التنفيذ", done: "مكتملة", blocked: "متوقفة",
    participants: "المشاركون في هذه المحادثة", requestRecorded: "سُجّل طلب الرد",

    skip: "انتقل إلى المحتوى",
    brand: "مساحة شهد",
    classic: "لوحة التحكم القديمة",
    lock: "قفل المساحة",
    private: "مساحتك الخاصة",
    welcome: "أهلًا شهد، هذا مكانك.",
    loginIntro: "مشاريعك ومحادثاتك وملفاتك، معًا في مكان هادئ.",
    token: "رمز الدخول إلى Bridge",
    loginNote: "الصقيه مرة واحدة. الرمز نفسه لا يُحفظ في هذا المتصفح.",
    rememberDevice: "تذكّري هذا الجهاز لمدة سنة",
    unlock: "افتح مساحتي",
    eyebrow: "مساحة صغيرة لأفكار كبيرة",
    headline: "كل الأشياء التي تصنعينها.",
    intro: "اختاري مشروعًا، اعثري على ملفاته، وواصلي الحديث مع فريقك.",
    projects: "مشاريعك",
    newProject: "+ مشروع جديد",
    search: "ابحثي عن مشروع",
    back: "→ كل المشاريع",
    projectSpace: "مساحة المشروع",
    chat: "المحادثة",
    files: "الملفات",
    message: "رسالة إلى فريقك",
    mention: "اذكري @claude أو @codex أو @local لطلب رد.",
    send: "إرسال الرسالة",
    savedFiles: "الملفات المحفوظة",
    refresh: "تحديث",
    download: "تنزيل",
    newTitle: "مكان لفكرة جديدة",
    name: "اسم المشروع",
    description: "وصف قصير",
    cancel: "إلغاء",
    create: "إنشاء المشروع",
    noProjects: "لا توجد مشاريع بعد. ابدئي بفكرة صغيرة.",
    noMatches: "لا توجد مشاريع تطابق بحثك.",
    noMessages: "صفحة جديدة. ابدئي الحديث مع فريقك.",
    noFiles:
      "لا توجد ملفات محفوظة بعد. ستظهر هنا الملفات التي يحفظها فريقك لهذا المشروع.",
    open: "افتحي المشروع ←",
    projectCount: "مشاريع في مكان واحد",
    noDescription: "مساحة لصنع شيء له معنى.",
    loading: "جارٍ التحميل…",
    error: "تعذّر التحميل. حاولي مرة أخرى.",
    invalid: "لم يفتح هذا الرمز المساحة. حاولي مرة أخرى.",
    sent: "تم إرسال الرسالة.",
    sendFailed: "تعذّر تأكيد الإرسال. حدّثي المحادثة قبل المحاولة مجددًا.",
    waiting: "تم طلب رد من",
    duplicate: "يوجد مشروع بهذا الاسم بالفعل.",
    working: "جارٍ العمل…",
    locked: "المساحة مقفلة.",
    version: "الإصدار",
    lastUpdated: "حُفظ",
    projectMissing: "هذا المشروع لم يعد متاحًا.",
    pollFailed: "تعذّر تحديث الردود. افتحي المشروع مجددًا للمحاولة.",
  },
};
let lang = "en";
try {
  lang = localStorage.getItem("hub-language") === "ar" ? "ar" : "en";
} catch {}
let token = "",
  authenticated = false,
  projects = [],
  current = null,
  tab = "chat",
  messages = [],
  files = [],
  selectedFile = null,
  poll = null,
  epoch = 0,
  waiting = [];
let tasks = [], connection = "syncing", taskUnavailable = false;
const colors = [
  "#ddd2fb",
  "#c4eedb",
  "#ffd3bd",
  "#cfe5ff",
  "#ffd0e1",
  "#fff0b3",
];
const icons = ["✳", "✦", "◈", "✿", "✧", "◉"];
const t = (key) => copy[lang][key] || key;
const text = (tag, value, className) => {
  const e = document.createElement(tag);
  e.textContent = value;
  if (className) e.className = className;
  return e;
};
function notice(key) {
  $("notice").textContent = key ? t(key) : "";
}
function stopPoll() {
  clearTimeout(poll);
  poll = null;
}
function hidePrivate() {
  epoch++;
  stopPoll();
  authenticated = false;
  current = null;
  projects = [];
  messages = [];
  files = [];
  selectedFile = null;
  waiting = [];
  $("home").hidden = true;
  $("project").hidden = true;
  $("login").hidden = false;
  $("lock").hidden = true;
  $("messages").replaceChildren();
  $("participants").replaceChildren();
  $("workStatus").replaceChildren();
  tasks = [];
  $("projectCards").replaceChildren();
  $("fileList").replaceChildren();
  $("fileContent").textContent = "";
  $("filePreview").hidden = true;
  $("message").value = "";
}
async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch("/api/" + path, {
    ...options,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (response.status === 401) {
    token = "";
    hidePrivate();
    throw new Error("invalid");
  }
  if (!response.ok) throw new Error("error");
  return response.json();
}
function date(value) {
  if (!value) return "";
  const d = new Date(
    value.includes("T") ? value : value.replace(" ", "T") + "Z",
  );
  return Number.isNaN(d.valueOf())
    ? ""
    : d.toLocaleString(lang === "ar" ? "ar-SA" : "en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      });
}
function translate() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.title = t("brand");
  document
    .querySelectorAll("[data-i18n]")
    .forEach((e) => (e.textContent = t(e.dataset.i18n)));
  $("language").textContent = lang === "en" ? "العربية" : "English";
  $("language").lang = lang === "en" ? "ar" : "en";
  document
    .querySelector("[role=tablist]")
    .setAttribute("aria-label", t("projectSpace"));
  renderCards();
  if (current) {
    renderMessages();
    renderFiles();
    renderWaiting();
    renderWork();
    renderConnection();
  }
}
function renderCards() {
  $("count").textContent = `${projects.length} ${t("projectCount")}`;
  const q = $("search").value.trim().toLocaleLowerCase();
  const shown = projects.filter((p) =>
    `${p.name} ${p.description}`.toLocaleLowerCase().includes(q),
  );
  $("projectCards").replaceChildren();
  if (!shown.length) {
    $("projectCards").append(
      text("p", t(q ? "noMatches" : "noProjects"), "empty"),
    );
    return;
  }
  shown.forEach((p) => {
    const index = projects.indexOf(p);
    const card = text("button", "", "card");
    card.type = "button";
    card.style.setProperty("--pastel", colors[index % colors.length]);
    card.append(
      text("span", icons[index % icons.length], "card-icon"),
      text("h3", p.name),
      text("p", p.description || t("noDescription")),
      text("span", t("open"), "card-open"),
    );
    card.onclick = () => {
      location.hash = "project=" + encodeURIComponent(p.name);
    };
    $("projectCards").append(card);
  });
}
async function loadHome() {
  projects = await api("projects");
  authenticated = true;
  $("login").hidden = true;
  $("lock").hidden = false;
  notice("");
  renderCards();
  await route();
}
async function route() {
  if (!authenticated) return;
  const version = ++epoch;
  stopPoll();
  waiting = [];
  selectedFile = null;
  $("filePreview").hidden = true;
  $("message").value = "";
  let name;
  try {
    name = location.hash.startsWith("#project=")
      ? decodeURIComponent(location.hash.slice(9))
      : null;
  } catch {
    name = null;
  }
  current = projects.find((p) => p.name === name) || null;
  $("home").hidden = !!current;
  $("project").hidden = !current;
  if (!current) {
    if (name) notice("projectMissing");
    return;
  }
  notice("");
  $("projectName").textContent = current.name;
  $("projectDescription").textContent = current.description || "";
  $("projectIcon").style.background =
    colors[projects.indexOf(current) % colors.length];
  messages = [];
  tasks = [];
  taskUnavailable = false;
  connection = "syncing";
  renderConnection();
  renderWork();
  files = [];
  renderMessages();
  renderFiles();
  renderWaiting();
  switchTab("chat");
  try {
    const project = current.name;
    const [m, f, work] = await Promise.all([
      api("chat?" + new URLSearchParams({ project, limit: "100" })),
      api("files?" + new URLSearchParams({ project })),
      api("tasks?" + new URLSearchParams({ project })).catch(() => null),
    ]);
    if (version !== epoch) return;
    messages = uniqueMessages(m);
    tasks = (work || []).filter(t => t.project === project);
    taskUnavailable = work === null;
    connection = "connected";
    renderConnection();
    renderWork();
    files = f;
    renderMessages();
    renderFiles();
    schedulePoll(version);
  } catch (e) {
    if (version === epoch) { notice(e.message); connection = "reconnecting"; renderConnection(); schedulePoll(version); }
  }
}
const identity = (author) => {
  const key = String(author || "unknown").toLowerCase();
  if (key === "claude") return { key: "claude", asset: "claude", name: author };
  if (key === "chatgpt" || key === "dot") return { key: "chatgpt", asset: "chatgpt", name: author };
  return { key: key === "human" ? "human" : "other", name: author || "unknown" };
};
function avatar(author) {
  const who = identity(author);
  if (who.asset) {
    const img = document.createElement("img");
    img.src = `/assets/${who.asset}.png`;
    img.width = 32; img.height = 32; img.alt = ""; img.className = "avatar";
    return img;
  }
  const el = text("span", String(who.name).slice(0, 2).toUpperCase(), "avatar avatar-initial");
  el.setAttribute("aria-hidden", "true");
  return el;
}
function uniqueMessages(rows) {
  const seen = new Set();
  return rows.filter(m => {
    if (current && m.project && m.project !== current.name) return false;
    if (m.id == null) return true;
    if (seen.has(String(m.id))) return false;
    seen.add(String(m.id)); return true;
  });
}
function renderConnection() { $("connection").textContent = t(connection); }
function renderWork() {
  const box = $("workStatus"); box.replaceChildren();
  if (taskUnavailable || !tasks.length) box.append(text("p", t(taskUnavailable ? "workUnavailable" : "noWork"), "work-hint"));
  for (const task of tasks) {
    const item = text("article", "", "work-item");
    item.append(text("span", task.id, "work-id"), text("p", task.title));
    const status = text("span", ["open", "in_progress", "done", "blocked"].includes(task.status) ? t(task.status === "open" ? "statusOpen" : task.status) : task.status, "work-badge");
    status.dataset.state = ["open", "in_progress", "done", "blocked"].includes(task.status) ? task.status : "unknown";
    item.append(status, text("small", task.claimed_by || task.assignee || "")); box.append(item);
  }
}
function renderMessages() {
  const box = $("messages");
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const oldScroll = box.scrollTop;
  box.replaceChildren();
  if (!messages.length) box.append(text("p", t("noMessages"), "empty"));
  const authors = [...new Set(messages.map(m => m.author))];
  $("participants").replaceChildren();
  $("participants").setAttribute("aria-label", t("participants"));
  for (const author of authors) {
    const chip = text("span", "", "participant"); chip.append(avatar(author), text("bdi", author)); $("participants").append(chip);
  }
  for (const m of messages) {
    const row = text("article", "", "message");
    row.dataset.author = identity(m.author).key;
    const content = text("div", "", "message-content");
    const header = document.createElement("header");
    header.append(text("bdi", m.author), text("time", date(m.at)));
    const bubble = text("p", m.text, "bubble"); bubble.dir = "auto";
    content.append(header, bubble); row.append(avatar(m.author), content); box.append(row);
  }
  box.scrollTop = atBottom ? box.scrollHeight : oldScroll;
}
function renderWaiting() {
  $("answering").textContent = waiting.length
    ? `${t("requestRecorded")}: ${waiting.join(", ")}` : "";
}
function schedulePoll(version) {
  stopPoll();
  poll = setTimeout(async () => {
    if (version !== epoch || !current || !authenticated) return;
    const project = current.name;
    try {
      const [rows, work] = await Promise.all([
        api("chat?" + new URLSearchParams({ project, limit: "100" })),
        api("tasks?" + new URLSearchParams({ project })).catch(() => null),
      ]);
      if (version !== epoch) return;
      const next = uniqueMessages(rows);
      if (JSON.stringify(next) !== JSON.stringify(messages)) { messages = next; renderMessages(); }
      tasks = (work || []).filter(t => t.project === project);
      taskUnavailable = work === null; renderWork();
      connection = "connected"; renderConnection();
      schedulePoll(version);
    } catch (e) {
      if (version === epoch && authenticated) {
        connection = "reconnecting"; renderConnection(); schedulePoll(version);
      }
    }
  }, 5000);
}
function renderFiles() {
  const list = $("fileList");
  list.replaceChildren();
  if (!files.length) list.append(text("p", t("noFiles"), "empty"));
  for (const file of files) {
    const b = text("button", "", "file-row");
    b.append(
      text("span", file.path),
      text("small", `${t("version")} ${file.version}`),
    );
    b.onclick = () => openFile(file.path);
    list.append(b);
  }
}
async function openFile(path) {
  const version = epoch;
  try {
    const f = await api(
      "file?" + new URLSearchParams({ project: current.name, path }),
    );
    if (version !== epoch) return;
    selectedFile = f;
    $("fileName").textContent = f.path;
    $("fileContent").textContent = f.content;
    $("filePreview").hidden = false;
    notice("");
  } catch (e) {
    if (version === epoch) notice(e.message);
  }
}
function switchTab(name) {
  tab = name;
  for (const item of ["chat", "files"]) {
    const active = item === name;
    $(item + "Panel").hidden = !active;
    $(item + "Tab").setAttribute("aria-selected", String(active));
    $(item + "Tab").tabIndex = active ? 0 : -1;
  }
}
for (const name of ["chat", "files"]) {
  $(name + "Tab").onclick = () => switchTab(name);
  $(name + "Tab").onkeydown = (e) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      switchTab(
        e.key === "Home"
          ? "chat"
          : e.key === "End"
            ? "files"
            : tab === "chat"
              ? "files"
              : "chat",
      );
      $(tab + "Tab").focus();
    }
  };
}
$("language").onclick = () => {
  lang = lang === "en" ? "ar" : "en";
  try {
    localStorage.setItem("hub-language", lang);
  } catch {}
  translate();
};
$("search").oninput = renderCards;
$("back").onclick = () => {
  location.hash = "";
};
window.addEventListener("hashchange", route);
$("lock").onclick = () => {
  token = "";
  fetch("/api/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  hidePrivate();
  notice("locked");
  $("token").focus();
};
$("loginForm").onsubmit = async (e) => {
  e.preventDefault();
  token = $("token").value;
  $("token").value = "";
  const button = e.submitter;
  button.disabled = true;
  try {
    await loadHome();
    if ($("remember").checked) await api("login", { method: "POST", body: JSON.stringify({ remember: true }) }).catch(() => {});
  } catch (err) {
    token = "";
    notice(err.message);
  } finally {
    button.disabled = false;
  }
};
$("newProject").onclick = () => {
  $("projectForm").reset();
  $("projectError").textContent = "";
  $("projectDialog").showModal();
};
$("cancelProject").onclick = () => $("projectDialog").close();
$("projectForm").onsubmit = async (e) => {
  e.preventDefault();
  const name = $("newName").value.trim();
  if (!name) return;
  if (projects.some((p) => p.name === name)) {
    $("projectError").textContent = t("duplicate");
    return;
  }
  e.submitter.disabled = true;
  try {
    await api("projects", {
      method: "POST",
      body: JSON.stringify({
        name,
        description: $("newDescription").value.trim(),
      }),
    });
    projects = await api("projects");
    $("projectDialog").close();
    renderCards();
    location.hash = "project=" + encodeURIComponent(name);
  } catch (err) {
    $("projectError").textContent = t(err.message);
  } finally {
    e.submitter.disabled = false;
  }
};
$("chatForm").onsubmit = async (e) => {
  e.preventDefault();
  const value = $("message").value.trim();
  if (!value || !current) return;
  const version = epoch,
    project = current.name;
  $("send").disabled = true;
  try {
    const result = await api("chat", {
      method: "POST",
      body: JSON.stringify({ project, text: value, to: "none" }),
    });
    if (version !== epoch) return;
    $("message").value = "";
    waiting = result.answering || [];
    renderWaiting();
    const next = await api(
      "chat?" + new URLSearchParams({ project, limit: "100" }),
    );
    if (version !== epoch) return;
    messages = uniqueMessages(next);
    renderMessages();
    notice("sent");
    schedulePoll(version);
  } catch (err) {
    if (version === epoch)
      notice(err.message === "invalid" ? "invalid" : "sendFailed");
  } finally {
    $("send").disabled = false;
  }
};
$("refreshFiles").onclick = async () => {
  if (!current) return;
  const version = epoch;
  try {
    const next = await api(
      "files?" + new URLSearchParams({ project: current.name }),
    );
    if (version !== epoch) return;
    files = next;
    renderFiles();
    notice("");
  } catch (e) {
    if (version === epoch) notice(e.message);
  }
};
$("download").onclick = () => {
  if (!selectedFile) return;
  const url = URL.createObjectURL(
    new Blob([selectedFile.content], { type: "text/plain;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = selectedFile.path.split("/").pop();
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.addEventListener("pagehide", () => {
  token = "";
  hidePrivate();
});
translate();
notice("loading");
loadHome().catch((e) => {
  if (e.message !== "invalid") {
    $("login").hidden = false;
  }
  notice(e.message === "invalid" ? "" : e.message);
});
