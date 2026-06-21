"""Shared test fixtures for SkillManager."""
import pytest
import os
import json
import tempfile
import shutil
from pathlib import Path

@pytest.fixture
def temp_workspace():
    """Create a temp workspace with source and target skill dirs, plus config."""
    tmp = tempfile.mkdtemp(prefix="skillmgr_test_")
    src_dir = os.path.join(tmp, "source_skills")
    tgt_dir = os.path.join(tmp, "target_skills")
    read_only_dir = os.path.join(tmp, "readonly_skills")
    os.makedirs(src_dir)
    os.makedirs(tgt_dir)
    os.makedirs(read_only_dir)

    config = {
        "sources": [
            {"name": "src", "label": "Test Source", "path": src_dir, "writable": True},
            {"name": "tgt", "label": "Test Target", "path": tgt_dir, "writable": True},
            {"name": "ro",  "label": "Read Only",  "path": read_only_dir, "writable": False},
        ]
    }
    config_path = os.path.join(tmp, "config.json")
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f)

    yield {
        "root": tmp,
        "config_path": config_path,
        "src_dir": src_dir,
        "tgt_dir": tgt_dir,
        "read_only_dir": read_only_dir,
        "config": config,
    }

    shutil.rmtree(tmp, ignore_errors=True)


@pytest.fixture
def client(temp_workspace, monkeypatch):
    """FastAPI TestClient with monkeypatched config path."""
    import main
    monkeypatch.setattr(main, "CONFIG_PATH", temp_workspace["config_path"])
    from fastapi.testclient import TestClient
    return TestClient(main.app)


