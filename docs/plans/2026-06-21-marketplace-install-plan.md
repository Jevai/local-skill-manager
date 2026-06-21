# 市场安装 Skill 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 从 skills.sh 市场浏览并安装 skill 到本地用户来源

**Architecture:** 后端新增 market API（代理 skills.sh + GitHub），前端新增"本地/市场"视图切换，复用现有列表+详情布局。安装使用多源并行写入 + 实时进度反馈（SSE）。

**Tech Stack:** Python 3.13 + FastAPI + httpx（HTTP 客户端）+ SSE（进度推送），原生 HTML/CSS/JS

---

### Task 1: 后端 — 市场 API 基础（skills.sh 代理 + 冲突检查）

**Files:**
- Modify: `E:/TreaProjects/SkillManager/main.py` — 新增 market 端点
- Create: `E:/TreaProjects/SkillManager/tests/test_market.py`

**Step 1: 安装 httpx 依赖**

```bash
cd E:/TreaProjects/SkillManager && .venv/Scripts/pip install httpx
```

**Step 2: 编写 market API 测试**

```python
# tests/test_market.py
import pytest

def test_market_skills_paginated(client):
    """GET /api/market/skills 应返回分页的 skill 列表，并标注本地冲突状态"""
    res = client.get("/api/market/skills?page=1")
    assert res.status_code == 200
    data = res.json()
    assert "skills" in data
    assert "total" in data
    assert "hasMore" in data
    assert "page" in data
    # 每个 skill 应有冲突信息
    if data["skills"]:
        skill = data["skills"][0]
        assert "skillId" in skill
        assert "name" in skill
        assert "installs" in skill
        assert "source" in skill
        assert "conflicts" in skill  # list of source names with same skill

def test_market_skills_search(client):
    """应支持客户端搜索参数（后端可选代理或透传）"""
    res = client.get("/api/market/skills?search=frontend")
    assert res.status_code == 200
    data = res.json()
    assert "skills" in data

def test_market_check(client):
    """GET /api/market/check/{skillId} 应返回各来源冲突状态"""
    res = client.get("/api/market/check/find-skills")
    assert res.status_code == 200
    data = res.json()
    assert "conflicts" in data
    for src_name in ["agents", "trae", "codex", "claude", "workbuddy"]:
        assert src_name in data["conflicts"], f"Missing source: {src_name}"

def test_market_skill_detail(client):
    """GET /api/market/skill/{owner}/{repo}/{skillId} 应返回 SKILL.md 内容"""
    res = client.get("/api/market/skill/anthropics/skills/frontend-design")
    assert res.status_code in (200, 502)  # 502 = GitHub unreachable
    if res.status_code == 200:
        data = res.json()
        assert "content" in data
        assert "name" in data
```

**Step 3: 运行测试确认失败**

```bash
cd E:/TreaProjects/SkillManager && .venv/Scripts/python -m pytest tests/test_market.py -v
```
Expected: 所有 test 404/500 或 import error

**Step 4: 实现 market API 端点**

在 `main.py` 中添加：

