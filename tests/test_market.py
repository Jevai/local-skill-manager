"""Tests for Market API (skills.sh proxy + conflict check + install)."""
import pytest
import os


def test_market_skills_paginated(client):
    """GET /api/market/skills should return paginated skill list with conflict info."""
    res = client.get("/api/market/skills?page=1")
    # May return 502 if network unreachable, or 200 from live API
    assert res.status_code in (200, 502)
    if res.status_code == 200:
        data = res.json()
        assert "skills" in data
        assert "total" in data
        assert "hasMore" in data
        assert "page" in data
        if data["skills"]:
            skill = data["skills"][0]
            assert "skillId" in skill
            assert "name" in skill


def test_market_skills_search(client):
    """Should support client-side search parameter."""
    res = client.get("/api/market/skills?search=frontend")
    assert res.status_code in (200, 502)


def test_market_check(client, temp_workspace):
    """GET /api/market/check/{skillId} should return per-source conflict status."""
    res = client.get("/api/market/check/find-skills")
    assert res.status_code == 200
    data = res.json()
    assert "conflicts" in data
    expected_sources = {s["name"] for s in temp_workspace["config"]["sources"]}
    assert set(data["conflicts"].keys()) == expected_sources


def test_market_skill_detail(client):
    """GET /api/market/skill/{owner}/{repo}/{skillId} should return SKILL.md content."""
    res = client.get("/api/market/skill/anthropics/skills/frontend-design")
    assert res.status_code in (200, 404, 502)
    if res.status_code == 200:
        data = res.json()
        assert "content" in data
        assert "name" in data


def test_market_install_missing_params(client):
    """POST /api/market/install without required params should return 400."""
    res = client.post("/api/market/install", json={})
    assert res.status_code == 400


def test_market_install_source_not_writable(client, temp_workspace):
    """Installing to read-only source should be rejected."""
    res = client.post("/api/market/install", json={
        "owner": "test", "repo": "test",
        "skillId": "test-skill",
        "sources": ["ro"]
    })
    assert res.status_code == 400


def test_market_skills_handles_network_error(client, monkeypatch):
    """When skills.sh is unreachable, should return 502."""
    import httpx

    async def mock_get_error(*args, **kwargs):
        raise httpx.ConnectError("mock network error")

    monkeypatch.setattr("httpx.AsyncClient.get", mock_get_error)
    res = client.get("/api/market/skills?page=1")
    assert res.status_code == 502


def test_market_check_with_local_skill(client, temp_workspace):
    """Local skill should appear in conflicts."""
    from tests.helpers import make_skill
    make_skill(temp_workspace["src_dir"], "find-skills", "A test skill")

    res = client.get("/api/market/check/find-skills")
    assert res.status_code == 200
    data = res.json()
    assert data["conflicts"]["src"] is True


def test_market_install_precheck_bad_source(client, temp_workspace):
    """Unknown source should return 400."""
    res = client.post("/api/market/install", json={
        "owner": "test", "repo": "test",
        "skillId": "test-skill",
        "sources": ["nonexistent"]
    })
    assert res.status_code == 400
