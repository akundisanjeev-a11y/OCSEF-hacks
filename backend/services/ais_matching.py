"""Conservative demo matcher; makes no authorization or fishing-activity decision."""

from collections import Counter, defaultdict
from math import asin, cos, radians, sin, sqrt

from backend.config import Settings
from backend.schemas import AISPoint, Candidate, MatchEvidence, MatchRequest, Observation, Position


def haversine_m(a: Position, b: Position) -> float:
    dlat = radians(b.lat - a.lat)
    dlon = radians(b.lon - a.lon)
    h = sin(dlat / 2) ** 2 + cos(radians(a.lat)) * cos(radians(b.lat)) * sin(dlon / 2) ** 2
    return 6_371_000 * 2 * asin(sqrt(min(1., max(0., h))))


def estimate_position(points: list[AISPoint], captured_at, max_gap_s: float):
    before = [p for p in points if p.timestamp <= captured_at]
    after = [p for p in points if p.timestamp >= captured_at]
    if not before or not after:
        return None
    left = max(before, key=lambda p: p.timestamp)
    right = min(after, key=lambda p: p.timestamp)
    # Contradictory reports at one supporting timestamp are not a usable track.
    for endpoint in (left, right):
        if any(p.timestamp == endpoint.timestamp and p.position != endpoint.position for p in points):
            return None
    gap = max((captured_at - left.timestamp).total_seconds(),
              (right.timestamp - captured_at).total_seconds())
    if gap > max_gap_s or abs(right.position.lon - left.position.lon) > 180:
        return None
    duration = (right.timestamp - left.timestamp).total_seconds()
    fraction = (captured_at - left.timestamp).total_seconds() / duration if duration else 0.
    position = Position(
        lat=left.position.lat + fraction * (right.position.lat - left.position.lat),
        lon=left.position.lon + fraction * (right.position.lon - left.position.lon),
    )
    return position, gap, sorted({left.timestamp, right.timestamp})


def match_scene(request: MatchRequest, settings: Settings | None = None) -> list[Observation]:
    """One scene per call. Conflicts remain ambiguous; no nearest-neighbor guessing."""
    settings = settings or Settings()
    tracks = defaultdict(list)
    for point in request.ais_points:
        tracks[point.mmsi].append(point)
    coverage = request.coverage
    outputs = []
    for observation in request.observations:
        evidence = MatchEvidence(
            reason_codes=[], distance_gate_m=settings.max_match_distance_meters,
            time_gate_s=settings.max_ais_point_gap_seconds,
            coverage_source=coverage.source if coverage else None,
        )
        # Reset previous identity so a new search cannot retain a stale MMSI/IMO.
        output = observation.model_copy(deep=True, update={
            "identity_status": "insufficient_data", "mmsi": None,
            "imo": None, "match_evidence": evidence,
        })
        outputs.append(output)
        if observation.position is None or observation.captured_at is None:
            evidence.reason_codes = ["missing_position_or_capture_time"]
            continue
        if (coverage is None or not coverage.adequate_for_search
                or not coverage.bounds.contains(observation.position)
                or not coverage.start <= observation.captured_at <= coverage.end):
            evidence.reason_codes = ["missing_or_inadequate_ais_coverage"]
            continue
        # Require coverage of the whole spatial gate, not just its center.
        p = observation.position
        margins = [Position(lat=coverage.bounds.south, lon=p.lon),
                   Position(lat=coverage.bounds.north, lon=p.lon),
                   Position(lat=p.lat, lon=coverage.bounds.west),
                   Position(lat=p.lat, lon=coverage.bounds.east)]
        if min(haversine_m(p, edge) for edge in margins) < settings.max_match_distance_meters:
            evidence.reason_codes = ["coverage_does_not_cover_search_radius"]
            continue
        unestimable_track = False
        for mmsi, points in tracks.items():
            usable = [point for point in points if coverage.start <= point.timestamp <= coverage.end]
            estimate = estimate_position(usable, observation.captured_at,
                                         settings.max_ais_point_gap_seconds)
            if estimate is None:
                unestimable_track = True
                continue
            position, gap, times = estimate
            distance = haversine_m(observation.position, position)
            if distance <= settings.max_match_distance_meters:
                evidence.candidates.append(Candidate(
                    mmsi=mmsi, estimated_position=position, distance_m=distance,
                    max_supporting_time_gap_s=gap, supporting_timestamps=times,
                ))
        evidence.candidates.sort(key=lambda c: (c.distance_m, c.mmsi))
        if unestimable_track:
            # Conservative: an unresolved track could be another candidate.
            evidence.reason_codes = ["incomplete_or_stale_ais_tracks"]
        elif not evidence.candidates:
            output.identity_status = "unmatched"
            evidence.reason_codes = ["no_candidate_within_gates"]
        else:
            output.identity_status = "ambiguous"
            evidence.reason_codes = ["pending_scene_assignment"]

    # Count even candidates from incomplete observations so another observation
    # cannot claim an AIS identity that the unresolved detection might share.
    claims = Counter(c.mmsi for o in outputs for c in o.match_evidence.candidates)
    for output in outputs:
        if output.identity_status != "ambiguous":
            continue
        candidates = output.match_evidence.candidates
        if len(candidates) == 1 and claims[candidates[0].mmsi] == 1:
            output.identity_status = "matched"
            output.mmsi = candidates[0].mmsi
            output.match_evidence.reason_codes = ["unique_one_to_one_candidate"]
        else:
            output.match_evidence.reason_codes = ["multiple_or_competing_candidates"]
    return outputs
