# Survey invite email — what the evidence says

Short version: the invitation email moves the response rate as much as the survey
itself. Studies put the swing at **20–40 percentage points from invitation
quality alone**, holding the survey constant. So the email is worth getting right.

## The levers that matter, in order

1. **State the time.** Time commitment is the number-one reason people skip a
   survey, so saying "takes a minute" up front removes the biggest objection.
   ([Alchemer](https://www.alchemer.com/resources/blog/survey-invitation-email-best-practices/))
2. **Embed the first question in the email.** Letting people answer the first
   question straight from the inbox (one tap) **lifts response ~22% and
   completion ~19%.** They arrive already started, which is the hardest step.
   ([Zonka](https://www.zonkafeedback.com/blog/measure-feedback-with-email-survey-invitation),
   [SurveyMonkey](https://www.surveymonkey.com/curiosity/3-ways-to-optimize-your-survey-invitations-to-increase-response-rates-3/))
3. **A specific, benefit-led subject under ~50 characters.** It must fit on a
   phone. Avoid generic "We'd love your feedback" — it reads as marketing and
   gets deleted. Personalised subjects are **~26% more likely to be opened.**
   ([Delighted](https://delighted.com/blog/email-survey-subject-line-tips))
4. **Keep the body short and single-purpose.** One clear ask, one clear button,
   no wall of text.
5. **Send while it's fresh.** The day after the event is the window; memory and
   goodwill are highest then.
6. **Name the reward and what it's for, but don't give the code away.** The
   incentive is a reason to start; revealing the actual code in the email lets
   people take it without responding. Show the offer, lock the code, reveal it on
   completion.

## How October Events applies this (v1.193.0)

- **Subject** states the time and the offer: "How was {event}? (a minute — 20%
  off inside)".
- **Body** lists the (short) set of questions so people see it really is quick,
  then embeds the **first 1–5 rating as one-tap buttons** that deep-link into the
  survey with that answer pre-selected.
- **Reward** shows the offer and what it's for in a locked chip ("unlocked when
  you finish"); the code itself is never in the invite.
- **Timing** is the automatic day-after send (configurable).
- **Thank-you email** on completion delivers the actual code to their inbox, so
  they still have it later.

## Not yet built (worth considering)

- **A single reminder to non-responders** ~3 days later lifts response further;
  it's the most common next add. Deferred to keep v1 simple (see the spec's open
  decisions).
- **Per-recipient unique codes** (instead of one shared capped code) if the
  reward ever needs tighter control.

Sources: Alchemer, Zonka Feedback, SurveyMonkey, Delighted (linked above).
