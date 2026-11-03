"""Scan Git source without opening ignored local secrets or printing values."""

from pathlib import Path
import re
import subprocess
import sys


PATTERNS = (
    ("Supabase server key", re.compile(r"\bsb_secret_[A-Za-z0-9_-]{20,}")),
    ("OpenAI key", re.compile(r"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{30,}")),
    ("GitHub token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})")),
    ("AWS access key", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
    ("private key", re.compile(r"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----")),
    ("Slack token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}")),
)
TEXT_SUFFIXES = {
    ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".yml", ".yaml",
    ".sql", ".py", ".example", ".sample", ".template", ".pem", ".key",
    ".toml", ".html", ".css", ".svg", ".sh", ".ps1", ".cmd", ".txt",
    ".conf", ".ini", ".cfg", ".xml", ".properties", ".env",
}


def credential_path(path):
    name = path.name.lower()
    if name == ".env" or name.startswith(".env."):
        return not name.endswith((".example", ".sample", ".template"))
    return (
        name in {"id_rsa", "id_dsa", "id_ecdsa", "id_ed25519", ".pypirc"}
        or path.suffix.lower() in {".p12", ".pfx", ".jks", ".keytab"}
    )


def scan_paths(paths, root=Path(".")):
    issues = []
    for name in paths:
        path = root / name
        if not path.is_file():
            continue
        if credential_path(path):
            issues.append((name, "credential/configuration file; use an ignored local file or secret manager"))
            continue
        if (
            path.suffix.lower() not in TEXT_SUFFIXES
            and path.name != ".npmrc"
            and not path.name.startswith(("Dockerfile", "Caddyfile", ".env."))
        ):
            continue
        text = path.read_text(encoding="utf-8-sig", errors="replace")
        if path.name == ".npmrc":
            for line in text.splitlines():
                if re.match(r"\s*(?://[^=]*:)?(?:_authToken|_auth|_password)\s*=", line):
                    value = line.split("=", 1)[1].strip().strip("\"'")
                    if value and not re.fullmatch(r"\$\{[A-Za-z_][A-Za-z0-9_]*\}", value):
                        issues.append((name, "literal npm credential; use an environment reference"))
        for label, pattern in PATTERNS:
            if pattern.search(text):
                issues.append((name, label))
    return issues


def git_paths(root=Path(".")):
    result = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=root,
    )
    return sorted(set(filter(None, result.decode("utf-8").split("\0"))))


def main():
    issues = scan_paths(git_paths())
    if issues:
        for name, label in issues:
            print(f"Potential secret: {name!r} ({label})")
        return 1
    print("No recognized credentials or private configuration in tracked/unignored source.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
