from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, StreamingResponse
import os
import json
import yaml
import shutil
from pathlib import Path
from typing import Optional

import httpx

app = FastAPI(title="SkillManager")

# Custom JSON encoder to handle non-serializable types
class SafeJSONResponse(JSONResponse):
    def render(self, content) -> bytes:
        return json.dumps(
            content,
            ensure_ascii=False,
            allow_nan=False,
            default=str
        ).encode("utf-8")

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")

def load_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def sanitize_for_json(obj):
    """Recursively convert obj to JSON-safe types."""
    if isinstance(obj, dict):
        return {str(k): sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_for_json(v) for v in obj]
    if isinstance(obj, (str, int, float, bool)) or obj is None:
        return obj
    return str(obj)


def parse_frontmatter(skill_dir: str) -> dict:
    """Parse SKILL.md frontmatter from a skill directory."""
    skill_md = os.path.join(skill_dir, "SKILL.md")
    if not os.path.exists(skill_md):
        return {"name": os.path.basename(skill_dir), "description": "(无 SKILL.md)"}

    with open(skill_md, "r", encoding="utf-8") as f:
        content = f.read()

    if content.startswith("---"):
        end = content.find("---", 3)
        if end != -1:
            try:
                fm = yaml.safe_load(content[3:end])
                if isinstance(fm, dict):
                    return sanitize_for_json(fm)
            except Exception:
                pass

    return {"name": os.path.basename(skill_dir), "description": "(无法解析 frontmatter)"}

def get_dir_size(path: str) -> int:
    total = 0
    try:
        for root, dirs, files in os.walk(path):
            for f in files:
                fp = os.path.join(root, f)
                if os.path.exists(fp):
                    total += os.path.getsize(fp)
    except Exception:
        pass
    return total // 1024

def scan_skills(selected_source: Optional[str] = None):
    config = load_config()
    sources = config["sources"]

    if selected_source:
        sources = [s for s in sources if s["name"] == selected_source]

    skills = {}

    for src in sources:
        src_name = src["name"]
        src_label = src["label"]
        src_path = src["path"]
        src_writable = src["writable"]
        exclude = src.get("exclude", [])

        if not os.path.exists(src_path):
            continue

        for entry in os.listdir(src_path):
            entry_path = os.path.join(src_path, entry)
            if not os.path.isdir(entry_path) or entry in exclude:
                continue

            is_symlink = os.path.islink(entry_path)
            real_path = os.path.realpath(entry_path) if is_symlink else None

            fm = parse_frontmatter(entry_path)
            skill_name = fm.get("name") or entry

            if skill_name not in skills:
                skills[skill_name] = {
                    "name": skill_name,
                    "description": fm.get("description", ""),
                    "locations": [],
                    "size_kb": 0,
                    "frontmatter": fm,
                    "all_names": set(),
                }

            skills[skill_name]["all_names"].add(entry)
            skills[skill_name]["locations"].append({
                "source": src_name,
                "source_label": src_label,
                "folder_name": entry,
                "path": entry_path,
                "writable": src_writable and not is_symlink,
                "is_symlink": is_symlink,
                "real_path": real_path,
            })

            if not is_symlink and skills[skill_name]["size_kb"] == 0:
                skills[skill_name]["size_kb"] = get_dir_size(entry_path)

    result = []
    for s in skills.values():
        s["all_names"] = list(s["all_names"])
        s["can_delete"] = any(loc["writable"] for loc in s["locations"])
        result.append(s)

    result.sort(key=lambda x: x["name"].lower())
    return result


@app.get("/api/sources")
def get_sources():
    config = load_config()
    return SafeJSONResponse(config["sources"])


@app.get("/api/skills")
def get_skills(source: Optional[str] = None, q: Optional[str] = None):
    skills = scan_skills(source)
    if q:
        q = q.lower()
        skills = [
            s for s in skills
            if q in s["name"].lower() or q in (s["description"] or "").lower()
        ]
    return SafeJSONResponse(skills)


@app.get("/api/skills/{name}")
def get_skill(name: str, source: Optional[str] = None):
    skills = scan_skills(source)
    for s in skills:
        if s["name"] == name:
            s["file_tree"] = build_file_tree(s["locations"][0]["path"])
            return SafeJSONResponse(s)
    raise HTTPException(404, "Skill not found")


@app.get("/api/skills/{name}/file")
def get_skill_file(name: str, path: str, source: Optional[str] = None):
    """Read a file inside a skill directory. path is relative to skill dir."""
    skills = scan_skills(source)
    target = None
    for s in skills:
        if s["name"] == name:
            target = s
            break

    if not target:
        raise HTTPException(404, "Skill not found")

    # Use the first writable location's path as base
    skill_dir = target["locations"][0]["path"]
    full_path = os.path.normpath(os.path.join(skill_dir, path))

    # Security: prevent path traversal
    if not full_path.startswith(os.path.normpath(skill_dir)):
        raise HTTPException(400, "Invalid path")

    if not os.path.isfile(full_path):
        raise HTTPException(404, "File not found")

    try:
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
        return PlainTextResponse(content)
    except UnicodeDecodeError:
        return PlainTextResponse("(二进制文件，无法显示)", status_code=200)


