#!/usr/bin/env bash
# S6: candidate cleaner deploy order.
#   1. Create the skill through SMAPI with a manifest that has no endpoint → skill id.
#   2. One CDK deploy with SKILL_ID set → Lambda ARN with a tightened permission.
#   3. Update the skill manifest with the endpoint and confirm Alexa can invoke it.
# Records whether SMAPI accepts a custom skill without an endpoint (brief item 10).
set -euo pipefail
cd "$(dirname "$0")"

VENDOR_ID="${VENDOR_ID:-$(ask smapi get-vendor-list | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).vendors[0].id))')}"
echo "vendor: $VENDOR_ID"

echo "--- step 1: create skill without endpoint"
CREATE_OUT=$(ask smapi create-skill-for-vendor --vendor-id "$VENDOR_ID" --manifest "file:manifest-no-endpoint.json" 2>&1) || { echo "SMAPI refused: $CREATE_OUT"; echo "OUTCOME: keep the two-deploy order"; exit 1; }
SKILL_ID=$(echo "$CREATE_OUT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const m=d.match(/amzn1\.ask\.skill\.[0-9a-f-]+/);console.log(m?m[0]:"")})')
echo "skill id: ${SKILL_ID:-<none: output was: $CREATE_OUT>}"
[ -n "$SKILL_ID" ] || exit 1
sleep 5
ask smapi get-skill-status --skill-id "$SKILL_ID" || true

echo "--- step 2: one CDK deploy with the skill id"
npm install >/dev/null
SKILL_ID="$SKILL_ID" npx cdk deploy --require-approval never --outputs-file cdk-outputs.json
LAMBDA_ARN=$(node -e 'console.log(require("./cdk-outputs.json").AlexaMcpBridgeAskProbe.LambdaArn)')
echo "lambda: $LAMBDA_ARN"

echo "--- step 3: put the endpoint into the manifest and update"
node -e '
  const m = require("./manifest-no-endpoint.json");
  m.manifest.apis.custom.endpoint = { uri: process.argv[1] };
  require("fs").writeFileSync("manifest-with-endpoint.json", JSON.stringify(m, null, 2));
' "$LAMBDA_ARN"
ask smapi update-skill-manifest --skill-id "$SKILL_ID" --stage development --manifest "file:manifest-with-endpoint.json"
sleep 10
ask smapi get-skill-status --skill-id "$SKILL_ID"

echo "--- step 4: invoke through the simulation API (needs an interaction model; skip if it fails)"
ask smapi simulate-skill --skill-id "$SKILL_ID" --stage development --input-content "open bridge probe" --device-locale en-US || echo "simulation needs a built interaction model; verify manually in the developer console"

echo
echo "OUTCOME: SMAPI accepted a custom skill without an endpoint; skill id $SKILL_ID existed before the first CDK deploy."
echo "Tear down: npx cdk destroy && ask smapi delete-skill --skill-id $SKILL_ID"