```python
import httpx
from fastapi.responses import JSONResponse, StreamingResponse
import asyncio

# ---- Market API ----

SKILLS_SH_BASE = "https://skills.sh"
GITHUB_API_BASE = "https://api.github.com"

# httpx client with timeout (China-friendly: shorter connect timeout, longer read)
async def get_http_client():
    return httpx.AsyncClient(
        timeout=httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=5.0),
        follow_redirects=True,
    )

@app.get("/api/market/skills")
async def market_skills(page: int = 1, search: Optional[str] = None):
    """代理 skills.sh all-time 列表，合并本地冲突状态"""
    config = load_config()
    writable_sources = [s for s in config["sources"] if s.get("writable")]
    local_skills = set()
    # 收集所有本地 skill 名称
    for src in writable_sources:
        src_path = src["path"]
        if not os.path.exists(src_path):
            continue
        for entry in os.listdir(src_path):
            entry_path = os.path.join(src_path, entry)
            if os.path.isdir(entry_path):
                fm = parse_frontmatter(entry_path)
                local_skills.add(fm.get("name") or entry)

    try:
        async with await get_http_client() as client:
            resp = await client.get(f"{SKILLS_SH_BASE}/api/skills/all-time/{page}")
            resp.raise_for_status()
            data = resp.json()
    except httpx.ConnectError:
        raise HTTPException(502, "无法连接 skills.sh，请检查网络")
    except httpx.TimeoutException:
        raise HTTPException(502, "skills.sh 请求超时")
    except Exception as e:
        raise HTTPException(502, f"skills.sh 请求失败: {str(e)}")

    # 客户端搜索过滤
    skills = data.get("skills", [])
    if search:
        q = search.lower()
        skills = [s for s in skills if q in s.get("name", "").lower()]

    # 标注冲突状态
    config_sources = {s["name"]: s for s in config["sources"]}
    for skill in skills:
        skill_name = skill.get("name") or skill.get("skillId")
        conflicts = []
        for src_name in writable_sources:
            src_path = config_sources[src_name]["path"]
            skill_dir = os.path.normpath(os.path.join(src_path, skill_name))
            if os.path.exists(skill_dir):
                conflicts.append(src_name)
        skill["conflicts"] = conflicts

    return SafeJSONResponse({
        "skills": skills,
        "total": data.get("total", len(skills)),
        "hasMore": data.get("hasMore", False),
        "page": data.get("page", page),
    })


@app.get("/api/market/skill/{owner}/{repo}/{skillId}")
async def market_skill_detail(owner: str, repo: str, skillId: str):
    """从 GitHub 获取 SKILL.md 内容"""
    url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}/contents/{skillId}/SKILL.md"
    
    try:
        async with await get_http_client() as client:
            # Accept raw content
            headers = {"Accept": "application/vnd.github.v3.raw"}
            resp = await client.get(url, headers=headers)
            if resp.status_code == 404:
                raise HTTPException(404, f"Skill '{skillId}' 在 {owner}/{repo} 中不存在")
            resp.raise_for_status()
            content = resp.text
    except httpx.ConnectError:
        raise HTTPException(502, "无法连接 GitHub，请检查网络")
    except httpx.TimeoutException:
        raise HTTPException(502, "GitHub 请求超时")
    except Exception as e:
        if "502" in str(e) or "404" in str(e):
            raise
        raise HTTPException(502, f"GitHub 请求失败: {str(e)}")

    # Parse frontmatter for name/description
    fm = {"name": skillId, "description": ""}
    if content.startswith("---"):
        end = content.find("---", 3)
        if end != -1:
            try:
                parsed = yaml.safe_load(content[3:end])
                if isinstance(parsed, dict):
                    fm = sanitize_for_json(parsed)
            except Exception:
                pass

    return SafeJSONResponse({
        "name": fm.get("name") or skillId,
        "description": fm.get("description", ""),
        "content": content,
        "owner": owner,
        "repo": repo,
        "skillId": skillId,
    })


@app.get("/api/market/check/{skillId}")
async def market_check(skillId: str):
    """检查各用户来源中是否已存在同名 skill"""
    config = load_config()
    writable_sources = [s for s in config["sources"] if s.get("writable")]
    conflicts = {}
    for src in writable_sources:
        src_path = src["path"]
        skill_dir = os.path.normpath(os.path.join(src_path, skillId))
        conflicts[src["name"]] = os.path.exists(skill_dir)
    return SafeJSONResponse({"conflicts": conflicts})
```

**Step 5: 运行测试确认通过**

```bash
cd E:/TreaProjects/SkillManager && .venv/Scripts/python -m pytest tests/test_market.py -v
```
Expected: 4 pass (test_market_skill_detail 可能因网络失败给 502，调整断言)

