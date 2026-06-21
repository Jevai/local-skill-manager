// ========== State ==========
let allSkills = [];       // ALL skills from ALL sources (fetched once)
let filteredSkills = [];   // allSkills filtered by source + search
let selectedSkill = null;
let selectedSource = "agents"; // default tab
let sources = [];
let currentFile = null;
let currentView = "local";  // "local" | "market"
let currentInstallSources = [];  // Track sources being installed

// ========== Init ==========
async function init() {
  await loadSources();
  await loadAllSkills();
  renderTabs();
  renderSkills();
  // 默认选中列表第一个，避免右侧详情为空
  if (filteredSkills.length > 0) {
    selectSkill(filteredSkills[0].name);
  }
}

async function loadSources() {
  const res = await fetch("/api/sources");
  sources = await res.json();
}

// Fetch ALL skills (no source filter) once at startup
async function loadAllSkills() {
  const res = await fetch("/api/skills");
  allSkills = await res.json();
  applyFilter();
}

// Apply both source filter and search filter on allSkills
function applyFilter() {
  const q = document.getElementById("search").value.toLowerCase();
  filteredSkills = allSkills.filter(s => {
    // Source filter
    if (selectedSource && selectedSource !== "all") {
      if (!s.locations.some(l => l.source === selectedSource)) return false;
    }
    // Search filter
    if (q) {
      if (!s.name.toLowerCase().includes(q) &&
          !(s.description || "").toLowerCase().includes(q)) return false;
    }
    return true;
  });
  renderSkills();
}

// ========== Tabs ==========
function renderTabs() {
  const container = document.getElementById("tabs");
  container.innerHTML = "";

  // "全部" tab
  const allTab = makeTab("all", "全部", allSkills.length);
  container.appendChild(allTab);

  for (const src of sources) {
    const count = allSkills.filter(s =>
      s.locations.some(l => l.source === src.name)
    ).length;
    container.appendChild(makeTab(src.name, src.label, count));
  }

  document.querySelectorAll(".tab").forEach(t => {
    t.classList.toggle("active", t.dataset.source === (selectedSource || "all"));
  });
}

function makeTab(sourceName, label, count) {
  const el = document.createElement("div");
  el.className = "tab";
  el.dataset.source = sourceName;
  el.innerHTML = label + '<span class="count">' + count + "</span>";
  el.onclick = () => selectTab(sourceName);
  return el;
}

async function selectTab(sourceName) {
  selectedSource = sourceName;
  applyFilter();
  renderTabs();
  selectedSkill = null;
  currentFile = null;
  renderDetail();
  // 切到新来源后，默认选中该列表的第一个
  if (filteredSkills.length > 0) {
    selectSkill(filteredSkills[0].name);
  }
}

// ========== Skill List ==========
function renderSkills() {
  const container = document.getElementById("skillList");
  container.innerHTML = "";
  for (const skill of filteredSkills) {
    const el = document.createElement("div");
    el.className = "skill-item" + (selectedSkill && selectedSkill.name === skill.name ? " active" : "");
    el.onclick = () => selectSkill(skill.name);
    const readonly = !skill.can_delete;
    // Build unique source labels as tags
    const sourceLabels = [...new Set(skill.locations.map(l => l.source_label))];
    const tagsHtml = sourceLabels.map(lb =>
      '<span class="source-tag">' + escHtml(lb) + "</span>"
    ).join("");

    el.innerHTML =
      '<div class="skill-item-name">' + escHtml(skill.name) + "</div>" +
      '<div class="skill-item-desc">' + escHtml(truncate(skill.description || "", 50)) + "</div>" +
      '<div class="skill-item-meta">' + tagsHtml + "</div>";
    container.appendChild(el);
  }
  document.getElementById("footer").textContent = "共 " + filteredSkills.length + " 个 skill";
}

async function selectSkill(name) {
  const params = new URLSearchParams();
  const res = await fetch("/api/skills/" + encodeURIComponent(name) + "?" + params.toString());
  if (!res.ok) return;
  selectedSkill = await res.json();
  currentFile = null;
  renderDetail();
  document.querySelectorAll(".skill-item").forEach(el => {
    el.classList.toggle("active", el.querySelector(".skill-item-name").textContent === name);
  });
}

