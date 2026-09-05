# S6: ASK deploy order

Tests whether a cleaner setup order exists than the two-deploy one the README documents: obtain the Alexa Skill id first (SMAPI create with no endpoint), then one CDK deploy with a tightened Lambda permission, then set the endpoint.

## What it creates

- A development-stage custom Alexa Skill in your Alexa developer account (no cost).
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
