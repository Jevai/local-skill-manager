# Install Panel UI Redesign - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 重构市场安装面板 UI，用折叠式 pill 标签替换原生 checkbox，嵌入详情区并增加结构化进度展示。

**Architecture:** 修改 `renderMarketDetail()` 输出 HTML 结构，新增 pill + progress CSS，重写前端安装交互逻辑。后端 SSE 接口不变。

**Tech Stack:** Vanilla JS, CSS, FastAPI (no changes)

---

### Task 1: Add pill + progress CSS to style.css

**Files:**
- Modify: `static/style.css` (append at end)

**Step 1: Add CSS rules**

Append to `static/style.css`:

```css
/* ========== Market Install Panel Redesign ========== */

.market-install-card {
  background: var(--color-background-secondary, #1a1a2e);
  border: 0.5px solid var(--color-border-tertiary, #252540);
  border-radius: var(--border-radius-md, 8px);
  overflow: hidden;
  transition: border-color 0.2s;
}

.market-install-card:hover {
  border-color: #00d4aa44;
}

.market-install-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
}

.market-install-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.market-install-arrow {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: #00d4aa;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 0.2s;
}

.market-install-arrow.open {
  transform: rotate(180deg);
}

.market-install-badge {
  font-size: 10px;
  color: #00d4aa;
  background: #00d4aa18;
  padding: 1px 7px;
  border-radius: 8px;
  font-family: 'JetBrains Mono', monospace;
}

.market-install-pills {
  border-top: 1px solid var(--color-border-tertiary, #252540);
  padding: 10px 14px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 16px;
  font-size: 11px;
  font-family: 'Inter', system-ui, sans-serif;
  border: 1px solid var(--color-border-tertiary, #252540);
  color: var(--color-text-tertiary, #8888aa);
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
}

.pill:hover:not(.selected) {
  border-color: var(--color-border-secondary, #444);
}

.pill.selected {
  background: #00d4aa18;
  border-color: #00d4aa44;
  color: #00d4aa;
}

.pill .pill-check {
  font-size: 9px;
  opacity: 0;
  transition: opacity 0.15s;
}

.pill.selected .pill-check {
  opacity: 1;
}

.pill.disabled {
  opacity: 0.35;
  cursor: not-allowed;
  text-decoration: line-through;
}

/* Progress area */
.market-install-progress {
  border-top: 1px solid var(--color-border-tertiary, #252540);
  padding: 12px 14px;
  background: var(--color-background-primary, #0d0d12);
}

.market-install-progress-title {
  font-size: 11px;
  color: var(--color-text-tertiary, #8888aa);
  margin-bottom: 8px;
  font-family: 'Inter', system-ui, sans-serif;
}

.market-install-progress-step {
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
  margin-bottom: 3px;
}

.market-install-progress-bar-track {
  height: 3px;
  background: var(--color-background-tertiary, #252540);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 8px;
}

.market-install-progress-bar-fill {
  height: 100%;
  width: 0%;
  background: #00d4aa;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.market-install-progress-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 5px;
}

.market-install-progress-count {
  font-size: 10px;
  color: var(--color-text-tertiary, #8888aa);
  font-family: 'JetBrains Mono', monospace;
}

.market-install-progress-status {
  font-size: 10px;
  font-family: 'Inter', system-ui, sans-serif;
}
```

**Step 2: Verify CSS loads**

Run: open browser → `http://localhost:7788/static/style.css`
Expected: new CSS rules visible at bottom of file

**Step 3: Commit**

```bash
git add static/style.css
git commit -m "style: 新增安装面板 pill + progress CSS"
```

---

### Task 2: Rewrite renderMarketDetail() in app.js

**Files:**
- Modify: `static/app.js` (replace `renderMarketDetail()` function, ~lines 791-837)

**Step 1: Replace renderMarketDetail()**

Replace the entire `renderMarketDetail(skill, detail)` function with:

```javascript
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
      '<span class="pill' + (isChecked ? ' selected' : '') + '"' +
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
            '<span style="font-size:12px;font-weight:500;color:var(--color-text-primary,#e0e0f0);">安装到目标源</span>' +
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
```

**Step 2: Add togglePill(), toggleInstallPanel(), updateInstallBadge()**

Append to `app.js` (before the closing of the file or before `// ========== Search ==========`):

```javascript
// ========== Install Panel New Logic ==========
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
  if (document.getElementById("installProgress").style.display !== "none") return;
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
```

**Step 3: Verify no syntax errors**

Run in browser console: `renderMarketDetail`
Expected: function is defined, no ReferenceError

**Step 4: Commit**

```bash
git add static/app.js
git commit -m "feat: 重写 renderMarketDetail，使用 pill 标签 + 折叠面板"
```

---

### Task 3: Rewrite startInstall() to use new panel structure

**Files:**
- Modify: `static/app.js` (replace `startInstall()` function, ~lines 846-912)

**Step 1: Replace startInstall()**

```javascript
async function startInstall() {
  if (!currentMarketSkill) return;
  const { skill } = currentMarketSkill;
  const [owner, repo] = (skill.source || "").split("/");

  const selectedPills = document.querySelectorAll("#installPills .pill.selected");
  const selectedSources = Array.from(selectedPills).map(p => p.dataset.source);
  if (selectedSources.length === 0) return;

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
            handleInstallEventV2(event, selectedSources.length);
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
  btn.textContent = "安装到选中来源";
  document.getElementById("installPills").style.display = "block";
  document.getElementById("installProgress").style.display = "none";
}

function handleInstallEventV2(event, total) {
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
    if (btn) { btn.textContent = "已安装"; btn.disabled = true; }

    setTimeout(async () => {
      await loadAllSkills();
      renderTabs();
    }, 1000);
  } else if (event.type === "error") {
    if (statusEl) { statusEl.textContent = event.message; statusEl.style.color = "#dc2626"; }
    resetInstallBtn();
  }
}
```

**Step 2: Remove old handleInstallEvent()**

Delete the old `handleInstallEvent()` function (~lines 914-960) to avoid conflicts.

**Step 3: Verify in browser**

Run: open browser → select a market skill → click header to expand → select pills → click install
Expected: progress bar fills, steps appear, completion message shows

**Step 4: Commit**

```bash
git add static/app.js
git commit -m "feat: 重写 startInstall + handleInstallEvent，适配新面板结构"
```

---

### Task 4: Cleanup and verify end-to-end

**Files:**
- Modify: `static/app.js` (remove dead code)
- Verify: manual browser test

**Step 1: Remove dead references**

Search `app.js` for references to old class names:
- `.source-checkbox`
- `.source-checkboxes`
- `.install-button`
- `#conflictModal` (if unused in market context)

Remove or update any remaining old code.

**Step 2: End-to-end manual test**

| Action | Expected |
|---|---|
| 点击市场 skill → 详情展示 | ✅ name, meta, desc, content 正常 |
| 点击「安装到目标源」header | ✅ pill 区域展开/折叠，箭头旋转 |
| 点击 pill 标签 | ✅ 选中态 toggle，badge 数字更新 |
| 不选任何 pill → 安装按钮 | ✅ disabled |
| 选择 pill → 点击安装 | ✅ pills 隐藏，进度区展开，SSE 进度正常 |
| 安装完成 | ✅ 按钮变「已安装」，本地列表刷新 |
| 只读来源 | ✅ 不在面板中出现 |

**Step 3: Commit cleanup**

```bash
git add static/app.js
git commit -m "cleanup: 移除安装面板旧代码，最终清理"
```

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-06-22-install-panel-redesign.md`.

Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