// ========== Detail Panel ==========
function renderDetail() {
  const container = document.getElementById("detail");
  if (!selectedSkill) {
    container.innerHTML = '<div class="detail-empty">选择一个 skill 查看详情</div>';
    return;
  }

  const s = selectedSkill;

  // File tree HTML (with skill name as root node)
  const treeHtml = renderFileTreeInteractive(s.file_tree, s, 0, s.name);

  container.innerHTML =
    '<div class="detail-header">' +
      '<div class="detail-name-row">' +
        '<div class="detail-name-left">' +
          '<span class="detail-name">' + escHtml(s.name) + "</span>" +
        "</div>" +
        '<div class="detail-actions">' +
          '<button class="btn btn-copy" onclick="openCopyModal()">复制到...</button>' +
          '<button class="btn btn-delete" ' + (!s.can_delete ? "disabled" : "") + ' onclick="openDeleteModal()">删除</button>' +
        "</div>" +
      "</div>" +
      '<div class="detail-desc">' + escHtml(s.description || "(无描述)") + "</div>" +
    "</div>" +
    '<div class="file-viewer">' +
      '<div class="file-tree-panel">' +
        '<div id="fileTree">' + treeHtml + "</div>" +
      "</div>" +
      '<div class="file-content-panel">' +
        '<div class="file-content-header" id="fileContentHeader">未选择文件</div>' +
        '<div class="file-content-body" id="fileContentBody">' +
          '<div class="loading">选择左侧文件查看内容</div>' +
        "</div>" +
      "</div>" +
    "</div>";

  // Auto-open SKILL.md if it exists
  const skillMdItem = document.querySelector('.ft-item.file[data-rel-path="SKILL.md"]');
  if (skillMdItem) {
    skillMdItem.click();
  } else if (s.file_tree && s.file_tree.length > 0) {
    const firstFile = findFirstFile(s.file_tree);
    if (firstFile) {
      const el = document.querySelector('.ft-item.file[data-rel-path="' + CSS.escape(firstFile) + '"]');
      if (el) el.click();
    }
  }

  // Expand all dirs by default
  document.querySelectorAll(".ft-item.dir").forEach(el => {
    toggleDir(el);
  });
}

// ========== File Tree ==========
function renderFileTreeInteractive(items, skill, depth, rootName) {
  if (!items || !items.length) return "";
  if (depth === undefined) depth = 0;
  let html = "";

  // Render skill name as non-clickable root node at depth 0
  if (depth === 0 && rootName) {
    html += '<div class="ft-item dir ft-root" data-depth="0" style="padding-left:12px">' +
      escHtml(rootName) + "/" +
    "</div>";
    // Children are always open for the root
    html += '<div class="ft-children open">' + renderFileTreeInteractive(items, skill, depth + 1) + "</div>";
    return html;
  }

  for (const item of items) {
    const relPath = item.rel_path;
    const indent = depth * 16;
    if (item.type === "dir") {
      html += '<div class="ft-item dir" data-rel-path="' + escHtml(relPath) + '" data-depth="' + depth + '" style="padding-left:' + (12 + indent) + 'px" onclick="toggleDir(this)">' +
        '<span class="arrow">&#9654;</span> ' + escHtml(item.name) + "/" +
      "</div>";
      html += '<div class="ft-children" data-dir="' + escHtml(relPath) + '">' + renderFileTreeInteractive(item.children, skill, depth + 1) + "</div>";
    } else {
      html += '<div class="ft-item file" data-rel-path="' + escHtml(relPath) + '" data-depth="' + depth + '" style="padding-left:' + (12 + indent) + 'px" onclick="openFile(\'' + jsEscape(relPath) + "', this)\">" +
        escHtml(item.name) +
      "</div>";
    }
  }
  return html;
}

function toggleDir(el) {
  // Root node (skill name) is not collapsible
  if (el.classList.contains("ft-root")) return;
  let children = el.nextElementSibling;
  if (!children || !children.classList.contains("ft-children")) return;
  const isOpen = children.classList.contains("open");
  children.classList.toggle("open");
  const arrow = el.querySelector(".arrow");
  if (arrow) arrow.classList.toggle("open", !isOpen);
}

async function openFile(relPath, el) {
  if (!selectedSkill) return;

  document.querySelectorAll(".ft-item.file").forEach(i => i.classList.remove("active"));
  if (el) el.classList.add("active");
  else {
    const target = document.querySelector('.ft-item.file[data-rel-path="' + CSS.escape(relPath) + '"]');
    if (target) target.classList.add("active");
  }

  currentFile = relPath;
  document.getElementById("fileContentHeader").textContent = relPath;

  const url = "/api/skills/" + encodeURIComponent(selectedSkill.name) + "/file?path=" + encodeURIComponent(relPath);
  const res = await fetch(url);
  const content = await res.text();

  // Robust extension extraction: get chars after last dot, trim whitespace
  const lastDot = relPath.lastIndexOf(".");
  const ext = lastDot >= 0 ? relPath.slice(lastDot + 1).trim().toLowerCase() : "";
  const bodyEl = document.getElementById("fileContentBody");

  if (ext === "md") {
    bodyEl.innerHTML = renderMarkdown(content);
  } else if (["py", "js", "ts", "jsx", "tsx"].includes(ext)) {
    bodyEl.innerHTML = '<div class="code-block hl-code">' + highlightCode(content, ext) + "</div>";
  } else if (ext === "json") {
    try {
      const pretty = JSON.stringify(JSON.parse(content), null, 2);
      bodyEl.innerHTML = '<div class="code-block hl-code">' + highlightJson(pretty) + "</div>";
    } catch (e) {
      bodyEl.innerHTML = '<div class="code-block hl-code">' + escHtml(content) + "</div>";
    }
  } else if (["yaml", "yml"].includes(ext)) {
    bodyEl.innerHTML = '<div class="code-block hl-code">' + highlightYaml(content) + "</div>";
  } else if (["sh", "bash", "bat", "cmd"].includes(ext)) {
    bodyEl.innerHTML = '<div class="code-block hl-code">' + highlightSh(content) + "</div>";
  } else if (["html", "htm", "xml", "svg"].includes(ext)) {
    bodyEl.innerHTML = '<div class="code-block hl-code">' + highlightXml(content) + "</div>";
  } else if (["css", "scss", "less"].includes(ext)) {
    bodyEl.innerHTML = '<div class="code-block hl-code">' + highlightCss(content) + "</div>";
  } else if (["sql"].includes(ext)) {
    bodyEl.innerHTML = '<div class="code-block hl-code">' + highlightSql(content) + "</div>";
  } else {
    bodyEl.innerHTML = '<div class="code-block">' + escHtml(content) + "</div>";
  }
}

