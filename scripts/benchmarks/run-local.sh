#!/usr/bin/env bash
# Isolated local resources only. Refuse existing names; cleanup only resources created here.
set -euo pipefail
cd "$(dirname "$0")/../.."
for name in janitor-capacity-pg janitor-capacity-server janitor-capacity-client janitor-capacity-throughput; do
  if docker container inspect "$name" >/dev/null 2>&1; then
    printf 'Container %s already exists. Use a different run or remove your previous benchmark explicitly.\n' "$name" >&2
    exit 1
  fi
done
if docker network inspect janitor-capacity-local >/dev/null 2>&1; then
  printf 'Network janitor-capacity-local already exists; refusing to reuse it.\n' >&2
  exit 1
fi
created=()
network_created=0
run_status=0
mkdir -p artifacts/benchmarks/diagnostics
cleanup() {
  for name in ${created[@]+"${created[@]}"}; do
    docker logs "$name" >"artifacts/benchmarks/diagnostics/$name.log" 2>&1 || true
    docker inspect --format '{{json .State}}' "$name" >"artifacts/benchmarks/diagnostics/$name-state.json" 2>/dev/null || true
  done
  for name in ${created[@]+"${created[@]}"}; do docker rm -fv "$name" >/dev/null 2>&1 || true; done
  if [ "$network_created" = 1 ]; then docker network rm janitor-capacity-local >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
wait_for() {
  for _ in {1..60}; do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  printf 'Benchmark service failed to become ready within 60 attempts.\n' >&2
  return 1
}
server_ready() {
  docker exec janitor-capacity-server node -e 'Promise.all(Array.from({length:8},(_,i)=>fetch(`http://127.0.0.1:${3000+i}/ready`).then(r=>{if(!r.ok)process.exit(1)}))).catch(()=>process.exit(1))'
}
pnpm benchmark:connections:build
docker network create janitor-capacity-local >/dev/null
network_created=1
created+=(janitor-capacity-pg)
docker run --name janitor-capacity-pg --network janitor-capacity-local --cpus=2 --memory=1g \
  -e POSTGRES_USER=visitor -e POSTGRES_PASSWORD=visitor -e POSTGRES_DB=janitor_bench \
  -p 127.0.0.1:55434:5432 -d postgres:17-alpine \
  -c shared_buffers=128MB -c max_connections=40 >/dev/null
wait_for docker exec janitor-capacity-pg pg_isready -U visitor -d janitor_bench
JANITOR_BENCHMARK_DATABASE_URL=postgres://visitor:visitor@127.0.0.1:55434/janitor_bench \
JANITOR_BENCHMARK_SHARDS=32 JANITOR_BENCHMARK_LABEL=current pnpm exec tsx scripts/benchmarks/security.ts
created+=(janitor-capacity-server)
docker run --name janitor-capacity-server --network janitor-capacity-local --cpus=4 --memory="${JANITOR_BENCHMARK_SERVER_MEMORY:-4g}" \
  --ulimit nofile=262144:262144 --mount "type=bind,source=$PWD/artifacts/benchmarks,target=/bench,readonly" \
  -e JANITOR_BENCHMARK_DATABASE_URL=postgres://visitor:visitor@janitor-capacity-pg:5432/janitor_bench \
  -d node:22-alpine node --max-old-space-size=160 /bench/server.mjs >/dev/null
wait_for server_ready
created+=(janitor-capacity-client)
docker run --name janitor-capacity-client --network janitor-capacity-local --cpus=2 --memory="${JANITOR_BENCHMARK_CLIENT_MEMORY:-4g}" \
  --ulimit nofile=262144:262144 --sysctl 'net.ipv4.ip_local_port_range=10240 65535' \
  --mount "type=bind,source=$PWD/artifacts/benchmarks,target=/bench,readonly" \
  --mount "type=bind,source=$PWD/docs/benchmarks,target=/results" \
  -e JANITOR_BENCHMARK_CONNECTIONS="${JANITOR_BENCHMARK_CONNECTIONS:-200000}" \
  -e JANITOR_BENCHMARK_RATES="${JANITOR_BENCHMARK_RATES:-100}" \
  -e JANITOR_BENCHMARK_SERVER_MEMORY="${JANITOR_BENCHMARK_SERVER_MEMORY:-4g}" \
  -e JANITOR_BENCHMARK_CLIENT_MEMORY="${JANITOR_BENCHMARK_CLIENT_MEMORY:-4g}" \
  -e JANITOR_BENCHMARK_OUTPUT=/results/connections-current.json \
  node:22-alpine node --max-old-space-size=1300 /bench/client.mjs || run_status=1
# Keep first-run diagnostics before restarting; the throughput sweep is independent.
docker logs janitor-capacity-server >artifacts/benchmarks/diagnostics/server-before-restart.log 2>&1
docker exec janitor-capacity-server cat /sys/fs/cgroup/memory.events >artifacts/benchmarks/diagnostics/memory-before-restart.txt 2>/dev/null || true
docker exec janitor-capacity-server cat /sys/fs/cgroup/memory.peak >artifacts/benchmarks/diagnostics/memory-peak-before-restart.txt 2>/dev/null || true
docker inspect --format '{{json .HostConfig.Memory}}' janitor-capacity-server >artifacts/benchmarks/diagnostics/memory-limit.json
docker restart janitor-capacity-server >/dev/null
wait_for server_ready
created+=(janitor-capacity-throughput)
docker run --name janitor-capacity-throughput --network janitor-capacity-local --cpus=2 --memory=1g \
  --ulimit nofile=262144:262144 --mount "type=bind,source=$PWD/artifacts/benchmarks,target=/bench,readonly" \
  --mount "type=bind,source=$PWD/docs/benchmarks,target=/results" \
  -e JANITOR_BENCHMARK_CONNECTIONS=10000 -e JANITOR_BENCHMARK_RATES=100,500,1000,2000 \
  -e JANITOR_BENCHMARK_SERVER_MEMORY="${JANITOR_BENCHMARK_SERVER_MEMORY:-4g}" -e JANITOR_BENCHMARK_CLIENT_MEMORY=1g \
  -e JANITOR_BENCHMARK_OUTPUT=/results/throughput-current.json \
  node:22-alpine node --max-old-space-size=512 /bench/client.mjs || run_status=1
exit "$run_status"