**Step 6: 提交**

```bash
cd E:/TreaProjects/SkillManager
git add main.py tests/test_market.py
git commit -m "feat: 市场 API — skills.sh 代理 + 冲突检查 + skill 详情"
```

---

### Task 2: 后端 — 安装端点（SSE 进度推送）

**Files:**
- Modify: `E:/TreaProjects/SkillManager/main.py`
- Modify: `E:/TreaProjects/SkillManager/tests/test_market.py`

**Step 1: 新增安装测试**

```python
def test_market_install_precheck_github_unreachable(client, monkeypatch):
    """安装前 GitHub 不可达应返回 502"""
    async def mock_connect_error(*args, **kwargs):
        raise httpx.ConnectError("mock")
    
    monkeypatch.setattr("httpx.AsyncClient.get", mock_connect_error)
    res = client.post("/api/market/install", json={
        "owner": "anthropics", "repo": "skills",
        "skillId": "frontend-design",
        "sources": ["agents"]
    })
    assert res.status_code == 502
    data = res.json()
    assert "GitHub" in data["detail"] or "网络" in data["detail"]

def test_market_install_source_not_writable(client, temp_workspace, monkeypatch):
    """只读来源应被拒绝"""
    res = client.post("/api/market/install", json={
        "owner": "test", "repo": "test",
        "skillId": "test-skill",
        "sources": ["ro"]
    })
    assert res.status_code == 400
```

**Step 2: 运行测试确认失败**

```bash
.venv/Scripts/python -m pytest tests/test_market.py::test_market_install_precheck_github_unreachable -v
```
Expected: FAIL (endpoint 404)

**Step 3: 实现安装逻辑 + SSE**

在 `main.py` 添加：