function findFirstFile(items) {
  for (const item of items) {
    if (item.type === "file") return item.rel_path;
    if (item.children) {
      const found = findFirstFile(item.children);
      if (found) return found;
    }
  }
  return null;
}

function getFileIcon(name) {
  const ext = name.split(".").pop().toLowerCase();
  if (["md"].includes(ext)) return "\uD83D\uDCDC";  // 📝
  if (["py"].includes(ext)) return "\uD83D\uDC23";  // 🐍
  if (["js", "ts", "jsx", "tsx"].includes(ext)) return "\uD83D\uDCDC";  // 📜 (reuse)
  if (["json"].includes(ext)) return "\uD83D\uDCCB";  // 📋
  if (["yaml", "yml"].includes(ext)) return "\u2699\uFE0F";  // ⚙️
  if (["sh", "bash"].includes(ext)) return "\uD83D\uDCBB";  // 🖥️
  if (["bat", "cmd"].includes(ext)) return "\uD83E\uDDAF";  // 🪯
  if (["html", "htm", "xml", "svg"].includes(ext)) return "\uD83C\uDF10";  // 🌐
  if (["css", "scss", "less"].includes(ext)) return "\uD83C\uDFA8";  // 🎨
  if (["sql"].includes(ext)) return "\uD83D\uDCC3";  // 🗃️
  return "\uD83D\uDCC4";  // 📄
}

