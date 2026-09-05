# S2: AgentCore Runtime probe

Deploys a minimal arm64 Node container to AgentCore Runtime and drives it through the sequences in [`docs/history/execution-plan.md`](../../docs/history/execution-plan.md) section 4.1. This answers whether a promise parked in the microVM survives between invocations, what `HealthyBusy` does, how long a cold start takes, and whether session ids can be reused after a reclaim.

## What it creates

- One AgentCore Runtime (`alexa_mcp_bridge_probe`) with its default endpoint and execution role.
- One ECR repository/image in the CDK asset bucket and registry.
- One CloudWatch log group (3-day retention).

Cost: the runtime is billed only while a session is active (about $0.09 per vCPU-hour and $0.009 per GB-hour in us-east-1). Running every sequence once keeps sessions alive for roughly 15 minutes total: under $1. ECR storage is cents per month until you destroy the stack.

## Run

```bash
npm install
npx cdk deploy --outputs-file cdk-outputs.json        # idle timeout 600 s
node drive.ts --sequence 1                            # cold start x5
node drive.ts --sequence 2                            # park 20 s and 5 min, resolve
node drive.ts --sequence 3                            # heartbeat gaps
node drive.ts --sequence 4                            # HealthyBusy
node drive.ts --sequence 5                            # abandoned first invocation
node drive.ts --sequence 7                            # session id format
node drive.ts --sequence 8 --tunnel-url https://…/mcp # held SSE stream (needs S3's tunnel)

PROBE_IDLE_SECONDS=60 npx cdk deploy --outputs-file cdk-outputs.json
node drive.ts --sequence 6                            # reuse after reclaim
```

## Tear down

```bash
npx cdk destroy
```

Then delete the probe image from the CDK assets ECR repository (`aws ecr batch-delete-image` on the `cdk-hnb659fds-container-assets-*` repository) if you want no storage cost left.
