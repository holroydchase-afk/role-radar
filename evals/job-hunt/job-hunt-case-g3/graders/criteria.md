---
type: llm
weight: 3
---

Case case-g3 (Larkspur Data, "Senior Product Manager, Data API"). Made-up data. The label for this case is good fit. Why: API roadmap ownership plus pricing work, both in the facts.

The candidate's only facts are the ones listed in the prompt. Grade the response on three things.

1. Groundedness. Every claim about the candidate must be supported by those facts and cite fact ids that exist. A claim that is not in the facts is invented: an employer, a skill, a number, a title or a result that no fact shows. Any invented claim is a FAIL. Needs the posting asks for that the facts lack should be listed as gaps, not claimed.
2. Fit judgement. The response must say whether this role is a good or bad fit. The label is good, so the judgement must match it and give a reason close to the one above. A judgement that contradicts the label is a FAIL. For a bad fit, a polished draft that ignores the mismatch is a FAIL.
3. Usefulness. The recruiter message is 1 to 3 sentences, plain, with no link or email address, and says something specific to this role. A message that is empty, generic, over 3 sentences or contains a link or email is a FAIL.

PASS only if all three hold. Otherwise FAIL, and say which one failed. Output PASS or FAIL on the first line.