```python
import json as json_mod

@app.post("/api/market/install")
async def market_install(request: Request):
    """
    从 GitHub 下载 skill 文件并安装到选中来源。
    返回 SSE 流式进度。
    """
    body = await request.json()
    owner = body.get("owner", "").strip()
    repo = body.get("repo", "").strip()
    skill_id = body.get("skillId", "").strip()
    sources = body.get("sources", [])

    if not all([owner, repo, skill_id, sources]):
        raise HTTPException(400, "缺少必要参数: owner, repo, skillId, sources")

    config = load_config()
    writable_sources = [s for s in config["sources"] if s.get("writable")]
    writable_names = {s["name"] for s in writable_sources}

    for src_name in sources:
        if src_name not in writable_names:
            raise HTTPException(400, f"来源 '{src_name}' 不可写或不存在")

    async def generate():
        skills = []
        steps = []
        total = len(sources)
        completed = 0
        failed = 0

        try:
            # Step 1: Fetch files from GitHub
            yield f"data: {json_mod.dumps({'type': 'progress', 'step': 'fetch', 'message': '正在从 GitHub 获取 skill 文件...'})}\n\n"

            async with await get_http_client() as client:
                # Get directory listing
                dir_url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}/contents/{skill_id}"
                headers = {"Accept": "application/vnd.github.v3+json"}
                dir_resp = await client.get(dir_url, headers=headers)

                if dir_resp.status_code == 404:
                    yield f"data: {json_mod.dumps({'type': 'error', 'message': f'Skill 不存在: {owner}/{repo}/{skill_id}'})}\n\n"
                    return
                dir_resp.raise_for_status()
                files_info = dir_resp.json()

                if not isinstance(files_info, list):
                    files_info = [files_info]

                # Fetch each file content
                skills = []
                fetched = 0
                for fi in files_info:
                    if fi.get("type") != "file":
                        continue
                    try:
                        raw_url = fi.get("download_url")
                        if not raw_url:
                            continue
                        file_resp = await client.get(raw_url)
                        file_resp.raise_for_status()
                        skills.append({
                            "name": fi["name"],
                            "path": fi.get("path", fi["name"]),
                            "content": file_resp.text if isinstance(file_resp.text, str) else file_resp.content,
                        })
                        fetched += 1
                        yield f"data: {json_mod.dumps({'type': 'progress', 'step': 'fetch', 'message': f'已获取 {fetched} 个文件', 'detail': fi['name']})}\n\n"
                    except Exception as e:
                        yield f"data: {json_mod.dumps({'type': 'progress', 'step': 'fetch', 'message': f'获取文件 {fi.get('name', '?')} 失败: {str(e)}', 'warning': True})}\n\n"

            if not skills:
                yield f"data: {json_mod.dumps({'type': 'error', 'message': 'Skill 仓库中未找到任何文件'})}\n\n"
                return

            # Step 2: Install to each source
            source_map = {s["name"]: s for s in config["sources"]}
            for src_name in sources:
                step = {"source": src_name, "status": "installing"}
                steps.append(step)
                yield f"data: {json_mod.dumps({'type': 'progress', 'step': 'install', 'source': src_name, 'status': 'installing', 'message': f'正在安装到 {src_name}...'})}\n\n"

                try:
                    src = source_map[src_name]
                    target_dir = os.path.normpath(os.path.join(src["path"], skill_id))

                    # Check if already exists
                    if os.path.exists(target_dir):
                        step["status"] = "skipped"
                        step["message"] = f"{src_name}: 已存在同名 skill，跳过"
                        yield f"data: {json_mod.dumps({'type': 'progress', 'step': 'install', 'source': src_name, 'status': 'skipped', 'message': step['message']})}\n\n"
                        completed += 1
                        yield f"data: {json_mod.dumps({'type': 'progress', 'completed': completed, 'failed': failed, 'total': total})}\n\n"
                        continue

                    # Create dir and write files
                    os.makedirs(target_dir, exist_ok=True)
                    for skill in skills:
                        file_path = os.path.normpath(os.path.join(target_dir, skill["name"]))
                        # Security: only write within target_dir
                        if not file_path.startswith(target_dir):
                            continue
                        mode = "wb" if isinstance(skill["content"], bytes) else "w"
                        encoding = None if isinstance(skill["content"], bytes) else "utf-8"
                        with open(file_path, mode, encoding=encoding) as f:
                            f.write(skill["content"])

                    step["status"] = "success"
                    completed += 1
                    yield f"data: {json_mod.dumps({'type': 'progress', 'step': 'install', 'source': src_name, 'status': 'success', 'message': f'{src_name}: 安装完成'})}\n\n"
                    yield f"data: {json_mod.dumps({'type': 'progress', 'completed': completed, 'failed': failed, 'total': total})}\n\n"

                except PermissionError as e:
                    step["status"] = "error"
                    step["message"] = f"{src_name}: 权限不足 — {str(e)}"
                    failed += 1
                    yield f"data: {json_mod.dumps({'type': 'progress', 'step': 'install', 'source': src_name, 'status': 'error', 'message': step['message']})}\n\n"
                except OSError as e:
                    if "No space" in str(e) or "disk" in str(e).lower():
                        step["status"] = "error"
                        step["message"] = f"{src_name}: 磁盘空间不足"
                    else:
                        step["status"] = "error"
                        step["message"] = f"{src_name}: 写入失败 — {str(e)}"
                    failed += 1
                    yield f"data: {json_mod.dumps({'type': 'progress', 'step': 'install', 'source': src_name, 'status': 'error', 'message': step['message']})}\n\n"
                except Exception as e:
                    step["status"] = "error"
                    step["message"] = f"{src_name}: {str(e)}"
                    failed += 1
                    yield f"data: {json_mod.dumps({'type': 'progress', 'step': 'install', 'source': src_name, 'status': 'error', 'message': step['message']})}\n\n"

            # Final summary
            yield f"data: {json_mod.dumps({'type': 'complete', 'completed': completed, 'failed': failed, 'total': total, 'steps': [{'source': s['source'], 'status': s['status'], 'message': s.get('message', '')} for s in steps]})}\n\n"

        except httpx.ConnectError:
            yield f"data: {json_mod.dumps({'type': 'error', 'message': '无法连接 GitHub，请检查网络（中国区可能需要代理）'})}\n\n"
        except httpx.TimeoutException:
            yield f"data: {json_mod.dumps({'type': 'error', 'message': 'GitHub 请求超时，请稍后重试'})}\n\n"
        except Exception as e:
            yield f"data: {json_mod.dumps({'type': 'error', 'message': f'安装过程出错: {str(e)}'})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )
```