// ========== Syntax Highlighting ==========
function escHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function jsEscape(str) {
  return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// Generic highlighter helpers
function hlWrap(cls, text) {
  return '<span class="hl-' + cls + '">' + text + "</span>";
}

function highlightCode(code, lang) {
  let result = escHtml(code);

  // Comments first (so they override everything)
  result = result.replace(/(#.*$)/gm, (m) => hlWrap("comment", m));
  result = result.replace(/(\/\/.*$)/gm, (m) => hlWrap("comment", m));
  result = result.replace(/(\/\*[\s\S]*?\*\/)/g, (m) => hlWrap("comment", m));

  // Strings
  result = result.replace(/("""[\s\S]*?"""|'''[\s\S]*?'''|`[^`]*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, (m) => hlWrap("string", m));

  // Numbers
  result = result.replace(/\b(\d+\.?\d*)\b/g, (m) => hlWrap("number", m));

  // Keywords
  const pyKw = /\b(def|class|import|from|as|if|elif|else|for|while|try|except|finally|with|return|yield|raise|pass|break|continue|and|or|not|in|is|lambda|global|nonlocal|assert|del|async|await)\b/g;
  const jsKw = /\b(const|let|var|function|class|extends|import|export|default|if|else|for|while|do|switch|case|break|continue|return|throw|try|catch|finally|new|this|typeof|instanceof|in|of|async|await|yield|void|delete|null|undefined|true|false)\b/g;

  if (lang === "py") {
    result = result.replace(pyKw, (m) => hlWrap("keyword", m));
    result = result.replace(/(@\w+)/g, (m) => hlWrap("builtin", m));
    result = result.replace(/\b(self|cls|True|False|None|print|len|range|str|int|list|dict|set|tuple|open|super|type|isinstance|hasattr|getattr|setattr|property|staticmethod|classmethod)\b/g, (m) => hlWrap("builtin", m));
    result = result.replace(/\bdef\s+(\w+)/g, (m, name) => "def " + hlWrap("func", name));
  } else if (["js", "ts", "jsx", "tsx"].includes(lang)) {
    result = result.replace(jsKw, (m) => hlWrap("keyword", m));
    result = result.replace(/\b(console|document|window|Math|Array|Object|String|Number|Boolean|Promise|Map|Set|JSON|require|module|exports|process|Buffer|Error|Date|RegExp)\b/g, (m) => hlWrap("builtin", m));
    result = result.replace(/(function\s+)?(\w+)\s*\(/g, (m, _kw, name) => (_kw || "") + hlWrap("func", name) + "(");
    if (["jsx", "tsx"].includes(lang)) {
      result = result.replace(/(&lt;\/?)([\w]+)/g, (m, open, tag) => open + hlWrap("tag", tag));
    }
  }

  return result;
}

function highlightJson(code) {
  let result = escHtml(code);
  // Keys
  result = result.replace(/(".*?")\s*:/g, (m, key) => hlWrap("prop", key) + ":");
  // String values
  result = result.replace(/:\s*(".*?")/g, (m, val) => ": " + hlWrap("string", val));
  // Numbers
  result = result.replace(/:\s*(\d+\.?\d*)/g, (m) => ": " + hlWrap("number", m.slice(2)));
  // Booleans / null
  result = result.replace(/:\s*(true|false|null)/g, (m) => ": " + hlWrap("keyword", m.slice(2)));
  return result;
}

function highlightYaml(code) {
  let result = escHtml(code);
  result = result.replace(/(#.*$)/gm, (m) => hlWrap("comment", m));
  result = result.replace(/^(\s*)([\w][\w\s\-]*?)(\s*:\s)/gm, (m, indent, key, colon) => indent + hlWrap("prop", key) + colon);
  result = result.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, (m) => hlWrap("string", m));
  result = result.replace(/\b(true|false|null|yes|no|on|off)\b/gi, (m) => hlWrap("keyword", m));
  result = result.replace(/\b(\d+\.?\d*)\b/g, (m) => hlWrap("number", m));
  return result;
}

function highlightSh(code) {
  let result = escHtml(code);
  result = result.replace(/(#.*$)/gm, (m) => hlWrap("comment", m));
  result = result.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, (m) => hlWrap("string", m));
  result = result.replace(/(\$[\w{}]+)/g, (m) => hlWrap("builtin", m));
  result = result.replace(/\b(if|then|else|elif|fi|for|while|do|done|case|esac|in|function|return|exit|echo|cd|ls|cp|rm|mv|mkdir|chmod|chown|export|source|set|unset|read|shift|test)\b/g, (m) => hlWrap("keyword", m));
  result = result.replace(/(\s)(--?[\w\-]*)/g, (m, sp, flag) => sp + hlWrap("punct", flag));
  return result;
}

function highlightXml(code) {
  let result = escHtml(code);
  result = result.replace(/(&lt;!--[\s\S]*?--&gt;)/g, (m) => hlWrap("comment", m));
  result = result.replace(/(&lt;\/?)([\w:\-]+)/g, (m, open, tag) => open + hlWrap("tag", tag));
  result = result.replace(/\s([\w:\-]+)(=)/g, (m, attr, eq) => " " + hlWrap("attr", attr) + eq);
  result = result.replace(/(=)(".*?")/g, (m, eq, val) => eq + hlWrap("string", val));
  return result;
}

function highlightCss(code) {
  let result = escHtml(code);
  result = result.replace(/(\/\*[\s\S]*?\*\/)/g, (m) => hlWrap("comment", m));
  // Selectors before {
  result = result.replace(/^([\w\.#\-\[\](),"':\s>+*~\|]+?)\s*\{/gm, (m, sel) => hlWrap("prop", sel) + " {");
  // Property names
  result = result.replace(/([\w\-]+)(\s*:)/g, (m, prop, colon) => hlWrap("prop", prop) + colon);
  // Colors
  result = result.replace(/(:\s*)(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\))/gi, (m, _before, color) => ": " + hlWrap("builtin", color));
  // Numbers with units
  result = result.replace(/(:\s*)(-?[\d\.]+(?:px|em|rem|%|vh|vw|deg|s|ms|fr)\b)/gi, (m, before, num) => before + hlWrap("number", num));
  // Strings
  result = result.replace(/("(?:[^"\\]|\\.)*'|'(?:[^'\\]|\\.)*')/g, (m) => hlWrap("string", m));
  return result;
}

function highlightSql(code) {
  let result = escHtml(code);
  result = result.replace(/(--.*$)/gm, (m) => hlWrap("comment", m));
  result = result.replace(/(\/\*[\s\S]*?\*\/)/g, (m) => hlWrap("comment", m));
  const sqlKw = /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|ON|AND|OR|NOT|IN|IS|NULL|AS|ORDER BY|GROUP BY|HAVING|LIMIT|OFFSET|INSERT INTO|VALUES|UPDATE|SET|DELETE FROM|CREATE TABLE|DROP TABLE|ALTER TABLE|ADD|COLUMN|INDEX|PRIMARY KEY|FOREIGN KEY|REFERENCES|UNIQUE|DEFAULT|CASCADE|UNION|ALL|DISTINCT|BETWEEN|LIKE|EXISTS|CASE|WHEN|THEN|ELSE|END|OVER|PARTITION BY|ROW_NUMBER|RANK|DENSE_RANK|COUNT|SUM|AVG|MIN|MAX|COALESCE|CAST|INTO|BEGIN|COMMIT|ROLLBACK)\b/gi;
  result = result.replace(sqlKw, (m) => hlWrap("keyword", m));
  result = result.replace(/('(?:[^'\\]|\\.)*')/g, (m) => hlWrap("string", m));
  result = result.replace(/\b(\d+\.?\d*)\b/g, (m) => hlWrap("number", m));
  return result;
}

// ========== Markdown Renderer (powered by marked.js) ==========
function renderMarkdown(md) {
  if (!md) return '<p class="md-empty">(空文件)</p>';
  // Configure marked once
  if (!renderMarkdown._inited) {
    renderMarkdown._inited = true;
    if (typeof marked !== "undefined") {
      marked.setOptions({
        gfm: true,
        breaks: false
      });
    }
  }
  // Strip YAML frontmatter if present
  let content = md;
  const firstLine = content.split("\n")[0].trim();
  if (firstLine === "---") {
    const endIdx = content.indexOf("\n---\n", 4);
    if (endIdx >= 0) {
      content = content.slice(endIdx + 5);
    }
  }
  const html = '<div class="markdown-content">' + (typeof marked !== "undefined" ? marked.parse(content) : escHtml(content)) + '</div>';
  return html || '<p class="md-empty">(空文件)</p>';
}

// ========== Delete ==========
let deleteTargets = [];

function openDeleteModal() {
  if (!selectedSkill || !selectedSkill.can_delete) return;
  // 仅当前选中的来源视图：只列该来源下可写位置；"all" 视图下列全部可写位置
  const inAllView = !selectedSource || selectedSource === "all";
  const candidates = inAllView
    ? selectedSkill.locations.filter(loc => loc.writable)
    : selectedSkill.locations.filter(loc => loc.writable && loc.source === selectedSource);
  deleteTargets = candidates;

  // 弹窗标题与提示根据来源动态调整
  const titleEl = document.querySelector("#deleteModal .modal-title");
  const hintEl = document.getElementById("deleteHint");
  if (titleEl) {
    titleEl.textContent = inAllView
      ? "确认删除（所有来源）"
      : `确认删除（来源：${selectedSkill.locations.find(l => l.source === selectedSource)?.source_label || selectedSource}）`;
  }
  if (hintEl) {
    hintEl.textContent = inAllView
      ? "将从所有可写来源删除该 skill。符号链接只会移除链接，不会删除源文件。"
      : "将仅从当前来源删除该 skill。符号链接只会移除链接，不会删除源文件。";
  }

  const pathsEl = document.getElementById("deletePaths");
  pathsEl.innerHTML = "";
  if (deleteTargets.length === 0) {
    const div = document.createElement("div");
    div.className = "path-item";
    div.textContent = inAllView
      ? "该 skill 在所有来源均为只读，无法删除"
      : "当前来源下该 skill 为只读或不存在，无法删除";
    pathsEl.appendChild(div);
  } else {
    for (const loc of deleteTargets) {
      const div = document.createElement("div");
      div.className = "path-item " + (loc.is_symlink ? "symlink" : "writable");
      div.textContent = (loc.is_symlink ? "[symlink] " : "") + loc.path;
      pathsEl.appendChild(div);
    }
  }
  // 没可删目标时禁用确认按钮
  const confirmBtn = document.querySelector('#deleteModal .btn-delete');
  if (confirmBtn) {
    confirmBtn.disabled = deleteTargets.length === 0;
  }
  document.getElementById("deleteModal").style.display = "flex";
}

function closeDeleteModal() {
  document.getElementById("deleteModal").style.display = "none";
  deleteTargets = [];
}

async function confirmDelete() {
  const paths = deleteTargets.map(loc => loc.path);
  const res = await fetch(
    "/api/skills/" + encodeURIComponent(selectedSkill.name),
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locations: paths })
    }
  );
  const result = await res.json();
  closeDeleteModal();
  selectedSkill = null;
  currentFile = null;
  await loadAllSkills();
  renderTabs();
  renderDetail();
  showToast("删除完成，已删除 " + result.deleted.length + "，跳过 " + result.skipped.length);
}

// ========== Copy ==========
let copySourceId = null;
let copySkillName = null;

function openCopyModal() {
  if (!selectedSkill) return;
  copySkillName = selectedSkill.name;
  copySourceId = selectedSkill.locations[0].source;

  document.getElementById("copySkillName").textContent =
    "将 " + copySkillName + " 复制到...";

  const select = document.getElementById("copyTargetSelect");
  select.innerHTML = "";
  for (const src of sources) {
    if (src.name === copySourceId) continue;
    const opt = document.createElement("option");
    opt.value = src.name;
    opt.textContent = src.label + (src.writable ? "" : " (只读)");
    opt.disabled = !src.writable;
    select.appendChild(opt);
  }

  document.getElementById("copyConfirmBtn").disabled = false;
  document.getElementById("copyConfirmBtn").textContent = "确认复制";
  document.getElementById("copyModal").style.display = "flex";
}

function closeCopyModal() {
  document.getElementById("copyModal").style.display = "none";
}

async function confirmCopy() {
  const targetId = document.getElementById("copyTargetSelect").value;
  const btn = document.getElementById("copyConfirmBtn");
  btn.disabled = true;
  btn.textContent = "复制中...";

  try {
    const res = await fetch("/api/skills/copy/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skill_name: copySkillName,
        source_id: copySourceId,
        target_id: targetId
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Copy failed");
    }

    const result = await res.json();

    if (result.conflict) {
      closeCopyModal();
      document.getElementById("conflictInfo").innerHTML =
        '<p>目标 <strong>' + sources.find(s => s.name === targetId).label +
        '</strong> 已存在 <strong>' + copySkillName + '</strong></p>' +
        '<p class="modal-path">' + result.existing_skill.path + '</p>' +
        '<p>' + result.existing_skill.file_count + ' 个文件, ' +
        result.existing_skill.size_kb + ' KB</p>';
      document.getElementById("conflictModal").dataset.targetId = targetId;
      document.getElementById("conflictModal").style.display = "flex";
    } else {
      closeCopyModal();
      showToast("已复制到 " + sources.find(s => s.name === targetId).label);
      await loadAllSkills();
      renderTabs();
    }
  } catch (e) {
    closeCopyModal();
    showToast("复制失败: " + e.message);
  }
}

function closeConflictModal() {
  document.getElementById("conflictModal").style.display = "none";
}

async function resolveConflict(strategy) {
  const targetId = document.getElementById("conflictModal").dataset.targetId;
  closeConflictModal();

  const res = await fetch("/api/skills/copy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      skill_name: copySkillName,
      source_id: copySourceId,
      target_id: targetId,
      strategy: strategy
    })
  });

  if (!res.ok) {
    const err = await res.json();
    showToast("复制失败: " + (err.detail || "Unknown error"));
    return;
  }

  const result = await res.json();
  let msg = "";
  if (result.action === "copied") msg = "已复制到 " + sources.find(s => s.name === targetId).label;
  else if (result.action === "renamed") msg = "已复制为 " + result.renamed_to;
  else if (result.action === "skipped") msg = "已跳过";
  showToast(msg);

  await loadAllSkills();
  renderTabs();
}

// ========== Toast ==========
function showToast(msg) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove("show"), 2500);
}

