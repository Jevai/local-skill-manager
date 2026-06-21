# Skill Migration (Copy) 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现跨来源 skill 复制功能，含两步式冲突检测、弹窗三选一冲突处理。

**Architecture:** 后端新增 2 个 POST 端点（`/copy/check`、`/copy`），复用现有扫描逻辑定位 skill；前端在详情面板加「复制到…」按钮，通过双弹窗完成交互。

**Tech Stack:** Python FastAPI + `shutil.copytree`；原生 HTML/CSS/JS SPA

---

### Task 1: 后端 — POST /api/skills/copy/check

**Files:**
- Modify: `E:\TreaProjects\SkillManager\main.py`（在 `delete_skill` 之后插入新端点）

**Step 1: 添加 copy/check 端点**

在 `delete_skill` 函数之后（约第 277 行后）、`# Serve static files` 之前插入：

```python
@app.post("/api/skills/copy/check")
async def copy_skill_check(request: Request):
    import json as json_mod
    body = await request.json()
    skill_name = body.get("skill_name", "").strip()
    source_id = body.get("source_id", "").strip()
    target_id = body.get("target_id", "").strip()

    # Validate
    config = load_config()
    source_names = {s["name"] for s in config["sources"]}
    if source_id not in source_names:
        raise HTTPException(400, f"Unknown source: {source_id}")
    if target_id not in source_names:
        raise HTTPException(400, f"Unknown source: {target_id}")
    if source_id == target_id:
        raise HTTPException(400, "Source and target must differ")

    target_src = next(s for s in config["sources"] if s["name"] == target_id)
    if not target_src["writable"]:
        raise HTTPException(400, "Target source is read-only")

    # Find source skill
    skills = scan_skills(source_id)
    target_skill = None
    for s in skills:
        if s["name"] == skill_name:
            target_skill = s
            break
    if not target_skill:
        raise HTTPException(404, f"Skill '{skill_name}' not found in source '{source_id}'")

    src_path = target_skill["locations"][0]["path"]

    # Check for conflict
    target_base = target_src["path"]
    dst_path = os.path.join(target_base, skill_name)

    if os.path.exists(dst_path):
        # Count files in existing target
        file_count = 0
        total_size = 0
        try:
            for root, dirs, files in os.walk(dst_path):
                for f in files:
                    fp = os.path.join(root, f)
                    if os.path.exists(fp):
                        file_count += 1
                        total_size += os.path.getsize(fp)
        except Exception:
            pass
        return SafeJSONResponse({
            "conflict": True,
            "existing_skill": {
                "name": skill_name,
                "source_id": target_id,
                "path": dst_path,
                "file_count": file_count,
                "size_kb": total_size // 1024
            }
        })

    # No conflict - execute copy directly
    try:
        shutil.copytree(src_path, dst_path)
        return SafeJSONResponse({
            "conflict": False,
            "success": True,
            "action": "copied",
            "skill_name": skill_name,
            "target_path": dst_path
        })
    except Exception as e:
        raise HTTPException(500, f"Copy failed: {str(e)}")
```

**Step 2: 启动服务测试**

```bash
cd E:\TreaProjects\SkillManager && python main.py
```

用 curl 验证无冲突复制：

```bash
curl -X POST http://127.0.0.1:7788/api/skills/copy/check \
  -H "Content-Type: application/json" \
  -d '{"skill_name":"some-skill","source_id":"workbuddy","target_id":"trae"}'
```

预期：`{"conflict": false, "success": true, ...}`

**Step 3: Commit**

```bash
git add main.py
git commit -m "feat: add POST /api/skills/copy/check endpoint"
```

---

### Task 2: 后端 — POST /api/skills/copy

**Files:**
- Modify: `E:\TreaProjects\SkillManager\main.py`（在 copy/check 之后插入）

**Step 1: 添加 copy 端点**

在 `copy_skill_check` 之后插入：

