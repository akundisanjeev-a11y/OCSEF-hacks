import numpy as np
import pandas as pd
import pytest

from training.activity_forecast.common import FEATURES
from training.activity_forecast.prepare import build_features
from training.activity_forecast.seasonal import add_seasonality, RULE_FEATURES
from training.activity_forecast.rolling_backtest import (
    aggregate_five, make_rows, training_mask, metrics, summarize_folds,
)


def test_grid_aggregation_conserves_hours_and_groups_the_correct_cells():
    fine = np.zeros((64800,2))
    ids = np.array([r*360+c for r in range(5) for c in range(5)])
    fine[ids] = [1.,2.]
    coarse = aggregate_five(fine)
    np.testing.assert_allclose(coarse[0],[25.,50.])
    np.testing.assert_allclose(coarse.sum(axis=0),fine.sum(axis=0))
    assert np.count_nonzero(coarse[:,0]) == 1


def test_weekly_features_match_the_existing_forecast_pipeline():
    dates = pd.date_range('2025-01-01',periods=70)
    annual_dates = pd.date_range('2024-01-01',periods=110)
    hours = np.array([np.arange(70,dtype=float)+10,np.zeros(70)])
    annual = np.full((2,110),20.)
    rows = make_rows(hours,dates,annual,annual_dates)
    current = pd.DataFrame({'cell_id':'cell-0','date':dates,'fishing_hours':hours[0]})
    history = pd.DataFrame({'cell_id':'cell-0','date':annual_dates,'fishing_hours':annual[0]})
    original = add_seasonality(build_features(current),current,history)
    np.testing.assert_array_equal(rows['day'],(original.date-dates[0]).dt.days)
    np.testing.assert_allclose(rows['x'],original[RULE_FEATURES])
    np.testing.assert_allclose(rows['baseline'],original[FEATURES[0]]*7)
    np.testing.assert_allclose(rows['target'],original.target_week_hours)
    assert (rows['cell']==0).all()  # A wholly quiet cell supplies no training rows.


def test_label_availability_is_strictly_before_each_issue():
    assert not training_mask(np.array([27]),40)[0]
    assert training_mask(np.array([27]),41)[0]


def test_future_changes_do_not_enter_historical_training_rows():
    dates = pd.date_range('2025-01-01',periods=100)
    annual_dates = pd.date_range('2024-01-01',periods=140)
    values = np.arange(100,dtype=float)[None,:]+10
    annual = np.full((1,140),20.)
    original = make_rows(values,dates,annual,annual_dates)
    changed = values.copy()
    changed[:,70:] = 100000
    later = make_rows(changed,dates,annual,annual_dates)
    for field in ('x','baseline','target','scale'):
        np.testing.assert_allclose(original[field][training_mask(original['day'],70)],
                                   later[field][training_mask(later['day'],70)])


def test_metrics_define_increases_and_handle_no_increase_events():
    result = metrics(np.array([20.,5.]),np.array([18.,6.]),np.array([10.,10.]))
    assert result['mae_hours'] == pytest.approx(1.5)
    assert result['directional_accuracy'] == 1
    assert result['spatial_top_decile_recall'] == 1
    quiet = metrics(np.zeros(3),np.zeros(3),np.zeros(3))
    assert quiet['directional_accuracy'] == 1
    assert quiet['spatial_top_decile_recall'] is None
    assert quiet['spatial_top_decile_jaccard'] is None


def test_fold_summary_pools_squared_errors_and_keeps_missing_spatial_scores_missing():
    records = []
    for actual, predicted, cells in [(np.array([10.]),np.array([7.]),1),
                                     (np.array([10.,10.,10.]),np.array([6.,6.,6.]),3)]:
        records.append({'region':'test','grid_degrees':1,'tree_depth':2,
                        'common_five_degree_cells':cells,
                        **metrics(actual,predicted,np.full(len(actual),10.))})
    summary = summarize_folds(pd.DataFrame(records))[0]
    assert summary['common_five_degree_mae_hours'] == pytest.approx(3.75)
    assert summary['common_five_degree_rmse_hours'] == pytest.approx(np.sqrt((9+3*16)/4))
    assert summary['baseline_rmse_hours'] == 0
    assert summary['mean_spatial_top_decile_recall'] is None
    assert summary['spatial_recall_scorable_folds'] == 0
