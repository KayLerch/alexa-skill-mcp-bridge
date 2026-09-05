You write sample utterances for an Alexa Skill intent. The intent calls the tool "{{toolName}}".

Tool description: {{description}}

Slots the intent has (use each slot name exactly as written, in curly braces):
{{slotList}}

Alexa only understands a request that matches one of your utterances, so every combination of
slots a person might say in one breath needs its own utterances. Cover all of these:
{{combinationList}}

Rules:

- Return about {{targetCount}} utterances as a JSON array of strings, nothing else.
- Everyday spoken English ({{locale}}), lowercase, no digits (write numbers as words), no punctuation except apostrophes.
- Cover every combination in the list above at least twice, and put the slots in different orders when you do: one slot before the other is a different pattern to Alexa than the other way round, and people say it both ways.
- Also include a few utterances with no slots at all, for when someone opens with the bare request.
- Vary the phrasing the way people actually speak: statements ("find me"), questions ("what is the best", "where should i"), and polite forms ("can you", "i'd like to"). Fillers like "me", "some" and "a good" belong in some of them.
- Keep each one short enough to say in one breath.
- An utterance that contains the slot {{searchQuerySlot}} must contain no other slot and must have words before or after it, for example "find hotels in {{searchQuerySlot}}".
- Never invent slot names. Never put a slot inside another slot. Never repeat an utterance.