// ========== Utils ==========
function truncate(str, len) {
  if (!str) return "";
  return str.length > len ? str.slice(0, len) + "..." : str;
}

// ========== View Mode ==========
function switchView(view) {
  currentView = view;
  document.querySelectorAll(".view-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.view === view)
  );

  const skillList = document.getElementById("skillList");
  const tabs = document.getElementById("tabs");
  const search = document.getElementById("search");

  if (view === "market") {
    tabs.style.display = "none";
    search.placeholder = "搜索市场 skill...";
    selectedSkill = null;
    currentFile = null;
    renderDetail();
    loadMarketSkills();
  } else {
    tabs.style.display = "";
    search.placeholder = "搜索 skill 名称或描述...";
    selectedSkill = null;
    currentFile = null;
    renderDetail();
    applyFilter();
    renderTabs();
    // 从市场切回本地时，默认选中列表第一个
    if (filteredSkills.length > 0) {
      selectSkill(filteredSkills[0].name);
    }
  }
}

// ========== Market Skills ==========
let marketPage = 1;
let marketHasMore = true;
let marketLoading = false;
let marketSkills = [];
let marketSearchTimer = null;

async function loadMarketSkills(reset = true) {
  if (marketLoading) return;
  if (reset) {
    marketPage = 1;
    marketHasMore = true;
    marketSkills = [];
    document.getElementById("skillList").innerHTML = "";
  }
  if (!marketHasMore) return;

  marketLoading = true;
  showMarketLoading();

  try {
    const q = document.getElementById("search").value.trim();
    const params = new URLSearchParams();
    params.set("page", marketPage);
    if (q) params.set("search", q);

    const res = await fetch("/api/market/skills?" + params.toString());
    if (!res.ok) {
      const err = await res.json();
      showToast("市场加载失败: " + (err.detail || "网络错误"));
      marketLoading = false;
      return;
    }
    const data = await res.json();

    if (reset) marketSkills = [];
    marketSkills.push(...data.skills);
    marketHasMore = data.hasMore;
    marketPage = data.page + 1;

    renderMarketSkillList();
  } catch (e) {
    showToast("市场加载失败: " + e.message);
  }
  marketLoading = false;
}

