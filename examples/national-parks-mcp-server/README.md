# National parks MCP server

The default example. Two tools over a committed extract of public National Park Service data for
fourteen parks: which activities each offers, what is open in which month, and what each is known
for. Every answer depends on more than one dimension, which is what makes the elicitation real.

Unofficial demo. Not affiliated with or endorsed by the National Park Service.

Tools:

- `find_park(activity?, month?, state?)` — which park suits an activity, a month, a state, or any
  combination. Answers a one-shot request outright; asks what you want to do only when nothing
  narrows the choice.
- `plan_park_visit(park, month?)` — what a named park is like in a given month. Asks which month
  when none is given, because access changes through the year.

## Run

```bash
npm run sample:start                      # this server, on http://localhost:3939/mcp
EXAMPLE=hotels-weather npm run sample:start       # a different example
npm run sample:start -- --list            # what else is here
PORT=4000 npm run sample:start            # any free port; then set BRIDGE_MCP_URL to match
SAMPLE_LOG=json npm run sample:start      # raw event records instead of readable lines
```

Try, in `npm run chat`:

- "what is the best national park for stargazing" — answered outright, no question.
- "which park should I visit in June" — one question back, then an answer that depends on both.
- "tell me about Glacier" — asks which month, because Going-to-the-Sun Road is the whole story.

## The data

[src/data.ts](src/data.ts) holds the extract, taken from nps.gov on 2026-09-05. Each row lists the
pages its facts came from, so any claim is checkable, and the header says which fields are the
pages' own words and which are a coarse reading of them. US federal works are not under copyright
and the fields are plain facts; there are no images and no NPS marks.

Adding or refreshing a park is a data change: open the `sources` of a row, re-read those fields,
edit, and run the tests. [src/data.test.ts](src/data.test.ts) enforces what the tools rely on —
every month classified as full or limited access, activities drawn from the shared vocabulary, at
least two parks per activity, and a source URL on every row.
