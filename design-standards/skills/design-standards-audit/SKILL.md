---
name: "design-standards-audit"
description: "Full detail of Dan's Design Standards v2.1: rule text with WCAG criteria, check procedures V-1 to V-7, critique rubric, appendix. Load for design checks, accessibility runs, critiques or V-7 reports."
---

# Design Standards v2.1 — audit detail

Use with skill `design-standards` (workflow, sizes, evidence rules, stance). Source of truth: https://claude.ai/code/artifact/00f213aa-f5f1-4582-a654-770b4589b242. Applies: W web · A app · E email · S social/static · P print.

## S rules with criteria
| ID | Rule | Applies |
|---|---|---|
| S-0 | Full WCAG 2.2 AA (web/app; email as clients allow). Incl. page titles, link purpose, label in name, input purpose, orientation, pointer gestures, bypass blocks, language | W A E |
| S-1 | Text ≥4.5:1; large (≥24px or ≥18.66px bold) ≥3:1 [1.4.3] | WAESP |
| S-2 | Control edges, states, focus rings, meaningful graphics ≥3:1 [1.4.11] | WA |
| S-3 | Targets ≥24×24 CSS px or 24px-circle spacing [2.5.8] | WA |
| S-4 | Keyboard operable, logical order, no traps [2.1.1, 2.1.2, 2.4.3] | WA |
| S-5 | Focus visible, not hidden by sticky/overlay [2.4.7, 2.4.11] | WA |
| S-6 | Reflow 320px no 2-way scroll [1.4.10]; 200% text [1.4.4]; text spacing [1.4.12] | WA |
| S-7 | Alt text; decorative hidden [1.1.1] | WAE |
| S-8 | Semantics, labelled controls, name/role/value, status messages [1.3.1, 4.1.2, 4.1.3] | WA |
| S-9 | Visible labels; text errors + fix; no redundant entry; accessible auth [3.3.1–3, 3.3.7, 3.3.8] | WA |
| S-10 | No context change on focus/input; consistent help [3.2.1, 3.2.2, 3.2.6] | WA |
| S-11 | Colour not sole signal [1.4.1] | WAESP |
| S-12 | Reduced motion; pause >5s [2.2.2]; no autoplay audio (stricter than 1.4.2); captions [1.2.2]; ≤3 flashes [2.3.1]; drag alt [2.5.7]; hover/focus content [1.4.13]; timing [2.2.1] | WAES |
| S-13 | I-2 job end to end per I-6 platform; real device = needs Dan (Ma) | WA |
| S-14 | States: default, focus, active, disabled; hover on pointer; loading/error where relevant; links/buttons distinct from text | WAE |
| S-15 | <100ms ack; >1s progress; >10s estimate or leave-and-return | WA |
| S-16 | Destructive/costly: undo preferred, else confirm stating consequence | WA |
| S-17 | Modal/sheet: focus in, return to trigger; Esc (keyboard) / back-swipe (mobile); ≤1 confirm layered; not for non-critical | WA |
| S-18 | Input preserved through errors, back, validation | WA |
| S-19 | Empty, loading, error, partial (some loaded/failed), success; longest content; +30% if translated | WA |
| S-20 | Consistent behaviour and naming | WAE |
| S-21 | User vocabulary, not system | WAES |
| S-22 | Buttons state outcome; action name persists (Publish → Published) | WAE |
| S-23 | Errors name cause + next step; "Something went wrong" alone fails | WAE |
| S-24 | No dark patterns: easy cancel; no confirmshaming, fake urgency/scarcity, pre-ticked consent, hidden costs, disguised ads | WAES |
| S-25 | Cost, commitment, data use before commit; plain privacy copy | WAE |
| S-26 | Real or labelled illustrative; AI people/quotes/customers never shown as real | WAESP |
| S-27 | Pre-ship lab (Lighthouse mobile): LCP≤2.5s, TBT≤200ms, CLS≤0.1. Field p75: LCP≤2.5s, INP≤200ms, CLS≤0.1. Reserve image/font space | W |
| S-28 | App cold start ≤2s mid-range; no visible stutter; offline/poor-network state | A |
| S-29 | Spacing ≤8 steps, type ≤7 steps, named tokens, nothing off-scale | WAE |
| S-30 | Colour role tokens; dark values pass S-1/S-2 | WA |
| S-31 | Body ≥16px web/email; app default (17pt iOS, 16sp Android); dense ≥14px; none <12px; ≤75 chars | WAE |
| S-32 | Ornament never misleads: nothing decorative misleads, hides content or competes with I-3; 01/02/03 only for real sequences. Whether ornament is earned = H-21 | WAESP |
| S-33 | 2-second test (V-3) names I-3 | WAESP |