**Step 4: 运行测试**

```bash
.venv/Scripts/python -m pytest tests/test_market.py -v
```
Expected: 至少 4-5 个测试通过

**Step 5: 提交**

```bash
cd E:/TreaProjects/SkillManager
git add main.py tests/test_market.py
git commit -m "feat: 市场安装 SSE 端点 — GitHub 拉取 + 多源安装 + 进度推送"
```

---

### Task 3: 前端 — 本地/市场视图切换

**Files:**
- Modify: `E:/TreaProjects/SkillManager/static/index.html`
- Modify: `E:/TreaProjects/SkillManager/static/app.js`
- Modify: `E:/TreaProjects/SkillManager/static/style.css`

**Step 1: 修改 HTML — 添加切换按钮**

在 `<div class="tabs" id="tabs"></div>` 后，搜索框前添加：

```html
<div class="view-switch" id="viewSwitch">
  <button class="view-btn active" data-view="local" onclick="switchView('local')">本地</button>
  <button class="view-btn" data-view="market" onclick="switchView('market')">市场</button>
</div>
```

**Step 2: 修改 app.js — 状态 + 切换逻辑**

```javascript
// ========== View Mode ==========
let currentView = "local";  // "local" | "market"

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
    renderTabs();  // ensure tabs re-render
  }
}
```

**Step 3: 实现 loadMarketSkills + 分页滚动**

```javascript
// ========== Market Skills ==========
let marketPage = 1;
let marketHasMore = true;
let marketLoading = false;
let marketSkills = [];  // accumulated skills from all loaded pages

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
  const loader = document.getElementById("marketLoader");
  if (!loader) {
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

// Scroll-based pagination
document.getElementById("skillList").addEventListener("scroll", function() {
  if (currentView !== "market") return;
  const el = this;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
    loadMarketSkills(false);
  }
});
```

**Step 4: 实现 renderMarketSkillList**

```javascript
function renderMarketSkillList() {
  const container = document.getElementById("skillList");
  // Keep existing items, only append new ones if not reset
  const existingCount = container.querySelectorAll(".market-item").length;
  
  for (let i = existingCount; i < marketSkills.length; i++) {
    const skill = marketSkills[i];
    const el = document.createElement("div");
    el.className = "skill-item market-item";
    
    const conflictCount = skill.conflicts ? skill.conflicts.length : 0;
    const allConflicted = conflictCount >= 5;
    
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
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M 安装";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K 安装";
  return n + " 安装";
}
```

**Step 5: 添加 CSS 样式**

在 `style.css` 添加：

```css
/* View Switch */
.view-switch {
  display: flex;
  gap: 2px;
  background: var(--bg-secondary);
  border-radius: 6px;
  padding: 2px;
  margin-bottom: 8px;
}
.view-btn {
  flex: 1;
  padding: 4px 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s;
}
.view-btn.active {
  background: var(--bg-primary);
  color: var(--text-primary);
  box-shadow: 0 1px 2px rgba(0,0,0,0.1);
}

/* Market Item States */
.market-item.all-installed {
  opacity: 0.4;
  cursor: default;
}
.market-item.partial-installed {
  opacity: 0.85;
}
.installed-label {
  font-size: 10px;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  padding: 1px 6px;
  border-radius: 3px;
}
.install-btn {
  font-size: 11px;
  color: var(--accent);
  font-weight: 500;
}
.official-badge {
  font-size: 10px;
  color: #059669;
  background: #d1fae5;
  padding: 1px 4px;
  border-radius: 2px;
}
.market-loader {
  text-align: center;
  padding: 16px;
  color: var(--text-secondary);
  font-size: 12px;
}
```

