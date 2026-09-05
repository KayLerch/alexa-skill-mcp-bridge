# Cost

Nothing in the stack runs always-on. The idle cost of a deployed bridge is a few cents a month for log and image storage. Everything else is pay-per-use, listed here where it occurs.

## One turn, worked example

A turn is one Alexa request: "find hotels in Berlin from the fifth to the seventh of October". Measured with the hotels-and-weather example server and Nova 2 Lite, reasoning off; the national parks example has the same shape, one tool call and two model calls per turn:

| Item                                                            | Amount                          | Price (us-east-1)                      | Cost       |
| --------------------------------------------------------------- | ------------------------------- | -------------------------------------- | ---------- |
| Model input tokens (system prompt, tools, history, tool result) | about 3,500 across two calls    | Nova 2 Lite, roughly $0.06 per million | $0.0002    |
| Model output tokens                                             | about 60                        | roughly $0.25 per million              | $0.00002   |
| AgentCore Runtime CPU                                           | about 3 s of one vCPU           | about $0.09 per vCPU-hour              | $0.00008   |
| AgentCore Runtime memory                                        | 20 minutes of a few hundred MB  | about $0.009 per GB-hour               | $0.001     |
| AgentCore Memory event                                          | 1                               | tenths of a cent per thousand          | negligible |
| Lambda                                                          | 1 invocation, 512 MB, about 3 s | free tier, then fractions of a cent    | negligible |
| CloudWatch logs                                                 | a few KB                        | $0.50 per GB ingested                  | negligible |

Order of magnitude: a tenth of a cent per turn, dominated by runtime memory while the session stays warm. A day of active testing costs cents. Prices change; check the AWS pricing pages for the current numbers.

## What costs money and when

- **Model tokens** per model call. Two calls per typical turn (tool choice, then phrasing). Reasoning effort above `off` roughly quadruples output tokens.
- **Runtime CPU** only while a turn runs. **Runtime memory** for the peak footprint while the session exists: from the first invocation until `runtime.idleTimeoutMinutes` pass without one (default 20 minutes). A parked question keeps the session alive but idle.
- **AgentCore Memory**: one event per exchange when `memory.shortTerm` is on. With `memory.longTerm`, the service runs extraction (a model call) per session to update user preferences and summaries.
- **Gateway** (`features.gateway`, off by default): billed per call in addition to the above.
- **CloudWatch logs** by volume, kept for `aws.logRetentionDays`.
- **ECR** image storage: about $0.10 per GB-month for the agent image while the stack exists.

## Defaults chosen for cost

Nova 2 Lite, reasoning off, 400 output tokens, 20-minute idle timeout, 7-day log retention.

## Nothing will alarm you

The stack has no cost alarm: an alarm that notifies needs an email address, and this repo keeps that kind of value out of tracked files. Watch [Billing and Cost Management](https://console.aws.amazon.com/costmanagement/home) while you test, or add a budget yourself once, outside the stack:

```bash
aws budgets create-budget --account-id <your-account-id> --budget \
  '{"BudgetName":"alexa-mcp-bridge","BudgetLimit":{"Amount":"5","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}'
```

The reliable control is `npm run destroy`: with the stack gone, the cost is zero.

## Tear down

`npm run destroy` removes the stack and deletes this app's images from the CDK asset repository. Memory records and logs expire on their own. The Alexa Skill stays in your developer account at no cost; delete it with `ask smapi delete-skill --skill-id <id>`.
