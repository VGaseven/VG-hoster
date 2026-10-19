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
let conversation = "group", firstChatRender = true, sessionRows = [], resultRows = [], decisionRows = {approvals:[],tasks:[]};
let tasks = [], connection = "syncing", taskUnavailable = false;
let chatRows = [], homeView = "chats", cameFrom = "";
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
  requestAnimationFrame(sizeChat);
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
  $("generalChat").hidden = true;
  if($("generalDialog").open) $("generalDialog").close();
  $("searchResults").replaceChildren(); $("sessionList").replaceChildren(); $("decisionList").replaceChildren();
  $("home").hidden = true;
  $("project").hidden = true;
  $("login").hidden = false;
  $("lock").hidden = true;
  $("messages").replaceChildren();
  $("participants").replaceChildren();
  $("workStatus").replaceChildren();
  tasks = [];
  $("projectCards").replaceChildren();
  $("chatList").replaceChildren(); chatRows = [];
  if ($("newChatDialog").open) $("newChatDialog").close();
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
  renderChatList();
  if (current) {
    $("back").textContent = t(cameFrom === "chats" ? "backChats" : "back");
    renderMessages();
    renderFiles();
    renderWaiting();
    renderWork();
    renderConnection();renderExtras();requestAnimationFrame(sizeChat);
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
  $("generalChat").hidden = false;
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
    const params = new URLSearchParams(location.hash.slice(1));
    name = params.get("project");
    homeView = params.get("view") === "projects" ? "projects" : "chats";
    cameFrom = params.get("from") === "chats" ? "chats" : "";
    conversation = ["claude","codex","chatgpt","claude-code","local","bridge"].includes(params.get("conversation")) ? params.get("conversation") : "group";
  } catch {
    name = null;
  }
  current = projects.find((p) => p.name === name) || null;
  $("home").hidden = !!current;
  $("project").hidden = !current;
  if (!current) {
    showHome(version);
    if (name) notice("projectMissing");
    return;
  }
  $("back").textContent = t(cameFrom === "chats" ? "backChats" : "back");
  // Opened from the chat list: show only the chat, like a messaging app.
  document.body.classList.toggle("chat-focus", cameFrom === "chats");
  $("generalChat").hidden = cameFrom === "chats";
  notice("");
  $("projectName").textContent = current.name;
  $("projectDescription").textContent = current.description || "";
  $("projectIcon").style.background =
    colors[projects.indexOf(current) % colors.length];
  messages = [];
  firstChatRender = true;
  sessionRows=[];resultRows=[];decisionRows={approvals:[],tasks:[]};
  $("searchResults").replaceChildren();$("unifiedSearch").value="";renderExtras();
  $("newMessages").hidden = true;
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
  $("myProjects").hidden = !["work","uni"].includes(current.name);
  $("childProjects").hidden = true;
  if(matchMedia("(max-width:600px)").matches && !$("workBody").hidden) $("toggleWork").click();
  loadExtras(version);
  try {
    const project = current.name;
    const [m, f, work] = await Promise.all([
      api(chatPath(project)),
      api("files?" + new URLSearchParams({ project })),
      api("tasks?" + new URLSearchParams({ project })).catch(() => null),
    ]);
    if (version !== epoch) return;
    messages = uniqueMessages(m);
    const target=new URLSearchParams(location.hash.slice(1)).get('message');
    if(target){const found=await api('chat-message?'+new URLSearchParams({project,agent:conversation,id:target}));if(version!==epoch)return;messages=uniqueMessages([...messages,found]).sort((a,b)=>a.id-b.id);}

    tasks = (work || []).filter(t => t.project === project);
    taskUnavailable = work === null;
    connection = "connected";
    renderConnection();
    renderWork();
    files = f;
    renderMessages();
    renderFiles();
    if(target)requestAnimationFrame(()=>{const row=$('message-'+target);row?.scrollIntoView({block:'nearest'});row?.setAttribute('tabindex','-1');row?.focus({preventScroll:true});});
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
    if (conversation !== "group" && m.agent !== conversation) return false;
    if (m.id == null) return true;
    if (seen.has(String(m.id))) return false;
    seen.add(String(m.id)); return true;
  });
}
function renderConnection() { $("connection").textContent = t(connection); }
function renderWork() {
  const opened=new Set([...document.querySelectorAll("#workStatus details[open]")].map(e=>e.closest("article").id+":"+e.querySelector("summary").textContent));
  const box = $("workStatus"); box.replaceChildren();
  if (taskUnavailable || !tasks.length) box.append(text("p", t(taskUnavailable ? "workUnavailable" : "noWork"), "work-hint"));
  for (const task of tasks.filter(task => $("workFilter").value === "all" || task.status === $("workFilter").value)) {
    const item = text("article", "", "work-item");
    item.append(text("span", task.id, "work-id"), text("p", task.title));
    const status = text("span", ["open", "in_progress", "done", "blocked"].includes(task.status) ? t(task.status === "open" ? "statusOpen" : task.status) : task.status, "work-badge");
    status.dataset.state = ["open", "in_progress", "done", "blocked"].includes(task.status) ? task.status : "unknown";
    item.id = 'task-' + task.id;
    item.append(status, text("small", task.claimed_by || task.assignee || ""),text('small',date(task.updated)));
    if(task.details) item.append(text('p',task.details));
    if(task.notes?.length) { const details=document.createElement('details'); details.append(text('summary',t('activity'))); for(const n of task.notes) details.append(text('p',n.author+': '+n.note)); item.append(details); }
    const result=document.createElement('details'); result.append(text('summary',t('result')));
    result.append(text('p',task.status==='done' ? (task.notes?.at(-1)?.note || t('noResult')) : t('notFinished')));
    const saved=resultRows.find(r=>r.task_id===task.id);
    if(saved){result.replaceChildren(text('summary',t('result')),text('p',saved.summary));for(const path of saved.files){const b=text('button',path);b.onclick=()=>{switchTab('files');openFile(path);};result.append(b);}if(saved.session?.source_url){const a=text('a',t('originalSession'));a.href=saved.session.source_url;a.rel='noreferrer';result.append(a);}else result.append(text('small',t('noSessionLink')));}else result.append(text('small',t('noSessionLink'))); const edit=text('button',t('editResult'));edit.onclick=()=>editMetadata('result',saved||{task_id:task.id});result.append(edit); item.append(result); box.append(item);for(const d of item.querySelectorAll("details"))d.open=opened.has(item.id+":"+d.querySelector("summary").textContent);
  }
}
function renderMessages() {
  const box = $("messages");
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const oldScroll = box.scrollTop;
  box.replaceChildren();
  if (!messages.length) box.append(text("p", t(conversation==='group'?'noMessages':'noDirect'), "empty"));
  document.querySelector('[data-i18n=together]').textContent=conversation==='group'?t('together'):conversation+' · '+t('privateConversation');
  document.querySelector('#chatForm label').textContent=conversation==='group'?t('message'):t('privateConversation');
  document.querySelector('#chatForm [data-i18n=mention]').textContent=conversation==='group'?t('mention'):t('directHelp');
  const authors = ["group","claude","codex","chatgpt","claude-code","local","bridge"];
  $("participants").replaceChildren();
  $("participants").setAttribute("aria-label", t("participants"));
  for (const author of authors) {
    const chip = text("button", "", "participant"); chip.type='button'; chip.setAttribute('aria-pressed',String(author===conversation)); chip.append(avatar(author), text("bdi", author==='group'?t('group'):author)); chip.onclick=()=>{location.hash=new URLSearchParams({project:current.name,conversation:author,...(cameFrom?{from:cameFrom}:{})}).toString();}; $("participants").append(chip);
  }
  $("scopeNote").textContent = conversation === "group" ? t("groupNote") : t("privateNote");
  for (const m of messages) {
    const row = text("article", "", "message");
    row.id = "message-"+m.id;
    row.dataset.author = identity(m.author).key;
    const content = text("div", "", "message-content");
    const header = document.createElement("header");
    header.append(text("bdi", m.author), text("time", date(m.at)));
    const bubble = text("p", m.text, "bubble"); bubble.dir = "auto";
    content.append(header);
    if(m.author==='bridge'||/^(📋|📝|🛠️|☁️)/u.test(m.text)) { const detail=document.createElement('details');detail.append(text('summary',t('activity')),bubble);content.append(detail); } else content.append(bubble);
    row.append(avatar(m.author), content); box.append(row);
  }
  box.scrollTop = firstChatRender || atBottom ? box.scrollHeight : oldScroll;
  $("newMessages").hidden = firstChatRender || atBottom;
  firstChatRender = false;
  markSeen(current?.name, conversation, messages);
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
        api(chatPath(project)),
        api("tasks?" + new URLSearchParams({ project })).catch(() => null),
      ]);
      if (version !== epoch) return;
      const next = uniqueMessages(rows);
      if (JSON.stringify(next) !== JSON.stringify(messages)) { messages = next; renderMessages(); }
      tasks = (work || []).filter(t => t.project === project);
      taskUnavailable = work === null; renderWork();
      loadExtras(version);
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
  requestAnimationFrame(sizeChat);
  for (const item of ["chat", "files", "sessions", "decisions", "search"]) {
    const active = item === name;
    $(item + "Panel").hidden = !active;
    $(item + "Tab").setAttribute("aria-selected", String(active));
    $(item + "Tab").tabIndex = active ? 0 : -1;
  }
}
for (const name of ['sessions','decisions','search']) {
 const button=text('button',t(name));button.id=name+'Tab';button.dataset.i18n=name;button.setAttribute('role','tab');button.setAttribute('aria-controls',name+'Panel');button.setAttribute('aria-selected','false');button.tabIndex=-1;document.querySelector('.tabs').append(button);
}
const tabNames=['chat','files','sessions','decisions','search'];
for(const name of tabNames) { $(name+'Tab').onclick=()=>switchTab(name); $(name+'Tab').onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();let i=tabNames.indexOf(tab);i=e.key==='Home'?0:e.key==='End'?4:(i+(e.key==='ArrowRight'?1:4))%5;switchTab(tabNames[i]);$(tab+'Tab').focus();}}; }
$("language").onclick = () => {
  lang = lang === "en" ? "ar" : "en";
  try {
    localStorage.setItem("hub-language", lang);
  } catch {}
  translate();
};
$("search").oninput = renderCards;
$("back").onclick = () => {
  location.hash = cameFrom === "chats" ? "" : "view=projects";
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
  for(const o of $("newParent").options)o.disabled=!!o.value&&!projects.some(p=>p.name===o.value);
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
    if($("newParent").value) await api("project-parent",{method:"POST",body:JSON.stringify({project:name,parent:$("newParent").value})});
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
    const result = await api(conversation === "group" ? "chat" : "direct", {
      method: "POST",
      body: JSON.stringify({ project, text: value, to: "none", agent: conversation, ...(conversation!=="group"?{reply:!!$("requestPrivateReply")?.checked}:{}) }),
    });
    if (version !== epoch) return;
    $("message").value = "";
    waiting = result.answering || [];
    renderWaiting();
    const next = await api(
      chatPath(project),
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
setupOverhaul();
setupChats();
translate();
notice("loading");
loadHome().catch((e) => {
  if (e.message !== "invalid") {
    $("login").hidden = false;
  }
  notice(e.message === "invalid" ? "" : e.message);
});
function chatPath(project) {return (conversation==='group'?'chat':'direct')+'?'+new URLSearchParams({project,agent:conversation,limit:'200'});}
async function loadExtras(version) {
 const project=current?.name;if(!project)return;
 const results=await Promise.allSettled(['sessions','decisions','results'].map(p=>api(p+'?'+new URLSearchParams({project}))));
 if(version!==epoch)return;
 sessionRows=results[0].status==='fulfilled'?results[0].value:null;
 decisionRows=results[1].status==='fulfilled'?results[1].value:null;
 resultRows=results[2].status==='fulfilled'?results[2].value:[];
 renderExtras();renderWork();await refreshPrivateStatus(version);
}
function renderExtras() {
 const sessions=$('sessionList');sessions.replaceChildren();const add=text('button',t('addSession'));add.onclick=()=>editMetadata('session',{});sessions.append(add);
 if(!sessionRows?.length)sessions.append(text('p',t(sessionRows?'noSessions':'error')));
 for(const s of sessionRows||[]) {const item=text('article','','work-item');item.id='session-'+s.id;item.append(text('h3',s.title),text('p',s.summary),text('p',s.status),text('small',date(s.updated)));if(s.source_url){const link=text('a',t('originalSession'));link.href=s.source_url;link.rel='noreferrer';item.append(link);}else item.append(text('p',t('noSessionLink')));const edit=text('button',t('editMetadata'));edit.onclick=()=>editMetadata('session',s);item.append(edit);sessions.append(item);}
 const decisions=$('decisionList');decisions.replaceChildren();
 if(!decisionRows){decisions.append(text('p',t('error')));return;}
 if(!decisionRows.approvals.length&&!decisionRows.tasks.length)decisions.append(text('p',t('noDecisions')));
 for(const a of decisionRows.approvals){const item=text('article','','decision');item.append(text('h3',a.action),text('p',a.actor),text('pre',a.args));for(const approve of [true,false]){const b=text('button',t(approve?'approve':'reject'));b.onclick=async()=>{b.disabled=true;try{await api('approvals/'+encodeURIComponent(a.id),{method:'POST',body:JSON.stringify({approve})});await loadExtras(epoch);}catch{notice('error');b.disabled=false;}};item.append(b);}decisions.append(item);}
 for(const task of decisionRows.tasks){const b=text('button',task.title+' · '+t(task.status==='blocked'?'blocked':'waitingUser'),'file-row');b.onclick=()=>{switchTab('chat');$('workFilter').value='all';renderWork();$('task-'+task.id)?.scrollIntoView({block:'nearest'});};decisions.append(b);}
}
function setupOverhaul(){
 Object.assign(copy.en,{private_auth_required:'Sign-in is required; no retry was sent.',private_permission_denied:'Access was denied; no retry was sent.',private_rate_limited:'The provider reported a usage limit.',private_timeout:'The reply timed out.',private_unavailable:'The reply program is unavailable.',private_unsupported_cli:'The installed CLI lacks required options.',private_network_error:'The provider connection failed.',private_invalid_response:'The reply format could not be read.',private_provider_error:'The reply failed; no further detail was retained.'});
 Object.assign(copy.ar,{private_auth_required:'يلزم تسجيل الدخول؛ لم تُعد المحاولة.',private_permission_denied:'رُفض الوصول؛ لم تُعد المحاولة.',private_rate_limited:'أبلغ المزوّد عن حدّ للاستخدام.',private_timeout:'انتهت مهلة انتظار الرد.',private_unavailable:'برنامج الرد غير متاح.',private_unsupported_cli:'نسخة البرنامج لا تدعم الخيارات المطلوبة.',private_network_error:'تعذّر الاتصال بالمزوّد.',private_invalid_response:'تعذّرت قراءة صيغة الرد.',private_provider_error:'تعذّر الرد؛ لم تُحفظ تفاصيل إضافية.'});

 Object.assign(copy.en,{replySubscription:'Experimental Claude subscription reply · no tools or native app session; consumes plan allowance.',knownSessions:'Confirmed source references · choose to register',requestReply:'Request a private reply',replyUnavailable:'Private replies are disabled or unavailable here. Messages are stored only; no native app is contacted.',replyAvailable:'Private API text replies · may use the configured API budget. No native app session is created.',replyState:'Latest reply request'});
 Object.assign(copy.ar,{replySubscription:'رد تجريبي باشتراك Claude · بلا أدوات أو جلسة تطبيق أصلية؛ يستهلك حصة الاشتراك.',knownSessions:'مراجع مصادر مؤكدة · اختاري للتسجيل',requestReply:'طلب رد خاص',replyUnavailable:'الرد الخاص معطّل أو غير متاح هنا. تُحفظ الرسائل فقط دون التواصل مع التطبيق الأصلي.',replyAvailable:'رد نصي خاص عبر API · قد يستخدم ميزانية API المضبوطة. لا تُنشأ جلسة داخل التطبيق الأصلي.',replyState:'آخر طلب رد'});

 Object.assign(copy.en,{addSession:'Add session',editMetadata:'Edit session',editResult:'Edit result',saveMetadata:'Save',source:'Source',status:'Status',unlinked:'No task association',linkHelp:'Paste an actual original URL, or leave blank. URL format is checked; access and remote existence are not verified. Status is a manually recorded snapshot.',metadataError:'Could not save. Check the source URL and project items.',state_unknown:'Unknown',state_working:'Working',state_waiting_for_user:'Waiting for you',state_blocked:'Blocked',state_completed:'Completed'});
 Object.assign(copy.ar,{addSession:'إضافة جلسة',editMetadata:'تعديل الجلسة',editResult:'تعديل النتيجة',saveMetadata:'حفظ',source:'المصدر',status:'الحالة',unlinked:'دون ربط بمهمة',linkHelp:'ألصقي الرابط الأصلي الفعلي أو اتركيه فارغًا. يُفحص تنسيق الرابط فقط، وليس وجود الجلسة أو صلاحية الوصول. الحالة لقطة مسجّلة يدويًا.',metadataError:'تعذّر الحفظ. تحققي من رابط المصدر وعناصر المشروع.',state_unknown:'غير معروفة',state_working:'يعمل',state_waiting_for_user:'بانتظارك',state_blocked:'متعطّل',state_completed:'مكتمل'});

 Object.assign(copy.en,{workspace:'Workspace',topLevel:'Top level',privateConversation:'Private conversation',directHelp:'Private storage. Available reply options appear below.',noDirect:'No messages in this private conversation yet.',originalSession:'Original session',group:'Group',groupNote:'Shared with this project’s team.',privateNote:'Private conversation · messages stay out of the group and external notifications.',tasks:'Tasks',filter:'Filter',all:'All',compact:'Compact messages',newMessages:'New messages ↓',sessions:'Sessions',decisions:'Needs your decision',search:'Search',sessionNote:'Only registered sessions appear here. Native app chats are not imported automatically.',noSessions:'No linked sessions are registered for this project.',noSessionLink:'Original session link unavailable',noDecisions:'Nothing needs your decision here.',activity:'Technical activity · expand',result:'Result',noResult:'Marked complete; no result summary was attached.',notFinished:'No completed result yet.',generalChat:'✦ General chat',destination:'Destination project',routeNote:'Check the destination before sending. Private conversations currently store messages without waking an agent.',myProjects:'My projects',unifiedSearch:'Search this project and selected conversation',searchNote:'Tasks, files, registered sessions and messages in this conversation. Up to 100 matching items.',approve:'Approve operation',reject:'Reject',waitingUser:'Waiting for you',choose:'Choose a destination',uncertain:'Please choose the workspace and project. Nothing has been sent.',suggested:'Suggested destination — you can change it:',groupConfirm:'This message will be shared with the selected project’s team.',privateConfirm:'This message will be stored in the selected private conversation.'});
 Object.assign(copy.ar,{workspace:'المساحة',topLevel:'المستوى الرئيسي',privateConversation:'محادثة خاصة',directHelp:'تُحفظ بشكل خاص. خيارات الرد المتاحة أدناه.',noDirect:'لا توجد رسائل في هذه المحادثة الخاصة بعد.',originalSession:'الجلسة الأصلية',group:'المجموعة',groupNote:'مشتركة مع فريق هذا المشروع.',privateNote:'محادثة خاصة · تبقى الرسائل خارج المجموعة والإشعارات الخارجية.',tasks:'المهام',filter:'تصفية',all:'الكل',compact:'رسائل مختصرة',newMessages:'رسائل جديدة ↓',sessions:'الجلسات',decisions:'يحتاج قرارك',search:'بحث',sessionNote:'تظهر الجلسات المسجّلة فقط. لا تُستورد محادثات التطبيقات تلقائيًا.',noSessions:'لا توجد جلسات مرتبطة مسجّلة لهذا المشروع.',noSessionLink:'رابط الجلسة الأصلية غير متاح',noDecisions:'لا يوجد قرار مطلوب هنا.',activity:'نشاط تقني · عرض التفاصيل',result:'النتيجة',noResult:'مكتملة في السجل؛ لم يُرفق ملخص للنتيجة.',notFinished:'لا توجد نتيجة مكتملة بعد.',generalChat:'✦ محادثة عامة',destination:'المشروع المستقبِل',routeNote:'راجعي الوجهة قبل الإرسال. المحادثة الخاصة تحفظ الرسائل حاليًا دون تشغيل الوكيل.',myProjects:'مشاريعي',unifiedSearch:'ابحثي في المشروع والمحادثة المحددة',searchNote:'المهام والملفات والجلسات المسجّلة ورسائل المحادثة. حتى ١٠٠ نتيجة مطابقة.',approve:'الموافقة على العملية',reject:'رفض',waitingUser:'بانتظارك',choose:'اختاري الوجهة',uncertain:'اختاري المساحة والمشروع. لم تُرسل أي رسالة.',suggested:'وجهة مقترحة — يمكنك تغييرها:',groupConfirm:'ستُشارك الرسالة مع فريق المشروع المحدد.',privateConfirm:'ستُحفظ الرسالة في المحادثة الخاصة المحددة.'});
 $('toggleWork').onclick=()=>{const hidden=!$('workBody').hidden;$('workBody').hidden=hidden;$('toggleWork').setAttribute('aria-expanded',String(!hidden));document.querySelector('.chat-layout').classList.toggle('collapsed',hidden);};
 $('workFilter').onchange=renderWork;
 $('compact').onchange=()=>document.querySelector('#chatPanel').classList.toggle('compact',$('compact').checked);
 $('newMessages').onclick=()=>{$('messages').scrollTop=$('messages').scrollHeight;$('newMessages').hidden=true;};
 $('messages').onscroll=()=>{if($('messages').scrollHeight-$('messages').scrollTop-$('messages').clientHeight<40)$('newMessages').hidden=true;};
 $('myProjects').onclick=async()=>{const version=epoch;try{const rows=await api('children?'+new URLSearchParams({project:current.name}));if(version!==epoch)return;const list=$('childProjects');list.replaceChildren();list.hidden=false;if(!rows.length)list.append(text('p',t('noProjects')));for(const p of rows){const b=text('button',p.name);b.onclick=()=>location.hash='project='+encodeURIComponent(p.name);list.append(b);}}catch{notice('error');}};
 let searchVersion=0;
 $('unifiedSearch').oninput=async()=>{const v=++searchVersion,version=epoch,q=$('unifiedSearch').value;const box=$('searchResults');box.replaceChildren();if(q.trim().length<2)return;try{const results=await api('search?'+new URLSearchParams({project:current.name,agent:conversation,q}));if(v!==searchVersion||version!==epoch)return;if(!results.length)box.append(text('p',t('noMatches')));for(const r of results){const b=text('button',r.kind+' · '+r.title,'file-row');b.onclick=()=>{if(r.kind==='file'){switchTab('files');openFile(r.id);}else if(r.kind==='message'){location.hash=new URLSearchParams({project:current.name,conversation,message:r.id}).toString();}else{switchTab(r.kind==='session'?'sessions':'chat');if(r.kind==='task'){$('workFilter').value='all';renderWork();}$(r.kind+'-'+r.id)?.scrollIntoView({block:'nearest'});}};box.append(b);}}catch{if(v===searchVersion)box.append(text('p',t('error')));}};
 $('generalChat').onclick=()=>{$('generalForm').reset();$('generalError').textContent='';$('classification').textContent=t('uncertain');$('destination').replaceChildren();const empty=text('option',t('choose'));empty.value='';$('destination').append(empty);for(const p of projects){const o=text('option',p.name);o.value=p.name;$('destination').append(o);}$('generalDialog').showModal();};
 $('closeGeneral').onclick=()=>$('generalDialog').close();
 let manuallyChosen=false;
 $('destination').onchange=()=>{manuallyChosen=true;};
 $('generalText').oninput=()=>{if(manuallyChosen)return;const value=$('generalText').value.toLowerCase();const named=projects.filter(p=>!['uni','work','personal','default'].includes(p.name)&&value.includes(p.name.toLowerCase()));if(named.length===1){$('destination').value=named[0].name;$('classification').textContent=t('suggested')+' '+named[0].name;return;}const scopes=[['uni',/\b(university|course|exam|assignment)\b|جامعة|اختبار|واجب/],['work',/\b(work|client|meeting)\b|عمل|عميل|اجتماع/],['personal',/\b(family|health|personal)\b|عائلة|صحة|شخصي/],['default',/\b(hub|bridge)\b/]].filter(([p,re])=>re.test(value)&&projects.some(x=>x.name===p));$('destination').value=scopes.length===1?scopes[0][0]:'';$('classification').textContent=scopes.length===1?t('suggested')+' '+scopes[0][0]:t('uncertain');};
 $('generalAgent').onchange=()=>{$('classification').textContent=t($('generalAgent').value==='group'?'groupConfirm':'privateConfirm');};
 $('generalDialog').addEventListener('close',()=>{manuallyChosen=false;});
 $('generalForm').onsubmit=async e=>{e.preventDefault();const project=$('destination').value,agent=$('generalAgent').value,value=$('generalText').value.trim();if(!project||!value)return;e.submitter.disabled=true;try{await api(agent==='group'?'chat':'direct',{method:'POST',body:JSON.stringify({project,agent,text:value,to:'none'})});$('generalDialog').close();location.hash=new URLSearchParams({project,conversation:agent}).toString();notice('sent');}catch{$('generalError').textContent=t('sendFailed');}finally{e.submitter.disabled=false;}};
}

function sizeChat(){if(!current||tab!=='chat')return;const panel=$('chatPanel');panel.style.height=Math.max(260,Math.min(640,window.innerHeight-panel.getBoundingClientRect().top-(innerWidth<761?72:22)))+'px';}
window.addEventListener('resize',sizeChat);

function editMetadata(kind, record) {
 const project=current.name, dialog=document.createElement('dialog'), form=document.createElement('form');
 dialog.append(form);form.append(text('h2',t(kind==='session'?'editMetadata':'editResult')));
 const fields={};
 function field(key,label,value,options){const id='metadata-'+key;const lab=text('label',label);lab.htmlFor=id;const input=document.createElement(options?'select':key==='summary'?'textarea':'input');input.id=id;input.name=key;if(options)for(const [value,title] of options){const o=text('option',title);o.value=value;input.append(o);}input.value=value||'';form.append(lab,input);fields[key]=input;return input;}
 if(kind==='session'){
  field('title',t('name'),record.title).required=true;
  field('source',t('source'),record.source||'codex',[['codex','Codex'],['claude','Claude']]);
  field('source_url',t('originalSession'),record.source_url);
  if(project==='default'&&!record.id){const known=field('known',t('knownSessions'),'',[
   ['',t('choose')],['codex://threads/01a149af-d095-7648-a9f5-4c2817a78021','Codex · Upgrade Hub workspace experience'],['https://claude.ai/code/session_018772VAxW2wNFY9g45HkBpz','Claude · remember-device release (81cc632)']]);known.onchange=()=>{if(!known.value)return;fields.source_url.value=known.value;fields.source.value=known.value.startsWith('codex:')?'codex':'claude';fields.title.value=known.selectedOptions[0].textContent;};}
form.append(text('small',t('linkHelp')));
  field('task_id',t('tasks'),record.task_id,[['',t('unlinked')],...tasks.map(x=>[x.id,x.title])]);
  field('status',t('status'),record.status||'unknown',['unknown','working','waiting_for_user','blocked','completed'].map(x=>[x,t('state_'+x)]));
 } else {
  field('session_id',t('originalSession'),record.session_id,[['',t('noSessionLink')],...(sessionRows||[]).map(x=>[x.id,x.title])]);
  const list=field('files',t('savedFiles'),'',files.map(x=>[x.path,x.path]));list.multiple=true;for(const o of list.options)o.selected=(record.files||[]).includes(o.value);
 }
 field('summary',t('description'),record.summary).required=kind==='result';
 const error=text('p','');error.setAttribute('role','alert');const cancel=text('button',t('cancel'));cancel.type='button';cancel.onclick=()=>dialog.close();const save=text('button',t('saveMetadata'));save.type='submit';form.append(error,cancel,save);
 form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{const payload={project,...Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.value.trim()]))};if(kind==='session')payload.id=record.id||crypto.randomUUID();else{payload.task_id=record.task_id;payload.files=[...fields.files.selectedOptions].map(o=>o.value);}await api(kind==='session'?'sessions':'results',{method:'POST',body:JSON.stringify(payload)});dialog.close();if(current?.name===project)await loadExtras(epoch);}catch{error.textContent=t('metadataError');}finally{save.disabled=false;}};
 dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
}

