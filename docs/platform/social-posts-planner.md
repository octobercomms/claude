# Social Posts Planner — brief

A Claude-driven chat that turns a business + post idea into a complete
production-ready brief, so the AM (or the client themselves) can pick
up their phone and start filming the same day.

Lives on the existing **Social** tab of the platform (per client),
alongside the connector data.

---

## Goal

Reduce the time from "I want a social post about X" to "I have
everything I need to shoot it" from a multi-day back-and-forth to
~15 minutes of conversation.

The output is not a post or a video — it's a **shoot-ready brief**.
Production stays human (or AI-generated through a separate tool); this
just removes all the planning friction.

---

## Flow

1. **Context once, reused forever**: pulls the client briefing
   (already on the client record) so it knows who the business is,
   tone of voice, target audience, what they sell.
2. **AM describes the idea**: free-form chat. "I want a post about
   our new Quiet Luxury collection, aimed at design-led 35-50s, for
   Instagram Reels and TikTok."
3. **Claude refines via Q&A**: tone? duration? talent on camera or
   product-only? key offer or just brand? any must-include props or
   shots? (Each question only if not inferable from briefing or
   prompt — no checklist-style interrogation.)
4. **Plan generated** as a structured brief (see schema below).
5. **AM iterates** ("make it shorter", "swap scene 3 to a UGC-style
   talking head", "less product-shot, more lifestyle") in the same
   chat.
6. **Lock & export** — same PDF / Word export flow as the AI Data
   Analyst chat (already shipped).
7. **Saved per client** so the AM can pull it back up and reuse as a
   template for the next post.

---

## Brief schema (what the plan contains)

### Top-level

- **Title** — short, AM-readable ("Quiet Luxury Reel #1")
- **Platform(s)** — Instagram Reels / TikTok / Shorts / Stories /
  static feed / carousel. Drives duration + aspect ratio choices.
- **Duration** — target (e.g. 15s, 30s, 60s)
- **Performance hypothesis** — which metric this post is meant to
  move (reach / saves / clicks / DMs). Without this we can't tell
  later whether it worked.
- **Hook (first 1–3 seconds)** — the pattern interrupt that stops the
  scroll. Generated separately because it's the most important and
  most-iterated element.
- **CTA** — what the viewer should do next (link in bio, comment, save,
  share, visit URL, etc.)

### Per scene (typically 3–6 scenes)

- **Scene number + name** ("Scene 1: Showroom wide")
- **Duration** in the cut (e.g. 2s)
- **Shot description** — what's in frame, the camera move (pan, push
  in, locked off, handheld)
- **Bullet points instead of a script** — the *idea* the on-camera
  talent should communicate, not a word-for-word script
- **B-roll** — cutaways the editor needs (close-up of product, hands
  unpacking, texture detail, etc.)
- **On-screen text** — caption text + timing (in/out frame), font
  treatment if the brand has one
- **Audio** — VO? Music only? Diegetic sound? Mood/tempo notes

### Production support

- **Equipment minimum** — what the AM/client can shoot on a phone
  (camera app settings, lighting tips, audio: built-in mic vs. lav)
- **Equipment ideal** — what'd benefit from a camera/lens/lav mic if
  they have it
- **Locations** — primary + backup
- **Props/wardrobe checklist**
- **Talent** — who's on camera (named if known, role-described if not)
  and what they need to be briefed on

### Post-production

- **Editing notes** — pace, cut style, transitions to avoid
- **Music/track brief** — mood, tempo, licensed track suggestions
  (Epidemic Sound / Artlist categories), key change/drop moments
- **Caption + hashtags** for the post itself (per platform — IG/TT
  use different hashtag strategies)
- **Reuse plan** — same content cut for other platforms, with format
  and duration notes per platform

### Approval gates

- Script approval (the bullet brief — sign off before filming)
- Rough cut approval
- Final cut approval
- Each gate names who from the client side owns it, so non-marketers
  know where their sign-off is needed.

---

## Build phases

### Phase 1 (MVP — chat + export)
- New Social tab "Plan a post" panel
- Reuses the AI Data Analyst chat infra (`/api/chat/...` already
  supports tool use, message history, PDF/Word export)
- Claude tool: `propose_plan` — emits the structured brief above as
  JSON, rendered in a preview pane (same UX as the report template
  builder)
- Export: PDF + Word via existing `services/chatExport`

### Phase 2 (storage + reuse)
- Persist locked plans per client (`social_post_plans` table)
- "Start from previous" — clone an old plan as the starting point
  for a new one
- Tag plans by campaign / collection so they can be grouped

### Phase 3 (production support)
- Integrate with the brand assets store: when Claude suggests a logo
  overlay or a colour palette, pull from the client's saved assets
- Music suggestions cross-referenced against an external API (or a
  small hand-curated list)
- Storyboard frame thumbnails generated via Gemini/Imagen for each
  scene so the AM can visualise before shooting

### Phase 4 (loop closure)
- After the post goes live, attach the actual performance back to
  the plan (via the Meta/TikTok connector data)
- Compare hypothesis vs. reality, surface patterns ("hook-style A
  beats B for this client")
- Feed those patterns back into the system prompt so future plans
  for this client lean toward what's been working

---

## Open questions

- Where does this sit alongside the existing strategist briefing
  flow? Same chat or separate?
- Do we want a library of reference posts the AM can show Claude
  ("make it like *this* one") — image/video upload as a stylistic
  reference?
- Multi-post campaigns: one chat producing a series of 5 posts vs.
  five separate chats? Almost certainly the first — same context
  reused.

---

## Out of scope (for now)

- AI video generation. This brief is *for humans to shoot*.
  Generative video can be a separate tool later.
- Scheduling/publishing. We aren't a social management tool.
- Performance dashboards beyond what already exists on the Social
  tab.
