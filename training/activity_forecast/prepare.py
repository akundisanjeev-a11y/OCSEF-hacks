"""Convert complete worldwide GFW exports into three-feature forecasting rows."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np
import pandas as pd

from training.activity_forecast.common import DATA, FEATURES


def cell_for(lat: float, lon: float, grid_degrees: int = 5) -> str:
    if not np.isfinite(lat) or not np.isfinite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
        raise ValueError('Coordinates must be finite WGS84 latitude/longitude')
    if grid_degrees <= 0 or 180 % grid_degrees:
        raise ValueError('Grid degrees must divide 180')
    row = min(int(np.floor((lat + 90) / grid_degrees)), 180 // grid_degrees - 1)
    col = int(np.floor(((lon + 180) % 360) / grid_degrees))
    return f'lat{row:02d}_lon{col:02d}'


def build_features(daily: pd.DataFrame, lag_days: int = 3) -> pd.DataFrame:
    if lag_days < 0:
        raise ValueError('Availability lag cannot be negative')
    data = daily.copy().sort_values(['cell_id', 'date']).reset_index(drop=True)
    data['date'] = pd.to_datetime(data['date'], format='%Y-%m-%d')
    if data.duplicated(['cell_id', 'date']).any():
        raise ValueError('Duplicate cell/day measurements')
    if not np.isfinite(data['fishing_hours']).all() or (data['fishing_hours'] < 0).any():
        raise ValueError('Activity hours must be finite and nonnegative')
    gaps = data.groupby('cell_id')['date'].diff().dropna()
    if not (gaps == pd.Timedelta(days=1)).all():
        raise ValueError('Daily table must include consecutive days; do not impute failed reports')
    grouped = data.groupby('cell_id', sort=False)['fishing_hours']
    data[FEATURES[0]] = grouped.transform(lambda s: s.rolling(7, min_periods=7).mean())
    data[FEATURES[1]] = grouped.transform(lambda s: s.shift(7).rolling(7, min_periods=7).mean())
    data[FEATURES[2]] = grouped.transform(lambda s: s.rolling(28, min_periods=28).mean())
    # Forecast the week AFTER the simulated issue date, accounting for publishing lag.
    data['target_week_hours'] = sum(grouped.shift(-offset) for offset in range(lag_days + 1, lag_days + 8))
    data['issue_date'] = data['date'] + pd.Timedelta(days=lag_days)
    data['target_start'] = data['issue_date'] + pd.Timedelta(days=1)
    data['target_end'] = data['issue_date'] + pd.Timedelta(days=7)
    data['label_available_at'] = data['target_end'] + pd.Timedelta(days=lag_days)
    # No target is created from missing future days. All-zero history is unscorable,
    # not proof that no vessels exist or that reception is adequate.
    data = data.dropna(subset=FEATURES + ['target_week_hours'])
    data = data.loc[data[FEATURES[2]] > 0].copy()
    return data


def prepare(grid_degrees: int = 5, lag_days: int = 3, manifest_path: Path | None = None,
            processed_dir: Path | None = None, daily_only: bool = False):
    if grid_degrees <= 0 or 180 % grid_degrees:
        raise ValueError('Grid degrees must divide 180')
    manifest = json.loads((manifest_path or DATA / 'collection_manifest.json').read_text())
    expected = pd.date_range(manifest['start'], manifest['end_exclusive'], inclusive='left')
    completed_days = set()
    parts = []
    source_rows = 0
    for report in manifest['reports']:
        if report['status'] != 'complete':
            raise ValueError('Incomplete reports cannot be used as zero activity')
        first, end = report['params']['date-range'].split(',')
        days = set(pd.date_range(first, end, inclusive='left'))
        if completed_days & days:
            raise ValueError('Overlapping report windows would double-count activity')
        completed_days |= days
        path = DATA / 'raw' / report['file']
        import hashlib
        if hashlib.sha256(path.read_bytes()).hexdigest() != report['sha256']:
            raise ValueError('Raw export does not match its recorded hash')
        with ZipFile(path) as archive:
            names = [n for n in archive.namelist() if n.lower().endswith('.csv')]
            if len(names) != 1:
                raise ValueError('Expected exactly one activity CSV per report')
            with archive.open(names[0]) as stream:
                frame = pd.read_csv(stream, usecols=['Lat', 'Lon', 'Time Range', 'Apparent Fishing Hours'])
        frame = frame.rename(columns={'Lat': 'lat', 'Lon': 'lon', 'Time Range': 'date',
                                      'Apparent Fishing Hours': 'fishing_hours'})
        frame['date'] = pd.to_datetime(frame['date'], format='%Y-%m-%d')
        if not frame['date'].isin(days).all():
            raise ValueError('Returned row falls outside the requested report window')
        for name in ('lat', 'lon', 'fishing_hours'):
            if not np.isfinite(frame[name]).all():
                raise ValueError('Nonfinite source measurement')
        if not frame['lat'].between(-90, 90).all() or not frame['lon'].between(-180, 180).all() or (frame['fishing_hours'] < 0).any():
            raise ValueError('Invalid source coordinates/hours')
        row = np.floor((frame['lat'] + 90) / grid_degrees).astype(int).clip(upper=180 // grid_degrees - 1)
        col = np.floor(((frame['lon'] + 180) % 360) / grid_degrees).astype(int)
        frame['cell_id'] = 'lat' + row.astype(str).str.zfill(2) + '_lon' + col.astype(str).str.zfill(2)
        source_rows += len(frame)
        # Sum HOURS across flags and source pixels. Never sum unique-vessel counts.
        parts.append(frame.groupby(['cell_id', 'date'])['fishing_hours'].sum())
        print(f"Aggregated {report['file']}: {len(frame):,} source rows", flush=True)
    if completed_days != set(expected):
        raise ValueError('Collection has missing or extra days; download all requested windows first')
    totals = pd.concat(parts).groupby(level=['cell_id', 'date']).sum()
    cells = [f'lat{r:02d}_lon{c:02d}' for r in range(180 // grid_degrees) for c in range(360 // grid_degrees)]
    index = pd.MultiIndex.from_product([cells, expected], names=['cell_id', 'date'])
    # A zero means no activity was reported in successful exports, NOT confirmed coverage.
    daily = totals.reindex(index, fill_value=0).rename('fishing_hours').reset_index()
    rows = build_features(daily, lag_days) if not daily_only else pd.DataFrame()
    if rows.empty and not daily_only:
        raise ValueError('No trainable rows after history/target checks')
    processed = processed_dir or DATA / 'processed'
    processed.mkdir(parents=True, exist_ok=True)
    daily.to_csv(processed / 'daily_world.csv', index=False, date_format='%Y-%m-%d', float_format='%.8f')
    if not daily_only:
        rows.to_csv(processed / 'training_rows.csv', index=False, date_format='%Y-%m-%d', float_format='%.8f')
    metadata = {'scope': 'worldwide', 'grid_degrees': grid_degrees, 'dataset': manifest['dataset'],
                'start': manifest['start'], 'end_exclusive': manifest['end_exclusive'],
                'feature_names': FEATURES, 'availability_lag_days': lag_days, 'source_rows': source_rows,
                'grid_cells': len(cells), 'trainable_cells': int(rows['cell_id'].nunique()) if not daily_only else 0,
                'daily_rows': len(daily), 'training_rows': len(rows),
                'created_at_utc': datetime.now(timezone.utc).isoformat(),
                'zero_interpretation': 'No reported apparent activity in complete exports; no coverage assertion.',
                'backtest_limitations': 'Retrospective revised GFW data with an assumed publishing lag, not an as-published real-time replay.'}
    (processed / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
    if daily_only:
        print(f'Ready: {len(daily):,} daily worldwide rows; targets intentionally not created.',flush=True)
    else:
        print(f"Ready: {len(rows):,} feature/target rows across {metadata['trainable_cells']:,} worldwide cells", flush=True)
    return metadata


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--grid-degrees', type=int, default=5)
    parser.add_argument('--availability-lag-days', type=int, default=3)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--daily-only', action='store_true')
    args = parser.parse_args()
    prepare(args.grid_degrees, args.availability_lag_days, args.manifest, args.output, args.daily_only)