```python
@app.post("/api/skills/copy")
async def copy_skill(request: Request):
    import json as json_mod
    body = await request.json()
    skill_name = body.get("skill_name", "").strip()
    source_id = body.get("source_id", "").strip()
    target_id = body.get("target_id", "").strip()
    strategy = body.get("strategy", "skip").strip()

    if strategy not in ("overwrite", "skip", "rename"):
        raise HTTPException(400, f"Invalid strategy: {strategy}")

    # Validate
    config = load_config()
    source_names = {s["name"] for s in config["sources"]}
    if source_id not in source_names:
        raise HTTPException(400, f"Unknown source: {source_id}")
    if target_id not in source_names:
        raise HTTPException(400, f"Unknown source: {target_id}")
    if source_id == target_id:
        raise HTTPException(400, "Source and target must differ")

    target_src = next(s for s in config["sources"] if s["name"] == target_id)
    if not target_src["writable"]:
        raise HTTPException(400, "Target source is read-only")

    # Find source skill
    skills = scan_skills(source_id)
    target_skill = None
    for s in skills:
        if s["name"] == skill_name:
            target_skill = s
            break
    if not target_skill:
        raise HTTPException(404, f"Skill '{skill_name}' not found in source '{source_id}'")

    src_path = target_skill["locations"][0]["path"]
    target_base = target_src["path"]
    dst_path = os.path.join(target_base, skill_name)

    # Strategy: skip
    if strategy == "skip":
        if os.path.exists(dst_path):
            return SafeJSONResponse({
                "success": True,
                "action": "skipped",
                "skill_name": skill_name,
                "target_path": dst_path
            })
        shutil.copytree(src_path, dst_path)
        return SafeJSONResponse({
            "success": True,
            "action": "copied",
            "skill_name": skill_name,
            "target_path": dst_path
        })

    # Strategy: overwrite
    if strategy == "overwrite":
        if os.path.exists(dst_path):
            shutil.rmtree(dst_path)
        shutil.copytree(src_path, dst_path)
        return SafeJSONResponse({
            "success": True,
            "action": "copied",
            "skill_name": skill_name,
            "target_path": dst_path
        })

    # Strategy: rename
    if strategy == "rename":
        final_name = skill_name
        counter = 0
        while os.path.exists(os.path.join(target_base, final_name)):
            counter += 1
            if counter == 1:
                final_name = skill_name + "_copy"
            else:
                final_name = f"{skill_name}_copy{counter}"
        final_dst = os.path.join(target_base, final_name)
        shutil.copytree(src_path, final_dst)
        return SafeJSONResponse({
            "success": True,
            "action": "renamed",
            "renamed_to": final_name,
            "skill_name": skill_name,
            "target_path": final_dst
        })
```

**Step 2: 测试三策略**

```bash
# Overwrite
curl -X POST http://127.0.0.1:7788/api/skills/copy \
  -H "Content-Type: application/json" \
  -d '{"skill_name":"test-skill","source_id":"workbuddy","target_id":"trae","strategy":"overwrite"}'

# Skip
curl -X POST http://127.0.0.1:7788/api/skills/copy \
  -H "Content-Type: application/json" \
  -d '{"skill_name":"test-skill","source_id":"workbuddy","target_id":"trae","strategy":"skip"}'

# Rename
curl -X POST http://127.0.0.1:7788/api/skills/copy \
  -H "Content-Type: application/json" \
  -d '{"skill_name":"test-skill","source_id":"workbuddy","target_id":"trae","strategy":"rename"}'
```

**Step 3: Commit**

```bash
git add main.py
git commit -m "feat: add POST /api/skills/copy endpoint with conflict strategies"
```

---

### Task 3: 前端 — HTML 弹窗结构

**Files:**
- Modify: `E:\TreaProjects\SkillManager\static\index.html`（在 delete modal 之后插入）

**Step 1: 添加弹窗 HTML**

