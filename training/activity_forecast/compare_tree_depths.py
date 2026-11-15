"""Controlled development-validation check; never evaluates July or saves a checkpoint."""
import json
from time import perf_counter

import numpy as np
import pandas as pd
from sklearn.tree import DecisionTreeRegressor

from training.activity_forecast.common import DATA, FEATURES
from training.activity_forecast.seasonal import add_seasonality, RULE_FEATURES
from training.activity_forecast.train import chronological_split


def main():
    processed = DATA/'processed'
    rows = add_seasonality(pd.read_csv(processed/'training_rows.csv'),
                          pd.read_csv(processed/'daily_world.csv'),
                          pd.read_csv(processed/'seasonal_history/daily_world.csv'))
    train, validation, _ = chronological_split(rows)
    baseline = validation[FEATURES[0]].to_numpy()*7
    scale = np.maximum.reduce([train[FEATURES[0]].to_numpy()*7,
                               train[FEATURES[2]].to_numpy()*7, np.ones(len(train))])
    val_scale = np.maximum.reduce([baseline, validation[FEATURES[2]].to_numpy()*7,
                                   np.ones(len(validation))])
    target = (train.target_week_hours.to_numpy()-train[FEATURES[0]].to_numpy()*7)/scale
    baseline_mae = float(np.abs(validation.target_week_hours.to_numpy()-baseline).mean())
    results = []
    for depth in [2, 4, 6]:
        start = perf_counter()
        model = DecisionTreeRegressor(criterion='absolute_error', max_depth=depth,
                                      min_samples_leaf=500, random_state=42)
        model.fit(train[RULE_FEATURES], target, sample_weight=scale)
        predictions = np.maximum(0, baseline+model.predict(validation[RULE_FEATURES])*val_scale)
        mae = float(np.abs(validation.target_week_hours.to_numpy()-predictions).mean())
        row = {'max_depth':depth, 'leaves':int(model.get_n_leaves()),
               'validation_mae_hours':mae, 'baseline_mae_hours':baseline_mae,
               'reduction_percent':100*(baseline_mae-mae)/baseline_mae,
               'seconds':round(perf_counter()-start, 2)}
        results.append(row)
        print(json.dumps(row), flush=True)
    output = {'scope':'Original development training/validation only; no July evaluation, model save or deployment.',
              'training_rows':len(train), 'validation_rows':len(validation),
              'min_samples_leaf':500, 'inputs':RULE_FEATURES, 'results':results}
    destination = DATA/'audit/tree_depth_experiment.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(output, indent=2)+'\n', encoding='utf-8')


if __name__ == '__main__':
    main()
