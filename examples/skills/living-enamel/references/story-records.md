# Story and delivery records

Use these records in the film folder; they belong to the skill, not application state.

## Story card

Write the final image before filling the middle. Keep these fields in `story-card.md`:

```text
Profile: feed | story
Fact / fiction:
Series promise and rules (if any):
Analytics read and one hypothesis (untested if no data):
Person / causal problem:
Want:
Opposition / doubt / obstacle:
Viewer expects:
Sourced actual outcome:
Final image that overturns the expectation:
One sentence to repeat or argue with:
ending_mode: consequence
Why this ending:

Three hooks from the same facts:
1. Strange mid-action act: sentence + frame zero; viewer expects X, stays to learn Y.
2. Contradiction: sentence + frame zero; viewer expects X, stays to learn Y.
3. Personal stake: sentence + frame zero; viewer expects X, stays to learn Y.
Chosen pair and reason:

Opening promise established at:
Opposition / obstacle established at:
Early reward and time:
Opening question first answered at:
What changes afterwards / second real question (or cut here):
Timed causal beats and information-changing visuals, about every 2–3s:
Key object continuity from setup to payoff:
Final line / final picture (last → first read if loop):

Narration claim → source URL / citation and supporting passage:
Dramatisations / uncertainties to disclose in delivery:
```

The ending mode must be exactly one plain line `ending_mode: loop`, `ending_mode: punchline` or `ending_mode: consequence`. Default to consequence for story, loop for feed. The checker reads this line; it only verifies file presence and a recognised mode, not the card's reasoning. Replace outline fields with decisions, not checkmarks. Keep each factual claim attached to a source; distinguish documented dialogue from an illustrative reconstruction. Use timing estimates for the initial card and update them after actual narration.

## Analytics ledger

Read `analytics.csv` in the film's parent (beside `series-card.md` when present) before choosing a topic/hook. If the series card exists without a ledger, create one with this UTF-8 CSV header. If neither exists, do not create an unsolicited series. After delivery append to any existing ledger without rewriting the owner's audience data.

```csv
folder,file_hash,skill_hash,topic,hook_sentence,first_frame_description,voice,duration,words,ending_mode,upload_date,snapshot_age,shown_in_feed,stayed_pct,views,engaged_views,average_pct_viewed,average_duration,likes,comments,shares,subscribers_gained
```

Use CSV quoting for commas, quotes and line breaks. `file_hash` is the final delivered MP4's SHA-256; `skill_hash` is SHA-256 of the active skill's `SKILL.md` bytes, not a different library version or the working kit. Duration and average duration are seconds, words are whitespace-separated stored narration tokens (`spoken`, falling back to `text` for legacy timelines), percentages use 0–100. Identify the actual engine and voice in `voice`. The owner supplies `upload_date`, `snapshot_age` (e.g. `24h`, `7d`) and every subsequent audience field; leave them blank on delivery. Do not substitute public views for engaged views or missing values for zero. Compare like-for-like snapshot ages; a single film cannot isolate a causal effect.