async function refreshPrivateStatus(version){
 let controls=$('privateReplyControls');if(!controls){controls=document.createElement('div');controls.id='privateReplyControls';$('chatForm').append(controls);}
 if(conversation==='group'){controls.hidden=true;return;}controls.hidden=false;
 const scope=conversation;
 try{const state=await api('direct-status?'+new URLSearchParams({project:current.name,agent:scope}));if(version!==epoch||scope!==conversation)return;
 const checked=$('requestPrivateReply')?.checked&&controls.dataset.scope===scope;controls.dataset.scope=scope;controls.replaceChildren();
 const label=text('label',t('requestReply'));const check=document.createElement('input');check.type='checkbox';check.id='requestPrivateReply';check.disabled=!state.capability.available||state.request?.state==='working';check.checked=!!checked&&!check.disabled;label.prepend(check);controls.append(label,text('small',t(state.capability.available?(state.capability.provider==='claude-subscription-experimental'?'replySubscription':'replyAvailable'):'replyUnavailable')));
 if(state.request)controls.append(text('small',t('replyState')+': '+state.request.state+' · '+date(state.request.updated)));
 if(state.request?.state==='failed'){const key='private_'+state.request.error_category;controls.append(text('small',t(Object.hasOwn(copy.en,key)?key:'private_provider_error')));}
 }catch{if(version===epoch){controls.replaceChildren(text('small',t('replyUnavailable')));}}
}