def build_file_tree(path: str, rel_path: str = "", depth: int = 0) -> list:
    """Build a file tree. rel_path is relative path from skill root."""
    if depth > 10:  # safety limit
        return []
    items = []
    try:
        for entry in sorted(os.listdir(path)):
            entry_path = os.path.join(path, entry)
            entry_rel = os.path.join(rel_path, entry) if rel_path else entry
            if os.path.isdir(entry_path):
                items.append({
                    "name": entry,
                    "type": "dir",
                    "rel_path": entry_rel,
                    "children": build_file_tree(entry_path, entry_rel, depth + 1)
                })
            else:
                size = os.path.getsize(entry_path)
                items.append({
                    "name": entry,
                    "type": "file",
                    "rel_path": entry_rel,
                    "size": size
                })
    except Exception:
        pass
    return items


@app.delete("/api/skills/{name}")
async def delete_skill(name: str, request: Request):
    import json as json_mod

    skills = scan_skills()
    target = None
    for s in skills:
        if s["name"] == name:
            target = s
            break

    if not target:
        raise HTTPException(404, "Skill not found")

    body = await request.json()
    raw_locations = body.get("locations", [])

    # Extract path strings from location objects (frontend sends [{path, writable}])
    paths_to_delete = []
    for item in raw_locations:
        if isinstance(item, str):
            paths_to_delete.append(item)
        elif isinstance(item, dict) and "path" in item:
            paths_to_delete.append(item["path"])

    # Fallback: use all writable locations from target skill
    if not paths_to_delete:
        paths_to_delete = [loc["path"] for loc in target["locations"] if loc["writable"]]

    deleted = []
    skipped = []

    # Normalize all paths for comparison
    paths_to_delete = [os.path.normpath(p) for p in paths_to_delete]

    for loc in target["locations"]:
        norm_loc_path = os.path.normpath(loc["path"])
        if norm_loc_path not in paths_to_delete:
            continue
        if not loc["writable"]:
            skipped.append(f"{loc['path']} (只读)")
            continue
        try:
            if loc["is_symlink"]:
                os.unlink(loc["path"])
            else:
                shutil.rmtree(loc["path"])
            deleted.append(loc["path"])
        except Exception as e:
            skipped.append(f"{loc['path']} (删除失败: {str(e)})")

    return SafeJSONResponse({"deleted": deleted, "skipped": skipped})


@app.post("/api/skills/copy/check")
async def copy_skill_check(request: Request):
    import json as json_mod
    body = await request.json()
    skill_name = body.get("skill_name", "").strip()
    source_id = body.get("source_id", "").strip()
    target_id = body.get("target_id", "").strip()

    config = load_config()
    source_names = {s["name"] for s in config["sources"]}
    if source_id not in source_names:
        raise HTTPException(400, f"Unknown source: {source_id}")
    if target_id not in source_names:
        raise HTTPException(400, f"Unknown target: {target_id}")
    if source_id == target_id:
        raise HTTPException(400, "Source and target must differ")

    target_src = next(s for s in config["sources"] if s["name"] == target_id)
    if not target_src["writable"]:
        raise HTTPException(400, "Target source is read-only")

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
    dst_path = os.path.normpath(os.path.join(target_base, skill_name))

    # Ensure target base directory exists
    os.makedirs(target_base, exist_ok=True)

    if os.path.exists(dst_path):
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

    # Pre-create destination to work around copytree sandbox issues on Windows
    os.makedirs(dst_path, exist_ok=True)
    shutil.copytree(src_path, dst_path, dirs_exist_ok=True)
    return SafeJSONResponse({
        "conflict": False,
        "success": True,
        "action": "copied",
        "skill_name": skill_name,
        "target_path": dst_path
    })


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

    config = load_config()
    source_names = {s["name"] for s in config["sources"]}
    if source_id not in source_names:
        raise HTTPException(400, f"Unknown source: {source_id}")
    if target_id not in source_names:
        raise HTTPException(400, f"Unknown target: {target_id}")
    if source_id == target_id:
        raise HTTPException(400, "Source and target must differ")

    target_src = next(s for s in config["sources"] if s["name"] == target_id)
    if not target_src["writable"]:
        raise HTTPException(400, "Target source is read-only")

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

    os.makedirs(target_base, exist_ok=True)

    if strategy == "skip":
        if os.path.exists(dst_path):
            return SafeJSONResponse({"success": True, "action": "skipped", "skill_name": skill_name, "target_path": dst_path})
        os.makedirs(dst_path, exist_ok=True)
        shutil.copytree(src_path, dst_path, dirs_exist_ok=True)
        return SafeJSONResponse({"success": True, "action": "copied", "skill_name": skill_name, "target_path": dst_path})

    if strategy == "overwrite":
        if os.path.exists(dst_path):
            shutil.rmtree(dst_path)
        os.makedirs(dst_path, exist_ok=True)
        shutil.copytree(src_path, dst_path, dirs_exist_ok=True)
        return SafeJSONResponse({"success": True, "action": "copied", "skill_name": skill_name, "target_path": dst_path})

    # strategy == "rename"
    final_name = skill_name
    counter = 0
    while os.path.exists(os.path.join(target_base, final_name)):
        counter += 1
        final_name = skill_name + "_copy" if counter == 1 else f"{skill_name}_copy{counter}"
    final_dst = os.path.join(target_base, final_name)
    os.makedirs(final_dst, exist_ok=True)
    shutil.copytree(src_path, final_dst, dirs_exist_ok=True)
    return SafeJSONResponse({"success": True, "action": "renamed", "renamed_to": final_name, "skill_name": skill_name, "target_path": final_dst})


