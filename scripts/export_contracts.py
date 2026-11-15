"""Export teammate handoff files; never loads model weights or starts a server."""

import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.main import app
from backend.schemas import MatchRequest, MatchResponse
from backend.services.ais_matching import match_scene


def main():
    docs = ROOT / "docs"
    examples = docs / "examples"
    examples.mkdir(parents=True, exist_ok=True)
    (docs / "openapi.json").write_text(
        json.dumps(app.openapi(), indent=2) + "\n", encoding="utf-8"
    )
    scenes = json.loads((ROOT / "fixtures/synthetic/scenes.json").read_text(encoding="utf-8"))
    for scene in scenes:
        response = MatchResponse(observations=match_scene(MatchRequest.model_validate(scene["request"])))
        (examples / f"{scene['scenario']}.json").write_text(
            response.model_dump_json(indent=2) + "\n", encoding="utf-8"
        )
    print("Exported docs/openapi.json and four fictional response examples")


if __name__ == "__main__":
    main()
