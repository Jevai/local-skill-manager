from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
import os
import json
import yaml
import shutil
from pathlib import Path
from typing import Optional

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