function showMarketLoading() {
  const container = document.getElementById("skillList");
  if (!document.getElementById("marketLoader")) {
    const el = document.createElement("div");
    el.id = "marketLoader";
    el.className = "market-loader";
    el.textContent = "加载中...";
    container.appendChild(el);
  }
}

function hideMarketLoading() {
  const loader = document.getElementById("marketLoader");
  if (loader) loader.remove();
}

function renderMarketSkillList() {
  const container = document.getElementById("skillList");
  const existingCount = container.querySelectorAll(".market-item").length;

  for (let i = existingCount; i < marketSkills.length; i++) {
    const skill = marketSkills[i];
    const el = document.createElement("div");
    el.className = "skill-item market-item";

    const conflictCount = skill.conflicts ? skill.conflicts.length : 0;
    const allConflicted = conflictCount >= sources.filter(s => s.writable).length;

    if (allConflicted) {
      el.classList.add("all-installed");
    } else if (conflictCount > 0) {
      el.classList.add("partial-installed");
    }

    let conflictLabel = "";
    if (allConflicted) {
      conflictLabel = '<span class="installed-label">已安装: 全部来源</span>';
    } else if (conflictCount > 0) {
      conflictLabel = '<span class="installed-label">已安装: ' + skill.conflicts.join(", ") + '</span>';
    }

    const installsLabel = formatInstalls(skill.installs);
    const officialBadge = skill.isOfficial ? ' <span class="official-badge">官方</span>' : '';

    el.innerHTML =
      '<div class="skill-item-name">' + escHtml(skill.name) + officialBadge + '</div>' +
      '<div class="skill-item-desc">' + escHtml(skill.source || "") + " · " + installsLabel + '</div>' +
      '<div class="skill-item-meta">' + conflictLabel +
      (allConflicted ? '' : ' <span class="install-btn">安装 →</span>') + '</div>';

    if (!allConflicted) {
      el.onclick = () => selectMarketSkill(skill);
    }

    container.appendChild(el);
  }

  hideMarketLoading();
  document.getElementById("footer").textContent = "已加载 " + marketSkills.length + " 个 skill";
}

