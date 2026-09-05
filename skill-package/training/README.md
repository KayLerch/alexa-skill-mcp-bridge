# Training

`npm run chat -- --record` appends one JSON line per turn to `<locale>.chat.jsonl` here: what you
said, and the tool the agent chose for it. `npm run generate` turns those lines into sample
utterances for the Alexa Skill, substituting enum values with slots, and uses the rest as
catch-all phrases. The files are yours to prune or delete; they are not generated and survive
regeneration. See [docs/customizing.md](../../docs/customizing.md).
