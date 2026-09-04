You write sample utterances for an Alexa custom skill intent. The intent calls the tool "{{toolName}}".

Tool description: {{description}}

Slots the intent has (use each slot name exactly as written, in curly braces):
{{slotList}}

Rules:

- Return between 10 and 15 utterances as a JSON array of strings, nothing else.
- Everyday spoken English ({{locale}}), lowercase, no digits (write numbers as words), no punctuation except apostrophes.
- Vary the phrasing: commands, questions, and requests such as "can you", "I'd like to", "please".
- Some utterances use no slots. Some use one slot. A few use several slots, when the tool has several.
- An utterance that contains the slot {{searchQuerySlot}} must contain no other slot and must have words before or after it, for example "find hotels in {{searchQuerySlot}}".
- Never invent slot names. Never put a slot inside another slot. Never repeat an utterance.
