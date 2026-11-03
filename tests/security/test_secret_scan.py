import importlib.util
from pathlib import Path
import subprocess

import pytest


spec = importlib.util.spec_from_file_location("secret_scan", Path(__file__).parents[2] / "scripts/scan-secrets.py")
scan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scan)


@pytest.mark.parametrize("kind", ["RSA ", "EC ", "OPENSSH ", "ENCRYPTED ", ""])
def test_detects_private_key_variants_without_disclosing_value(tmp_path, kind):
    name = "accidental.html"
    (tmp_path / name).write_text("-----BEGIN " + kind + "PRIVATE KEY-----\nprivate-material", encoding="utf-8")
    assert scan.scan_paths([name], tmp_path) == [(name, "private key")]


@pytest.mark.parametrize("name", [".env", ".env.production", ".env.local", "id_ed25519", "backup.p12"])
def test_rejects_credential_files_even_without_recognizable_tokens(tmp_path, name):
    (tmp_path / name).write_text("unrecognized-sensitive-value", encoding="utf-8")
    assert scan.scan_paths([name], tmp_path)


def test_allows_registry_configuration_and_npm_environment_references(tmp_path):
    (tmp_path / ".npmrc").write_text("registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n", encoding="utf-8")
    assert scan.scan_paths([".npmrc"], tmp_path) == []


def test_rejects_literal_npm_credentials_without_disclosing_them(tmp_path):
    (tmp_path / ".npmrc").write_text("//registry.npmjs.org/:_authToken=private-unrecognized-value", encoding="utf-8")
    assert scan.scan_paths([".npmrc"], tmp_path)[0][1].startswith("literal npm credential")


@pytest.mark.parametrize("prefix,body", [("github_pat_", "a" * 60), ("ghp_", "a" * 36), ("ASIA", "A" * 16), ("sk-proj-", "a" * 50)])
def test_covers_token_families_in_shell_and_configuration(tmp_path, prefix, body):
    (tmp_path / "setup.ps1").write_text(prefix + body, encoding="utf-8")
    issues = scan.scan_paths(["setup.ps1"], tmp_path)
    assert len(issues) == 1
    assert prefix + body not in str(issues)


def test_git_inventory_respects_ignored_local_secrets_but_never_excludes_tracked_ones(tmp_path):
    subprocess.run(["git", "init", "--quiet", str(tmp_path)], check=True)
    (tmp_path / ".gitignore").write_text(".env*\n!.env.example\n", encoding="utf-8")
    (tmp_path / ".env.local").write_text("LOCAL_ONLY=private", encoding="utf-8")
    (tmp_path / ".env.example").write_text("AUTH_SECRET=replace-me", encoding="utf-8")
    assert ".env.local" not in scan.git_paths(tmp_path)
    assert scan.scan_paths(scan.git_paths(tmp_path), tmp_path) == []
    subprocess.run(["git", "-C", str(tmp_path), "add", "--force", ".env.local"], check=True)
    assert scan.scan_paths(scan.git_paths(tmp_path), tmp_path)[0][0] == ".env.local"