function formatInstalls(n) {
  if (!n) return "0 安装";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M 安装";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K 安装";
  return n + " 安装";
}

// ========== Market Detail & Install ==========
let currentMarketSkill = null;

async function selectMarketSkill(skill) {
  const [owner, repo] = (skill.source || "").split("/");
  if (!owner || !repo) {
    showToast("无法解析 skill 来源");
    return;
  }

  const skillId = skill.skillId || skill.name;
  try {
    const res = await fetch("/api/market/skill/" + owner + "/" + repo + "/" + skillId);
    if (!res.ok) {
      const err = await res.json();
      showToast("获取 skill 详情失败: " + (err.detail || "网络错误"));
      return;
    }
    const detail = await res.json();
    renderMarketDetail(skill, detail);
  } catch (e) {
    showToast("获取 skill 详情失败: " + e.message);
  }
}

function renderMarketDetail(skill, detail) {
  currentMarketSkill = { skill, detail };
  const container = document.getElementById("detail");

  const writableSources = sources.filter(s => s.writable);
  const hasWritable = writableSources.length > 0;

  // Build pill HTML (only writable sources)
  let pillsHtml = "";
  for (const src of writableSources) {
    const hasConflict = skill.conflicts && skill.conflicts.includes(src.name);
    const isChecked = !hasConflict;
    pillsHtml +=
      '<span class="pill' + (isChecked ? ' selected' : '') + (hasConflict ? ' disabled' : '') + '"' +
      ' data-source="' + escHtml(src.name) + '"' +
      ' onclick="togglePill(this)">' +
        '<span class="pill-check">✓</span> ' + escHtml(src.label) +
      '</span>';
  }

  const installsLabel = formatInstalls(skill.installs);
  const officialBadge = skill.isOfficial ? ' <span class="official-badge">官方 ✓</span>' : '';

  container.innerHTML =
    '<div class="detail-header">' +
      '<div class="detail-name">' + escHtml(detail.name || skill.name) + officialBadge + '</div>' +
      '<div class="detail-meta">' +
        escHtml(skill.source || "") + " · " + installsLabel +
      '</div>' +
      '<div class="detail-desc">' + escHtml(detail.description || "(无描述)") + '</div>' +
    '</div>' +

    // NEW: Install panel card
    (hasWritable ?
      '<div class="market-install-card" id="installCard">' +

        // Header bar (always visible)
        '<div class="market-install-header" onclick="toggleInstallPanel()">' +
          '<div class="market-install-header-left">' +
            '<svg class="market-install-arrow" id="installArrow" viewBox="0 0 24 24">' +
              '<path d="M6 9l6 6 6-6"/>' +
            '</svg>' +
            '<span style="font-size:12px;font-weight:500;color:var(--color-text-primary, #e0e0f0);">安装到目标源</span>' +
            '<span class="market-install-badge" id="installBadge">0 已选</span>' +
          '</div>' +
          '<button class="btn btn-primary" id="installBtn" onclick="event.stopPropagation();startInstall()" ' +
            'style="padding:5px 14px;font-size:11px;">安装</button>' +
        '</div>' +

        // Pill area (collapsible)
        '<div class="market-install-pills" id="installPills" style="display:none;">' +
          pillsHtml +
        '</div>' +

        // Progress area (hidden initially)
        '<div class="market-install-progress" id="installProgress" style="display:none;"></div>' +

      '</div>' : '') +

    '<div class="market-content">' +
      renderMarkdown(detail.content || "") +
    '</div>';

  // Update badge count after render
  updateInstallBadge();
}


