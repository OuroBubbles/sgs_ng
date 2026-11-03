"""Install pinned official SDK ZIPs when sdkmanager's Java downloader stalls.

Download URLs and SHA-1 values come from Google's repository2-3.xml. This only
extracts the two named packages; it never deletes an SDK directory.
"""

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import zipfile


project = Path(__file__).resolve().parent.parent
sdk = Path(os.environ["ANDROID_HOME"]).resolve()
downloads = Path(os.environ.get("SGS_ANDROID_TOOLS_ROOT", sdk.parent)) / "downloads"
packages = [
    ("build-tools_r36_windows.zip", "build-tools/36.0.0", "f16ccffd34de8790dede813a6c7d8e2c11a27b50"),
    ("platform-36_r02.zip", "platforms/android-36", "2c1a80dd4d9f7d0e6dd336ec603d9b5c55a6f576"),
]

evidence = []
for filename, relative, expected in packages:
    archive = downloads / filename
    digest = hashlib.sha1(archive.read_bytes()).hexdigest()
    if digest != expected:
        raise RuntimeError(f"Official SDK checksum mismatch: {filename}")

    destination = (sdk / relative).resolve()
    if not destination.is_relative_to(sdk):
        raise RuntimeError("SDK target escaped the configured SDK directory")

    with zipfile.ZipFile(archive) as source:
        for item in source.infolist():
            # Official archives contain one top-level package directory.
            relative_path = PurePosixPath(item.filename).parts[1:]
            if not relative_path or item.is_dir():
                continue
            target = destination.joinpath(*relative_path).resolve()
            if not target.is_relative_to(destination):
                raise RuntimeError("Archive member escaped its package directory")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read(item))

    evidence.append({"file": filename, "officialSha1": digest, "destination": str(destination)})

output = project / ".artifacts" / "toolchain" / "android-archives.json"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
print("Official Android SDK archives verified and extracted.")
