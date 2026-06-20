// ========== State ==========
let allSkills = [];       // ALL skills from ALL sources (fetched once)
let filteredSkills = [];   // allSkills filtered by source + search
let selectedSkill = null;
let selectedSource = "agents"; // default tab
let sources = [];
let currentFile = null;

// ========== Init ==========
async function init() {
  await loadSources();
  await loadAllSkills();
  renderTabs();
  renderSkills();
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
    el.innerHTML =
      '<div class="skill-item-name">' + escHtml(skill.name) + "</div>" +
      '<div class="skill-item-desc">' + escHtml(truncate(skill.description || "", 50)) + "</div>" +
      '<div class="skill-item-meta">' +
        '<span class="' + (readonly ? "readonly" : "writable") + '">' + (readonly ? "只读" : "可写") + "</span>" +
        "<span>" + skill.locations.length + " 位置</span>" +
      "</div>";
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

  // Build locations HTML
  let locationsHtml = "";
  for (const loc of s.locations) {
    let tags = "";
    if (loc.is_symlink) tags += '<span class="detail-location-tag tag-symlink">symlink</span>';
    if (!loc.writable) tags += '<span class="detail-location-tag tag-readonly">只读</span>';
    else tags += '<span class="detail-location-tag tag-writable">可写</span>';
    locationsHtml +=
      '<div class="detail-location">' +
        '<div><span class="detail-location-source">' + escHtml(loc.source_label) + "</span>" + tags + "</div>" +
        '<div class="detail-location-path">' + escHtml(loc.path) + (loc.is_symlink ? " → " + escHtml(loc.real_path || "") : "") + "</div>" +
      "</div>";
  }

  // File tree HTML
  const treeHtml = renderFileTreeInteractive(s.file_tree, s);

  container.innerHTML =
    '<div class="detail-header">' +
      '<div class="detail-name">' + escHtml(s.name) + "</div>" +
      '<div class="detail-actions">' +
        '<button class="btn btn-delete" ' + (!s.can_delete ? "disabled" : "") + ' onclick="openDeleteModal()">删除</button>' +
      "</div>" +
      '<div class="detail-locations">' +
        '<div class="detail-section-title">位置 (' + s.locations.length + ")</div>" +
        locationsHtml +
      "</div>" +
      '<div class="detail-desc">' + escHtml(s.description || "(无描述)") + "</div>" +
    "</div>" +
    '<div class="file-viewer">' +
      '<div class="file-tree-panel">' +
        '<div class="file-tree-title">文件</div>' +
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
function renderFileTreeInteractive(items, skill, depth) {
  if (!items || !items.length) return "";
  if (depth === undefined) depth = 0;
  let html = "";
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
        getFileIcon(item.name) + " " + escHtml(item.name) +
      "</div>";
    }
  }
  return html;
}

function toggleDir(el) {
  let children = el.nextElementSibling;
  if (!children || !children.classList.contains("ft-children")) return;
  const isOpen = children.classList.contains("open");
  children.classList.toggle("open");
  el.querySelector(".arrow").classList.toggle("open", !isOpen);
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
  let content = await res.text();

  const ext = relPath.split(".").pop().toLowerCase();
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

// ========== Simple Markdown Renderer ==========
function renderMarkdown(md) {
  let html = "";
  const lines = md.split("\n");
  let inCodeBlock = false;
  let codeLang = "";
  let codeContent = [];
  let inTable = false;
  let tableRows = [];

  function flushCode() {
    if (inCodeBlock) {
      const raw = codeContent.join("\n");
      const ext = codeLang || "txt";
      let rendered;
      if (ext === "json") {
        try { rendered = highlightJson(JSON.stringify(JSON.parse(raw), null, 2)); }
        catch(e) { rendered = escHtml(raw); }
      } else if (["py","js","ts"].includes(ext)) { rendered = highlightCode(raw, ext); }
      else if (["yaml","yml"].includes(ext)) { rendered = highlightYaml(raw); }
      else if (ext === "sh") { rendered = highlightSh(raw); }
      else if (ext === "sql") { rendered = highlightSql(raw); }
      else { rendered = escHtml(raw); }
      html += '<pre class="md-code"><code class="hl-code">' + rendered + "</code></pre>";
      codeContent = [];
      inCodeBlock = false;
      codeLang = "";
    }
  }

  function flushTable() {
    if (inTable && tableRows.length > 0) {
      html += '<table class="md-table">';
      let ri = 0;
      for (const row of tableRows) {
        if (ri === 1) { ri++; continue; } // skip separator
        const tag = ri === 0 ? "th" : "td";
        const cells = row.split("|").map(c => c.trim()).filter(Boolean);
        html += "<tr>" + cells.map(c => "<" + tag + ">" + renderInline(c) + "</" + tag + ">").join("") + "</tr>";
        ri++;
      }
      html += "</table>";
      tableRows = [];
      inTable = false;
    }
  }

  function renderInline(text) {
    let r = escHtml(text);
    r = r.replace(/`([^`]+)`/g, "<code>$1</code>");
    r = r.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    r = r.replace(/\*(.+?)\*/g, "<em>$1</em>");
    r = r.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    return r;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("```")) {
      flushTable();
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      } else {
        flushCode();
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent.push(line);
      continue;
    }

    // Table detection
    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (!inTable) { flushTable(); inTable = true; }
      tableRows.push(line);
      continue;
    } else if (inTable) {
      flushTable();
    }

    if (trimmed.startsWith("### ")) {
      html += "<h3>" + renderInline(trimmed.slice(4)) + "</h3>\n";
    } else if (trimmed.startsWith("## ")) {
      html += "<h2>" + renderInline(trimmed.slice(3)) + "</h2>\n";
    } else if (trimmed.startsWith("# ")) {
      html += "<h1>" + renderInline(trimmed.slice(2)) + "</h1>\n";
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      html += "<hr>\n";
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      html += "<ul><li>" + renderInline(trimmed.slice(2)) + "</li></ul>\n";
    } else if (/^\d+\.\s/.test(trimmed)) {
      html += "<ol><li>" + renderInline(trimmed.replace(/^\d+\.\s/, "")) + "</li></ol>\n";
    } else if (trimmed.startsWith("> ")) {
      html += "<blockquote>" + renderInline(trimmed.slice(2)) + "</blockquote>\n";
    } else if (trimmed === "") {
      html += "\n";
    } else {
      html += "<p>" + renderInline(line) + "</p>\n";
    }
  }

  flushCode();
  flushTable();

  return html || '<p class="md-empty">(空文件)</p>';
}

// ========== Delete ==========
let deleteTargets = [];

function openDeleteModal() {
  if (!selectedSkill || !selectedSkill.can_delete) return;
  deleteTargets = selectedSkill.locations.filter(loc => loc.writable);
  const pathsEl = document.getElementById("deletePaths");
  pathsEl.innerHTML = "";
  for (const loc of deleteTargets) {
    const div = document.createElement("div");
    div.className = "path-item " + (loc.is_symlink ? "symlink" : "writable");
    div.textContent = (loc.is_symlink ? "[symlink] " : "") + loc.path;
    pathsEl.appendChild(div);
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
  alert("删除完成\n已删除: " + result.deleted.length + "\n跳过: " + result.skipped.length);
}

// ========== Utils ==========
function truncate(str, len) {
  if (!str) return "";
  return str.length > len ? str.slice(0, len) + "..." : str;
}

// ========== Search ==========
document.getElementById("search").addEventListener("input", () => {
  applyFilter();
});

init();