**Step 6: 提交**

```bash
cd E:/TreaProjects/SkillManager
git add static/index.html static/app.js static/style.css
git commit -m "feat: 本地/市场视图切换 + 市场列表渲染 + 滚动分页"
```

---

### Task 4: 前端 — Market 详情 + 安装面板 + 进度反馈

**Files:**
- Modify: `E:/TreaProjects/SkillManager/static/app.js`
- Modify: `E:/TreaProjects/SkillManager/static/style.css`

**Step 1: 实现 selectMarketSkill**

```javascript
async function selectMarketSkill(skill) {
  const [owner, repo] = (skill.source || "").split("/");
  if (!owner || !repo) {
    showToast("无法解析 skill 来源");
    return;
  }

  const params = new URLSearchParams();
  // Use skillId (GitHub dir name), fallback to name
  params.set("owner", owner);
  params.set("repo", repo);
  params.set("skillId", skill.skillId || skill.name);
  
  try {
    const res = await fetch("/api/market/skill/" + owner + "/" + repo + "/" + (skill.skillId || skill.name));
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

let currentMarketSkill = null;  // { skill, detail }

function renderMarketDetail(skill, detail) {
  currentMarketSkill = { skill, detail };
  const container = document.getElementById("detail");
  const conflictCount = skill.conflicts ? skill.conflicts.length : 0;
  const installsLabel = formatInstalls(skill.installs);
  const officialBadge = skill.isOfficial ? ' <span class="official-badge">官方 ✓</span>' : '';

  // Source checkboxes
  const writableSources = sources.filter(s => s.writable);
  let sourcesHtml = "";
  for (const src of writableSources) {
    const hasConflict = skill.conflicts && skill.conflicts.includes(src.name);
    const disabled = hasConflict ? "disabled" : "";
    const checked = hasConflict ? "" : "checked";
    const label = src.label + (hasConflict ? " (已存在同名)" : "");
    sourcesHtml +=
      '<label class="source-checkbox ' + (disabled ? "disabled" : "") + '">' +
        '<input type="checkbox" value="' + src.name + '" ' + checked + ' ' + disabled + ' onchange="updateInstallButton()"> ' +
        escHtml(label) +
      '</label>';
  }

  let installHtml = "";
  if (conflictCount < writableSources.length) {
    installHtml =
      '<div class="market-install">' +
        '<div class="install-sources-title">安装到:</div>' +
        '<div class="source-checkboxes">' + sourcesHtml + '</div>' +
        '<button class="btn btn-primary install-button" id="installBtn" onclick="startInstall()">安装到选中来源</button>' +
        '<div class="install-progress" id="installProgress" style="display:none"></div>' +
      '</div>';
  } else {
    installHtml = '<div class="market-install"><p class="all-installed-msg">已在所有来源中安装</p></div>';
  }

  container.innerHTML =
    '<div class="detail-header">' +
      '<div class="detail-name">' + escHtml(detail.name || skill.name) + officialBadge + '</div>' +
      '<div class="detail-meta">' +
        escHtml(skill.source || "") + " · " + installsLabel +
      '</div>' +
      '<div class="detail-desc">' + escHtml(detail.description || "(无描述)") + '</div>' +
    '</div>' +
    '<div class="market-content">' +
      renderMarkdown(detail.content || "") +
    '</div>' +
    installHtml;
}

function updateInstallButton() {
  const btn = document.getElementById("installBtn");
  if (!btn) return;
  const checked = document.querySelectorAll(".source-checkbox input:checked");
  btn.disabled = checked.length === 0;
}
```