## H rules (full)
H-1 Mood before hex (new brands): 3–5 moods, best fit to I-1–I-4, colours from named scene objects; semantic colours exempt · H-2 Playful (consumer/marketing): ≤2 of stickers, offset shadows, hand-drawn marks, quippy copy · H-3 Softer humane type; 1–2 families, distinct · H-4 Weight/scale contrast; tighter tracking large, open small · H-5 Line-height body 1.4–1.6, headings 1.05–1.2; measure 45–75 · H-6 Headline type as design · H-7 Roles: ground, ink, one accent (action/state), ≤2 supporting; expressive colour welcome when it is the I-8 signature and never clashes with the accent's meaning · H-8 White ground; cream only if mood demands; offer low-glare theme instead · H-9 Ink #000 or deliberate scene dark; generic #111/#0B0B0B is a tell; greys from scene or neutral · H-10 Avoid: warm off-white × red/orange/copper/terracotta; warm off-white × fluorescent; navy/charcoal × electric purple/lime/teal; white × muted earth; tinted warm ground × saturated accent · H-11 Whitespace groups; asymmetry, scale contrast · H-12 Surfaces over cards; cards only for actionable units; vary radius/elevation by importance · H-13 Row columns align; fixed slots · H-14 Touch 44px, pointer 32px · H-15 Validate on blur/submit; live only for strength/count/availability · H-16 Interface voice; no apologies/oops · H-17 Removal pass: keep if it adds information, warmth or character; I-8 signature exempt · H-18 Human touch from real content (voice, work, photos, failures, hand-set headline), as much as content honestly offers; never blob/glow/grain as substitute · H-19 Motion needs a job (orient, feedback, signature); a motion language is fine when it is the signature; static update fine; S-12 always · H-20 Anti-defaults (see core skill); a removed tell must be replaced by an I-8 choice; "neutral-safe" is itself a tell · H-21 Earned ornament: ornament, texture, illustration, structure welcome when they build the signature or carry information, never from habit; builder logs one line per ornament; reviewer judges in V-5.

## Checks
| ID | Procedure | Size | Pass |
|---|---|---|---|
| V-1 | Two directions, both meet I-1–I-4, differ on ≥2 of mood/type/layout; one deliberately goes too far, pick may pull back; loser rejected with reason | Ma | Both + reason in brief |
| V-2 | Screenshot each section; one-line verdict: spacing, typography, contrast, alignment, fit, repetition | All | All verdicts; targeted fixes |
| V-3 | Image only, 2s: "what's it for, what first?" 3 humans, 2 name I-3. Agent: fresh session, image only, I-3 withheld until answered; indicative only on Ma | Mi, Ma | I-3 named |
| V-4 | Agent: scan, contrast all themes, keyboard walk, 320px + 200%, text spacing, reduced motion. Dan: screen reader, real device, forced colours | Mi agent, Ma all | S-0–S-12 pass/n.a./needs Dan |
| V-5 | Critique (rubric) at real size, phone, dark mode; includes S-32, H-21 and the logo-swap test (competitor could use it unchanged → fail, back to I-8) | Mi, Ma | Top 3 made or logged; logo-swap passes |
| V-6 | 3 task sessions, representative users, I-2 job | Ma | Done; failures fixed/logged |
| V-7 | `ID | status | evidence` atop every hand-off | All | No S failed |

Wrong intent or missing character found in V-3/5/6 → back to Part 1, restructure; targeted fixes are for craft only.

Rubric: Intent (I-1–3; this brief, not every brief; H-20 + logo-swap; I-8 signature visible on first screen?) · First impression · Usability (remove/merge/defer) · Hierarchy · Consistency vs tokens · Ornament (S-32, H-21: each log line carries information or builds the signature) · Accessibility (V-4). Feedback: specific, cites ID or job, proposes fix, notes what works, matches stage, biggest first.

```
## Critique: [name] — [stage] — [size]
Verdict: [strength, problem] · Eye lands on: [x] — I-3? y/n · Signature visible? y/n · Logo-swap: pass/fail
| Finding | ID | Severity | Fix |
Works: … · Top 3: 1. 2. 3.
```

## Appendix (H tier)
Palette seeds (ground × accent): slate × verdigris; fog × navy; bone × moss; snow × evergreen; ink × chrome yellow; white × cobalt; white × cadmium red; don't reuse across products · Imagery: one treatment per product, no baked-in text, credit per licence · Icons: one set, consistent stroke/grid, label unless universal, never sole clickability cue · Charts: by question, one highlight, direct labels, tabular nums, not colour alone, no 3D/gradients · Dark mode: not inverted, lighter = higher, desaturated accents, no pure white on pure black · Email: single column, live text, alt on all images, real-link buttons, works images-off · i18n: logical CSS start/end, locale formats, check RTL · Print: one message at 3m, bleed/safe area, CMYK, test contrast on stock · Cross-product: shared primitive tokens, per-product brand layer.