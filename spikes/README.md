# Verification spikes

Each directory is a small, re-runnable probe for one of the ten assumptions that had to be checked against live behavior before the design could rely on them. Spikes live outside the npm workspaces, install their own dependencies, and use Node 22's built-in type stripping (`node spike.ts`). Outcomes go to the verification log in [`docs/decisions.md`](../docs/decisions.md), summarized in [`docs/architecture.md`](../docs/architecture.md).

| Spike                      | Brief items      | Needs AWS                | What it creates                                               | Cost                                                                                                                                                                                              |
| -------------------------- | ---------------- | ------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `strands-elicitation` (S1) | 1                | No                       | Nothing                                                       | Free                                                                                                                                                                                              |
| `probe-runtime` (S2)       | 2, 3, 4, 5, 6, 9 | Yes, deploys             | One AgentCore Runtime, its ECR image, an IAM role, log groups | Runtime billed only while the probe sessions are active (about $0.09 per vCPU-hour, $0.009 per GB-hour). Running all sequences once: well under $1. ECR storage: cents per month until destroyed. |
| `tunnel-idle` (S3)         | 7                | No (needs `cloudflared`) | A quick tunnel                                                | Free                                                                                                                                                                                              |
| `nova-latency` (S4)        | 8                | Bedrock only             | Nothing                                                       | Nova 2 Lite tokens: about $0.001 per run                                                                                                                                                          |
| `cdk-synth-gateway` (S5)   | 9                | No                       | Nothing (synth only)                                          | Free                                                                                                                                                                                              |
| `ask-deploy-order` (S6)    | 10               | Yes, deploys             | A hello-world Lambda and a development-stage Alexa Skill      | Free tier                                                                                                                                                                                         |

## Prerequisites

- Node 22.18 or later (`nvm use` at the repo root).
- For S2 and S6: AWS credentials for us-east-1, CDK bootstrapped there (`cdk bootstrap`), Docker or Finch for the arm64 image, and `iam:CreateServiceLinkedRole` on the deploying principal (AgentCore creates its service-linked role on first use).
- For S4: Bedrock model access enabled for Amazon Nova 2 Lite in us-east-1.
- For S3: `cloudflared` (`brew install cloudflared`).
- For S6: ASK CLI logged in (`ask configure`).

## Run

```bash
cd spikes/<name>
npm install
node spike.ts --help     # each spike prints its options
```

S2 and S6 create billable resources. Each README says exactly what and how to tear it down. Do not leave the probe runtime deployed.
