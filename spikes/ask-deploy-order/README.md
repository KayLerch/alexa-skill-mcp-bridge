# S6: ASK deploy order

Tests the cleaner setup order the brief asks about: obtain the skill id first (SMAPI create with no endpoint), then one CDK deploy with a tightened Lambda permission, then set the endpoint.

## What it creates

- A development-stage custom skill in your Alexa developer account (no cost).
- A hello-world Lambda with the Alexa Skills Kit trigger permission (free tier).

## Run

```bash
npm install
./spike.sh
```

## Tear down

```bash
npx cdk destroy
ask smapi delete-skill --skill-id <id printed by the script>
```