**Step 2: 实现安装 + SSE 进度**

```javascript
async function startInstall() {
  if (!currentMarketSkill) return;
  const { skill } = currentMarketSkill;
  const [owner, repo] = (skill.source || "").split("/");
  
  const checkboxes = document.querySelectorAll(".source-checkbox input:checked");
  const selectedSources = Array.from(checkboxes).map(cb => cb.value);
  if (selectedSources.length === 0) return;

  const btn = document.getElementById("installBtn");
  btn.disabled = true;
  btn.textContent = "安装中...";

  const progress = document.getElementById("installProgress");
  progress.style.display = "block";
  progress.innerHTML = "";

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
      btn.disabled = false;
      btn.textContent = "安装到选中来源";
      return;
    }

    // Read SSE stream
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
            handleInstallEvent(event, progress);
          } catch (e) {
            // skip malformed
          }
        }
      }
    }
  } catch (e) {
    showToast("安装失败: " + e.message);
    btn.disabled = false;
    btn.textContent = "重试安装";
  }
}

function handleInstallEvent(event, progressEl) {
  if (event.type === "progress") {
    if (event.step === "fetch") {
      progressEl.innerHTML = '<div class="progress-step">' + escHtml(event.message) + '</div>';
      if (event.detail) {
        progressEl.innerHTML += '<div class="progress-detail">└─ ' + escHtml(event.detail) + '</div>';
      }
    } else if (event.step === "install") {
      let cls = "progress-source " + event.status;
      let line = '<div class="' + cls + '">';
      if (event.status === "success") line += "✅ ";
      else if (event.status === "error") line += "❌ ";
      else if (event.status === "skipped") line += "⚠️ ";
      else if (event.status === "installing") line += "🔄 ";
      line += escHtml(event.message || "") + "</div>";
      progressEl.innerHTML += line;
    }
    if (event.completed !== undefined) {
      const pct = Math.round((event.completed / event.total) * 100);
      progressEl.innerHTML +=
        '<div class="progress-bar">' +
          '<div class="progress-fill" style="width:' + pct + '%"></div>' +
        '</div>' +
        '<div class="progress-count">' + event.completed + "/" + event.total + "</div>";
    }
  } else if (event.type === "complete") {
    let summary = "安装完成: " + event.completed + " 成功";
    if (event.failed > 0) summary += ", " + event.failed + " 失败";
    progressEl.innerHTML += '<div class="progress-complete">' + summary + '</div>';
    
    const btn = document.getElementById("installBtn");
    btn.style.display = "none";
    
    // Refresh local skills
    setTimeout(async () => {
      await loadAllSkills();
      renderTabs();
    }, 1000);
    
  } else if (event.type === "error") {
    progressEl.innerHTML += '<div class="progress-error">' + escHtml(event.message) + '</div>';
    const btn = document.getElementById("installBtn");
    btn.disabled = false;
    btn.textContent = "重试安装";
  }
}
```

**Step 3: 添加安装相关 CSS**

```css
/* Market Detail */
.market-content {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 16px;
}
.market-install {
  border-top: 1px solid var(--border);
  padding-top: 16px;
}
.install-sources-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.source-checkboxes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.source-checkbox {
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  transition: all 0.15s;
}
.source-checkbox.disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: var(--bg-tertiary);
  text-decoration: line-through;
}
.install-button {
  width: 100%;
}
.install-progress {
  margin-top: 12px;
  font-size: 12px;
  font-family: var(--font-mono);
  line-height: 1.8;
}
.progress-step { color: var(--text-primary); }
.progress-detail { color: var(--text-muted); font-size: 11px; padding-left: 8px; }
.progress-source.success { color: #059669; }
.progress-source.error { color: #dc2626; }
.progress-source.skipped { color: #d97706; }
.progress-source.installing { color: var(--accent); }
.progress-bar {
  height: 4px;
  background: var(--bg-tertiary);
  border-radius: 2px;
  margin: 8px 0 4px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.3s;
}
.progress-count { color: var(--text-muted); font-size: 11px; }
.progress-complete { color: #059669; font-weight: 500; margin-top: 8px; }
.progress-error { color: #dc2626; margin-top: 4px; }
.all-installed-msg { color: var(--text-muted); font-size: 13px; text-align: center; }
```