在 `<!-- Delete Modal -->` 整个 block 之后（第 44 行后）、`<script>` 之前插入：

```html
  <!-- Copy Modal - Step 1: Select Target -->
  <div class="modal-overlay" id="copyModal" style="display:none">
    <div class="modal">
      <div class="modal-title">复制 Skill</div>
      <div class="modal-text" id="copySkillName"></div>
      <div class="form-group">
        <label>目标来源</label>
        <select id="copyTargetSelect"></select>
      </div>
      <div class="modal-actions">
        <button class="btn btn-cancel" onclick="closeCopyModal()">取消</button>
        <button class="btn btn-primary" id="copyConfirmBtn" onclick="confirmCopy()">确认复制</button>
      </div>
    </div>
  </div>

  <!-- Copy Modal - Step 2: Conflict -->
  <div class="modal-overlay" id="conflictModal" style="display:none">
    <div class="modal">
      <div class="modal-title">目标已存在同名 Skill</div>
      <div id="conflictInfo" class="modal-text"></div>
      <div class="modal-actions">
        <button class="btn btn-danger" onclick="resolveConflict('overwrite')">覆盖</button>
        <button class="btn btn-cancel" onclick="resolveConflict('skip')">跳过</button>
        <button class="btn btn-primary" onclick="resolveConflict('rename')">重命名</button>
      </div>
    </div>
  </div>
```

**Step 2: Verify HTML in browser**

启动服务，打开 `http://127.0.0.1:7788`，确认无 JS 报错。

**Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat: add copy/conflict modal HTML"
```

---

### Task 4: 前端 — JS 复制逻辑

**Files:**
- Modify: `E:\TreaProjects\SkillManager\static\app.js`

**Step 1: 添加「复制到…」按钮**

在 `renderDetail` 函数中，第 152-154 行的 detail-actions div 内添加复制按钮：

修改第 150-154 行：
```javascript
  container.innerHTML =
    '<div class="detail-header">' +
      '<div class="detail-name">' + escHtml(s.name) + "</div>" +
      '<div class="detail-actions">' +
        '<button class="btn btn-copy" onclick="openCopyModal()">复制到...</button>' +
        '<button class="btn btn-delete" ' + (!s.can_delete ? "disabled" : "") + ' onclick="openDeleteModal()">删除</button>' +
      "</div>" +
```

注意：复制按钮放在删除按钮前面。

**Step 2: 添加复制相关 JS 函数**

在 `confirmDelete` 函数之后（约第 483 行）、`// ========== Utils ==========` 之前插入：

```javascript
// ========== Copy ==========
let copySourceId = null;
let copySkillName = null;

function openCopyModal() {
  if (!selectedSkill) return;
  copySkillName = selectedSkill.name;

  // Determine current source - use first location source
  copySourceId = selectedSkill.locations[0].source;

  document.getElementById("copySkillName").textContent =
    "将 " + copySkillName + " 复制到...";

  // Populate target sources (exclude current source)
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
      // Show conflict modal
      closeCopyModal();
      document.getElementById("conflictInfo").innerHTML =
        '<p>目标 <strong>' + sources.find(s => s.name === targetId).label +
        '</strong> 已存在 <strong>' + copySkillName + '</strong></p>' +
        '<p class="modal-path">' + result.existing_skill.path + '</p>' +
        '<p>' + result.existing_skill.file_count + ' 个文件, ' +
        result.existing_skill.size_kb + ' KB</p>';
      // Store target_id for resolve
      document.getElementById("conflictModal").dataset.targetId = targetId;
      document.getElementById("conflictModal").style.display = "flex";
    } else {
      // Success
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
```

**Step 3: Verify flow**

启动服务，点击 skill 的「复制到…」按钮，验证完整流程。

**Step 4: Commit**

```bash
git add static/app.js
git commit -m "feat: add copy skill UI with conflict resolution modals"
```

---

### Task 5: 前端 — 样式

