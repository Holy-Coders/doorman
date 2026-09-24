# Run the learning service with Postgres

This example hosts the optional Doorman learning protocol with a small Fastify server and a caller-owned Postgres pool. It is separate from visitor identity storage. The service accepts only authenticated, bounded feature summaries; it does not install collection into your app automatically.

From the repository root:

```sh
pnpm install
pnpm build
cd examples/learning-service
```

Create `.env` (ignored by Git):

```dotenv
DATABASE_URL=postgres://visitor:visitor@localhost:5432/doorman_network
PORT=3002
HOST=127.0.0.1
OPERATOR_KEY_HASH=replace_with_sha256_of_a_random_operator_token
MAX_EVALUATIONS_PER_DAY=0
MAX_EVALUATIONS_LIFETIME=0
```

Keep the original random operator token in your secret manager. Use a dedicated database for this service. The pool bounds connections and SQL execution time. Configure the Postgres driver's TLS for your database provider; do not disable certificate verification.

Apply the initial migration once and start the app:

```sh
pnpm migrate
pnpm dev
```

Visit `http://localhost:3002/health`. Follow the [operator workflow](../learning-worker/README.md) to enroll a participant, configure its separate opt-ins, discover patterns and review a canary. The HTTP protocol and operator endpoints are identical on both deployments.

To enable inference deliberately, add `JEV_API_KEY` and positive daily/lifetime call budgets. The direct transport calls `POST https://api.typesafe.ai/v1/systemone` with `model`, structured `state` and typed `questions`. Missing provider configuration returns disabled risk; errors and timeouts return unavailable risk. The example has no automatic retries or payload logging.

Postgres hosting has no built-in scheduler. Your existing scheduler can call authenticated `/operator/cleanup` and `/operator/discover` at the desired interval. Discovery never promotes itself and does not call an AI model. Alternatively call `service.discover()` in a bounded management command. Use preselected holdout participants and chronological cutoffs; see [the learning guide](../../docs/LEARNING.md).

For a public deployment put this server behind HTTPS, keep operator and participant credentials server-side, use a separate operator access policy, and configure infrastructure log retention. `HOST=0.0.0.0` is available for your container platform. Local loopback HTTP is supported only for development.

## Optional supervised classifier

Apply both `0001_network.sql` and `0002_classifiers.sql` through the migration command before upgrading. The service now accepts private `POST /v1/classify` requests and separate operator `/operator/classifier/export`, `/stage`, `/promote` and `/rollback` actions. Training remains offline; the scheduled Worker never starts it. Jev feature calls share the existing inference quotas and require the exact reported model pin. [Follow the classifier guide](../../docs/VALIDATION.md) to run the free generated-data demo or prepare a reviewed real-data pilot.
