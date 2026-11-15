from copy import deepcopy
import json

import pytest
from pydantic import ValidationError

from backend.config import ROOT
from backend.schemas import MatchRequest
from backend.services.ais_matching import haversine_m, match_scene


SCENES = json.loads((ROOT / "fixtures/synthetic/scenes.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("scene", SCENES, ids=lambda scene: scene["scenario"])
def test_documented_scenarios(scene):
    output = match_scene(MatchRequest.model_validate(scene["request"]))[0]
    assert output.identity_status == scene["expected_status"]
    assert output.data_mode == "synthetic"
    assert (output.mmsi is not None) == (output.identity_status == "matched")


def test_interpolates_at_capture_time():
    output = match_scene(MatchRequest.model_validate(SCENES[0]["request"]))[0]
    candidate = output.match_evidence.candidates[0]
    assert candidate.distance_m == pytest.approx(0, abs=0.001)
    assert candidate.max_supporting_time_gap_s == 120
    assert candidate.estimated_position.lat == pytest.approx(SCENES[0]['request']['observations'][0]['position']['lat'])


def test_two_detections_cannot_claim_same_ship():
    request = deepcopy(SCENES[0]["request"])
    second = deepcopy(request["observations"][0])
    second["observation_id"] = "second-observation"
    request["observations"].append(second)
    outputs = match_scene(MatchRequest.model_validate(request))
    assert all(o.identity_status == "ambiguous" and o.mmsi is None for o in outputs)


@pytest.mark.parametrize("missing_field", ["position", "captured_at"])
def test_missing_metadata(missing_field):
    request = deepcopy(SCENES[0]["request"])
    request["observations"][0][missing_field] = None
    assert match_scene(MatchRequest.model_validate(request))[0].identity_status == "insufficient_data"


def test_stale_track_is_not_unmatched_or_matched():
    request = deepcopy(SCENES[0]["request"])
    request["coverage"]["start"] = "2026-01-01T09:00:00Z"
    request["coverage"]["end"] = "2026-01-01T11:00:00Z"
    request["ais_points"][0]["timestamp"] = "2026-01-01T09:30:00Z"
    request["ais_points"][1]["timestamp"] = "2026-01-01T10:30:00Z"
    output = match_scene(MatchRequest.model_validate(request))[0]
    assert output.identity_status == "insufficient_data"


def test_unresolved_other_track_prevents_confident_identity():
    request = deepcopy(SCENES[0]["request"])
    point = deepcopy(request["ais_points"][0])
    point["mmsi"] = "999000002"
    request["ais_points"].append(point)  # Cannot bracket capture time.
    output = match_scene(MatchRequest.model_validate(request))[0]
    assert output.identity_status == "insufficient_data"
    assert output.mmsi is None
    assert len(output.match_evidence.candidates) == 1


def test_incomplete_coverage_is_not_unmatched():
    request = deepcopy(SCENES[2]["request"])
    request["coverage"]["adequate_for_search"] = False
    assert match_scene(MatchRequest.model_validate(request))[0].identity_status == "insufficient_data"


def test_search_radius_must_be_covered():
    request = deepcopy(SCENES[0]["request"])
    request["coverage"]["bounds"]["south"] = request['observations'][0]['position']['lat'] - 0.0001
    assert match_scene(MatchRequest.model_validate(request))[0].identity_status == "insufficient_data"


def test_conflicting_simultaneous_reports_are_unusable():
    request = deepcopy(SCENES[1]["request"])
    point = deepcopy(request["ais_points"][0])
    point["position"]["lat"] += 0.1
    request["ais_points"].append(point)
    assert match_scene(MatchRequest.model_validate(request))[0].identity_status == "insufficient_data"


def test_rematching_clears_previous_identity():
    observation = match_scene(MatchRequest.model_validate(SCENES[0]["request"]))[0]
    request = MatchRequest(observations=[observation], coverage=None)
    output = match_scene(request)[0]
    assert output.identity_status == "insufficient_data"
    assert output.mmsi is None and output.imo is None
    assert observation.mmsi == "999000001"  # No input mutation.


@pytest.mark.parametrize("change", ["naive_time", "duplicate_id", "mixed_scene", "mixed_provenance", "bad_lat", "nan"])
def test_rejects_invalid_contract(change):
    request = deepcopy(SCENES[0]["request"])
    if change == "naive_time":
        request["observations"][0]["captured_at"] = "2026-01-01T10:00:00"
    elif change == "duplicate_id":
        request["observations"].append(deepcopy(request["observations"][0]))
    elif change == "mixed_scene":
        second = deepcopy(request["observations"][0])
        second.update(observation_id="second", scene_id="other")
        request["observations"].append(second)
    elif change == "mixed_provenance":
        request["coverage"]["data_mode"] = "model_upload"
    elif change == "bad_lat":
        request["observations"][0]["position"]["lat"] = 100
    else:
        request["observations"][0]["position"]["lat"] = float("nan")
    with pytest.raises(ValidationError):
        MatchRequest.model_validate(request)


def test_haversine_uses_meters():
    from backend.schemas import Position
    assert haversine_m(Position(lat=0, lon=0), Position(lat=0, lon=1)) == pytest.approx(111195, abs=1)
