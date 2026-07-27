# Venn Roadmap

> Status: Pre-Ratification Draft 0.1
> Founding Custodian: Carbon Caste Inc
> Initial Legal Context: Canada, with Ontario as the operating base
> Companion Drafts: `FOUNDING_DOCUMENT.md`, `CHARTER.md`, `CONSTITUTION.md`

## 1. Roadmap contract

This Roadmap sequences tests, not destiny. Dates are planning ranges; gates are binding. A phase advances only when its evidence is independently inspectable and its predecessor's acceptance still applies to the exact implementation under review.

The Roadmap cannot amend the Charter or Constitution. When a product opportunity conflicts with them, the product changes.

Every phase SHALL:

- produce something independently useful if the next phase never arrives;
- state the population, jurisdiction, evidence, assurance, and limitations of every measure;
- preserve the separation of expression, inference, confirmation, delegation, and ballot;
- use no person-linked political signal before the applicable consent, legal, privacy, security, and governance gates;
- keep protocols independently implementable;
- record corrections and failed gates; and
- avoid claims stronger than the evidence.

## 2. Repository progression

### 2.1 Pre-ratification workspace

The four foundational drafts are first reviewed together in one private, clean staging repository:

```text
FOUNDING_DOCUMENT.md
CHARTER.md
CONSTITUTION.md
ROADMAP.md
governance/
  REVIEW_PROTOCOL.md
  DECISION_LEDGER.md
  reviews/
```

Every review binds an exact commit. One integration editor applies accepted changes. Any material edit invalidates earlier approvals. Ratification requires a final no-change circuit in which every named reviewer issues GO on the same commit, followed by human ratification.

### 2.2 Canonical repositories

After ratification, the canonical Venn repository begins from the ratified document set rather than inheriting VHC history. Anticipated separation:

- `venn-protocol` — constitutional documents, normative specifications, registries, conformance suites, and verifier;
- `venn-reference` — reference-artifact schemas, authoring and validation tooling;
- `venn-reader` — Carbon Caste's news, context, familiar, and participation product;
- later calibration, identity-adapter, aggregation, and conformance packages when independent ownership or release cadence justifies separation.

The exact organization, names, licences, and visibility remain formation decisions. No repository split may create a private protocol advantage.

## 3. Cross-cutting workstreams

Every phase tracks:

1. **Reference integrity** — facts, claims, frames, source rights, wording, translations, corrections.
2. **Signal semantics** — evidence classes, response schemas, repetition bounds, inference and confirmation.
3. **Consent and rights** — permissions, refusal, renewal, withdrawal, access, correction, deletion, youth exclusion.
4. **Identity and assurance** — authorization, personhood, eligibility, place, deduplication, recovery, provider plurality.
5. **Privacy and aggregation** — role separation, thresholds, metadata, privacy accounting, receipt-freeness.
6. **Calibration and methodology** — sampling, nonresponse, weighting, uncertainty, participation gaps.
7. **Surfaces and adoption** — reader, embeds, comment kits, agents, platforms, institutions.
8. **Governance and economics** — custody, stewardship, conflicts, conformance, public baseline, sustainable services.
9. **Security and cryptographic agility** — threat models, dependencies, migration, post-quantum planning, operations.
10. **Independent implementation** — public specifications, fixtures, offline verification, replaceable operators.

## 4. Phase F0 — Constitutional formation

**Purpose:** establish the exact project Venn is before code begins to define it.

### Work

- Complete the four foundational drafts.
- Create the private staging repository and governed decision ledger.
- Verify access to the exact requested review models; do not substitute silently.
- Run independent opening reviews before reviewers see one another's conclusions.
- Run the controlled multi-model correction sequence.
- Complete a final no-change review circuit on one exact commit.
- Record Carbon Caste's founding authority and transition covenant.
- Select initial licences in principle and obtain legal review.
- Complete naming and trademark review.
- Human founder ratifies the exact packet.

### Go gate

- The same exact commit receives all required reviewer GO decisions.
- No unresolved material contradiction exists across the four documents.
- Every unresolved implementation choice is explicitly deferred rather than hidden.
- Carbon Caste ratifies and publishes the founding decision.

### Stop conditions

- A reviewer identifies an unresolved Foundational Covenant conflict.
- The requested model identity cannot be verified and no authorized process change exists.
- A drafting change receives approval only against an obsolete commit.

## 5. Phase V0 — Validate the reference layer and demand

**Target range:** first 1–2 months after ratification.

**Purpose:** determine whether the shared reference object is fair enough to support anything downstream and whether real hosts and consuming institutions want it.

### Work

