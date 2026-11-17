import json
import re
from collections import defaultdict
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PHOTO_ROOT = ROOT / "media" / "bus"
APP_FILE = ROOT / "app.js"
START_MARKER = "// Updated from the current contents of media/bus on "
INDEX_START = "const PHOTO_LIBRARY_INDEX = {"


def photo_vehicle_ids(file_name: str) -> list[str]:
    stem = Path(file_name).stem
    stem = re.sub(r"\s+\(\d+\)$", "", stem)
    return [value.strip() for value in re.split(r"\s*\+\s*", stem) if value.strip()]


def build_index() -> dict[str, list[str]]:
    index: defaultdict[str, list[str]] = defaultdict(list)
    files = sorted(
        PHOTO_ROOT.rglob("*.jpeg"),
        key=lambda path: (path.parent.name.lower(), path.name.lower()),
    )
    for path in files:
        relative_path = path.relative_to(PHOTO_ROOT).as_posix()
        for vehicle_id in photo_vehicle_ids(path.name):
            if relative_path not in index[vehicle_id]:
                index[vehicle_id].append(relative_path)
    return dict(index)


def update_app() -> None:
    content = APP_FILE.read_text(encoding="utf-8")
    marker_start = content.index(START_MARKER)
    index_start = content.index(INDEX_START, marker_start)
    index_end = content.index("\n};", index_start) + 3
    rendered = json.dumps(build_index(), ensure_ascii=False, indent=4)
    replacement = (
        f"{START_MARKER}{date.today().isoformat()}.\n"
        f"const PHOTO_LIBRARY_INDEX = {rendered}"
        f";"
    )
    APP_FILE.write_text(content[:marker_start] + replacement + content[index_end:], encoding="utf-8")


if __name__ == "__main__":
    update_app()
