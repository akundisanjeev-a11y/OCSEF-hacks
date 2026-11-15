import hashlib
import json

import joblib
import numpy as np
import pandas as pd
import pytest

from training.activity_forecast.common import FEATURES
from training.activity_forecast.prepare import build_features
from training.activity_forecast.seasonal import (RULE_FEATURES, add_seasonality,
                                                candidate_predictions, fit_blend, fit_candidates)


def histories():
    current = pd.DataFrame({'cell_id':'lat20_lon40',
        'date':pd.date_range('2025-01-01', periods=181),
        'fishing_hours':np.arange(181,dtype=float)+10})
    annual = pd.DataFrame({'cell_id':'lat20_lon40',
        'date':pd.date_range('2024-01-01','2024-07-31'),
        'fishing_hours':20.})
    return current,annual


def test_seasonal_reference_uses_prior_year_only():
    current,annual=histories()
    rows=build_features(current)
    enriched=add_seasonality(rows,current,annual)
    row=enriched.loc[enriched.date==pd.Timestamp('2025-02-01')].iloc[0]
    assert row.seasonal_reference_available
    assert row.seasonal_estimate_hours==pytest.approx(row[FEATURES[2]]*7)
    assert row.recent_three_day_hours==pytest.approx((40+41+39)*7/3)
    changed=current.copy()
    changed.loc[changed.date>pd.Timestamp('2025-02-01'),'fishing_hours']=99999.
    changed_rows=add_seasonality(rows,changed,annual)
    pd.testing.assert_frame_equal(
        enriched.loc[enriched.date<=pd.Timestamp('2025-02-01'),RULE_FEATURES],
        changed_rows.loc[changed_rows.date<=pd.Timestamp('2025-02-01'),RULE_FEATURES])


def test_missing_or_zero_annual_history_falls_back_without_dropping_rows():
    current,annual=histories()
    annual['fishing_hours']=0
    rows=build_features(current)
    enriched=add_seasonality(rows,current,annual)
    assert len(enriched)==len(rows)
    assert not enriched.seasonal_reference_available.any()
    np.testing.assert_allclose(enriched.seasonal_estimate_hours,enriched[FEATURES[0]]*7)
    missing=add_seasonality(rows,current,annual.iloc[:0])
    assert len(missing)==len(rows)
    assert not missing.seasonal_reference_available.any()
    np.testing.assert_allclose(missing.seasonal_estimate_hours,missing[FEATURES[0]]*7)


def test_annual_duplicates_and_gaps_are_rejected():
    current,annual=histories()
    rows=build_features(current)
    with pytest.raises(ValueError,match='Duplicate'):
        add_seasonality(rows,current,pd.concat([annual,annual.iloc[[0]]]))
    with pytest.raises(ValueError,match='consecutive'):
        add_seasonality(rows,current,annual.drop(index=50))


def test_blend_learns_weights():
    x=np.array([[10,2],[2,10],[5,9],[8,1],[1,9],[6,8]],dtype=float)
    y=x@np.array([0.7,0.3])
    weights=fit_blend(x,y)
    np.testing.assert_allclose(weights,[0.7,0.3],atol=1e-4)
    with pytest.raises(ValueError):
        fit_blend(x,np.full(6,float('nan')))


def test_small_tree_has_at_most_four_leaves_and_nonnegative_forecasts():
    current,annual=histories()
    rows=add_seasonality(build_features(current),current,annual)
    model=fit_candidates(rows)
    assert model['correction_tree'].get_n_leaves()<=4
    predictions=candidate_predictions(model,rows)
    for value in predictions.values():
        assert np.isfinite(value).all() and (value>=0).all()


def test_freezing_does_not_read_fresh_test_and_reports_are_reused(tmp_path,monkeypatch):
    import training.activity_forecast.improve as improvement
    current,annual=histories()
    processed=tmp_path/'processed'
    (processed/'seasonal_history').mkdir(parents=True)
    metadata={'feature_names':FEATURES,'dataset':'test-source','grid_degrees':5,'availability_lag_days':3}
    for directory in [processed,processed/'seasonal_history']:
        (directory/'metadata.json').write_text(json.dumps(metadata))
    current.to_csv(processed/'daily_world.csv',index=False)
    annual.to_csv(processed/'seasonal_history/daily_world.csv',index=False)
    build_features(current).to_csv(processed/'training_rows.csv',index=False)
    monkeypatch.setattr(improvement,'DATA',tmp_path)
    output=tmp_path/'model'
    selection=improvement.train_improved(output)
    assert not (processed/'fresh_test').exists()  # Training succeeded without test data.
    assert selection['selected_method'] in selection['candidate_names']
    model_hash=hashlib.sha256((output/'model.joblib').read_bytes()).hexdigest()
    assert selection['frozen_model_sha256']==model_hash
    bundle=joblib.load(output/'model.joblib')
    assert bundle['schema_version']==2
    assert pd.Timestamp(bundle['trained_label_available_through'])<pd.Timestamp(selection['fresh_issue_start'])
    # Test outcomes exist only after the model and choice are frozen.
    fresh=current.iloc[:31].copy()
    fresh['date']=pd.date_range('2025-07-01',periods=31)
    fresh['fishing_hours']=50.
    (processed/'fresh_test').mkdir()
    fresh.to_csv(processed/'fresh_test/daily_world.csv',index=False)
    (processed/'fresh_test/metadata.json').write_text(json.dumps(metadata))
    report=improvement.evaluate_fresh(output)
    assert report['fresh_test']['rows']>0
    repeated=improvement.evaluate_fresh(output)
    assert repeated==report
    result=improvement.predict_improved_location(12,22,bundle,pd.concat([current,fresh]),annual_history=annual)
    assert result['status']=='scored'
    assert len(result['decision_path'])<=2
    assert result['predicted_week_hours']>=0
    assert not result['seasonal_reference_available']  # August not in training references.
    extension=processed/'inference_reference'
    extension.mkdir()
    (extension/'metadata.json').write_text(json.dumps(metadata))
    pd.DataFrame({'cell_id':'lat20_lon40','date':pd.date_range('2024-08-01',periods=31),
                  'fishing_hours':20.}).to_csv(extension/'daily_world.csv',index=False)
    result=improvement.predict_improved_location(12,22,bundle,pd.concat([current,fresh]))
    assert result['seasonal_reference_available']
    assert result['seasonal_estimate_hours']==pytest.approx(350.)
    assert hashlib.sha256((output/'model.joblib').read_bytes()).hexdigest()==model_hash
    (extension/'metadata.json').write_text(json.dumps({**metadata,'dataset':'wrong-source'}))
    with pytest.raises(ValueError,match='source/grid'):
        improvement.predict_improved_location(12,22,bundle,pd.concat([current,fresh]))
