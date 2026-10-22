# Customizing the Alexa Skill for your MCP server

`npm run chat` understands anything you type, because nothing sits between you and the model. The
Alexa Skill does not: Alexa's NLU has to match what you say to a sample utterance in the
interaction model before the bridge sees a word, and what it cannot match lands in
`AMAZON.FallbackIntent`, which carries **no text at all**. Everything on this page is about closing
that gap — without editing a generated file, because `npm run generate` overwrites those.

## What is generated, and what is yours

| Generated, never edit by hand                          | Yours, survives regeneration                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| `skill-package/interactionModels/custom/<locale>.json` | `skill-package/overrides/<locale>.utterances.json`                |
| `packages/skill-lambda/generated/tool-manifest.json`   | `skill-package/training/<locale>.chat.jsonl` (what chat recorded) |
|                                                        | `skill.invocationName` in `bridge.config.ts`                      |

The generator reads the two files on the right every time and merges them into the two on the left.
So the workflow is always the same: edit your file, `npm run generate`, `npm run skill:deploy`.

## What the generated model already does for you

You get more than one intent per tool. For a server whose tools take `park`, `month`, `activity` and
`state`, the model contains:

- **One intent per tool**, with typed slots and entity resolution, and sample utterances covering
  every combination of its slots in more than one word order (`find park for {activity} in {month}`
  and `find park in {month} for {activity}` are different patterns to Alexa).
- **`SpokenRequestIntent`**, a catch-all: a custom slot type seeded with phrases, which Alexa
  matches loosely and passes through verbatim. Anything the tool intents do not recognise reaches
  the agent as text instead of dying in Fallback. `features.catchAll` turns it off.
- **`ChoiceAnswerIntent`**, one slot type holding every enum value of every tool plus your
  `answers.choices`, so a reply to any question the bridge asks — "stargazing", "January",
  "Yosemite" — has a home, alone or inside a sentence ("i think it's yosemite", "option b", "go
  with january"). Without it a bare word goes to Fallback and the Lambda can only repeat the
  question.
- The **answer intents** for yes/no, dates, numbers and free text, and the standard intents.

Measured against Alexa's own NLU on 2026-09-05 with the national parks model: tool intents win
whenever they match ("best park for fishing in june" → `FindParkIntent` with both slots), one-word
answers route to `ChoiceAnswerIntent`, unmatched phrasings route to the catch-all with the full
text ("recommend a park with dark skies"), and "yes", "no", "stop", "help" still reach their
built-ins. Nothing in the battery reached Fallback. The full table is in
[decisions.md](decisions.md).

## The overrides file

`skill-package/overrides/<locale>.utterances.json`. Four kinds of entry, all optional, plus
`_comment` keys the generator ignores. Entries for intents your current server does not have are
skipped with a note, so overrides for several example servers can live in one file.

### Extra utterances for a generated intent

```json
"FindParkIntent": ["which park is good for {activity}", "where should i go for {activity} in {month}"]
```

Slot names are the tool's argument names in braces. Alexa's rules apply: lowercase words, no
digits, and an `AMAZON.SearchQuery` slot must stand alone behind a carrier phrase. A sample that
breaks them is rejected with a note naming it.

The bridge's own answer intents take extra samples the same way: `ChoiceAnswerIntent` (slot
`{choice}`), `FreeTextAnswerIntent` (`{answer}`), `DateAnswerIntent` (`{date}`) and
`NumberAnswerIntent` (`{number}`), for example `"ChoiceAnswerIntent": ["my pick is {choice}"]`.
Alexa refuses one sample string in two intents, so a sample a tool intent already has is kept
there and dropped from the answer intent (D67).

### Synonyms for slot values

```json
"slotSynonyms": { "ParkType": { "Great Smoky Mountains": ["the smokies"], "Rocky Mountain": ["rocky"] } }
```

This is the lever for proper nouns, which is where speech recognition is weakest. The type name is
the argument in PascalCase plus `Type` (`ParkType`, `ActivityType`); when two tools share an
argument name with different values, the second keeps a tool-prefixed type (`FindParkMonthType`)
and its slot is renamed, and the generate output tells you.

### Training phrases for the catch-all

```json
"catchAll": ["somewhere warm in the winter", "a park my kids would like"]
```

Phrases here are not a closed list: they teach the catch-all what your requests sound like, and
Alexa still passes through phrases that are not in it.

### An extra intent for an existing tool

```json
"intents": [{ "name": "WhereToGoIntent", "tool": "find_park", "samples": ["where should i go in {month}"] }]
```

When you want a differently shaped way of asking to be its own intent. Its slots are the tool's, the
manifest gains a second route to that tool, and the Lambda handles it with no new code — every
generated intent already goes through one manifest-driven handler. You will rarely need this;
extra utterances on the existing intent cover most cases.

### Keeping the file in your own repository

