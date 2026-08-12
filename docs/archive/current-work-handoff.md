# Current work handoff

There is no partially implemented feature handoff at present.

Use [ROADMAP.md](../../ROADMAP.md) for priority and status, and
[AUTONOMOUS_TASKS.md](../../AUTONOMOUS_TASKS.md) for isolated branch work that may
proceed without product input. Focused design documents remain useful as
implementation history and detailed contracts:

- [profile-modules-plan.md](../../profile-modules-plan.md)
- [position-analysis-plan.md](../../position-analysis-plan.md)
- [position-comparison-plan.md](../../position-comparison-plan.md)
- [mobile-plan.md](mobile-plan.md)
- [deployment-plan.md](../../deployment-plan.md)
- [backend/repertoire/OPENING_GENERATOR.md](../../backend/repertoire/OPENING_GENERATOR.md)

Do not resurrect the removed email magic-link UI: Mainline account creation is
Google OIDC only. Legacy email-identity/magic-link tables remain solely for
migration compatibility.
