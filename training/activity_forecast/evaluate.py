"""Explicit historical test evaluation. Do not use this output to tune the model."""

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import joblib
import pandas as pd

from training.activity_forecast.common import DATA, ROOT
from training.activity_forecast.train import chronological_split, score_candidates


def evaluate(output: Path):
    bundle = joblib.load(output / ('best_model.joblib' if (output/'best_model.joblib').exists() else 'model.joblib'))
    if bundle.get('schema_version') == 2:
        from training.activity_forecast.improve import evaluate_fresh
        return evaluate_fresh(output)
    rows = pd.read_csv(DATA / 'processed/training_rows.csv')
    _, _, test = chronological_split(rows)
    metrics, predictions, _ = score_candidates(bundle['model'], bundle.get('calibration_scale', 1.0), test)
    report = {'model_version': bundle['version'], 'selected_method': bundle['default_method'],
              'historical_test': metrics,
              'caveat': 'This historical test period was inspected during earlier experiments. It is not a fresh independent test.'}
    (output / 'historical_test_evaluation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'weights/activity_forecast')
    evaluate(parser.parse_args().output)
