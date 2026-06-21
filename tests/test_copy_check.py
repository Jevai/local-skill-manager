"""Tests for POST /api/skills/copy/check endpoint."""
import os
import json
from helpers import make_skill


class TestCopyCheckNoConflict:
    """When target does NOT have the skill, copy should succeed immediately."""

    def test_copies_skill_to_empty_target(self, client, temp_workspace):
        """No conflict: skill is copied and success response returned."""
        make_skill(temp_workspace["src_dir"], "my-skill", "A skill to copy")

        res = client.post("/api/skills/copy/check", json={
            "skill_name": "my-skill",
            "source_id": "src",
            "target_id": "tgt",
        })

        assert res.status_code == 200
        data = res.json()
        assert data["conflict"] is False
        assert data["success"] is True
        assert data["action"] == "copied"
        assert data["skill_name"] == "my-skill"
        assert os.path.isdir(os.path.join(temp_workspace["tgt_dir"], "my-skill"))


class TestCopyCheckConflict:
    """When target already has the skill, return conflict info (no copy)."""

    def test_detects_existing_skill_and_returns_info(self, client, temp_workspace):
        """Conflict: returns info about existing skill in target."""
        make_skill(temp_workspace["src_dir"], "my-skill", "Source version")
        make_skill(temp_workspace["tgt_dir"], "my-skill", "Target version")

        # Add an extra file to target to verify file count
        with open(os.path.join(temp_workspace["tgt_dir"], "my-skill", "extra.txt"), "w") as f:
            f.write("hello")

        res = client.post("/api/skills/copy/check", json={
            "skill_name": "my-skill",
            "source_id": "src",
            "target_id": "tgt",
        })

        assert res.status_code == 200
        data = res.json()
        assert data["conflict"] is True
        assert data["existing_skill"]["name"] == "my-skill"
        assert data["existing_skill"]["source_id"] == "tgt"
        assert data["existing_skill"]["file_count"] >= 2  # SKILL.md + extra.txt
        assert data["existing_skill"]["size_kb"] >= 0
        # Verify no copy happened
        content = open(os.path.join(temp_workspace["tgt_dir"], "my-skill", "SKILL.md")).read()
        assert "Target version" in content  # unchanged


class TestCopyCheckErrors:
    """Validation and error handling."""

    def test_rejects_unknown_source(self, client, temp_workspace):
        make_skill(temp_workspace["src_dir"], "my-skill")
        res = client.post("/api/skills/copy/check", json={
            "skill_name": "my-skill",
            "source_id": "nonexistent",
            "target_id": "tgt",
        })
        assert res.status_code == 400
        assert "nonexistent" in res.json()["detail"].lower()

    def test_rejects_unknown_target(self, client, temp_workspace):
        make_skill(temp_workspace["src_dir"], "my-skill")
        res = client.post("/api/skills/copy/check", json={
            "skill_name": "my-skill",
            "source_id": "src",
            "target_id": "nonexistent",
        })
        assert res.status_code == 400

    def test_rejects_same_source_and_target(self, client, temp_workspace):
        make_skill(temp_workspace["src_dir"], "my-skill")
        res = client.post("/api/skills/copy/check", json={
            "skill_name": "my-skill",
            "source_id": "src",
            "target_id": "src",
        })
        assert res.status_code == 400

    def test_rejects_readonly_target(self, client, temp_workspace):
        make_skill(temp_workspace["src_dir"], "my-skill")
        res = client.post("/api/skills/copy/check", json={
            "skill_name": "my-skill",
            "source_id": "src",
            "target_id": "ro",
        })
        assert res.status_code == 400

    def test_skill_not_found(self, client, temp_workspace):
        res = client.post("/api/skills/copy/check", json={
            "skill_name": "no-such-skill",
            "source_id": "src",
            "target_id": "tgt",
        })
        assert res.status_code == 404
