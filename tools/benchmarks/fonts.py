"""Descriptive audit of FP-Agent's existing FingerprintJS font component.
This is NOT Janitor's local-12-v1 probe and has no verified person/device truth.
Only aggregate results are written; font names and session identifiers stay local.
"""
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from prepare import json_sessions


def font_set(component):
    value = component.get('value') if isinstance(component, dict) else None
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        return None
    return tuple(sorted(set(value)))


def collision_rate(counts):
    total = sum(counts)
    return sum(n * (n - 1) for n in counts) / (total * (total - 1)) if total > 1 else None


def main():
    root = Path('artifacts/external')
    source = root / 'fpagent-raw.json'
    with source.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    assert digest == 'e07847509a4851acb18e2390f5bf364c9b2f9c25588fce9f34929a872524cde3'
    families = defaultdict(Counter)
    missing, empty, sessions, repeats, stable = Counter(), Counter(), Counter(), Counter(), Counter()
    with source.open() as stream:
        for label, row in json_sessions(stream):
            sessions[label] += 1
            sets = []
            for batch in row['fpjs_data']:
                body = json.loads(batch['req_body'])
                value = font_set(body.get('result', {}).get('components', {}).get('fonts'))
                if value is not None:
                    sets.append(value)
            if not sets:
                missing[label] += 1
                continue
            # One observation per session; repeated captures do not inflate collisions.
            families[label][sets[0]] += 1
            empty[label] += not bool(sets[0])
            if len(sets) > 1:
                repeats[label] += 1
                stable[label] += len(set(sets)) == 1
    human = families['Human']
    report = dict(version=1, sourceSha256=digest, sessionCount=sum(sessions.values()),
                  collector='Published FingerprintJS component; different list and method from Janitor local-12-v1',
                  families={label: dict(sessions=sessions[label], measured=sum(counts.values()), missing=missing[label],
                                       empty=empty[label], distinctFontSets=len(counts), largestSetSessionCount=max(counts.values(), default=0),
                                       pairCollisionRate=collision_rate(counts.values()),
                                       sessionsWithRepeatedCaptures=repeats[label], repeatStableSessions=stable[label],
                                       sessionsSharingSetWithHuman=sum(n for key, n in counts.items() if key in human))
                            for label, counts in sorted(families.items())},
                  limitations=['Session-level collisions include repeat visitors; not a false-person-match rate.',
                               'Published grouping includes fingerprint-derived identifiers; using them as font identity truth would be circular.',
                               'No claims about local-12-v1 accuracy, cross-device linking, malicious intent or assistant brand.',
                               'Font component errors and missing values stay unknown. Empty measured sets are reported separately.'],
                  productionPromoted=False)
    path = root / 'font-audit.json'
    path.write_text(json.dumps(report, indent=2) + '\n')
    path.chmod(0o600)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