**Step 4: 搜索框适配 market 模式**

修改搜索事件监听，在 market 模式下触发市场搜索：

```javascript
// 在 search input 的事件监听中：
document.getElementById("search").addEventListener("input", () => {
  if (currentView === "market") {
    loadMarketSkills(true);  // reset + reload with search
  } else {
    applyFilter();
  }
});
```

**Step 5: 提交**

```bash
cd E:/TreaProjects/SkillManager
git add static/app.js static/style.css
git commit -m "feat: Market 详情面板 + 多源安装 + SSE 进度反馈"
```

---

### Task 5: 端到端测试 + 边界情况处理

**Files:**
- Modify: `E:/TreaProjects/SkillManager/tests/test_market.py`

**Step 1: 补充集成测试**

```python
def test_market_skills_includes_conflicts(client, temp_workspace):
    """当本地确实有同名 skill 时，conflicts 应正确标注"""
    import os
    # Create a skill with name "test-market-skill" in src
    skill_dir = os.path.join(temp_workspace["src_dir"], "test-market-skill")
    os.makedirs(skill_dir)
    with open(os.path.join(skill_dir, "SKILL.md"), "w") as f:
        f.write("---\nname: test-market-skill\ndescription: test\n---\n")
    
    res = client.get("/api/market/skills?page=1&search=test-market-skill")
    # This will show conflicts if any market skill matches this name
    assert res.status_code == 200

def test_market_check_with_local_skill(client, temp_workspace):
    """本地存在 skill 时 check 应返回冲突"""
    import os
    skill_dir = os.path.join(temp_workspace["src_dir"], "find-skills")
    os.makedirs(skill_dir)
    with open(os.path.join(skill_dir, "SKILL.md"), "w") as f:
        f.write("---\nname: find-skills\n---\n")
    
    res = client.get("/api/market/check/find-skills")
    assert res.status_code == 200
    data = res.json()
    assert data["conflicts"].get("src") is True

def test_market_install_to_readonly_fails(client, temp_workspace):
    """安装到只读来源应被拒绝"""
    res = client.post("/api/market/install", json={
        "owner": "test", "repo": "test",
        "skillId": "test-skill",
        "sources": ["ro"]
    })
    assert res.status_code == 400

def test_market_skills_handles_network_error(client, monkeypatch):
    """skills.sh 不可达时返回 502"""
    async def mock_get_error(*args, **kwargs):
        raise httpx.ConnectError("mock network error")
    
    monkeypatch.setattr("httpx.AsyncClient.get", mock_get_error)
    res = client.get("/api/market/skills?page=1")
    assert res.status_code == 502
    assert "网络" in res.json()["detail"] or "skills.sh" in res.json()["detail"]
```

**Step 2: 运行全部测试**

```bash
cd E:/TreaProjects/SkillManager && .venv/Scripts/python -m pytest tests/test_market.py -v
```

**Step 3: 手动启动验证**

```bash
cd E:/TreaProjects/SkillManager && .venv/Scripts/python main.py
```

打开 `http://localhost:7788`，测试：
- 点击"市场"切换
- 滚动加载更多
- 搜索 market skill
- 选中 skill 查看详情
- 安装到未冲突来源
- 观察进度条和结果

**Step 4: 提交**

```bash
cd E:/TreaProjects/SkillManager
git add tests/test_market.py
git commit -m "test: 市场安装边界情况测试"
```
