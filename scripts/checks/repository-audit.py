"""Read-only repository inventory. Findings are candidates, never deletion approval."""

import argparse
import hashlib
import importlib.util
import json
import re
import subprocess
from collections import Counter, defaultdict
from pathlib import Path


def git(root, *args):
    return subprocess.check_output(["git", *args], cwd=root)


def inventory(root):
    names = git(root, "ls-files", "-z").decode().split("\0")
    names = [name for name in names if name and (root / name).is_file()]
    text = {}
    sizes = {}
    hashes = defaultdict(list)
    for name in names:
        data = (root / name).read_bytes()
        sizes[name] = len(data)
        hashes[hashlib.sha256(data).hexdigest()].append(name)
        if b"\0" not in data:
            try:
                text[name] = data.decode("utf-8-sig")
            except UnicodeDecodeError:
                pass

    def references(value, exclude):
        return [name for name, source in text.items() if name != exclude and value in source]

    assets = []
    for name in names:
        if name.startswith("public/"):
            assets.append({"file": name, "references": references(Path(name).name, name)})
    scripts = []
    for name in names:
        if name.startswith("scripts/"):
            scripts.append({"file": name, "pathReferences": references(name, name),
                            "basenameReferences": references(Path(name).name, name),
                            "extensionlessImportReferences": [
                                source_name for source_name, source in text.items()
                                if source_name != name and re.search(
                                    r"(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)[\"'](?:[^\"'\n]*/)?"
                                    + re.escape(Path(name).stem) + r"[\"']", source
                                )
                            ]})

    missing_links = []
    for name, source in text.items():
        if not name.endswith(".md"):
            continue
        for match in re.finditer(r"\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))[^)]*\)", source):
            target = match.group(1) or match.group(2)
            if re.match(r"(?:[a-zA-Z][\w+.-]*:|#|/)", target):
                continue
            target = target.split("#", 1)[0].split("?", 1)[0]
            if target and not (root / name).parent.joinpath(target).exists():
                missing_links.append({"file": name, "line": source.count("\n", 0, match.start()) + 1, "target": target})

    smells = []
    markers = []
    for name, source in text.items():
        if name.startswith(("app/", "apps/", "server/", "packages/", "public/")):
            for number, line in enumerate(source.splitlines(), 1):
                if re.search(r"\b(?:TODO|FIXME|HACK|debugger)\b|console\.(?:debug|log)\(|\bprint\(", line):
                    markers.append({"file": name, "line": number, "kind": "runtime-output-or-marker"})
        if re.search(r"(?:^|[/_.-])(?:old|backup|copy|final_v\d+|test123)(?:[/_.-]|$)|(?:\.DS_Store|Thumbs\.db|\.log|\.tmp|\.swp)$", name, re.I):
            smells.append(name)

    return {
        "scope": "tracked files; substring references are evidence hints, not reachability proofs",
        "head": git(root, "rev-parse", "HEAD").decode().strip(),
        "trackedFiles": len(names), "trackedBytes": sum(sizes.values()),
        "topLevelCounts": dict(sorted(Counter(name.split("/")[0] for name in names).items())),
        "emptyFiles": [name for name in names if sizes[name] == 0],
        "duplicateGroups": [group for group in hashes.values() if len(group) > 1],
        "suspiciousNames": smells,
        "trackedIgnored": git(root, "ls-files", "-ci", "--exclude-standard").decode().splitlines(),
        "largestFiles": [{"file": name, "bytes": size} for name, size in sorted(sizes.items(), key=lambda entry: entry[1], reverse=True)[:20]],
        "largestSources": [{"file": name, "lines": source.count("\n") + 1} for name, source in sorted(text.items(), key=lambda entry: entry[1].count("\n"), reverse=True)[:25]],
        "assets": assets, "scripts": scripts,
        "missingMarkdownTargets": missing_links,
        "runtimeMarkers": markers,
    }


def history_scan(root):
    # Reuse the project detector without printing matching text or secret values.
    spec = importlib.util.spec_from_file_location("project_secret_scan", root / "scripts/checks/scan-secrets.py")
    detector = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(detector)
    entries = {}
    for line in git(root, "rev-list", "--objects", "--all").decode().splitlines():
        oid, _, name = line.partition(" ")
        if name:
            entries[oid] = name
    checks = subprocess.run(["git", "cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], cwd=root,
                            input=("\n".join(entries) + "\n").encode(), stdout=subprocess.PIPE, check=True).stdout.decode()
    objects = []
    for row in checks.splitlines():
        oid, kind, size = row.split()
        name = entries[oid]
        if kind == "blob" and int(size) <= 2_000_000 and (Path(name).suffix.lower() in detector.TEXT_SUFFIXES or Path(name).name.startswith(("Dockerfile", ".env", ".npmrc"))):
            objects.append(oid)
    batch = subprocess.run(["git", "cat-file", "--batch"], cwd=root, input=("\n".join(objects) + "\n").encode(),
                           stdout=subprocess.PIPE, check=True).stdout
    findings = []
    offset = 0
    for _ in objects:
        end = batch.index(b"\n", offset)
        oid, _, length = batch[offset:end].decode().split()
        length = int(length)
        data = batch[end + 1:end + 1 + length]
        offset = end + 1 + length + 1
        source = data.decode("utf-8-sig", errors="replace")
        name = entries[oid]
        labels = [label for label, pattern in detector.PATTERNS if pattern.search(source)]
        if detector.credential_path(Path(name)):
            labels.append("historical credential file")
        if labels:
            findings.append({"object": oid, "path": name, "labels": labels})
    return {"scope": "all locally reachable refs; existing project regex detector; not an exhaustive secret/remote audit",
            "textBlobsScanned": len(objects), "potentialFindings": findings}


def script_candidates(report):
    # Documenting a manual script must not turn it into an executable consumer.
    return [entry["file"] for entry in report["scripts"]
            if not any(not name.endswith(".md") for name in
                       entry["basenameReferences"] + entry["extensionlessImportReferences"])]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--output", type=Path, default=Path(".local/reports/repository-audit.json"))
    parser.add_argument("--history", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    report = inventory(root)
    if args.history:
        report["history"] = history_scan(root)
    output = args.output.resolve()
    # Reports are always written outside the tracked application tree by default.
    if not output.is_relative_to(root / ".local"):
        parser.error("--output must stay inside the audited repository's .local directory")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"trackedFiles": report["trackedFiles"], "trackedBytes": report["trackedBytes"],
                      "emptyFiles": report["emptyFiles"], "duplicateGroups": report["duplicateGroups"],
                      "missingMarkdownTargets": report["missingMarkdownTargets"],
                      "scriptsWithoutCodeReferences": script_candidates(report),
                      "unreferencedAssetCandidates": [entry["file"] for entry in report["assets"] if not entry["references"]],
                      "history": report.get("history"), "output": str(output)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