// WhatsApp-style chat list: one place for every group and private chat, newest first.
// Only the last-seen message id per chat is kept in this browser, to show unread badges.
const chatKey = (project, agent) => JSON.stringify([project, agent]);
function readSeen() { try { const v = JSON.parse(localStorage.getItem("hub-seen") || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; } }
function markSeen(project, agent, rows) {
  if (!project || !rows.length) return;
  const top = Math.max(...rows.map(m => Number(m.id) || 0));
  const seen = readSeen(), key = chatKey(project, agent);
  if ((seen[key] || 0) >= top) return;
  seen[key] = top;
  try { localStorage.setItem("hub-seen", JSON.stringify(seen)); } catch {}
}
const agentName = (agent) => ({ group: t("group"), claude: "Claude", codex: "Codex", chatgpt: "ChatGPT", "claude-code": "Claude Code", local: "Local AI", bridge: "Bridge" })[agent] || agent;
function shortTime(value) {
  if (!value) return "";
  const d = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  if (Number.isNaN(d.valueOf())) return "";
  const locale = lang === "ar" ? "ar-SA" : "en-GB", now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return t("yesterday");
  return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
}
function showHome(version) {
  document.body.classList.remove("chat-focus");
  const chats = homeView === "chats";
  $("chatsHome").hidden = !chats;
  $("projectsHome").hidden = chats;
  $("chatsView").setAttribute("aria-pressed", String(chats));
  $("projectsView").setAttribute("aria-pressed", String(!chats));
  $("generalChat").hidden = chats;
  if (chats) loadChatList(version);
}
async function loadChatList(version) {
  stopPoll();
  try {
    const seen = readSeen();
    const pairs = Object.entries(seen).map(([k, id]) => { try { return [...JSON.parse(k), id]; } catch { return null; } }).filter(Boolean);
    const rows = await api("chats?" + new URLSearchParams({ seen: JSON.stringify(pairs) }));
    if (version !== epoch) return;
    chatRows = rows; renderChatList();
  } catch (e) { if (version === epoch) notice(e.message); }
  if (version === epoch && authenticated && !current) poll = setTimeout(() => loadChatList(version), 5000);
}
function renderChatList() {
  const list = $("chatList");
  if (!list) return;
  list.replaceChildren();
  if (!chatRows.length) { list.append(text("li", t("noChats"), "empty")); return; }
  for (const c of chatRows) {
    const li = document.createElement("li");
    const b = text("button", "", "chat-row"); b.type = "button";
    if (c.unread) b.classList.add("unread");
    const pic = c.agent === "group" ? text("span", "👥", "avatar avatar-initial group-avatar") : avatar(c.agent);
    pic.setAttribute("aria-hidden", "true");
    const body = text("span", "", "chat-row-body");
    const top = text("span", "", "chat-row-top");
    const title = text("bdi", c.agent === "group" ? c.project : agentName(c.agent), "chat-row-title");
    top.append(title, text("time", shortTime(c.at)));
    const sub = text("span", "", "chat-row-sub");
    const kind = text("span", c.agent === "group" ? t("groupChat") : `${t("privateWith")} · ${c.project}`, "chat-row-kind");
    const preview = text("bdi", c.id == null ? t("noMessagesYet") : (c.author === "human" ? t("you") + ": " : c.agent === "group" ? agentName(c.author) + ": " : "") + c.text.replace(/\s+/g, " "), "chat-row-preview");
    preview.dir = "auto";
    sub.append(preview);
    if (c.unread) { const badge = text("span", c.unread > 99 ? "99+" : String(c.unread), "unread-badge"); badge.setAttribute("aria-label", `${c.unread} ${t("unreadLabel")}`); sub.append(badge); }
    body.append(top, kind, sub);
    b.append(pic, body);
    b.onclick = () => { location.hash = new URLSearchParams({ project: c.project, conversation: c.agent, from: "chats" }).toString(); };
    li.append(b); list.append(li);
  }
}
function setupChats() {
  Object.assign(copy.en, { chats: "Chats", newChat: "+ New chat", newChatTitle: "Start a new chat", chatKind: "Who do you want to talk to?", kindPrivate: "One assistant (private)", kindGroup: "The whole team (group)", assistant: "Assistant", inProject: "In project", openChat: "Open chat", backChats: "← Chats", groupChat: "Group chat", privateWith: "Private", you: "You", noMessagesYet: "No messages yet", noChats: "No chats yet. Tap “+ New chat” to start one.", yesterday: "Yesterday", unreadLabel: "unread messages" });
  Object.assign(copy.ar, { chats: "المحادثات", newChat: "+ محادثة جديدة", newChatTitle: "ابدئي محادثة جديدة", chatKind: "مع من تريدين التحدث؟", kindPrivate: "مساعد واحد (خاصة)", kindGroup: "الفريق كله (مجموعة)", assistant: "المساعد", inProject: "في مشروع", openChat: "افتحي المحادثة", backChats: "→ المحادثات", groupChat: "محادثة جماعية", privateWith: "خاصة", you: "أنتِ", noMessagesYet: "لا توجد رسائل بعد", noChats: "لا توجد محادثات بعد. اضغطي «+ محادثة جديدة» للبدء.", yesterday: "أمس", unreadLabel: "رسائل غير مقروءة" });
  $("chatsView").onclick = () => { location.hash = ""; };
  $("projectsView").onclick = () => { location.hash = "view=projects"; };
  const syncKind = () => { const group = $("newChatForm").elements.chatKind.value === "group"; $("newChatAgent").disabled = group; $("newChatAgent").previousElementSibling.hidden = group; $("newChatAgent").hidden = group; };
  for (const r of $("newChatForm").elements.chatKind) r.onchange = syncKind;
  $("newChat").onclick = () => {
    $("newChatForm").reset();
    $("newChatProject").replaceChildren(...projects.map(p => { const o = text("option", p.name); o.value = p.name; return o; }));
    syncKind(); $("newChatDialog").showModal();
  };
  $("cancelNewChat").onclick = () => $("newChatDialog").close();
  $("newChatForm").onsubmit = (e) => {
    e.preventDefault();
    const project = $("newChatProject").value; if (!project) return;
    const agent = $("newChatForm").elements.chatKind.value === "group" ? "group" : $("newChatAgent").value;
    $("newChatDialog").close();
    location.hash = new URLSearchParams({ project, conversation: agent, from: "chats" }).toString();
  };
}
