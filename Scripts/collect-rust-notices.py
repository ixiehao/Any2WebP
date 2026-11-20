"""Build the license and corresponding-source index for the macOS app."""

import json
from pathlib import Path
import subprocess
import sys


PROJECT = Path(__file__).resolve().parents[1]
LICENSES = PROJECT / "docs/licenses"


def resolved_packages(target):
    metadata = json.loads(subprocess.check_output(
        ["cargo", "metadata", "--manifest-path", str(PROJECT / "src-tauri/Cargo.toml"),
         "--locked", "--format-version", "1", "--filter-platform", target,
         "--features", "tauri/custom-protocol"],
        cwd=PROJECT,
    ))
    graph = metadata["resolve"]
    nodes = {node["id"]: node["deps"] for node in graph["nodes"]}
    candidates = [graph["root"]]
    reached = set()
    while candidates:
        package_id = candidates.pop()
        if package_id in reached:
            continue
        reached.add(package_id)
        candidates.extend(dep["pkg"] for dep in nodes[package_id]
                          if any(kind["kind"] != "dev" for kind in dep["dep_kinds"]))
    return sorted(
        (package for package in metadata["packages"]
         if package["id"] in reached and package["id"] != graph["root"]),
        key=lambda package: (package["name"], package["version"]),
    )


def notice_files(package, overrides):
    root = Path(package["manifest_path"]).parent
    paths = {path for path in root.iterdir() if path.is_file() and path.name.upper().startswith(
        ("LICENSE", "LICENCE", "COPYING", "NOTICE", "UNLICENSE")
    )}
    if package["license_file"]:
        paths.add(root / package["license_file"])
    key = f'{package["name"]}@{package["version"]}'
    paths.update(LICENSES / filename for filename in overrides.get(key, []))
    if not any(not path.name.upper().startswith("NOTICE") for path in paths):
        raise ValueError(f"{key} has no packaged license text. Check upstream before adding an override.")
    return sorted(paths, key=lambda path: path.name)


def write_notices(target, destination):
    overrides = json.loads((LICENSES / "rust-overrides.json").read_text(encoding="utf-8"))
    packages = resolved_packages(target)
    text_numbers = {}
    rows = []
    for package in packages:
        name, version = package["name"], package["version"]
        if package["source"] != "registry+https://github.com/rust-lang/crates.io-index":
            raise ValueError(f"Review the corresponding source URL for {package['id']}")
        source = f"https://static.crates.io/crates/{name}/{name}-{version}.crate"
        texts = []
        for path in notice_files(package, overrides):
            text = path.read_text(encoding="utf-8-sig").strip()
            if not text:
                raise ValueError(f"Empty notice for {name}@{version}: {path.name}")
            number = text_numbers.setdefault(text, len(text_numbers) + 1)
            texts.append(f"{path.name} [license text {number}]")
        rows.append(f"{name} {version} — {package['license'] or 'See notice text'}\n"
                    f"Source: {source}\n" + "\n".join(texts))
    heading = (
        f"Any2WebP Rust dependency notices ({target})\n\n"
        "Each source link identifies the exact archived crate used for this distribution.\n"
        "Cargo's locked dependency graph includes runtime and build dependencies.\n"
    )
    full_texts = [f"License text {number}\n{'=' * 24}\n{text}"
                  for text, number in text_numbers.items()]
    destination.write_text("\n\n".join([heading, *rows, *full_texts]) + "\n", encoding="utf-8")
    print(f"Recorded {len(packages)} Rust dependencies and {len(text_numbers)} notice texts.")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: collect-rust-notices.py TARGET OUTPUT")
    write_notices(sys.argv[1], Path(sys.argv[2]))