# ---- Market API ----

SKILLS_SH_BASE = "https://skills.sh"
GITHUB_API_BASE = "https://api.github.com"


def _check_github_rate_limit(resp) -> None:
    """Check GitHub API rate limit headers. Raises HTTPException on limit hit."""
    if resp.status_code in (403, 429) and resp.headers.get("X-RateLimit-Remaining") == "0":
        reset_ts = resp.headers.get("X-RateLimit-Reset", "")
        reset_msg = ""
        if reset_ts:
            from datetime import datetime, timezone
            try:
                reset_time = datetime.fromtimestamp(int(reset_ts), tz=timezone.utc).strftime("%H:%M:%S")
                reset_msg = f"，重置时间 UTC {reset_time}"
            except (ValueError, OSError):
                pass
        raise HTTPException(429, f"GitHub API 速率限制已达上限{reset_msg}，请稍后重试")


async def get_http_client():
    return httpx.AsyncClient(
        timeout=httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=5.0),
        follow_redirects=True,
    )


@app.get("/api/market/skills")
async def market_skills(page: int = 1, search: Optional[str] = None):
    """Proxy skills.sh all-time list, merge local conflict status."""
    config = load_config()
    writable_sources = [s for s in config["sources"] if s.get("writable")]

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

    # Client-side search filter
    skills = data.get("skills", [])
    if search:
        q = search.lower()
        skills = [s for s in skills if q in s.get("name", "").lower()]

    # Annotate conflict status
    config_sources = {s["name"]: s for s in config["sources"]}
    for skill in skills:
        skill_name = skill.get("name") or skill.get("skillId")
        conflicts = []
        for src in writable_sources:
            if src["name"] not in config_sources:
                continue
            src_path = config_sources[src["name"]]["path"]
            skill_dir = os.path.normpath(os.path.join(src_path, skill_name))
            if os.path.exists(skill_dir):
                conflicts.append(src["name"])
        skill["conflicts"] = conflicts

    return SafeJSONResponse({
        "skills": skills,
        "total": data.get("total", len(skills)),
        "hasMore": data.get("hasMore", False),
        "page": data.get("page", page),
    })


@app.get("/api/market/skill/{owner}/{repo}/{skillId}")
async def market_skill_detail(owner: str, repo: str, skillId: str):
    """Fetch SKILL.md content from GitHub."""
    url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}/contents/{skillId}/SKILL.md"

    try:
        async with await get_http_client() as client:
            headers = {"Accept": "application/vnd.github.v3.raw"}
            resp = await client.get(url, headers=headers)
            _check_github_rate_limit(resp)
            if resp.status_code == 404:
                raise HTTPException(404, f"Skill '{skillId}' 在 {owner}/{repo} 中不存在")
            resp.raise_for_status()
            content = resp.text
    except httpx.ConnectError:
        raise HTTPException(502, "无法连接 GitHub，请检查网络")
    except httpx.TimeoutException:
        raise HTTPException(502, "GitHub 请求超时")
    except HTTPException:
        raise
    except Exception as e:
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
    """Check which writable sources already have this skill."""
    config = load_config()
    writable_sources = [s for s in config["sources"] if s.get("writable")]
    conflicts = {}
    for src in config["sources"]:
        src_path = src["path"]
        skill_dir = os.path.normpath(os.path.join(src_path, skillId))
        conflicts[src["name"]] = os.path.exists(skill_dir)
    return SafeJSONResponse({"conflicts": conflicts})


