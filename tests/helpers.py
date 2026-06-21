"""Shared helpers for tests."""
import os


def make_skill(parent_dir: str, name: str, description: str = "A test skill") -> str:
    """Create a minimal skill directory with SKILL.md."""
    skill_dir = os.path.join(parent_dir, name)
    os.makedirs(skill_dir, exist_ok=True)
    skill_md = os.path.join(skill_dir, "SKILL.md")
    with open(skill_md, "w", encoding="utf-8") as f:
        f.write(f"---\nname: {name}\ndescription: {description}\n---\n\n# {name}\n")
    return skill_dir
