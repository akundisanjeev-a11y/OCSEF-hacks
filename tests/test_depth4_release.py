import json

import joblib
import numpy as np
import pandas as pd
import pytest

import training.activity_forecast.release_depth4 as release


@pytest.fixture
def frozen_candidate(tmp_path,monkeypatch):
    data = tmp_path/'datasets/activity_forecast'
    monkeypatch.setattr(release,'ROOT',tmp_path)
    monkeypatch.setattr(release,'DATA',data)
    monkeypatch.setattr(release,'RELEASE_DATA',data/'releases/depth4')
    metadata = {'dataset':'public-global-fishing-effort:v5.0','grid_degrees':5,
                'availability_lag_days':3}
    for block,start,end in [('','2025-01-01','2025-06-30'),
                            ('fresh_test','2025-07-01','2025-07-31'),
                            ('seasonal_history','2024-01-01','2024-07-31')]:
        destination = data/'processed'/block
        destination.mkdir(parents=True,exist_ok=True)
        pd.DataFrame({'cell_id':'lat20_lon40','date':pd.date_range(start,end),
                      'fishing_hours':np.arange(len(pd.date_range(start,end)))+10.}).to_csv(
                          destination/'daily_world.csv',index=False)
        (destination/'metadata.json').write_text(json.dumps(metadata))
    output = tmp_path/'candidate'
    protocol = release.freeze(output)
    return output,protocol,data


def test_freeze_uses_depth_four_and_only_available_labels_without_holdout_files(frozen_candidate,monkeypatch):
    output,protocol,data = frozen_candidate
    model = joblib.load(output/'model.joblib')
    assert model['models']['correction_tree'].max_depth==4
    assert model['data_metadata']['availability_lag_days']==4
    assert pd.Timestamp(protocol['trained_label_available_through']) < pd.Timestamp('2025-08-01')
    assert not (data/'raw').exists()
    monkeypatch.setattr(release,'fit_candidates',lambda *a,**k:pytest.fail('Repeated freeze must not refit'))
    assert release.freeze(output)==protocol


def test_freeze_detects_changed_training_sources(frozen_candidate):
    output,_,data = frozen_candidate
    with (data/'processed/daily_world.csv').open('a') as stream:
        stream.write('\n')
    with pytest.raises(ValueError,match='Training source changed'):
        release.check_frozen(output)


def test_test_collection_requires_recorded_validation(frozen_candidate,monkeypatch):
    output,_,_ = frozen_candidate
    monkeypatch.setattr(release,'collect',lambda *a,**k:pytest.fail('Must not collect before validation'))
    with pytest.raises(ValueError,match='record validation'):
        release.prepare_test(output)


def test_recorded_validation_is_reused_without_downloading_or_re_evaluating(frozen_candidate,monkeypatch):
    output,protocol,_ = frozen_candidate
    result = {'model_sha256':protocol['frozen_model_sha256'],
              'protocol_sha256':release.sha(output/'selection_freeze.json'),'source_sha256':{}}
    release.save_json(output/'validation_evaluation.json',result)
    monkeypatch.setattr(release,'prepare_validation',lambda *a:pytest.fail('Must reuse saved result'))
    assert release.evaluate_stage(output,'validation')==result


def test_planned_validation_is_scored_once_without_refitting(frozen_candidate,monkeypatch):
    output,protocol,data = frozen_candidate
    destination = data/'validation'
    for annual in (False,True):
        folder = destination/'seasonal_history' if annual else destination
        folder.mkdir(parents=True,exist_ok=True)
        dates = pd.date_range('2024-01-01' if annual else '2025-01-01',
                              '2024-08-31' if annual else '2025-08-31')
        pd.DataFrame({'cell_id':'lat20_lon40','date':dates,
                      'fishing_hours':20.+np.arange(len(dates))%8}).to_csv(folder/'daily_world.csv',index=False)
        release.save_json(folder/'metadata.json',{'dataset':'public-global-fishing-effort:v5.0',
            'grid_degrees':5,'availability_lag_days':4})
    monkeypatch.setattr(release,'prepare_validation',lambda *a:destination)
    monkeypatch.setattr(release,'fit_candidates',lambda *a,**k:pytest.fail('Validation must not fit'))
    result = release.evaluate_stage(output,'validation')
    assert result['metrics']['weekly_folds']==4
    assert [row['issue_date'] for row in result['folds']]==protocol['validation_issues']
    assert release.sha(output/'model.joblib')==protocol['frozen_model_sha256']
    assert release.evaluate_stage(output,'validation')==result
    with (destination/'daily_world.csv').open('a') as stream:
        stream.write('\n')
    with pytest.raises(ValueError,match='evaluation source has changed'):
        release.recorded_stage(output,'validation')