@app.post("/api/market/install")
async def market_install(request: Request):
    """
    Download skill files from GitHub and install to selected sources.
    Returns SSE streaming progress.
    """
    import json as json_mod

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
    all_names = {s["name"] for s in config["sources"]}

    for src_name in sources:
        if src_name not in all_names:
            raise HTTPException(400, f"来源 '{src_name}' 不存在")
        if src_name not in writable_names:
            raise HTTPException(400, f"来源 '{src_name}' 不可写")

    async def generate():
        skills = []
        steps = []
        total = len(sources)
        completed = 0
        failed = 0

        try:
            # Step 1: Recursively fetch files from GitHub
            yield f"data: {json_mod.dumps({'type': 'progress', 'step': 'fetch', 'message': '正在从 GitHub 获取 skill 文件...'})}\n\n"

            async with await get_http_client() as client:
                fetched = 0
                headers = {"Accept": "application/vnd.github.v3+json"}

                async def fetch_dir_recursive(api_path: str, skill_prefix: str):
                    """Recursively fetch a directory from GitHub Contents API."""
                    nonlocal fetched
                    url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}/contents/{api_path}"
                    resp = await client.get(url, headers=headers)
                    if resp.status_code == 404:
                        return
                    if resp.status_code in (403, 429) and resp.headers.get("X-RateLimit-Remaining") == "0":
                        reset_ts = resp.headers.get("X-RateLimit-Reset", "")
                        reset_msg = f"，重置时间 UTC {reset_ts}" if reset_ts else ""
                        raise HTTPException(429, f"GitHub API 速率限制已达上限{reset_msg}，请稍后重试")
                    resp.raise_for_status()
                    entries = resp.json()
                    if not isinstance(entries, list):
                        entries = [entries]

                    for entry in entries:
                        if entry.get("type") == "dir":
                            await fetch_dir_recursive(entry["path"], skill_prefix)
                        elif entry.get("type") == "file":
                            try:
                                raw_url = entry.get("download_url")
                                if not raw_url:
                                    continue
                                file_resp = await client.get(raw_url)
                                file_resp.raise_for_status()
                                # Store path relative to skill root
                                rel = entry.get("path", entry["name"])
                                if rel.startswith(skill_prefix + "/"):
                                    rel = rel[len(skill_prefix) + 1:]
                                skills.append({
                                    "name": os.path.basename(rel),
                                    "path": rel,
                                    "content": file_resp.text if isinstance(file_resp.text, str) else file_resp.content,
                                })
                                fetched += 1
                                yield f"data: {json_mod.dumps({'type': 'progress', 'step': 'fetch', 'message': f'已获取 {fetched} 个文件', 'detail': entry['name']})}\n\n"
                            except Exception as e:
                                yield f"data: {json_mod.dumps({'type': 'progress', 'step': 'fetch', 'message': f'获取文件 {entry.get('name', '?')} 失败: {str(e)}', 'warning': True})}\n\n"

                await fetch_dir_recursive(skill_id, skill_id)

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

                    if os.path.exists(target_dir):
                        step["status"] = "skipped"
                        step["message"] = f"{src_name}: 已存在同名 skill，跳过"
                        yield f"data: {json_mod.dumps({'type': 'progress', 'step': 'install', 'source': src_name, 'status': 'skipped', 'message': step['message']})}\n\n"
                        completed += 1
                        yield f"data: {json_mod.dumps({'type': 'progress', 'completed': completed, 'failed': failed, 'total': total})}\n\n"
                        continue

                    os.makedirs(target_dir, exist_ok=True)
                    for sk in skills:
                        # Use path (relative to skill root) to preserve subdirectory structure
                        rel = sk.get("path", sk["name"])
                        file_path = os.path.normpath(os.path.join(target_dir, rel))
                        if not file_path.startswith(target_dir):
                            continue
                        os.makedirs(os.path.dirname(file_path), exist_ok=True)
                        mode = "wb" if isinstance(sk["content"], bytes) else "w"
                        encoding = None if isinstance(sk["content"], bytes) else "utf-8"
                        with open(file_path, mode, encoding=encoding) as f:
                            f.write(sk["content"])

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
                    step["status"] = "error"
                    step["message"] = f"{src_name}: 写入失败 — {str(e)}"
                    failed += 1
                    yield f"data: {json_mod.dumps({'type': 'progress', 'step': 'install', 'source': src_name, 'status': 'error', 'message': step['message']})}\n\n"
                except Exception as e:
                    step["status"] = "error"
                    step["message"] = f"{src_name}: {str(e)}"
                    failed += 1
                    yield f"data: {json_mod.dumps({'type': 'progress', 'step': 'install', 'source': src_name, 'status': 'error', 'message': step['message']})}\n\n"

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


# Serve static files
static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/")
def root():
    return FileResponse(os.path.join(static_dir, "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=7788)
