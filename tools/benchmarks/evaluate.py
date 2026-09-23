"""External research evaluation, never a production promotion manifest.
Train/calibrate/select on disjoint groups, then report untouched test sessions.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from sklearn.metrics import roc_auc_score, average_precision_score

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'classifier'))
from train import fit_candidates

FEATURES = ['mouse_speed', 'mouse_turn_ratio', 'mouse_pause_ratio', 'interaction_mean_ms', 'interaction_cv']
EXTENDED_FEATURES = FEATURES + ['mouse_step_mean_px', 'mouse_large_step_ratio', 'mouse_interval_cv', 'interaction_short_gap_ratio', 'interaction_repeat_gap_ratio']


def fingerprint(value):
    return hashlib.sha256(value.encode()).hexdigest()


def groups(rows):
    # Join both publisher browser identifiers so a changed fingerprint cannot split a cookie.
    parent = {}
    def find(x):
        parent.setdefault(x, x)
        if parent[x] != x:
            parent[x] = find(parent[x])
        return parent[x]
    for row in rows:
        if row.get('browserLink'):
            a, b = find(row['group']), find(row['browserLink'])
            parent[max(a,b)] = min(a,b)
    return [find(r['group']) for r in rows]


def assign_groups(values, fractions):
    unique = sorted(set(values), key=lambda s: fingerprint('doorman-external-v1:' + s))
    boundaries = np.cumsum(fractions) * len(unique)
    return {value: next(i for i, end in enumerate(boundaries) if rank < end) for rank, value in enumerate(unique)}


def metrics(rows, predictions, indices, threshold):
    y = np.array([int(rows[i]['positive']) for i in indices])
    p = np.array([predictions[i] if predictions[i] is not None else np.nan for i in indices])
    scored = np.isfinite(p)
    yes = scored & (p >= threshold)
    tp, fp = int(sum(yes & (y==1))), int(sum(yes & (y==0)))
    pos, neg = int(sum(y==1)), int(sum(y==0))
    auc = float(roc_auc_score(y[scored],p[scored])) if len(set(y[scored]))==2 else None
    ap = float(average_precision_score(y[scored],p[scored])) if len(set(y[scored]))==2 else None
    return dict(sessions=len(indices), positives=pos, negatives=neg, scored=int(sum(scored)),
                positiveCoverage=float(sum(scored & (y==1)))/pos if pos else None,
                negativeCoverage=float(sum(scored & (y==0)))/neg if neg else None,
                truePositives=tp, falsePositives=fp, precision=tp/(tp+fp) if tp+fp else None,
                recall=tp/pos if pos else None, falsePositiveRate=fp/neg if neg else None,
                rocAucScored=auc, averagePrecisionScored=ap,
                brierScored=float(np.mean((p[scored]-y[scored])**2)) if sum(scored) else None)


def threshold_on_validation(rows, scores, validation):
    # Fixed objective before test access. Null means abstain, never a negative label.
    thresholds = sorted({float(scores[i]) for i in validation if scores[i] is not None}, reverse=True)
    best, recall = 1.0, 0
    for t in thresholds:
        result = metrics(rows, scores, validation, t)
        if result['falsePositiveRate'] is not None and result['falsePositiveRate'] <= .02 and result['truePositives'] > recall:
            best, recall = t, result['truePositives']
    return best


def evaluate_fold(rows, indices, summary):
    fitting = [i for i in indices[0] if sum(k in rows[i]['features'] for k in FEATURES) >= 2]
    calibration = [i for i in indices[1] if sum(k in rows[i]['features'] for k in FEATURES) >= 2]
    results, parity = [], []
    family = summary.get('heldoutAgent', summary.get('heldoutEnvironment'))
    try:
        trained, native = fit_candidates(rows, fitting, calibration, FEATURES)
        comparison = []
        scored_by_name = {}
        for candidate, predictions in zip(trained['candidates'], native):
            columns = [c['name'] for c in candidate['parameters']['columns']]
            scores = [p if sum(n in r['features'] for n in columns)/len(columns) >= .8 else None for r,p in zip(rows,predictions['scores'])]
            scored_by_name[candidate['name']] = scores
            threshold = threshold_on_validation(rows, scores, indices[2])
            validation = metrics(rows, scores, indices[2], threshold)
            comparison.append(dict(name=candidate['name'], threshold=threshold, validation=validation, columns=columns))
            parity.append(dict(fold=family, candidate=candidate, scores=scores))
        # Use the production preference for the simpler model unless Brier improves > .002.
        selected = comparison[0]
        for challenger in comparison[1:]:
            cb, sb = challenger['validation']['brierScored'], selected['validation']['brierScored']
            if cb is not None and (sb is None or cb < sb-.002):
                selected = challenger
        results.append({**summary, 'status':'evaluated', 'selected': selected['name'], 'threshold':selected['threshold'],
                        'columns':selected['columns'], 'validationComparison':comparison,
                        'test':metrics(rows, scored_by_name[selected['name']], indices[3], selected['threshold'])})
    except ValueError as error:
        results.append({**summary, 'status':'unavailable', 'reason':str(error)})
    return results[0], parity


def fpagent(rows):
    group_ids = groups(rows)
    humans = assign_groups([group_ids[i] for i,r in enumerate(rows) if not r['positive']], [.55,.15,.15,.15])
    families = sorted({r['family'] for r in rows if r['positive']})
    results, parity = [], []
    for family in families:
        agent_groups = assign_groups([group_ids[i] for i,r in enumerate(rows) if r['positive'] and r['family'] != family], [.65,.15,.20])
        parts = [3 if r['family']==family else agent_groups[group_ids[i]] if r['positive'] else humans[group_ids[i]] for i,r in enumerate(rows)]
        indices = [[i for i,p in enumerate(parts) if p==n] for n in range(4)]
        assert not any(set(group_ids[i] for i in indices[a]) & set(group_ids[i] for i in indices[b]) for a in range(4) for b in range(a+1,4))
        # Evidence is a prerequisite to fitting, not a label. All test rows remain in denominators.
        fitting = [i for i in indices[0] if sum(k in rows[i]['features'] for k in FEATURES) >= 2]
        calibration = [i for i in indices[1] if sum(k in rows[i]['features'] for k in FEATURES) >= 2]
        test_env = {rows[i].get('environment') for i in indices[3]} - {None}
        training_env = {rows[i].get('environment') for i in indices[0]} - {None}
        summary = dict(heldoutAgent=family, partitions=[len(x) for x in indices],
                       trainingSessionsWithEvidence=len(fitting), calibrationSessionsWithEvidence=len(calibration),
                       sharedReportedEnvironments=len(test_env & training_env),
                       groupOverlap=0)
        result, fold_parity = evaluate_fold(rows, indices, summary)
        results.append(result)
        parity.extend(fold_parity)
    # Connected components of source runs, human browsers and reported environments.
    # If the agent cohort collapses into one component, a three-way independent split
    # cannot contain positives in fitting, calibration and test.
    links = {}
    def root(value):
        links.setdefault(value, value)
        if links[value] != value:
            links[value] = root(links[value])
        return links[value]
    for i,row in enumerate(rows):
        if row.get('environment'):
            a,b = root('group:'+group_ids[i]), root('env:'+row['environment'])
            links[max(a,b)] = min(a,b)
    positive_components = {root('group:'+group_ids[i]) for i,r in enumerate(rows) if r['positive'] and r.get('environment')}
    component_ids = [root('group:'+g) for g in group_ids]
    human_only = assign_groups([c for c in component_ids if c not in positive_components], [.55,.15,.15,.15])
    environment_folds = []
    for index, held in enumerate(sorted(positive_components, key=fingerprint)):
        remaining = assign_groups(list(positive_components-{held}), [.5,.25,.25])
        parts = [3 if c==held else remaining[c] if c in positive_components else human_only[c] for c in component_ids]
        indices = [[i for i,p in enumerate(parts) if p==n] for n in range(4)]
        envs = [{rows[i]['environment'] for i in indices[n] if rows[i].get('environment')} for n in range(4)]
        assert not any(envs[a] & envs[b] for a in range(4) for b in range(a+1,4))
        summary = dict(heldoutEnvironment=index+1, partitions=[len(x) for x in indices],
                       sharedReportedEnvironments=0, groupOverlap=0)
        result, fold_parity = evaluate_fold(rows, indices, summary)
        environment_folds.append(result)
        parity.extend(fold_parity)
    environment_audit = dict(agentComponents=len(positive_components),
        reportedConfigurations=len({r['environment'] for r in rows if r.get('environment')}),
        status='evaluated', folds=environment_folds,
        explanation='Connected source runs, browser identifiers and reported configurations are kept disjoint. Configurations are proxies; physical host and human participant IDs are unavailable.')
    report = dict(source='FP-Agent', sessions=len(rows), humans=sum(not r['positive'] for r in rows),
                  agents=sum(r['positive'] for r in rows), humanBrowserGroups=len(humans),
                  participantHoldoutVerified=False, physicalEnvironmentHoldoutVerified=False,
                  split='seven leave-one-agent-family-out folds; human browser groups and other agent source runs split before fitting',
                  features=FEATURES, environmentAudit=environment_audit, jev='not evaluated: no paid inference budget used',
                  productionEligible=False, folds=results)
    return report, parity


def balabit(rows):
    # With only 5-7 owner recordings, reserve the entire public test for evaluation.
    # No test labels select features, scaling, hyperparameters or a detection threshold.
    train = [r for r in rows if r['partition']=='training']
    test = [i for i,r in enumerate(rows) if r['partition']=='test']
    usable = [name for name in FEATURES if sum(name in r['features'] for r in train)/len(train)>=.8]
    scores = [None]*len(rows)
    owner_results = []
    for owner in sorted({r['group'] for r in train}):
        own = [r for r in train if r['group']==owner and all(n in r['features'] for n in usable)]
        if len(usable)<2 or len(own)<3:
            owner_results.append(dict(trainingSessions=len(own), status='insufficient-evidence'))
            continue
        x = np.array([[r['features'][n] for n in usable] for r in own])
        center, scale = np.median(x,axis=0), np.std(x,axis=0)
        scale = np.maximum(scale, [.1 if 'ratio' in n else 1 for n in usable])
        for i in test:
            row = rows[i]
            if row['group']!=owner or not all(n in row['features'] for n in usable):
                continue
            distance = float(np.mean(((np.array([row['features'][n] for n in usable])-center)/scale)**2))
            scores[i] = distance/(1+distance)
        owner_results.append(dict(trainingSessions=len(own), status='evaluated'))
    report = dict(source='Balabit', sessions=len(rows), trainingSessions=len(train), testSessions=len(test), owners=len(owner_results),
                  method='owner median and training standard deviation; mean squared standardized distance; monotonic d/(1+d) anomaly score',
                  features=usable, productionEligible=False, jev='not evaluated',
                  threshold=None, thresholdReason='Only 5-7 training recordings per owner; insufficient independent owner calibration for a reliable 95% cutoff.',
                  test=metrics(rows,scores,test,2), ownerResults=owner_results)
    for key in ['brierScored','truePositives','falsePositives','precision','recall','falsePositiveRate']:
        report['test'].pop(key)
    return report


def main():
    global FEATURES
    parser=argparse.ArgumentParser()
    parser.add_argument('source',choices=['fpagent','balabit'])
    parser.add_argument('--directory',default='artifacts/external')
    parser.add_argument('--extended', action='store_true')
    args=parser.parse_args()
    suffix='-extended' if args.extended else ''
    if args.extended:
        FEATURES = EXTENDED_FEATURES
    root=Path(args.directory)
    rows=json.loads((root/(args.source+'-features.json')).read_text())['rows']
    if args.source=='fpagent':
        report, parity = fpagent(rows)
        p=root/('fpagent'+suffix+'-parity.json');p.write_text(json.dumps(parity,allow_nan=False));p.chmod(0o600)
    else:
        report=balabit(rows)
    p=root/(args.source+suffix+'-report.json');p.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n');p.chmod(0o600)
    print(json.dumps({'source':args.source,'sessions':len(rows),'report':str(p)}))

if __name__=='__main__':
    main()