def test_existing_evaluation_entrypoint_returns_recorded_candidate_test(frozen_candidate):
    from training.activity_forecast.improve import evaluate_fresh
    output,protocol,_ = frozen_candidate
    metrics = {'mae_hours':9.,'baseline_mae_hours':10.}
    result = {'model_sha256':protocol['frozen_model_sha256'],
              'model_version':protocol['version'],'selected_method':'seasonal_correction_tree',
              'protocol_sha256':release.sha(output/'selection_freeze.json'),'source_sha256':{},
              'metrics':metrics,'protocol':'test protocol','limitations':[]}
    for stage in ('validation','test'):
        release.save_json(output/f'{stage}_evaluation.json',result)
    returned = evaluate_fresh(output)
    assert returned['fresh_test']==metrics
    assert returned['model_sha256']==protocol['frozen_model_sha256']


def test_failed_validation_cannot_replace_existing_checkpoint(frozen_candidate,monkeypatch):
    output,protocol,_ = frozen_candidate
    existing = release.ROOT/'weights/activity_forecast/model.joblib'
    existing.parent.mkdir(parents=True)
    existing.write_bytes(b'previous checkpoint')
    def recorded(_output,stage):
        return {'model_sha256':protocol['frozen_model_sha256'],'metrics':{
            'beats_baseline':stage=='test','weeks_beating_baseline':4,'weekly_folds':7}}
    monkeypatch.setattr(release,'recorded_stage',recorded)
    assert release.promote(output) is False
    assert existing.read_bytes()==b'previous checkpoint'
    assert not (release.ROOT/'.env').exists()
    assert release.read_json(output/'release_decision.json')['promoted'] is False


def test_explicit_previous_model_policy_releases_permanently_and_preserves_baseline_failure(frozen_candidate,monkeypatch):
    output,protocol,_ = frozen_candidate
    existing = release.ROOT/'weights/activity_forecast/model.joblib'
    existing.parent.mkdir(parents=True)
    existing.write_bytes(b'previous checkpoint')
    previous_hash = release.sha(existing)
    for stage in ('validation','test'):
        release.save_json(output/f'{stage}_evaluation.json',{
            'model_sha256':protocol['frozen_model_sha256'],
            'protocol_sha256':release.sha(output/'selection_freeze.json'),'source_sha256':{},
            'protocol':'frozen protocol','metrics':{'beats_baseline':stage=='test',
                'weeks_beating_baseline':4,'weekly_folds':7}})
    release.save_json(output/'paired_comparison.json',{
        'depth4_model_sha256':protocol['frozen_model_sha256'],
        'previous_model_sha256':previous_hash,'depth4_better_under_comparison_rule':True})
    release.save_json(output/'release_decision.json',{'promoted':False,'validation_passes_gate':False})
    assert release.promote(output,replace_if_better_than_previous=True) is True
    assert release.sha(existing)==protocol['frozen_model_sha256']
    assert release.sha(existing.with_name('best_model.joblib'))==protocol['frozen_model_sha256']
    archived = existing.parent/'archive'/protocol['version']/'model.joblib'
    assert release.sha(archived)==previous_hash
    decision = release.read_json(output/'release_decision.json')
    assert decision['permanent'] is True and decision['validation_passes_gate'] is False
    assert release.read_json(output/'baseline_release_decision.json')['promoted'] is False
    assert 'ACTIVITY_FORECAST_DATA_DIR' in (release.ROOT/'.env').read_text()


@pytest.mark.parametrize('mae_win,wins,folds,expected',[
    (True,4,7,True),(True,3,7,False),(False,7,7,False),(True,2,4,False),(True,3,4,True)])
def test_release_gate_requires_both_lower_mae_and_majority_of_weeks(mae_win,wins,folds,expected):
    assert release.passes_gate({'metrics':{'beats_baseline':mae_win,
        'weeks_beating_baseline':wins,'weekly_folds':folds}})==expected
