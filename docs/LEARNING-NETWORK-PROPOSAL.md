# A shared learning service: original proposal

The opt-in pilot described here is now implemented in `packages/network`, with Postgres and Cloudflare D1 service examples. Read the [current guide](LEARNING-NETWORK.md) and [application setup](NETWORK-CLIENT.md) for the shipped behavior. It discovers readable patterns from labeled summaries; it does not fine-tune Jev's weights. Ordinary Doorman installs and the public website do not contribute data automatically.

## Keep three choices separate

1. **Remote evaluation:** an application calls our hosted evaluator for a private answer. This must work without granting training rights or contributing historical activity.
2. **Contribution:** an implementer deliberately exports a documented, bounded set of derived features and verified outcomes. Collection is disabled by default and independently revocable.
3. **Model improvement:** contributed samples become eligible for a controlled evaluation/training dataset under an explicit policy. They are not automatically promoted into production behavior.

An implementer must be able to use upstream Jev, a custom classifier or its own hosted evaluator with no contribution. Self-hosted identity storage remains with the implementer. No cross-customer identity graph is needed to learn general attack patterns.

## Collect evidence, not complete logs

Start with aggregate request rates, status classes, timing buckets, broad environment categories and outcome labels. Exclude bodies, URLs/query strings, credentials, raw IPs, emails, mouse coordinates, keystrokes and full browser fingerprints. Tenant-scoped rotating references can link a contributed sample to a later outcome without making a global identity identifier.

These references and behavior patterns can still be personal data. Hashing a user ID does not make the data anonymous. Document the exact schema, preview/export tools, sampling, retention, access, deletion and contribution controls before enabling uploads. Keep raw service access logs from quietly defeating the telemetry policy.

Useful labels include a verified delegated agent credential, confirmed account takeover after investigation, and a successful independent recovery/check. A failed CAPTCHA, missing mouse movement, shared account, VPN or Jev's own suspicion score is not a reliable attacker label. A valid login confirms account credential use, not the identity of the human at the keyboard.

## A small initial architecture

Use an authenticated ingestion endpoint and a Postgres dataset with tenant scope, event ID, schema/model versions, derived features, label provenance and expiry. Enforce quotas, replay deduplication and strict allowlists. Keep contributors isolated; a large or malicious contributor must not dominate training. A bounded reviewed export can feed offline experiments. We do not need a streaming platform to prove the experiment.

Keep a separate catalog of reviewed research: source URL, publication date, specific finding, confidence, applicability and a regression fixture. Research updates propose code/prompt changes through normal pull requests. External pages are evidence to review, not instructions to execute or deploy.

## The improvement loop

Compare a candidate evaluator against deterministic matching and the current production model on held-out tenants and future time windows. Measure calibration, false positives, missed abuse, uncertain/abstained results, latency and cost. Include accessibility users, privacy browsers, legitimate bots, delegated agents, shared accounts and scarce signals. Keep account identity confidence separate from automation and abuse.

Roll out first in shadow mode, with no change to application decisions. Review performance by cohort, promote a version only after predefined gates pass, canary it, and retain an immediate rollback. Store model and feature versions with each assessment. A model update is not permission to merge customer identities or change their authorization policy.

## What “tuned Jev” can mean today

The current documented Jev integration evaluates typed questions over a state. We can improve the questions, selected evidence, calibration and a compatible evaluator service without changing the library API. The public [Jev model documentation](https://developers.cloudflare.com/ai/models/typesafe/jev/) does not establish that customers can fine-tune Jev's weights. Cloudflare's [fine-tuning support](https://developers.cloudflare.com/workers-ai/features/fine-tunes/) is model-specific, not a guarantee for Jev.

Confirm TypeSafe's supported training/hosting path and rights before promising a proprietary fine-tuned Jev model. If it is unavailable, a calibrated Jev pipeline or separately trained compatible classifier can still provide the hosted service. “JevZ” should remain a working idea until that is established.

The first experiment should be a small, explicitly opted-in pilot with agreed cost and retention limits, useful labels and an offline report. More traffic alone is not proof that a model improves.
