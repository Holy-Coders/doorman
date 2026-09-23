"""Read research files as data, never execute their SQL or import their code.
Only the projected private NDJSON is written. Raw text, IPs and headers are discarded.
"""
import argparse
import csv
import hashlib
import io
import json
import math
import os
import re
import tarfile
from datetime import datetime, timezone
from pathlib import Path


def opaque(value):
    return hashlib.sha256(str(value).encode()).hexdigest()


def sql_values(line):
    """The dump's one-tuple-per-line MySQL scalar format; no SQL execution."""
    if not re.match(r'^\(\d+,', line):
        return None
    result, i = [], 1
    while i < len(line):
        while line[i].isspace():
            i += 1
        if line[i] == "'":
            i += 1
            value = []
            while i < len(line):
                char = line[i]
                i += 1
                if char == '\\':
                    char = line[i]
                    i += 1
                    value.append({'n': '\n', 'r': '\r', 't': '\t', '0': '\0', 'Z': '\x1a'}.get(char, char))
                elif char == "'":
                    if i < len(line) and line[i] == "'":
                        value.append("'")
                        i += 1
                    else:
                        break
                else:
                    value.append(char)
            else:
                raise ValueError('Unterminated SQL string')
            value = ''.join(value)
        else:
            start = i
            while i < len(line) and line[i] not in ',)':
                i += 1
            value = line[start:i].strip()
            if value == 'NULL':
                value = None
            elif re.fullmatch(r'-?\d+', value):
                value = int(value)
            else:
                raise ValueError('Unsupported SQL scalar')
        result.append(value)
        while i < len(line) and line[i].isspace():
            i += 1
        if i >= len(line):
            raise ValueError('Incomplete SQL tuple')
        if line[i] == ')':
            if line[i+1:].strip() not in ['', ',', ';']:
                raise ValueError('Unexpected SQL tuple suffix')
            return result
        if line[i] != ',':
            raise ValueError('Unexpected SQL tuple delimiter')
        i += 1
    raise ValueError('Incomplete SQL tuple')


def signal(value):
    if not isinstance(value, str) or not value.strip():
        return None
    if value.lower().strip() in ['undefined', 'null', 'no js', 'no javascript', 'not supported', 'unknown', 'not available', 'no webgl']:
        return None
    return value.strip()


