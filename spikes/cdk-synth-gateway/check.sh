#!/usr/bin/env bash
# Synth and report the properties the bridge stack depends on.
set -euo pipefail
cd "$(dirname "$0")"
npx cdk synth --quiet >/dev/null
T=cdk.out/SpikeGatewaySynth.template.json
echo "--- Runtime LifecycleConfiguration:"; node -e "const t=require('./$T');for(const [k,v] of Object.entries(t.Resources)){if(v.Type==='AWS::BedrockAgentCore::Runtime')console.log(JSON.stringify(v.Properties.LifecycleConfiguration), JSON.stringify(v.Properties.AgentRuntimeArtifact))}"
echo "--- Memory strategies:"; node -e "const t=require('./$T');for(const [k,v] of Object.entries(t.Resources)){if(v.Type==='AWS::BedrockAgentCore::Memory')console.log(JSON.stringify(v.Properties.MemoryStrategies.map(s=>Object.keys(s)[0])))}"
echo "--- Gateway authorizer + protocol:"; node -e "const t=require('./$T');for(const [k,v] of Object.entries(t.Resources)){if(v.Type==='AWS::BedrockAgentCore::Gateway')console.log(v.Properties.AuthorizerType, JSON.stringify(v.Properties.ProtocolConfiguration))}"
echo "--- Gateway target:"; node -e "const t=require('./$T');for(const [k,v] of Object.entries(t.Resources)){if(v.Type==='AWS::BedrockAgentCore::GatewayTarget')console.log(JSON.stringify(v.Properties.TargetConfiguration), JSON.stringify(v.Properties.CredentialProviderConfigurations))}"
echo "--- Does the CFN schema know a Gateway sessions/streaming configuration?"
grep -o "StreamingConfigurationProperty\|SessionsConfiguration[A-Za-z]*\|sessionsConfiguration" node_modules/aws-cdk-lib/aws-bedrockagentcore/lib/bedrockagentcore.generated.d.ts | sort | uniq -c
