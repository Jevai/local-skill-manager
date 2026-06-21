"""Tests for POST /api/skills/copy endpoint."""
import os
from helpers import make_skill


class TestCopyOverwrite:
    """strategy=overwrite replaces existing skill."""

    def test_overwrites_existing_skill(self, client, temp_workspace):
        make_skill(temp_workspace["src_dir"], "my-skill", "New version")
        make_skill(temp_workspace["tgt_dir"], "my-skill", "Old version")

        res = client.post("/api/skills/copy", json={
            "skill_name": "my-skill",
            "source_id": "src",
            "target_id": "tgt",
            "strategy": "overwrite",
        })

        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert data["action"] == "copied"
        content = open(os.path.join(temp_workspace["tgt_dir"], "my-skill", "SKILL.md")).read()
        assert "New version" in content


class TestCopySkip:
    """strategy=skip does nothing when target exists, copies when target empty."""

    def test_skips_when_target_exists(self, client, temp_workspace):
        make_skill(temp_workspace["src_dir"], "my-skill", "Source")
        make_skill(temp_workspace["tgt_dir"], "my-skill", "Target")

        res = client.post("/api/skills/copy", json={
            "skill_name": "my-skill",
            "source_id": "src",
            "target_id": "tgt",
            "strategy": "skip",
        })

        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert data["action"] == "skipped"
        # Target unchanged
        content = open(os.path.join(temp_workspace["tgt_dir"], "my-skill", "SKILL.md")).read()
        assert "Target" in content

    def test_copies_when_target_empty(self, client, temp_workspace):
        make_skill(temp_workspace["src_dir"], "my-skill", "Source")

        res = client.post("/api/skills/copy", json={
            "skill_name": "my-skill",
            "source_id": "src",
            "target_id": "tgt",
            "strategy": "skip",
        })

        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert data["action"] == "copied"
        assert os.path.isdir(os.path.join(temp_workspace["tgt_dir"], "my-skill"))


class TestCopyRename:
    """strategy=rename creates a new directory with _copy suffix."""

    def test_renames_when_target_exists(self, client, temp_workspace):
        make_skill(temp_workspace["src_dir"], "my-skill", "Source")
        make_skill(temp_workspace["tgt_dir"], "my-skill", "Original")

        res = client.post("/api/skills/copy", json={
            "skill_name": "my-skill",
            "source_id": "src",
            "target_id": "tgt",
            "strategy": "rename",
        })

        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert data["action"] == "renamed"
        assert data["renamed_to"] == "my-skill_copy"
        assert os.path.isdir(os.path.join(temp_workspace["tgt_dir"], "my-skill_copy"))
        # Original still there
        assert os.path.isdir(os.path.join(temp_workspace["tgt_dir"], "my-skill"))


class TestCopyErrors:
    """Validation errors for copy endpoint."""

    def test_rejects_invalid_strategy(self, client, temp_workspace):
        make_skill(temp_workspace["src_dir"], "my-skill")
        res = client.post("/api/skills/copy", json={
            "skill_name": "my-skill",
            "source_id": "src",
            "target_id": "tgt",
            "strategy": "invalid",
        })
        assert res.status_code == 400

    def test_rejects_unknown_source(self, client, temp_workspace):
        res = client.post("/api/skills/copy", json={
            "skill_name": "my-skill",
            "source_id": "unknown",
            "target_id": "tgt",
            "strategy": "skip",
        })
        assert res.status_code == 400

    def test_rejects_readonly_target(self, client, temp_workspace):
        make_skill(temp_workspace["src_dir"], "my-skill")
        res = client.post("/api/skills/copy", json={
            "skill_name": "my-skill",
            "source_id": "src",
            "target_id": "ro",
            "strategy": "skip",
        })
        assert res.status_code == 400
