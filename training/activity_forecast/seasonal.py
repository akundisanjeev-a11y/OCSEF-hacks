"""Small interpretable models with past-only same-calendar-period annual references."""

import numpy as np
import pandas as pd
from sklearn.tree import DecisionTreeRegressor

from training.activity_forecast.calibration import fit_scale
from training.activity_forecast.common import FEATURES

RULE_FEATURES = ['seasonal_change_fraction', 'recent_three_day_change_fraction']


def add_seasonality(rows, daily, annual_history):
    result = rows.copy()
    result['date'] = pd.to_datetime(result['date'])
    result['target_start'] = pd.to_datetime(result['target_start'])
    current = daily.copy().sort_values(['cell_id', 'date'])
    current['date'] = pd.to_datetime(current['date'])
    history = annual_history.copy()
    history['date'] = pd.to_datetime(history['date'])
    history = history.sort_values(['cell_id', 'date'])
    for data in (current, history):
        if data.duplicated(['cell_id', 'date']).any():
            raise ValueError('Duplicate daily history entries')
        if not np.isfinite(data.fishing_hours).all() or (data.fishing_hours < 0).any():
            raise ValueError('Invalid activity hours')
        if not (data.groupby('cell_id')['date'].diff().dropna() == pd.Timedelta(days=1)).all():
            raise ValueError('History must be complete and consecutive within each cell')
    current['recent_three_day_hours'] = current.groupby('cell_id').fishing_hours.transform(
        lambda s: s.rolling(3, min_periods=3).mean()) * 7
    result = result.merge(current[['cell_id', 'date', 'recent_three_day_hours']],
                          on=['cell_id', 'date'], how='left', validate='one_to_one')
    reference = history.set_index(['cell_id', 'date']).fishing_hours

    def lookup(dates):
        # Only earlier-year measurements are used, even for the forecast target dates.
        dates = dates - pd.DateOffset(years=1)
        if not (dates < result['date']).all():
            raise ValueError('Annual reference must precede the observation cutoff')
        keys = pd.MultiIndex.from_arrays([result.cell_id, dates], names=['cell_id', 'date'])
        return reference.reindex(keys).to_numpy()

    year_target = sum(lookup(result.target_start + pd.Timedelta(days=i)) for i in range(7))
    year_mean = sum(lookup(result.date - pd.Timedelta(days=i)) for i in range(28)) / 28
    valid = np.isfinite(year_target) & np.isfinite(year_mean) & (year_mean > 0)
    base = result[FEATURES[0]].to_numpy() * 7
    growth = np.divide(result[FEATURES[2]].to_numpy(), year_mean,
                       out=np.ones(len(result)), where=valid)
    # Predeclared guard against dividing by tiny annual activity, not a data filter.
    growth = np.clip(growth, 0, 5)
    result['seasonal_estimate_hours'] = np.where(valid, year_target * growth, base)
    result['seasonal_reference_available'] = valid
    scale = np.maximum.reduce([base, result[FEATURES[2]].to_numpy()*7, np.ones(len(result))])
    result[RULE_FEATURES[0]] = (result.seasonal_estimate_hours.to_numpy() - base) / scale
    result[RULE_FEATURES[1]] = (result.recent_three_day_hours.to_numpy() - base) / scale
    if not np.isfinite(result[RULE_FEATURES].to_numpy()).all():
        raise ValueError('Missing current history or invalid seasonal features')
    return result


def fit_blend(x, y):
    """Nonnegative two-coefficient least-absolute-deviation regression."""
    x, y = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    if x.ndim != 2 or x.shape != (len(y), 2) or not len(y):
        raise ValueError('Expected two predictors and one nonempty target vector')
    if not np.isfinite(x).all() or not np.isfinite(y).all() or (x < 0).any() or (y < 0).any():
        raise ValueError('Blend training data must be finite and nonnegative')
    weights = np.array([fit_scale(x[:, 0], y), 0.])
    previous_error = np.abs(y-x@weights).mean()
    for _ in range(100):
        previous = weights.copy()
        for column in range(2):
            valid = x[:, column] > 0
            if not valid.any():
                continue
            residual = y-x@weights + x[:, column]*weights[column]
            ratios, importance = residual[valid]/x[valid, column], x[valid, column]
            order = np.argsort(ratios, kind='stable')
            index = np.searchsorted(np.cumsum(importance[order]), importance.sum()/2)
            weights[column] = np.clip(ratios[order][index], 0, 2)
        error = np.abs(y-x@weights).mean()
        if error > previous_error + 1e-8:
            return previous
        if previous_error-error < 1e-7:
            break
        previous_error = error
    return weights


def fit_candidates(rows):
    baseline = rows[FEATURES[0]].to_numpy()*7
    target = rows.target_week_hours.to_numpy()
    scale = np.maximum.reduce([baseline, rows[FEATURES[2]].to_numpy()*7, np.ones(len(rows))])
    blend = fit_blend(np.column_stack([baseline, rows.seasonal_estimate_hours]), target)
    tree = DecisionTreeRegressor(criterion='absolute_error', max_depth=2,
                                min_samples_leaf=500, random_state=42)
    tree.fit(rows[RULE_FEATURES], (target-baseline)/scale, sample_weight=scale)
    return {'calibration_scale': fit_scale(baseline, target),
            'blend_weights': blend.tolist(), 'correction_tree': tree}


def candidate_predictions(models, rows):
    baseline = rows[FEATURES[0]].to_numpy()*7
    scale = np.maximum.reduce([baseline, rows[FEATURES[2]].to_numpy()*7, np.ones(len(rows))])
    return {
        'repeat_last_week': baseline,
        'trained_calibration': models['calibration_scale'] * baseline,
        'seasonal_blend': np.maximum(0, models['blend_weights'][0]*baseline +
                                    models['blend_weights'][1]*rows.seasonal_estimate_hours.to_numpy()),
        'seasonal_correction_tree': np.maximum(0, baseline +
            models['correction_tree'].predict(rows[RULE_FEATURES])*scale),
    }