- Produce ten versioned reference artifacts containing evidentiary spine, contested facts, uncertainty, claim IDs, frame and counterframe, citations, source-rights evidence, and corrections.
- Test them with readers across political perspectives, languages, regions, and relevant subject expertise.
- Conduct 10–15 workflow interviews across representative offices, municipalities, newsrooms, publishers, community hosts, survey labs, and platform/comment teams.
- Obtain at least one consuming-institution design partner and one publisher or community-host design partner.
- Build disposable Venn Reader and embed prototypes.
- Test Compose-and-Confirm comprehension, refusal, uncertainty, and the distinction between expression and counting.
- Define one candidate 18+ Ontario civic pilot population and limited claim set without collecting person-linked political signal.
- Begin cryptographic inventory and data-longevity classification.

### Go gate

- Cross-perspective reviewers agree that the artifact is fair enough to use and that material frames are represented.
- Participants understand that posting, inference, confirmation, and voting are different.
- “Post without counting” is as usable as “post and count.”
- One consuming partner and one host partner commit to continued design.
- A credible calibration partner is identified.

### Kill or redesign

- Material groups consistently reject the reference artifact as structurally misleading.
- Claim wording cannot survive paraphrase testing.
- Users cannot understand or exercise refusal.
- No real consuming workflow values the envelope.

Failure is evidence. The project SHALL redesign the failed layer rather than reinterpret the gate.

## 6. Phase V1 — Read-only protocol foundation

**Target range:** months 2–5.

**Purpose:** make Venn useful before sensitive signal collection.

### Work

- Freeze semantic and privacy-critical requirements, not an unreviewed cryptographic wire format.
- Specify event artifacts, claim versions, frames, corrections, signal classes, assurance vectors, credential-admission policy, public envelopes, layered authorization, ballot separation, and protocol registries.
- Build schema validation, resolver, reference pipeline, offline verifier CLI, read-only API, mirrorable transparency log, generic embed, and comment-system kit.
- Build the first non-sensitive Venn Reader reference surface.
- Build the institutional envelope-verification workflow.
- Publish source-rights and correction procedures.
- Establish algorithm identifiers, version negotiation, retirement, compromise, and migration tests.

### Go gate

- A stranger can verify a complete packet offline.
- An independently hosted surface renders the same versioned artifact.
- A consuming institution successfully uses the verifier on synthetic or non-sensitive evidence.
- The read-only system creates no person-linked political inference or confirmed-position record.
- A second implementation can be started from the specification without private assistance.

## 7. Phase V2 — Counsel-approved adult Ontario signal pilot

**Target range:** months 5–10.

**Purpose:** test the complete expression-to-calibration loop in the smallest defensible live scope.

### Preconditions

- Canadian privacy counsel approves the declared data flows.
- A DPIA-equivalent assessment passes.
- Independent privacy, civil-rights, accessibility, survey-method, security, cryptographic, coercion, and metadata reviews pass for the exact lane.
- The pilot is 18+, has one declared Ontario population and limited claim set, and is explicitly not general public collection.
- Retention, withdrawal, correction, incident, and shutdown procedures are exercised.

### Work

- Implement distinct permission flows for measurement, confirmation, eligibility, calibration, delegation, and secondary use.
- Ship standing but scoped, renewable, reviewable, and revocable measurement authorization.
- Implement Compose-and-Confirm with exact claim/version, full response schema, visible consequence, and equal refusal.
- Integrate passkey authorization and at least one optional personhood and one eligibility/place path, with accessible alternatives and published limits.
- Keep provider cohorts separate unless reviewed cross-provider deduplication exists.
- Run role-separated private aggregation with contribution bounds, thresholds, metadata controls, and privacy accounting.
- Conduct one calibration run over the same claim set with paraphrase randomization.
- Publish the first complete civic measure and public baseline.
- Deliver the envelope to a real consuming institution and return an aggregate explanation to participants.

### Go gate

- Participants can inspect, refuse, renew, and withdraw authorization.
- No test path creates a public stance ledger or centrally readable political dossier.
- Expression, inference, confirmation, and assurance remain distinguishable end to end.
- The public result discloses coverage, skew, uncertainty, evidence mix, provider mix, deduplication limits, and corrections.
- Independent auditors reproduce the public envelope from the permitted evidence.
- The consuming partner confirms practical value without requiring raw personal data.

### Stop conditions

- Consent is not meaningfully understood.
- Withdrawal or deletion behavior fails.
- A provider or operator can link identity to readable signal contrary to the declared model.
- Receipt, timing, status, or small-cell behavior creates an unacceptable participation oracle.
- Calibration shows the stream cannot support the published claim.

## 8. Phase V3 — Reference product and plural operation

**Target range:** months 10–18.

**Purpose:** prove that the protocol is useful through Venn Reader but not dependent on it or Carbon Caste.

### Work

- Harden Venn Reader as a separate conforming product.
- Add a second independent publisher or community host.
- Add a second credential provider as a separate cohort until overlap is proven.
- Place deduplication and aggregation roles under independently governed operators.
- Add independent log mirrors, witnesses, and methodology review.
- Publish conformance-mark investigation, appeal, suspension, and revocation procedures.
- Establish the independent stewardship body and execute the required mark and governance-rights transition.
- Let Venn participants decide predeclared ordinary interface, roadmap, and registry questions through Venn processes.
- Add agent read and verification interfaces; consequential actions continue to require a fresh human surface.

