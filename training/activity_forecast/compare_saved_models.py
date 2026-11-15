"""Paired comparison of two already frozen checkpoints; does not train a model.

The August-October outcomes have already been viewed. This is a post-hoc
checkpoint comparison, not another independent test or hyperparameter search.
"""
import json

import joblib
import numpy as np
import pandas as pd

from training.activity_forecast.common import ROOT
from training.activity_forecast.prepare import build_features
from training.activity_forecast.seasonal import add_seasonality, candidate_predictions
from training.activity_forecast.improve import metrics_for
from training.activity_forecast.release_depth4 import (
    OUTPUT, RELEASE_DATA, sha, save_json, read_json, check_frozen, recorded_stage,
)


def compare():
    protocol = check_frozen(OUTPUT)
    old = ROOT/'weights/activity_forecast/model.joblib'
    new = OUTPUT/'model.joblib'
    if sha(old)==sha(new):
        old = ROOT/'weights/activity_forecast/archive'/protocol['version']/'model.joblib'
    identity = {'previous_model_sha256':sha(old),'depth4_model_sha256':sha(new)}
    destination = OUTPUT/'paired_comparison.json'
    if destination.exists():
        result = read_json(destination)
        if any(result[k] != v for k,v in identity.items()):
            raise ValueError('A checkpoint changed since the recorded paired comparison')
        for stage in ('validation','test'):
            recorded_stage(OUTPUT,stage)
        print(json.dumps(result,indent=2))
        return result
    decision_protocol = {**identity,
        'comparison_scope':'Post-hoc paired comparison; these outcomes were already viewed. No training or tuning.',
        'common_availability_lag_days':4,
        'native_previous_training_lag_days':3,
        'promotion_condition':'Depth-four test MAE lower than previous, strict majority of test weeks lower, and validation MAE no higher than previous.',
        'caveat':'Previous weights were trained with a three-day target gap; both frozen models now receive identical four-day-available inputs and identical targets. This measures operational checkpoint performance, not the causal effect of depth.'}
    save_json(OUTPUT/'paired_comparison_protocol.json',decision_protocol)
    bundles = {'previous':joblib.load(old),'depth4':joblib.load(new)}
    summaries = {}
    for stage in ('validation','test'):
        recorded = recorded_stage(OUTPUT,stage)
        if recorded is None:
            raise ValueError('The originally planned evaluation must already be recorded')
        processed = RELEASE_DATA/f'{stage}_processed'
        daily = pd.read_csv(processed/'daily_world.csv')
        annual = pd.read_csv(processed/'seasonal_history/daily_world.csv')
        rows = build_features(daily,4)
        rows = rows.loc[rows.issue_date.isin(pd.to_datetime(protocol[f'{stage}_issues']))].copy()
        rows = add_seasonality(rows,daily,annual)
        predictions = {name:candidate_predictions(bundle['models'],rows)['seasonal_correction_tree']
                       for name,bundle in bundles.items()}
        baseline = candidate_predictions(bundles['depth4']['models'],rows)['repeat_last_week']
        reports = {name:metrics_for(rows,prediction,baseline) for name,prediction in predictions.items()}
        np.testing.assert_allclose(reports['depth4']['mae_hours'],recorded['metrics']['mae_hours'])
        folds = []
        actual = rows.target_week_hours.to_numpy()
        for issue in pd.to_datetime(protocol[f'{stage}_issues']):
            mask = (rows.issue_date==issue).to_numpy()
            folds.append({'issue_date':str(issue.date()),
                **{f'{name}_mae_hours':float(abs(prediction[mask]-actual[mask]).mean())
                   for name,prediction in predictions.items()}})
        wins = sum(fold['depth4_mae_hours']<fold['previous_mae_hours'] for fold in folds)
        summaries[stage] = {'models':reports,'folds':folds,'depth4_weeks_beating_previous':wins,
            'weekly_folds':len(folds),'depth4_mae_reduction_vs_previous_percent':
            100*(reports['previous']['mae_hours']-reports['depth4']['mae_hours'])/reports['previous']['mae_hours']}
        errors = rows[['cell_id','issue_date','target_start','target_end','target_week_hours']].copy()
        for name,prediction in predictions.items():
            errors[f'{name}_prediction_hours'] = prediction
            errors[f'{name}_absolute_error_hours'] = abs(prediction-actual)
        errors.to_csv(OUTPUT/f'paired_{stage}_errors.csv.gz',index=False)
    validation, test = summaries['validation'], summaries['test']
    better = (test['models']['depth4']['mae_hours']<test['models']['previous']['mae_hours']
        and test['depth4_weeks_beating_previous']>test['weekly_folds']/2
        and validation['models']['depth4']['mae_hours']<=validation['models']['previous']['mae_hours'])
    result = {**decision_protocol,'depth4_better_under_comparison_rule':better,'results':summaries}
    save_json(destination,result)
    print(json.dumps(result,indent=2))
    return result


if __name__=='__main__':
    compare()
