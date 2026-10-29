# Handoff: onboarding psychology research → onboarding work

From the session "Onboarding recordings psychological analysis" (28–29 Oct 2026).
Read this before changing any intermission screen. Nothing in the app was changed by that session.

## What exists

- **The comparison page (private artifact):** https://claude.ai/artifact/5L7hDJN1kvL2G9TeCP7AtE
  Eleven onboardings side by side: the ten recordings in the founder's Drive folder "SuppStack Paywall References" (Open, Rootd, Loóna, Foodnoms, Foodvisor, Fabulous, Tangerine, Stoic, Yuka, RISE) plus MyFormula's flow as built on 27 Oct (branch `claude/dreamy-meitner-ryihf9`).
- **Word-for-word transcripts**, one JSON file per app, every screen with its kind, exact words, buttons, inline reactions and what it aims to make the person feel:
  repo `cameronr33/Creator-Management-Tool`, branch `claude/onboarding-recordings-psychology-94fmp6`, folder `CLAUDE OUTPUTS/MYFORMULA/MyFormula - Onboarding Psychology - transcripts/`.
  These replace `docs/design/intermissions/reference-teardown.md` as the reference baseline: that file was written from 1-fps paywall notes; these come from the full videos, every distinct screen at 3 fps.
- Gaps: Open, Foodnoms and Foodvisor recordings start partway through; Tangerine and Yuka have no questionnaire; Foodvisor's post-paywall part was skimmed.

## Findings about our flow

1. **We are the wordiest of the eleven.** Median words per screen that asks nothing (headline + body): MyFormula 34, Foodvisor 29, Rootd 27, RISE 23, Loóna 22, Fabulous 21, Stoic 12. Other apps keep headlines to 3–9 words. Our heaviest: Screens 8, 10, 12 (~50 words each, five text blocks), 13 (51), 30 (44 plus a 7-row table).
2. **We lead on proof and the turn.** Only flow citing named studies; Screen 13 is the strongest turn because it follows the person's own admissions; Screen 34 is the only paywall built from the person's own result.
3. **We are the most fear-led.** Three different alarms in a row (8, 10, 12). References that use worry stay with one idea and point forward at once (Loóna's 47% → "Let's fix it"; RISE's sleep debt is the person's own number, framed as payable).
4. **Answers rarely answer back.** RISE replies inline on 13 of its first 18 questions; we reply once (Screen 4).
5. **We never use the name** between Screen 20 (asked) and Screen 32.
6. **Privacy is unsaid at the sensitive questions** (medications, blood test, pregnancy). Foodvisor shows a privacy screen right after its health-conditions question; Foodnoms puts it in each question's subtitle; Stoic says it in one line after age.
7. **Most people get no result before the price.** 22b is conditional and 33 is skipped.

## Suggested changes (not yet approved by the founder)

Wording only:
1. Fact screens 8/10/12 to ~25 words: big number, one caption, the answer-matched line, source. Move the way-out line into the button (e.g. Screen 8 "Good to know" → "Show me the better forms").
2. Screen 13: drop "Every pick is chosen for you and graded on its evidence."; replace the three ticks with one answer per problem just shown (form scored / independent dose checks credited / contaminant testing counts). **Check each claim against the scoring code before use.**
3. Screen 30: show the three biggest score factors, full table behind "How we score".
4. House rule for screens that ask nothing: headline ≤ 8 words, ≤ 25 words total, one idea. Exceptions: Screen 32 checklist, AI consent sheet.
7. Use the first name on 24c and the paywall headline.
8. One privacy line in the subtitle of Screen 23 or 24b (e.g. "Used only to check your picks. Never sold."; the privacy policy says "We do not sell or rent your data to anyone"). Note the founder **turned down** a general privacy line on 13b in round 3; this proposes a different place.

Structural (launch-plan scope freeze applies; need the founder's explicit go-ahead):
5. Ease the fear run: either keep all three with the way out beside the number, or cut one pair (the 9/10 label pair fits worst).
6. One-line inline replies under options on Screens 15 and 5; this could replace Screen 4 (which still has no round-3 pick).
9. Turn 25b and 23b into slide-up notes over the question just answered (Foodvisor's "Your program has been updated!" pattern).
10. Give everyone something before the price, e.g. the checklist's closing line names their first pick.
11. (Low) Give Screen 1 an outcome promise.

Keep: the question-then-fact structure and named sources, Screen 13 as the turn, the light reminder ask (31), the honest build checklist (32). Do not borrow: pledges/signatures, held contracts, future-self letters, scripted discount wheels, fake countdowns, blurred fake stats.

## How to use this

Offer the founder a round-4 picking page (same format and artifact as rounds 1–3, collection `picks4`) built from the wording-only changes first. Any copy change must follow `AGENTS.md`: config strings and `docs/onboarding-flow.md` change together, `npm run verify` green, fresh-context review.