Set `BRIDGE_PROFILE_DIR` (see [config](config.md#a-profile-folder)) and the generator also reads
`<profile>/overrides/<locale>.utterances.json`, in the same format, after the one above. Its samples
come first, and an alias intent with the same name replaces the one here. The same folder holds
`.env` and `prompt-addendum.md`, a short note for the agent's system prompt (for example "ask one
quiz question at a time"), up to 2000 UTF-8 bytes, and `bridge.config.json` for any other setting (invocation name, memory, `visual.enabled`, and so on). Nothing in the folder is tracked by this repo.

### Answers while a question is open

A server that asks its own questions in its spoken line (a quiz, a guided form) gets answers the
tool intents cannot know: "I don't know", "about twenty miles", "the second one". Short ones often
land in `AMAZON.FallbackIntent`, which carries no text. Three levers:

- Put answer-shaped phrases into `catchAll` (`"i don't know"`, `"no idea"`, `"about twenty
miles"`, `"the second one"`): they teach the catch-all what answers sound like, and the whole
  phrase reaches the agent as text.
- Give spoken one-word answers a canonical value with `answers.choices`
  ([config](config.md#answers)). A server that offers "A, B or C" in its own speech sets, in
  `bridge.config.ts` or a profile's `bridge.config.json`:

  ```json
  "answers": {
    "choices": {
      "a": ["ay", "option a", "letter a", "the first one"],
      "b": ["bee", "be", "option b", "letter b", "the second one"],
      "c": ["see", "sea", "option c", "letter c", "the third one"]
    }
  }
  ```

  then `npm run generate` and `npm run skill:deploy`. "Bee", "option b" and "i think it's b"
  reach `ChoiceAnswerIntent`, and the server receives the canonical "b", whichever words Alexa
  heard (D67). Letters kept in `catchAll` as well do no harm, but they are no longer needed there.

- `skill.fallbackSensitivity` sets how readily Alexa gives up on the nearest intent. Whatever still
  lands in Fallback while the session is open is asked again: `skill.fallbackWhileOpen` ("Sorry, I
  didn't catch that.") and the last question, never a generic "What would you like to do?" (D60).

## Built-in intents: repeat, next, stop

The generated model always has `AMAZON.RepeatIntent` and `AMAZON.NextIntent` beside help, stop,
cancel and fallback. "Repeat" replays the last thing the user heard, from the session, with no
agent call. The others go to the agent as the word itself unless you map them in
`intents.builtIns` ([config](config.md#intents)):

```json
"intents": {
  "builtIns": {
    "AMAZON.NextIntent": { "tool": "skip_park" },
    "AMAZON.StartOverIntent": { "text": "start a new trip" },
    "AMAZON.StopIntent": { "tool": "save_trip" }
  }
}
```

A `tool` mapping is called directly, without the model, and spoken like the launch tool below; a
`text` mapping is a turn the agent hears. Stop, Cancel and NavigateHome take a tool only: its result
field is the farewell when it answers in time with a result that ends the session on its own (the
end-session field true, or no closing question without one); an error, an empty field, a timeout or
a line that asks a question leaves the plain "Goodbye.", and the session ends either way.

## The launch and help

`skill.launch` names a tool the agent calls on "Alexa, open …" without the model (D57): a server
that writes its own welcome ("Welcome back. Say …") speaks it through `speech.resultField` and draws
its start screen, and with `speech.endSessionField` it can end the session ("nothing here yet,
goodbye for now"). When the call fails or has nothing to say, the generated greeting is spoken.
`skill.help` and `skill.examplePhrases` replace the generated help and the greeting's examples.
`npm run generate` notes a launch or mapped tool that your server does not list, and prints the
example phrases the greeting will use.

## Your Alexa Skill listing

`skill-package/skill.json` ships as the bridge's own development listing. Your name, descriptions,
example phrases, keywords, category, privacy and terms URLs and icons go into
`<profile>/skill-package/skill.json`, in the same shape, holding only what differs; icons go into
`<profile>/skill-package/assets/images/` and are referenced as
`file://assets/images/en-US_largeIconUri.png` (108×108 and 512×512 PNG for the small and large
icon). `npm run skill:deploy` merges the listing over the repo's (objects merge, arrays replace;
the endpoint stays your Lambda), copies the assets in, runs `ask deploy`, and takes both off
again (D62). A `file://` path that is not in the assets folder stops the deploy before anything is
uploaded.

## Let chat write your utterances

The best guess at what people will say to the device is what you say to the bridge while testing:

```bash
npm run chat -- --record
```

Each turn is appended to `skill-package/training/<locale>.chat.jsonl` with the tool the agent chose
for it. On the next `npm run generate`, a recorded request whose enum values match the tool's
slots becomes a sample utterance for that tool's intent ("is it worth going to yosemite in
november" → `is it worth going to {park} in {month}` on `PlanParkVisitIntent`); one that does not
fit becomes a catch-all phrase; anything with digits is skipped and reported. The file is yours:
prune lines you do not want, or delete it. Test in chat the way you expect people to talk, and the
model learns their angles instead of yours.

## Changing the invocation name or the tools

The invocation name is `skill.invocationName` in `bridge.config.ts`. Change it, run
`npm run generate`, then `npm run skill:deploy`. The Alexa Skill's listed name is a different
field, `publishingInformation.locales.<locale>.name` in `skill-package/skill.json`; it is not
generated, and the way to change it without touching a tracked file is your profile's listing
(below).

When your MCP server's tools change — a new tool, a renamed argument, a new enum value — the
manifest and the interaction model both change, so it is `npm run generate` followed by
`npm run deploy` (the manifest is bundled into the Lambda) and `npm run skill:deploy` (the model). There is no
shortcut, and it is not a limitation of this bridge: an Alexa+ add-on has to be redeployed to
Alexa+ when its tool schema changes for the same reason. What you do not have to redeploy is the
model when only an _answer_ changes; the agent reads tool results live.

If redeploying on every schema change is getting in the way of iterating, `features.toolIntents:
false` drops the per-tool intents and routes everything through the catch-all; the model then
stops depending on your schemas, at the cost of entity resolution. It is the right setting for a
few days of fast iteration, and the wrong one for the demo.
