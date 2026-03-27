# ROUTING_SEMANTICS.md

This file defines the intended semantics of the thinking-router tiers for humans and automation.

## Tier definitions

### A0
Use for:
- translation
- rewrite / rephrase / wording polish
- ultra-short standalone Q&A
- one-liner explanations

Do **not** use A0 for:
- debug / diagnosis
- config / routing / model-policy explanations
- multi-step reasoning
- risk or action requests

### A1
Use for:
- standalone summary
- recommendation
- shortlist / comparison
- lightweight draft generation

Examples:
- restaurant recommendations
- short product-update draft
- shortlist of options
- standalone pros/cons comparison

### A
Use for:
- lightweight context-aware follow-up
- short replies that depend on previous thread context
- context-carry replies that should not collapse to A0

Examples:
- "发了"
- "貌似可以了"
- short follow-up replies inside an existing diagnostic thread

### B
Use for:
- explain / analyze
- debug / diagnose
- design / architecture
- system or configuration explanation
- normal execution planning

Examples:
- explain fallback order
- debug why gateway restart did not apply a hook
- compare routing behavior
- analyze a failure and suggest fixes

### C
Use for:
- high-risk execution
- destructive operations
- config mutation with real-world impact
- prod / security / billing / trading execution
- explicit high-intensity reasoning requests when stakes are high

Examples:
- restart production services
- mutate routing / config in a live environment
- delete / truncate / purge
- trading or order-execution actions
- disabling security checks or changing permissions

## Heuristics update policy

Automation must optimize routing by editing heuristics only.

Allowed:
- update regex in `router.config.json`
- generate and apply `cron/heuristics.overrides.json`
- use `cron/heuristics-updater.js`

Not allowed:
- edit `thinking-router.js`
- edit hook handler files
- redefine the meaning of A0/A1/A/B/C without explicit human approval

## Success criterion

The cron optimizer should make routing behavior better match the tier definitions above while keeping changes:
- small
- local
- easy to revert
- low risk