def fpstalker(root):
    columns = re.findall(r'^  `([^`]+)`', (root / 'fpstalker-schema.sql').read_text(), re.M)
    count = 0
    for part in [1, 2]:
        with tarfile.open(root / f'extension{part}.txt.tar.gz') as archive:
            member = archive.getmember(f'extension{part}.txt')
            for line in io.TextIOWrapper(archive.extractfile(member), encoding='utf8'):
                values = sql_values(line)
                if values is None:
                    continue
                if len(values) != len(columns):
                    raise ValueError('FP-Stalker schema mismatch')
                row = dict(zip(columns, values))
                observation = {}
                for output, source in [('userAgent', 'userAgentHttp'), ('platform', 'platformJS')]:
                    if signal(row[source]):
                        observation[output] = signal(row[source])
                resolution = re.fullmatch(r'(\d+)[x_](\d+)[x_](\d+)', str(row['resolutionJS']))
                if resolution:
                    width, height, depth = map(int, resolution.groups())
                    if 0 < width <= 32768 and 0 < height <= 32768 and 0 < depth <= 128:
                        observation['screen'] = dict(width=width, height=height, colorDepth=depth)
                graphics = {k: signal(row[v]) for k, v in [('webglVendor', 'vendorWebGLJS'), ('webglRenderer', 'rendererWebGLJS')] if signal(row[v])}
                if graphics:
                    observation['graphics'] = graphics
                # HTTP Accept-Language != navigator.languages; timezone offset != IANA zone.
                # Neither is invented. Flash, hashes, IPs, plugins and benchmark timings are omitted.
                if not row['id']:
                    raise ValueError('Missing ground truth browser ID')
                timestamp = datetime.strptime(row['creationDate'], '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc).timestamp() * 1000
                count += 1
                yield dict(id=opaque(row['counter']), subject=opaque(row['id']), at=int(timestamp), order=row['counter'], signals=observation)
    if count != 15000:
        raise ValueError(f'Unexpected FP-Stalker row count: {count}')


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def compact_events(frames):
    """Keep type, time, and relative movement only. Never keys, selectors or input."""
    previous = None
    last_time = -1
    for frame in frames:
        if not isinstance(frame, list) or not frame or not finite(frame[-1]) or frame[-1] < 0:
            continue
        kind, time = frame[0], frame[-1]
        if time < last_time:
            previous = None
            yield ['reset', time]
        last_time = time
        if kind == 'mm' and len(frame) in [4, 5]:
            x, y = frame[-3:-1]
            if not finite(x) or not finite(y):
                continue
            if previous is not None:
                yield ['mousemove', time, x-previous[0], y-previous[1]]
            # First movement has no recoverable movementX/Y; count with zero displacement.
            else:
                yield ['mousemove', time, 0, 0]
            previous = (x, y)
        elif kind == 'md' and len(frame) in [5, 6]:
            yield ['pointerdown', time]
        elif kind == 'kd' and len(frame) in [3, 4, 5]:
            yield ['keydown', time]
        elif kind in ['sc', 'se']:
            # Positions are not wheel deltas. Only count the documented scroll event.
            yield ['scroll', time]


def json_sessions(stream):
    """Incrementally read a {label: [session,...]} document. At most one session in memory."""
    decoder = json.JSONDecoder()
    buffer, pos, eof = '', 0, False

    def fill():
        nonlocal buffer, pos, eof
        buffer = buffer[pos:] + stream.read(262144)
        pos = 0
        eof = len(buffer) == 0 or eof
        if len(buffer) > 100_000_000:
            raise ValueError('Research session exceeds 100 MB limit')

    def whitespace():
        nonlocal pos
        while True:
            while pos < len(buffer) and buffer[pos].isspace():
                pos += 1
            if pos < len(buffer) or eof:
                return
            fill()

    def token(expected):
        nonlocal pos
        whitespace()
        if buffer[pos:pos+1] != expected:
            raise ValueError(f'Expected JSON delimiter {expected}')
        pos += 1

    def value():
        nonlocal pos, buffer, eof
        whitespace()
        while True:
            try:
                result, pos = decoder.raw_decode(buffer, pos)
                return result
            except json.JSONDecodeError:
                if eof:
                    raise ValueError('Incomplete research JSON') from None
                remainder = buffer[pos:]
                chunk = stream.read(262144)
                eof = not chunk
                buffer, pos = remainder + chunk, 0
                if len(buffer) > 100_000_000:
                    raise ValueError('Research session exceeds 100 MB limit')

    token('{')
    while True:
        label = value()
        token(':')
        token('[')
        whitespace()
        while buffer[pos:pos+1] != ']':
            yield label, value()
            whitespace()
            if buffer[pos:pos+1] != ',':
                break
            pos += 1
        token(']')
        whitespace()
        if buffer[pos:pos+1] != ',':
            break
        pos += 1
    token('}')
    whitespace()
    if buffer[pos:].strip() or stream.read(1):
        raise ValueError('Trailing research JSON')


def fpagent(root):
    with (root / 'fpagent-raw.json').open() as stream:
        for label, row in json_sessions(stream):
            source = row['source']
            if label != source['class_label']:
                raise ValueError('FP-Agent source label mismatch')
            human = label == 'Human'
            # These are browser fingerprint/cookie identifiers, NOT verified participant IDs.
            match = re.match(r'^(Shopping|Forums|Flight-booking) ([a-f0-9]{32}) ([a-f0-9-]{36})-\d+ ', source['task_name'])
            if human and not match:
                raise ValueError('Cannot recover human browser group')
            frames = []
            for batch in row['behavioral_data']:
                body = json.loads(batch['req_body'])
                frames.extend(body.get('eventFrames', []))
            events = list(compact_events(frames))
            # Environment is a grouping audit, never a model feature. No IP/headers.
            environment = {}
            for batch in row['fpjs_data']:
                body = json.loads(batch['req_body'])
                components = body.get('result', {}).get('components', {})
                for key in ['platform', 'screenResolution', 'timezone', 'hardwareConcurrency', 'deviceMemory']:
                    if key in components and 'value' in components[key]:
                        environment[key] = components[key]['value']
                if environment:
                    break
            yield dict(id=opaque(json.dumps(source, sort_keys=True)), family=label, positive=not human,
                       group=opaque(match[2]) if human else opaque(label+'|'+source['source_file']),
                       browserLink=opaque(match[3]) if human else None,
                       environment=opaque(json.dumps(environment, sort_keys=True)) if environment else None,
                       events=events)


def balabit(root):
    with tarfile.open(root / 'balabit.tar.gz') as archive:
        members = [m for m in archive.getmembers() if m.isfile()]
        labels_file = next(m for m in members if m.name.endswith('/public_labels.csv'))
        labels = {r['filename']: r['is_illegal'] == '1' for r in csv.DictReader(io.TextIOWrapper(archive.extractfile(labels_file)))}
        for member in members:
            match = re.search(r'/(training_files|test_files)/(user\d+)/(session_\d+)$', member.name)
            if not match:
                continue
            split, user, session = match.groups()
            if split == 'test_files' and session not in labels:
                continue
            events, previous, last = [], None, -1
            for row in csv.DictReader(io.TextIOWrapper(archive.extractfile(member))):
                # RDP client's clock, seconds -> ms. Host receipt batches are not user timing.
                time = float(row['client timestamp']) * 1000
                if not math.isfinite(time) or time < 0:
                    continue
                if time < last:
                    previous = None
                    events.append(['reset', time])
                last = time
                if row['state'] in ['Move', 'Drag']:
                    x, y = float(row['x']), float(row['y'])
                    if not math.isfinite(x) or not math.isfinite(y):
                        continue
                    events.append(['mousemove', time, x-previous[0] if previous else 0, y-previous[1] if previous else 0])
                    previous = (x, y)
                elif row['state'] == 'Pressed':
                    events.append(['pointerdown', time])
            yield dict(id=opaque(session), group=opaque(user), partition='training' if split=='training_files' else 'test',
                       positive=labels.get(session, False), events=events)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source', choices=['fpstalker', 'fpagent', 'balabit'])
    parser.add_argument('--directory', default='artifacts/external')
    args = parser.parse_args()
    root = Path(args.directory)
    output = root / (args.source + '.ndjson')
    temporary = output.with_suffix('.tmp')
    count = 0
    with open(temporary, 'w', opener=lambda p,f: os.open(p,f,0o600)) as target:
        for row in globals()[args.source](root):
            target.write(json.dumps(row, separators=(',', ':'), allow_nan=False)+'\n')
            count += 1
    temporary.replace(output)
    print(json.dumps({'dataset': args.source, 'sessions': count}))


if __name__ == '__main__':
    main()