### Go gate

- An implementation not maintained by Carbon Caste passes the technical suite.
- An independent publisher produces a conforming artifact.
- Independent operators produce and verify a real measure.
- The independent steward controls protocol governance and conformance.
- Carbon Caste remains commercially viable without constitutional privilege.

No general public person-linked political collection or third-party public conformance proceeds before the stewardship gate.

## 9. Phase V4 — Multi-jurisdiction and platform adoption

**Target range:** months 18–36.

**Purpose:** make Venn plural across jurisdictions, languages, providers, publishers, models, and surfaces.

### Work

- Add jurisdiction profiles with local legal, eligibility, consent, youth, threshold, and calibration rules.
- Publish multilingual, dialect, sarcasm, disability, and frame-bias benchmarks.
- Require registered interpretation models, model cards, cohort error reporting, and reproducible aggregate methods.
- Add native publisher, comment-system, community, social, video, and agent adapters only through authorized pathways.
- Expand one-human/one-count research through interoperable credentials, same-holder proofs, overlap estimation, recovery, revocation, and provider audits.
- Establish recurring privacy, security, cryptographic, methodology, rights, and accessibility review.
- Test hybrid and post-quantum migrations where the data-longevity and threat analysis justify them.
- Add separately named commercial or cultural profiles only after independent consent and misuse review.

### Go gate

- No single Venn service, platform, model, credential provider, publisher, or jurisdiction is operationally necessary.
- Independent implementations interoperate from public specifications.
- Every measure remains honest about unresolved cross-provider duplicates and coverage.
- Commercial growth has not produced exclusive civic results or personal political targeting.

## 10. Phase V5 — Public infrastructure for the agentic internet

**Target range:** years 3–5.

**Purpose:** make typed, calibrated, claim-resolved human signal a routine input to agents and institutions.

### Work

- Make verifiable civic envelopes consumable by policy agents, legislative assistants, public consultations, journalism, and platform context systems.
- Support participant-controlled private continuity across conforming wallets without a global political identifier.
- Expand from political and civic questions into carefully profiled cultural, commercial, organizational, and social domains.
- Give mature plural constituencies authority over protected amendment proposals under the Constitution.
- Demonstrate governance decisions made through Venn while identifying the represented population honestly.
- Keep public civic baselines accessible and machine-readable.

### Success gate

Independent stewards, implementations, publishers, credential providers, aggregation operators, calibration partners, auditors, participants, and consuming institutions can operate Venn without permission from Carbon Caste.

## 11. Phase V6 — Decision and ballot research

**Timing:** begins only after preceding evidence and external demand justify it.

**Purpose:** pursue the explicit ambition of legitimate binding decisions without converting opinion measurement into voting by drift.

### Progression

1. nonbinding internal consultations;
2. binding ordinary Venn community decisions;
3. low-stakes organizational votes;
4. independently administered civic pilots; and
5. legally recognized public decisions only after external validation, authorization, and adoption.

### Required evidence

Every ballot profile must demonstrate fresh authorization, eligibility without signal-history linkage, ballot secrecy, receipt-freeness, coercion resistance, universal verifiability, accessibility, availability, denial-of-service resilience, contestability, recounts, independent implementation and administration, legal certification, cryptographic agility, and post-quantum migration planning.

The commercial operator SHALL not administer a consequential external election alone. No signal, profile, delegation, or prior confirmation becomes a ballot.

## 12. VHC disposition

VHC remains preserved during formation as historical source material and a design quarry. It is not the Venn foundation.

A hostile salvage audit SHALL classify:

- reference-artifact and frame-table work;
- story clustering and correction provenance;
- Slide-to-Post and `CommentComposer` interaction work;
- identity, credential, delegation, and verification components;
- security and governance utilities;
- copyrighted-content acquisition paths; and
- operational infrastructure.

Every port requires current provenance, licensing, semantic, privacy, security, accessibility, and conformance review. News and participation components that survive belong in `venn-reference` or `venn-reader`, not automatically in the protocol core. After the salvage record is complete, VHC becomes read-only historical material with a successor pointer.

## 13. Deferred implementation decisions

The constitutional packet intentionally does not choose:

- exact open-code, specification, content, data, and mark licences;
- the stewardship legal form and transfer instruments;
- protected-amendment numeric thresholds;
- consent-screen wording and renewal interval;
- signal retention periods;
- conformance enforcement procedure details;
- pilot partners and exact claim set;
- credential providers;
- private-aggregation or receipt-free constructions;
- differential-privacy parameters;
- final federation topology;
- final agent transport; or
- a ballot implementation.

These are resolved through evidence, review, and ratified specifications. No implementation default acquires constitutional force merely because it shipped first.
