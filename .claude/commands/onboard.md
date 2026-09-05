---
description: Walk me through setting up the bridge, step by step
---

Follow the procedure in @docs/onboarding.md.

Start at step 0: ask which outcome I want before doing anything, and run `npm run doctor` to find out
where I already am. Honour its rules, in particular: nothing that creates AWS or Alexa resources without
asking me first, `.env` rather than `bridge.config.ts`, and no step counts as done until a command's
output proves it.
