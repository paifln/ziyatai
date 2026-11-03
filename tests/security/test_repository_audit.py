"""A cleanup report must not hide the same candidates it documents."""

import importlib.util
import json
from pathlib import Path
import subprocess


def test_documenting_a_script_does_not_make_it_used(tmp_path):
    module_path = Path(__file__).resolve().parents[2] / "scripts/checks/repository-audit.py"
    spec = importlib.util.spec_from_file_location("repository_audit", module_path)
    audit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(audit)

    subprocess.run(["git", "init", "--quiet", str(tmp_path)], check=True)
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    (scripts / "manual.mjs").write_text("console.log('manual check');\n")
    (tmp_path / "README.md").write_text("Review scripts/manual.mjs before deletion.\n")
    subprocess.run(["git", "-C", str(tmp_path), "add", "."], check=True)
    # inventory reports a HEAD, so use an isolated local commit without changing
    # the user's identity, configuration or actual repository history.
    subprocess.run(["git", "-C", str(tmp_path), "-c", "user.name=Audit Test",
                    "-c", "user.email=audit@example.test", "commit", "--quiet",
                    "--no-gpg-sign", "-m", "fixture"], check=True)

    assert audit.script_candidates(audit.inventory(tmp_path)) == ["scripts/manual.mjs"]

    (tmp_path / "package.json").write_text(json.dumps({
        "scripts": {"manual": "node scripts/manual.mjs"}
    }))
    subprocess.run(["git", "-C", str(tmp_path), "add", "package.json"], check=True)
    assert audit.script_candidates(audit.inventory(tmp_path)) == []
