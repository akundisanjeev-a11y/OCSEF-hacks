"""One learned coefficient: minimize training MAE for next_week = scale * last_week."""

import numpy as np


def fit_scale(last_week, targets) -> float:
    x = np.asarray(last_week, dtype=float)
    y = np.asarray(targets, dtype=float)
    if x.ndim != 1 or x.shape != y.shape or not len(x):
        raise ValueError('Use equally sized, nonempty one-dimensional training arrays')
    if not np.isfinite(x).all() or not np.isfinite(y).all() or (x < 0).any() or (y < 0).any():
        raise ValueError('Training hours must be finite and nonnegative')
    valid = x > 0
    if not valid.any():
        return 1.0
    # |y-a*x| = x*|y/x-a|. The weighted median of y/x minimizes MAE.
    ratios, weights = y[valid] / x[valid], x[valid]
    order = np.argsort(ratios, kind='stable')
    middle = np.searchsorted(np.cumsum(weights[order]), weights.sum() / 2)
    return float(ratios[order][middle])