**Files:**
- Modify: `E:\TreaProjects\SkillManager\static\style.css`（末尾追加）

**Step 1: 追加样式**

```css
/* ===== Copy modal ===== */
.form-group {
  margin: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form-group label {
  font-size: 13px;
  color: var(--text-dim);
}
.form-group select {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 14px;
  outline: none;
}
.form-group select:focus {
  border-color: var(--accent);
}
.form-group select option:disabled {
  color: var(--text-dim);
}

.btn-copy {
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--accent);
}
.btn-copy:hover {
  background: var(--accent);
  color: #fff;
}
.btn-primary {
  background: var(--accent);
  color: #fff;
  border: none;
}
.btn-primary:hover {
  opacity: 0.85;
}
.btn-danger {
  background: var(--red, #dc3545);
  color: #fff;
  border: none;
}
.btn-danger:hover {
  opacity: 0.85;
}

.modal-path {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: var(--text-dim);
  word-break: break-all;
  margin: 8px 0;
  padding: 6px 10px;
  background: var(--surface);
  border-radius: 4px;
}

/* ===== Toast ===== */
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%) translateY(100px);
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 10px 24px;
  border-radius: 8px;
  font-size: 14px;
  z-index: 10000;
  opacity: 0;
  transition: transform 0.25s ease, opacity 0.25s ease;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
}
.toast.show {
  transform: translateX(-50%) translateY(0);
  opacity: 1;
}
```

**Step 2: 替换 alert 为 toast**

把 `confirmDelete` 中的 `alert(...)` 改为 `showToast(...)`：

修改第 482 行：
```javascript
  showToast("删除完成，已删除 " + result.deleted.length + "，跳过 " + result.skipped.length);
```

**Step 3: Commit**

```bash
git add static/style.css static/app.js
git commit -m "style: add copy modal, toast styles; replace alert with toast"
```

---

### Task 6: 文档同步

**Files:**
- Modify: `E:\TreaProjects\SkillManager\Agent.md`

**Step 1: 更新功能清单**

在功能清单表中插入新行（v0.1.5）：

```markdown
| ✅ | 技能复制 | 跨来源复制 skill 到 writable 目标，含冲突检测与三策略处理 |
```

**Step 2: 更新 API 端点**

在 API 端点表中插入：

```markdown
| POST | `/api/skills/copy/check` | 检测冲突，无冲突直接复制 |
| POST | `/api/skills/copy` | 执行复制（overwrite/skip/rename） |
```

**Step 3: 更新变更记录**

追加：

```markdown
| 2026-06-21 | v0.1.5 | 新增技能复制功能：两步式冲突检测 + 弹窗三策略处理 |
```

**Step 4: Commit**

```bash
git add Agent.md
git commit -m "docs: update Agent.md for v0.1.5 copy feature"
```

---

### Task 7: 端到端验证

**Step 1: 启动服务**

```bash
cd E:\TreaProjects\SkillManager && python main.py
```

**Step 2: 验证清单**

- [ ] 打开 `http://127.0.0.1:7788`，UI 正常渲染
- [ ] 选中一个 skill，看到「复制到…」按钮
- [ ] 点击「复制到…」→ 弹窗列出其他来源（排除当前来源、只读来源灰显）
- [ ] 选择目标，点「确认复制」
- [ ] 无冲突场景：toast 成功提示，列表刷新，目标来源数量 +1
- [ ] 有冲突场景：弹窗显示冲突信息 + 三按钮
  - [ ] 覆盖：旧文件被替换
  - [ ] 跳过：不做变更，toast "已跳过"
  - [ ] 重命名：创建 `xxx_copy` 目录，toast 显示新名
- [ ] 复制到只读来源被阻止（下拉中可选但按钮行为？或直接不显示）
- [ ] 复制中按钮显示 loading 态

**Step 3: 修复发现的问题**

**Step 4: Commit 修复**

```bash
git add -A
git commit -m "fix: e2e verification fixes"
```