async function startInstall() {
  if (!currentMarketSkill) return;
  const { skill } = currentMarketSkill;
  const [owner, repo] = (skill.source || "").split("/");

  const selectedPills = document.querySelectorAll("#installPills .pill.selected");
  const selectedSources = Array.from(selectedPills).map(p => p.dataset.source);
  if (selectedSources.length === 0) return;

  currentInstallSources = selectedSources;

  const btn = document.getElementById("installBtn");
  btn.disabled = true;
  btn.textContent = "安装中...";

  // Hide pills, show progress
  document.getElementById("installPills").style.display = "none";
  const progressEl = document.getElementById("installProgress");
  progressEl.style.display = "block";
  progressEl.innerHTML =
    '<div class="market-install-progress-title">正在安装...</div>' +
    '<div id="progressStepList"></div>' +
    '<div class="market-install-progress-bar-track">' +
      '<div class="market-install-progress-bar-fill" id="progressBarFill"></div>' +
    '</div>' +
    '<div class="market-install-progress-footer">' +
      '<span class="market-install-progress-count" id="progressCount">0/' + selectedSources.length + '</span>' +
      '<span class="market-install-progress-status" id="progressStatus"></span>' +
    '</div>';

  try {
    const res = await fetch("/api/market/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner: owner,
        repo: repo,
        skillId: skill.skillId || skill.name,
        sources: selectedSources,
      })
    });

    if (!res.ok) {
      const err = await res.json();
      showToast("安装失败: " + (err.detail || "未知错误"));
      resetInstallBtn();
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const event = JSON.parse(line.slice(6));
            handleInstallEvent(event, selectedSources.length);
          } catch (e) {}
        }
      }
    }
  } catch (e) {
    showToast("安装失败: " + e.message);
    resetInstallBtn();
  }
}

function resetInstallBtn() {
  const btn = document.getElementById("installBtn");
  if (!btn) return;
  btn.disabled = false;
  btn.textContent = "安装";
  document.getElementById("installPills").style.display = "block";
  document.getElementById("installProgress").style.display = "none";
  updateInstallBadge();
}

function handleInstallEvent(event, total) {
  const stepList = document.getElementById("progressStepList");
  const barFill = document.getElementById("progressBarFill");
  const countEl = document.getElementById("progressCount");
  const statusEl = document.getElementById("progressStatus");

  if (event.type === "progress") {
    if (event.step === "install") {
      let icon = "🔄";
      let color = "#00d4aa";
      if (event.status === "success") icon = "✅";
      else if (event.status === "error") { icon = "❌"; color = "#dc2626"; }
      else if (event.status === "skipped") { icon = "⚠️"; color = "#d97706"; }

      if (stepList) {
        stepList.innerHTML += '<div class="market-install-progress-step" style="color:' + color + '">' + icon + ' ' + escHtml(event.message || "") + '</div>';
      }

      if (event.completed !== undefined && barFill) {
        const pct = total > 0 ? Math.round((event.completed / total) * 100) : 100;
        barFill.style.width = pct + "%";
        if (countEl) countEl.textContent = event.completed + "/" + total;
      }
    }
  } else if (event.type === "complete") {
    let summary = "安装完成: " + event.completed + " 成功";
    if (event.failed > 0) summary += ", " + event.failed + " 失败";
    if (statusEl) {
      statusEl.textContent = summary;
      statusEl.style.color = event.failed > 0 ? "#d97706" : "#059669";
    }
    const btn = document.getElementById("installBtn");
    if (btn) { btn.textContent = event.failed > 0 ? "部分完成" : "已安装"; btn.disabled = true; }

    setTimeout(async () => {
      await loadAllSkills();
      renderTabs();
    }, 1000);

    // Update conflicts to include newly installed sources
    if (currentMarketSkill && currentInstallSources.length > 0) {
      const conflicts = currentMarketSkill.skill.conflicts || [];
      for (const src of currentInstallSources) {
        if (!conflicts.includes(src)) conflicts.push(src);
      }
      currentMarketSkill.skill.conflicts = conflicts;
      currentInstallSources = [];
    }
  } else if (event.type === "error") {
    if (statusEl) { statusEl.textContent = event.message; statusEl.style.color = "#dc2626"; }
    resetInstallBtn();
  }
}

// ========= Install Panel New Logic =========
function toggleInstallPanel() {
  const pills = document.getElementById("installPills");
  const arrow = document.getElementById("installArrow");
  if (!pills) return;
  const isOpen = pills.style.display !== "none";
  pills.style.display = isOpen ? "none" : "block";
  if (arrow) arrow.classList.toggle("open", !isOpen);
}

function togglePill(el) {
  if (el.classList.contains("disabled")) return;
  const prog = document.getElementById("installProgress");
  if (prog && prog.style.display !== "none") return;
  el.classList.toggle("selected");
  updateInstallBadge();
}

function updateInstallBadge() {
  const badge = document.getElementById("installBadge");
  if (!badge) return;
  const checked = document.querySelectorAll("#installPills .pill.selected").length;
  badge.textContent = checked + " 已选";
  const btn = document.getElementById("installBtn");
  if (btn) btn.disabled = checked === 0;
}

// ========== Search ==========
document.getElementById("search").addEventListener("input", () => {
  if (currentView === "market") {
    clearTimeout(marketSearchTimer);
    marketSearchTimer = setTimeout(() => loadMarketSkills(true), 300);
  } else {
    applyFilter();
  }
});

// Scroll-based pagination for market view
document.getElementById("skillList").addEventListener("scroll", function() {
  if (currentView !== "market") return;
  const el = this;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
    loadMarketSkills(false);
  }
});

init();
