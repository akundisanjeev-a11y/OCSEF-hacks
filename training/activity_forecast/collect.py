"""Fetch worldwide daily reports sequentially; successful reports are cached."""

import argparse
from datetime import date, datetime, timezone
import hashlib
from io import BytesIO
import json
from pathlib import Path
import sys
import time
from zipfile import ZipFile, is_zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import requests

from training.activity_forecast.common import DATA, read_token

DATASET = "public-global-fishing-effort:v5.0"
URL = "https://gateway.api.globalfishingwatch.org/v3/4wings/report"
WORLD = {"type": "Polygon", "coordinates": [[[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]]]}


def month_windows(start: date, end: date):
    while start < end:
        next_month = date(start.year + (start.month == 12), start.month % 12 + 1, 1)
        stop = min(next_month, end)
        yield start.isoformat(), stop.isoformat()
        start = stop


def validate_export(content: bytes, start: str, end: str):
    if not is_zipfile(BytesIO(content)):
        raise ValueError("Expected a ZIP export; response was not accepted as training data")
    with ZipFile(BytesIO(content)) as archive:
        geometry_files = [n for n in archive.namelist() if n.endswith('geometry.geojson')]
        if len(geometry_files) != 1:
            raise ValueError('Report is missing its query geometry')
        geometry = json.loads(archive.read(geometry_files[0]))
        shapes = [feature['geometry'] for feature in geometry.get('features', [])]
        if shapes != [WORLD]:
            raise ValueError('Returned report does not cover the requested world polygon')
        readmes = [n for n in archive.namelist() if n.endswith('.md')]
        text = '\n'.join(archive.read(n).decode('utf-8-sig') for n in readmes)
        if DATASET not in text or start not in text or end not in text:
            raise ValueError("Report provenance does not match the requested version/date range")
        if not any(n.endswith('.csv') for n in archive.namelist()):
            raise ValueError("Report has no CSV")
        if archive.testzip() is not None:
            raise ValueError("Report ZIP failed its integrity check")


def collect(start: date, end: date, manifest_name: str = 'collection_manifest.json'):
    if start >= end or (end - start).days > 366:
        raise ValueError("Use an increasing date interval of at most 366 days")
    if Path(manifest_name).name != manifest_name or not manifest_name.endswith('.json'):
        raise ValueError('Manifest name must be a JSON filename inside the dataset folder')
    token = read_token()
    raw = DATA / 'raw'
    raw.mkdir(parents=True, exist_ok=True)
    reports = []
    with requests.Session() as session:
        session.headers.update({'Authorization': f'Bearer {token}'})
        for first, last in month_windows(start, end):
            path = raw / f'world_{first}_{last}_v5.zip'
            metadata_path = path.with_suffix('.metadata.json')
            params = {'datasets[0]': DATASET, 'date-range': f'{first},{last}',
                      'spatial-resolution': 'LOW', 'temporal-resolution': 'DAILY',
                      'group-by': 'FLAG', 'spatial-aggregation': 'false', 'format': 'CSV'}
            if path.is_file() and metadata_path.is_file():
                metadata = json.loads(metadata_path.read_text())
                content = path.read_bytes()
                if hashlib.sha256(content).hexdigest() != metadata['sha256']:
                    raise ValueError('Cached report hash mismatch; cached file was not reused')
                validate_export(content, first, last)
                print(f'Using cached worldwide report {first} to {last}', flush=True)
            else:
                print(f'Downloading worldwide daily report {first} to {last}...', flush=True)
                try:
                    response = session.post(URL, params=params, json={'geojson': WORLD}, timeout=(20, 130))
                except requests.Timeout:
                    response = None
                if response is None or response.status_code == 524:
                    print('Report timed out; checking the existing report without submitting another.', flush=True)
                    for _ in range(6):
                        time.sleep(10)
                        response = session.get(URL.replace('/report', '/last-report'), timeout=(20, 60))
                        if response.status_code == 200 and is_zipfile(BytesIO(response.content)):
                            break
                if response is None or response.status_code != 200:
                    status = response.status_code if response is not None else 'timeout'
                    raise ValueError(f'GFW returned HTTP {status}; no failed request is treated as zero activity')
                content = response.content
                validate_export(content, first, last)
                path.write_bytes(content)
                metadata = {'dataset': DATASET, 'scope': 'worldwide', 'bounds': [-180, -90, 180, 90],
                            'params': params, 'end_exclusive': True, 'file': path.name,
                            'retrieved_at_utc': datetime.now(timezone.utc).isoformat(),
                            'sha256': hashlib.sha256(content).hexdigest(), 'status': 'complete'}
                metadata_path.write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
                print(f'Saved {path.name} ({len(content)/1_000_000:.1f} MB)', flush=True)
            reports.append(metadata)
            (DATA / 'collection_progress.json').write_text(json.dumps(reports, indent=2) + '\n', encoding='utf-8')
    manifest = {'scope': 'worldwide', 'dataset': DATASET, 'start': start.isoformat(),
                'end_exclusive': end.isoformat(), 'reports': reports,
                'interpretation': 'Reported apparent fishing activity, not proven fishing or authorization.'}
    (DATA / manifest_name).write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--start', type=date.fromisoformat, default=date(2025, 1, 1))
    parser.add_argument('--end', type=date.fromisoformat, default=date(2025, 7, 1))
    parser.add_argument('--manifest', default='collection_manifest.json')
    args = parser.parse_args()
    try:
        result = collect(args.start, args.end, args.manifest)
    except (ValueError, requests.RequestException) as exc:
        # Do not print HTTP request objects, headers, .env contents, or credentials.
        print(f'Collection stopped: {exc if isinstance(exc, ValueError) else type(exc).__name__}', file=sys.stderr)
        raise SystemExit(1)
    print(f"Complete: {len(result['reports'])} cached worldwide reports", flush=True)


if __name__ == '__main__':
    main()
