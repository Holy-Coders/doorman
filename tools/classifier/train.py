"""Offline numeric training. Called after TypeScript validates the sealed dataset.
No pickle, network access, label generation, or test-set model selection.
"""
import argparse
import json
import tempfile
from pathlib import Path

import numpy as np
import sklearn
from sklearn.linear_model import LogisticRegression
import catboost
from catboost import CatBoostClassifier


def partition(row, split):
    observed, confirmed = row['observedAt'], row['confirmedAt']
    if row['tenantId'] in split['holdoutTenants']:
        return 'holdout' if observed >= split['validationBefore'] else None
    for name, start, end in [
        ('training', 0, split['trainingBefore']),
        ('calibration', split['trainingBefore'], split['calibrationBefore']),
        ('validation', split['calibrationBefore'], split['validationBefore']),
    ]:
        if start <= observed < end and confirmed < end:
            return name
    return None


def train(data, feature_names, enrichment=None):
    rows = data['rows']
    split = data['manifest']['split']
    fitting = [i for i, r in enumerate(rows) if partition(r, split) == 'training']
    calibration = [i for i, r in enumerate(rows) if partition(r, split) == 'calibration']
    for indices in [fitting, calibration]:
        if len(indices) < 20 or len({rows[i]['positive'] for i in indices}) != 2:
            raise ValueError('Fitting and calibration each need at least 20 independently labeled sessions and both outcomes')
    labels = np.array([int(r['positive']) for r in rows])
    enriched = {} if enrichment is None else {
        (r['tenantId'], r['sampleId']): r['values'] for r in enrichment['rows']
    }
    candidates, parity = [], []
    for mode in ['telemetry'] + (['jev'] if enrichment is not None else []):
        names = [n for n in feature_names if mode == 'jev' or not n.startswith('jev_')]
        matrix = np.array([[({**r['features'], **(enriched.get((r['tenantId'], r['sampleId']), {}) if mode == 'jev' else {})}).get(n, np.nan) for n in names] for r in rows], dtype=np.float64)
        # Missingness and variance selection uses fitting data exclusively.
        usable = [j for j in range(len(names)) if np.isfinite(matrix[fitting, j]).mean() >= .8 and np.nanstd(matrix[fitting, j]) > 1e-8]
        if len(usable) < 2:
            raise ValueError('Need at least two varying, well-covered numeric features')
        matrix = matrix[:, usable]
        mean, scale = np.nanmean(matrix[fitting], axis=0), np.nanstd(matrix[fitting], axis=0)
        x = (np.where(np.isnan(matrix), mean, matrix) - mean) / scale
        columns = [{'name': names[j], 'mean': float(mean[k]), 'scale': float(scale[k])} for k, j in enumerate(usable)]
        for kind in ['logistic', 'boosted-trees']:
            if kind == 'logistic':
                estimator = LogisticRegression(C=1.0, max_iter=1000, solver='lbfgs', random_state=0).fit(x[fitting], labels[fitting])
                raw = estimator.decision_function(x)
                numeric = {'kind': kind, 'weights': estimator.coef_[0].tolist(), 'bias': float(estimator.intercept_[0])}
            else:
                estimator = CatBoostClassifier(iterations=96, depth=3, learning_rate=.05, l2_leaf_reg=10, random_seed=0, thread_count=1, allow_writing_files=False, verbose=False, nan_mode='Forbidden')
                estimator.fit(x[fitting], labels[fitting])
                raw = estimator.predict(x, prediction_type='RawFormulaVal')
                with tempfile.TemporaryDirectory() as directory:
                    path = Path(directory) / 'numeric.json'
                    estimator.save_model(str(path), format='json')
                    saved = json.loads(path.read_text())
                trees = []
                for tree in saved['oblivious_trees']:
                    splits = tree.get('splits') or []
                    if any(s['split_type'] != 'FloatFeature' for s in splits):
                        raise ValueError('Only numeric trees can be exported')
                    trees.append({'splits': [{'column': s['float_feature_index'], 'border': s['border']} for s in splits], 'leaves': tree['leaf_values']})
                numeric = {'kind': kind, 'trees': trees, 'scale': saved['scale_and_bias'][0], 'bias': saved['scale_and_bias'][1][0]}
            calibrator = LogisticRegression(C=1.0, solver='lbfgs', max_iter=1000).fit(raw[calibration].reshape(-1, 1), labels[calibration])
            slope, bias = float(calibrator.coef_[0][0]), float(calibrator.intercept_[0])
            if not .0001 <= slope <= 100:
                raise ValueError('Calibration is inverted or unstable; collect better evidence')
            name = mode + '-' + kind
            candidates.append({'name': name, 'mode': mode, 'parameters': {'columns': columns, 'estimator': numeric, 'calibration': {'slope': slope, 'bias': bias}}})
            # Native predictions are checked by the TypeScript CLI before accepting an artifact.
            probabilities = calibrator.predict_proba(raw.reshape(-1, 1))[:, 1]
            parity.append({'name': name, 'scores': probabilities.tolist()})
    return {'version': 1, 'datasetDigest': data['manifest']['digest'], 'trainerVersion': f'janitor-v1 sklearn-{sklearn.__version__} catboost-{catboost.__version__} numpy-{np.__version__}', 'candidates': candidates}, parity


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('input')
    parser.add_argument('output')
    args = parser.parse_args()
    config = json.loads(Path(args.input).read_text())
    trained, parity = train(config['dataset'], config['featureNames'], config.get('enrichment'))
    Path(args.output).write_text(json.dumps({'training': trained, 'parity': parity}, allow_nan=False))
    Path(args.output).chmod(0o600)
