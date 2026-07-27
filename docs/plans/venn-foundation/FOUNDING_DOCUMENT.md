# VENN — Founding Document: The Human-Signal Protocol for the Agentic Internet

> Status: Pre-Ratification Draft 0.2
> Founding Custodian: Carbon Caste Inc
> Initial Legal Context: Canada, with Ontario as the operating base
> Last Reviewed: 2026-07-26
> Companion Drafts: `CHARTER.md`, `CONSTITUTION.md`, `ROADMAP.md`

This document supersedes the 2026-07-25 Assent working draft. It records why Venn exists, the reasoning that produced its architecture, and the ambition against which later choices must be tested. The companion Charter states the durable mission and boundaries; the Constitution states binding rules; the Roadmap states provisional execution gates. If these drafts conflict, the conflict is a defect to resolve before ratification. After ratification, the Constitution controls normative behavior, the Charter controls mission interpretation, and this document remains the founding account rather than an alternative specification.

---

## 0. Provenance, supersession, and definitions

### 0.1 What this consolidates

Nine rounds of analysis converged here:

1. **Landscape assessment** (2026-07-25): VHC spans six markets with one developer; its crown jewels are records and enforced invariants, not screens; identity should be consumed, not minted; the news pipeline carries unlicensed-copyright risk; the P2P mesh is the leading cause of its own outages.
2. **Assent draft** (2026-07-25): re-scope to an evidence layer for deliberative processes — SCITT transparency log, sortition transcripts, conformance gates.
3. **External critique**: the Assent draft overclaimed ("provably fair panel", "operator cannot cheat", "proof of consideration"), embedded a privacy error (public per-person stance rows), contradicted itself on cohort floors, assumed government documents are public domain, and overstated code maturity.
4. **Instrument correction**: the mini-public wedge narrowed away the founding idea. The recovered thesis: leverage ordinary, everyday engagement — with consent — as continuous civic signal, with mini-publics demoted to a calibration instrument.
5. **Agent-era synthesis**: Venn as the human-authority and public-opinion layer for an internet operated by agents; constitutional norms enforced at verification; `CivicMeasureEnvelope`; MCP/A2A/CLI as adapters over a transport-neutral protocol.
6. **Four structural corrections**: the trusted-ceremony problem and its WebAuthn answer; deniable receipts (the vote-buying surface); claim-wording governance and publisher pluralism (the Ministry-of-Claims risk); admissibility framing and demand-side-first adoption.
7. **Human-signal expansion**: ordinary expression — including repetition, sarcasm, outrage, attention, sharing, and sincere argument — contains population-level evidence even when it is not a confirmed personal position. The protocol therefore separates four evidence classes (expression, salience, inference, confirmation), assurance qualifiers, and calibration outputs instead of discarding the ambient layer or collapsing everything into one sentiment score.
8. **Provider-neutral identity and platform synthesis**: one human should be countable without becoming globally trackable. Passkeys authorize ceremonies; external personhood and eligibility credentials provide declared assurance; scope-specific nullifiers allow duplicate weight to be rejected within the domain and credential policy their construction actually covers. World ID is a possible provider, not a dependency. Native platform adapters and the Compose-and-Confirm gesture are the long-term carrier, while Venn remains useful without platform cooperation.
9. **Founder settlement** (2026-07-26): Venn begins with adult political and civic measurement in Canada, with Ontario as the operating base, while preserving a global and eventually cross-domain ambition. Layered consent, public baseline civic measures, Carbon Caste's temporary custodianship, progressive self-governance, two-level constitutional entrenchment, a structurally separate Venn Reader, cryptographic agility, and a separately gated long-term ballot capability were accepted as founding direction.

### 0.2 What carries forward from the Assent draft

The transparency-log profile on SCITT (RFC 9943, June 2026), the conformance-gate architecture, the assurance architecture, the linkability-domain registry, the salvage discipline, the licensing scheme, and the spec-first repository shape all survive. What does not survive: the public stance ledger, the universal cohort floor, the mini-public-only scope, the panel-fairness overclaims, and the name.

### 0.3 Definitions used throughout

- **Designed** vs. **working**: specified on paper vs. running code a user can exercise.
- **Admissibility** vs. **behavior**: what the protocol accepts into the graph vs. what third-party systems do internally. _The constitution governs admissibility._ Venn cannot govern the internals of other people's agents and does not claim to.
- **Freeze-critical**: a property that must be present in the first frozen schema because it cannot be retrofitted after records circulate.
- **Ceremony**: a deliberate credential-holder authorization under a declared assurance policy, bound to an exact claim version through a trusted human surface and a reviewed private-disposition construction.
- **Expression**: an attributable or integrity-checked event — a post, comment, reaction, share, open, dwell event, or other declared interaction — before any claim about what it means. Its origin assurance may range from a platform account to a personhood-admitted contributor; the word does not itself assert human origin.
- **Inference**: a model-produced probability distribution over possible meanings of expression. It is evidence for a population estimate, never an assertion by the person.
- **Confirmed position**: a claim-bound position the human explicitly authorizes through a ceremony.
- **Assurance**: what a declared verifier or issuer establishes about the contributor — account control, human presence, issuer-scoped personhood/uniqueness, eligibility, or place — independently of what the signal means.
- **Scope nullifier**: a value designed to be stable only inside a declared measurement scope, allowing duplicate prevention there without intentionally creating a cross-context identity; its actual unlinkability depends on the reviewed construction, issuer behavior, metadata, and operator separation.
- **Private profile**: the participant-controlled, encrypted history their wallet or familiar may maintain for their own use. It is not a public identifier, a Venn-held political dossier, or a source of standing authority for new positions.

---

## 1. Thesis

### 1.1 The founding intuition (recovered from VHC)

People already read, react, argue, celebrate, rage, and want to be heard — and they will not take a single extra step to do it. The original VHC insight was that this everyday engagement could be formalized into legible civic signal without demanding new habits. That intuition survives intact, with one precision added: **"no extra step" means no new destinations and no new habits — not no consent.** A one-tap confirmation on a control that is already in front of the person is the same gesture as a like. What people will not do is go somewhere else and remember to do civic duty there.

### 1.2 The structural argument (why now, and why this grows more valuable)

As AI systems make persuasive text and simulated public opinion effectively free:

- **Message volume is becoming weaker evidence.** Legislative and agency channels face growing synthetic advocacy; the hypothesis Venn must test is that consuming institutions increasingly discount raw engagement totals and will value inspectable evidence envelopes instead.
- **Predicted preference becomes accurate and remains illegitimate.** A model saying "District 12 supports this 61–39" will often be right, and it will still not be consent. The gap between _simulation_ and _authorization_ is the permanent market.
- **Ambient human expression remains valuable when its provenance and limits are explicit.** Sarcasm, repetition, outrage, sharing, and attention reveal what matters, which frames move people, and which questions formal polling failed to ask. They become dangerous only when silently promoted into personal beliefs or mistaken for representative headcount.
- **Every uncalibrated social-listening product decays toward worthlessness**, because it increasingly measures synthetic text and agent traffic. The surviving instruments will distinguish expression from assertion, authenticate human contribution, cap repetition, and calibrate the resulting stream.

The scarce goods of the agentic era are **authentic human signal and human authority**: evidence that expression came from credential-admitted humans rather than manufactured volume, and proof that a contributor unique within a declared policy and nullifier domain was presented with exact material and explicitly confirmed a position within bounds that constrain flooding. Venn measures both, but never pretends they are the same thing or that cryptography proves freedom from coercion.

### 1.3 What Venn is

> **Venn is the open protocol for representing humanity in the age of AI. It turns everyday expression into evidence of what people care about, and deliberate human confirmation into trustworthy measures of what they believe. It helps platforms, agents, communities, and institutions count distinct humans rather than bots, posts, or noise — creating an auditable public-opinion layer without creating a public record of anyone's identity or political history.**

One protocol, many clients. The publisher embed, generic comment-system kit, native platform integration, Bluesky integration, share-to-agent flow, browser Lens, MCP server, verifier CLI, future credential wallets, and Carbon Caste's structurally separate Venn Reader are all _surfaces_ over the same record and measurement system. No surface defines the protocol or receives privileged weighting, data access, or governance authority.

The working name is Venn: overlapping circles — shared facts in the intersection, frames in the crescents. It fits the thesis and is non-partisan; ownership and trademark posture remain open until the review in §16.

### 1.4 The irreducible formulation

> **Any surface may carry expression. Models may interpret it. Only a fresh human-facing authorization under declared assurance may create a confirmed position. Within a declared credential and nullifier scope verified under its named policy, no system may count one admitted contributor as a crowd. Anyone may audit the aggregate. No conformant public output may expose humanity person by person.**

Venn does not promise access to a metaphysical truth called "what people really think." It promises a typed, inspectable chain from observed expression through probabilistic interpretation and explicit confirmation to a calibrated population estimate, with provenance, coverage, uncertainty, and correction history attached.

The project is oriented by seven short statements:

> **Make collective human judgment legible to machines without making individual people legible to power.**
>
> **Expression shows what matters. Only a human can confirm what they believe.**
>
> **Count people once. Measure repetition as intensity, never as additional humans.**
>
> **Public opinion should be public. Personal political histories should not.**
>
> **Every signal remains what it is: attention is not belief, inference is not confirmation, and engagement is not a vote.**
>
> **Humans confirm. Agents cite. Institutions verify. Nobody has to trust the operator.**
>
> **No platform, identity provider, company, founder, or government should own humanity's signal.**

---

## 2. Non-goals (the scope firewall)

The predecessor's failure mode was scope. These are constitutional boundaries, not a denial of Venn's long-term ambition. Changing one requires the applicable protected or refounding process in the Constitution.

1. **Not reducible to a news destination.** Carbon Caste may operate Venn Reader as the first reference implementation, but the protocol is not the reader, the reader has no privileged standing, and competing publishers and clients must be able to implement the same public specification.
2. **Not an identity issuer.** Personhood, eligibility, and residency credentials are consumed from external issuers — potentially World ID, OpenID4VP-compatible wallets, EUDI wallets, passport-NFC systems, mDLs, notaries, or rosters — at declared assurance levels. Venn operates no biometric enrollment, enrollment hardware, or global uniqueness index.
3. **Not a universal identity or opinion profile.** There is no global Venn person identifier and no centrally readable identity-to-opinion table, encrypted or otherwise. One private wallet may hold continuity for its owner; the protocol sees only purpose-bound proofs and scope nullifiers.
4. **Not a token, not a treasury.** No coin, no mint, no yield, and no financial inducement for surrendering biometric or political data. Revenue is institutional (§10.5).
5. **Not presently a binding-election system.** Venn openly aspires to become capable of supporting binding democratic decisions if communities freely choose it after public legitimacy and external validation are earned. A ballot profile remains separately governed and legally authorized, with fresh consent, secrecy, receipt-freeness, coercion resistance, universal verifiability, accessibility, contestability, independent administration, and no conversion of an old signal into a vote.
6. **Not a behavioral-data broker or unauthorized scraper.** Venn does not centralize raw cross-platform activity. Ambient measurement requires a conformant local, user-authorized, publisher-authorized, or platform-native adapter with a declared data basis and retention policy.
7. **Not a peer-to-peer network.** Verifiability comes from transparency logs, mirrors, and offline verification — not gossip. Federation is earned later, cheaply, because the record format permits it.
8. **Not constitutionally dependent on a social network or moderation platform.** A reference product may host reading and discussion, but the protocol supplies context and a standard way to interpret, confirm, and aggregate signal across independently governed surfaces.
9. **Not an autonomous-agent product.** Venn defines what agents may submit and how it is verified. It does not ship an autonomous familiar.
10. **Not the Ministry of Claims or Credentials.** The format supports multiple independent artifact publishers, credential providers, aggregators, and implementations from the first schema. Venn-the-operator may begin as publisher and reference implementer; it must never become the sole author of shared reality or the sole arbiter of who counts as human.

---

## 3. Operating assumptions, 2026–2031

### 3.1 Base case

| Period  | What changes                                                                                         | What stays recognizable                                                                       | Venn's move                                                                                                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026–27 | AI embedded in browsers, OS, search; consumption shifts toward assembled answers                     | Feeds, creators, publishers, public argument                                                  | Establish event artifacts, claim IDs, typed signals, embeds, Compose-and-Confirm, credential-provider interfaces; sell the envelope verifier to institutions already drowning in synthetic advocacy |
| 2028–29 | Persistent personal familiars; platforms seek credible human-origin and unique-reach metrics         | Identity, community, status, consequential choices stay human                                 | Become what platforms and familiars use to distinguish expression, inference, and confirmation; support native comment-system kits; ride platform payment-confirmation rails                        |
| 2030–31 | Large share of online text and engagement is synthetic; communication is increasingly agent-to-agent | Human legitimacy, local eligibility, community, and consequential authorization remain scarce | Be the accepted evidence format for claim-level, population-level human signal: what was observed, what was inferred, what was confirmed, how it was calibrated, and with what uncertainty          |

### 3.2 Constraints on the design

- **Principal-centric, agent-plural.** One human may authorize many agents (OS, employer, health, personal). No combination of them multiplies that human's influence; all debit the same budgets.
- **Test the consuming side first.** Institutions already face synthetic public-comment risk, so the first buyer may exist before the familiar ecosystem matures. V0 must test that hypothesis rather than assume it (§10.1).
- **Platforms are a long-term carrier, not a dependency.** Native adoption by comment, feed, video, and community platforms is the scale path. The protocol must still be fully useful when walled gardens refuse — embeds, panels, share-to-agent, and institutional verification require no platform's permission.
- **Identity is plural and assurance is contextual.** Passkeys, account proofs, personhood credentials, residency credentials, and institutional rosters prove different things. No single provider is privileged in the normative protocol, and mixed-provider populations are not silently treated as globally deduplicated.
- **Resilience rule: every phase must be independently valuable in the world where the next phase never arrives.** Explicit + calibrated measures work with zero familiars. The instrument is not a bet on any particular agent future.
- **Self-selection and nonresponse do not vanish because everyone has an agent.** Calibration is a permanent subsystem, not a launch phase.

---

## 4. The instrument: three tiers

Venn is a measurement instrument, not a platform. Three tiers:

### 4.1 Reference layer — the shared object

One versioned, evidence-backed account per event, inspectable by humans and agents alike:

```text
EventArtifact
 ├── evidentiary spine            what the available sources support
 ├── contested facts              what remains unresolved, with uncertainty
 ├── stable claims                specific propositions, each with frame + counterframe + citations
 ├── source rights evidence       verified licensing basis per source (§7.2.2)
 ├── version history              stable hashes per version
 └── corrections                  logged, superseding, never silent
```

The honest promise — and the only one made: _Venn publishes one versioned, evidence-backed account of the event, explicitly separating established facts, contested claims, uncertainty, and competing frames._ Not "the event as it happened"; no system has that vantage. An agent may summarize the artifact differently for different users, but it can always prove which version, claims, and evidence it used.

### 4.2 Signal layer — typed evidence, never one sentiment score

Every admitted contribution declares what kind of evidence it is. Signal meaning and contributor assurance are orthogonal: a like accompanied by a high-assurance personhood presentation is still an ambiguous expression, while a claim confirmation made with a passkey is explicit even if no residency credential is attached.

| Evidence class | Source                                                                   | What it legitimately means                                                  | Allowed placement                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `expression`   | Post, comment, reaction, share, open, dwell, or other declared event     | This event occurred and was attributed at the stated origin/assurance level | Raw event remains with the participant or originating surface; integrity metadata may enter auditor custody                                                                          |
| `salience`     | Bounded interpretation of attention and repetition                       | This subject appears important to this participant set                      | Private per-person; aggregate-only publication                                                                                                                                       |
| `inferred`     | Model distribution over claim, stance, ambiguity, sarcasm, and intensity | The expression may imply these meanings with these probabilities            | Readable per-person interpretation stays participant-local or in an ephemeral no-retention source component; only bounded encrypted/secret-shared contributions and aggregates leave |
| `confirmed`    | Human ceremony bound to an exact claim and version                       | This human deliberately authorized this position to count                   | Private deniable receipt; aggregate publication                                                                                                                                      |

`calibrated` is not another observation class. It is an **output stage**: a statistical adjustment of one or more declared evidence classes against a probability panel or other registered design. Its result is a population estimate under method M, never a personal statement, and appears only in a public envelope carrying method, uncertainty, coverage, sensitivity, and limitations.

`verified` is not a meaning class either. It is an assurance qualifier applied to a contribution or cohort: verified account control, human presence, issuer-scoped personhood/uniqueness, eligibility, or place. Every envelope declares both the evidence classes it uses and the assurance policy under which contributors were admitted.

Four hard rules govern the layer:

- **A like is never an asserted position.** It may be applause, bookmarking, solidarity, sarcasm, tribal reflex, or an accidental tap. It may contribute bounded evidence to salience and an explicitly labeled inferred aggregate; it can never become a confirmed personal position without a ceremony.
- **Model inference is never an assertion.** A classifier may estimate "62% oppose, 8% support, 30% unresolved; sarcasm probability 47%" and may ask, "It sounds as though you disagree with claim C — count it?" Only the person's ceremony disposes. Ignoring the prompt leaves probabilistic evidence, not an official fact about that individual.
- **Inference does not create a central shadow profile.** Readable per-person interpretation stays on the participant's device or inside an ephemeral source-side component with enforced no-retention, then becomes only a bounded encrypted or secret-shared aggregate contribution. An originating platform may keep the raw expression it already controls under its own rules; a conformant Venn adapter may not add a durable account-keyed political inference dossier. Venn never stores a centrally readable table of inferred political positions.
- **Silence and absence are missing data.** Neither is neutral, abstention, nor assent.

### 4.3 Repetition, intensity, and human count

Repeated expression is information, but it is not repeated humanity. For each declared claim/population/period scope:

- **distinct-contributor headcount is capped at one** per measurement-root nullifier inside one declared admission cohort; it may be labeled distinct-human reach only when the admission policy includes the stated personhood assurance, and provider cohorts are not combined without a reviewed cross-provider construction;
- **frequency** reports how often the subject arose, separately from how many people raised it;
- **salience** uses a published saturating function so each additional event adds less than the one before;
- **intensity** is a separately bounded dimension, never multiplied into headcount;
- **inferred position** is consolidated into at most one bounded probability contribution per contributor and scope; repetition may change confidence but not create extra contributors;
- **confirmed position** is one current claim-version outcome per contributor and scope, with corrections or reversals superseding rather than accumulating; and
- **representativeness** is calculated from coverage and calibration, never inferred from volume.

The protocol never collapses distinct-contributor reach, salience, intensity, frequency, interpretive confidence, confirmed stance, and representativeness into one opaque score.

### 4.4 Calibration layer — the science

Mini-publics and probability panels are not the product; they are the instrument's calibration standard. Periodically, properly sampled panels (recruited with sortition tooling, selection published as replayable transcripts) answer the _same claim set_ as the continuous stream:

- Where inferred/confirmed signal and the sampled panel agree, confidence rises.
- Where they diverge, Venn has _measured_ a participation gap — itself a publishable finding.
- Panels also perform **wording-sensitivity testing**: randomized paraphrases of each claim; claims whose support swings past a threshold are flagged `wording_unstable` in every downstream measure (§7.2.3).

This is the river-sampling-calibrated-by-panel pattern that serious survey science already uses, applied to a continuous, claim-resolved stream. It is what separates Venn from social listening:

|                  | Continuous | Claim-resolved | Calibrated |
| ---------------- | ---------- | -------------- | ---------- |
| Polling          | ✗          | ~              | ✓          |
| Social listening | ✓          | ✗              | ✗          |
| Municipal survey | ✗          | ~              | ✓          |
| **Venn**         | ✓          | ✓              | ✓          |

### 4.5 What "public opinion" may honestly mean

Scale is never presented as representativeness, and inference is never presented as confirmation. Every published measure carries population, denominator where known, coverage, acquisition surfaces, time window, known skews, input evidence classes, assurance policy, model/method version, output stage, and uncertainty. Defensible template sentences include:

> "Among 8,412 participants unique within credential policy P and nullifier domain D, 61% explicitly confirmed support; coverage was 7.3% of eligible residents, with these known participation skews."
>
> "The calibrated population estimate is 55–62% support under method M. It combines confirmed responses and a separately labeled inferred-expression stream; wording sensitivity and nonresponse remain material limitations."

Those are smaller than "the district supports this" or "we know what people really think" — and they are the versions institutions can actually defend.

---

## 5. The constitution — sorted by enforceability

The prior fourteen norms are preserved in substance but reorganized by what can actually be enforced. This sorting is itself constitutional: **claiming enforcement power over other systems' internals is the overclaim our own lint exists to catch.** The constitution governs _admissibility_ — what may enter the Venn graph and what Venn will publish. The enforcement point is verification: **non-conformant output fails verification and therefore does not count.**

### 5.1 Class A — Admissibility rules (mechanically verifiable; gate-enforced)

- **ADM-1.** Nothing is admitted as a **confirmed position** without a valid confirmation ceremony bound to the exact claim ID and claim version.
- **ADM-2.** Every contribution preserves its evidence class (`expression`, `salience`, `inferred`, `confirmed`) through every downstream operation. No operation may relabel inference as confirmation.
- **ADM-3.** No per-person stance appears in any public record. Publication passes the three-layer placement check (§6.1).
- **ADM-4.** An agent asserting or acting _for a principal_ carries a valid, unexpired delegation reference and is permanently marked as an agent action. A platform or interpretation adapter submitting observation or inference evidence instead carries registered adapter/model provenance; it may never claim personal agency, human origin beyond its assurance evidence, or confirmation.
- **ADM-5.** Delegated-action budgets are enforced at admission: every delegated action debits the principal's declared per-period budget, and no agent holds a budget of its own. Human expression is not discarded because it repeats; distinct-contributor headcount, bounded signal contribution, saturating repetition weight, and privacy-release budgets are separate controls. Budget continuity may be claimed only inside the deduplication scope proven by the active credential policy.
- **ADM-6.** A materially revised claim version requires a fresh ceremony. Carryover of stances across material revisions is rejected. (Immaterial-revision criteria are defined in the wording spec and logged per revision.)
- **ADM-7.** `abstain`, `not_considered`, `not_applicable`, and every other code in the pinned response schema are valid ceremony outcomes and reported as first-class answers. The schema declares their stance-denominator treatment; they are never silently coerced to neutral or dropped.
- **ADM-8.** Every published measure carries a complete `CivicMeasureEnvelope` — population, denominator, coverage, input evidence classes, output dimensions/stage, assurance and credential policy, contribution bounds, method/model version, uncertainty, wording stability, privacy parameters, admission counts, and correction status. An aggregate without its envelope is non-conformant.
- **ADM-9.** Aggregates publish only at or above the per-output threshold declared in the thresholds registry for that population, process, and stratum (§6.3). There is no universal floor; there is a universal _requirement to declare and justify_ the floor in force.
- **ADM-10.** Within a declared claim/version/population/period/credential-policy measurement scope, one admitted contributor contributes at most one unit of cross-class headcount when the registered construction privately reconciles its evidence classes. Repetition may continue to affect separately bounded frequency, salience, intensity, and interpretive confidence under a saturating policy, never population count. If cross-class reconciliation is unavailable, class-specific counts remain separate and no combined distinct-contributor denominator is published.
- **ADM-11.** Every measure names a versioned `CredentialAdmissionPolicy`, its accepted providers and assurance claims, its nullifier scope, and its known duplicate/exclusion risks. Cohorts from providers without proven cross-provider deduplication remain separate or are modeled with the limitation disclosed.
- **ADM-12.** Every private aggregate declares its aggregation trust model, release threshold, contribution bound, and — where differential privacy is used — privacy unit, parameters, accounting period, and remaining release budget. "Encrypted" and "anonymous" are never substitutes for this metadata.
- **ADM-13.** No Venn measurement, deduplication, aggregation, log, or publication role may hold both a stable cross-context person identifier and readable expression, inference, or position data. The participant-controlled private plane is outside that prohibition. An originating platform may retain the account graph and raw expression it already lawfully controls, but its Venn adapter may not persist Venn-derived account-keyed political inference or export the platform identifier into the Venn measurement plane. A platform that operates an aggregation role receives no source-custody exception in that role. Role separation is a protocol property, not an operator promise.

### 5.2 Class B — Ceremony rules (attestable with hardware; verified where platform support exists)

- **CER-1.** A ceremony begins with an authenticator-mediated authorization act: user-presence and user-verification flags set, signature over a generic confirmation-session context and opaque private-flow handle. The claim, admission scope, and stance are bound only inside the reviewed receipt-free private-disposition construction. WebAuthn/passkeys prove control of a scoped credential and a local verification event; they do **not** by themselves prove a unique natural person, legal identity, residency, claim participation, selected outcome, or exclusive device use.
- **CER-2.** The ceremony surface must be independent of the requesting agent. The known gap — proving the human _saw_ the claim text ("what you see is what you sign") — is acknowledged in the spec, floored by origin-bound rendering today, and narrowed by secure-display attestation as platforms ship it (§7.1). No conformant implementation claims the gap is fully closed merely because WebAuthn succeeds.
- **CER-3.** High-impact actions — delivery to a representative, participation in a formal process — require a fresh ceremony at the time of action. Standing consent never substitutes.
- **CER-4.** A Compose-and-Confirm control must show the exact claim, version, selected outcome, and consequence ("post and count this") before release. A comparably accessible "post without counting this" path is mandatory. Model suggestions may be shown but may not be silently pre-confirmed. Showing the outcome does not authorize placing it inside an ordinarily verifiable signature or transferable commitment.

### 5.3 Class C — Policy positions (honestly labeled as such; enforced inside Venn's own systems, advocated beyond them)

- **POL-1.** Inference about a person's views, wherever it occurs, must never be presented as that person's assertion. Venn enforces this at admissibility; it cannot enforce it inside third-party agents, and says so plainly.
- **POL-2.** Silence is never assent, anywhere.
- **POL-3.** No third party should ever demand a receipt or a participation status. Venn's own APIs are designed to minimize provability and participation oracles (§6.2); carrying the norm beyond Venn is law-and-norms work, pursued with allies, not claimed as protocol magic.
- **POL-4.** Personhood and eligibility must remain plural and contestable. Venn advocates interoperable credentials, accessible alternatives, due process for false duplicate findings, and a practical path to correction and recovery; protocol conformance cannot guarantee that every external issuer behaves fairly.

---

## 6. Privacy architecture

### 6.1 Three-layer record placement (freeze-critical)

The Assent draft's single public append-only log of per-person stances was an architectural error: scoped pseudonym + place commitment + claim + position + timestamp is a durable political dossier awaiting correlation. The corrected placement:

| Layer                                            | Contents                                                                                                                                                                                                                                                  | Visibility                                                                                                                                                                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Private source and participant plane**      | Raw expressions at the originating surface; readable per-person inference only on the participant device or in an ephemeral no-retention source component; local account bindings; the person's ceremony receipts, private profile, and recovery material | Participant-controlled context plus the originating platform's pre-existing raw content custody under a declared basis; never public; the platform's Venn adapter may not add a durable account-keyed inference dossier |
| **2. Role-separated processing and audit plane** | Scoped nullifiers at the deduplication role; encrypted or secret-shared bounded contributions at independent aggregators; admission decisions, threshold applications, model/method evidence, and calibration workings                                    | Purpose-bound processors and auditors; no single Venn measurement role receives both a stable person handle and readable political signal                                                                               |
| **3. Public record**                             | Artifact versions, claim/wording history, committed rules, process checkpoints, aggregate commitments, envelopes, methodology, privacy-accounting summaries, and corrections                                                                              | Public transparency log (SCITT profile)                                                                                                                                                                                 |

**Per-person expression, inference, stance, nullifier mappings, and per-submission public commitments never appear in layer 3.** Fine-grained timestamps and low-cardinality slices are suppressed when they could create a participation oracle. These are gate-enforced (§12.3, gate 1) and freeze-critical.

### 6.2 Unprovability objective — the right not to be measured (freeze-critical)

A naïvely signed participant receipt is provable to anyone — an employer, a party, a buyer, a coercer. That recreates the exact failure receipt-free voting exists to prevent, an insight VHC's own GWC whitepaper carried (MACI: "a user cannot prove to a briber how they voted"). Corrections:

- **Receipts are designated-verifier (deniable).** Constructed so only the participant can be convinced by their own receipt; to a protocol verifier it should be indistinguishable from one the participant could have forged. Audit-to-self and aggregate-level log audit are preserved while third-party resale value is reduced.
- **No protocol participation oracle.** No conformant API or public-log query may confirm or deny an individual's participation. Protocol-visible _never-participated_ and _abstained_ states are indistinguishable.
- **Receipts are never demandable.** Venn publishes no mechanism by which a third party could require receipt disclosure, and the spec prohibits conformant implementations from adding one.

The secret ballot's genius was _mandatory_ secrecy — you cannot reliably sell what the protocol does not let you prove. Deniable receipts cannot prevent screenshots, device compromise, compelled live demonstrations, platform metadata, traffic analysis, or coercion outside the protocol. Venn therefore claims coercion resistance only for the specified evidence surfaces, tests metadata leakage, and treats law, interface design, and institutional safeguards as necessary complements. These properties must be in the first frozen receipt schema; they cannot be retrofitted after receipts circulate.

### 6.3 Output thresholds (replaces the universal cohort floor)

The universal k ≥ 100 floor contradicted the design's own 48-person panels. Replacement: a **thresholds registry** (`spec/registry/output-thresholds.json`) declaring, per output class:

- open-population geographic measures: default k ≥ 100 (carried from VHC), overridable per jurisdiction only with a published rationale;
- panel outputs: per-stratum minima, suppression and rounding rules sized to the panel;
- expression, salience, and inferred aggregates: separate, generally higher floors (attention and model-derived political data can be more re-identifying than confirmed aggregate answers);
- every entry carries its rationale and its review date.

The invariant is not one number; it is **no aggregate ships without a declared, logged, justified threshold** (rule ADM-9).

### 6.4 One participant-controlled wallet context, many purpose-bound civic proofs (freeze-critical)

The linkability-domain registry pattern is ported from VHC: every identifier or nullifier under which a person can contribute is declared with purpose, scope, derivation family, linkability profile, visibility, rotation, and recovery policy. Code-registry drift fails the build.

The desired experience is **one private wallet context, many purpose-bound civic personae**:

- the wallet may privately preserve continuity and the person's confirmed-position history for their own familiar;
- each `{claim, claim-version, population, period, credential-admission-policy}` measurement scope receives a different **measurement-root nullifier**;
- class-specific subproofs let the private deduplication role reconcile expression, inference, and confirmation inside that measurement without exposing the root or cross-class linkage to aggregators or the public;
- repeated and cross-class contributions inside that scope can be recognized and bounded under a registered reconciliation policy;
- unrelated claims, periods, populations, relying parties, and credential presentations receive no Venn-issued master identifier and must resist joining under the registered construction and threat model; and
- credential rotation and recovery must preserve the declared budget only where the active credential policy proves safe continuity.

Encryption alone is insufficient: a stable encrypted identifier is still a tracking handle. The privacy property is domain separation and role separation, not merely ciphertext.

Some deployments may choose stronger class unlinkability and therefore be unable to reconcile an inferred and confirmed contribution from the same person. Those deployments publish class-specific contributor counts, mark cross-class overlap `unknown` or `modeled`, and never publish a combined distinct-contributor denominator. They do not trade an honest limitation for a fake precision.

### 6.5 Authorization, personhood, and eligibility are separate

Venn composes proofs rather than pretending one credential proves everything:

| Proof                                 | What it can establish                                                                                                | What it does not establish                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Account token / federated sign-in** | Control of an Apple, Google, platform, or other account under that provider's policy                                 | Unique humanity, exclusive account use, residency, or political consent                                        |
| **WebAuthn/passkey assertion**        | Control of a relying-party-scoped credential; user presence and, when set, local user verification for this ceremony | A globally unique natural person, legal identity, residency, or that no other person can use the authenticator |
| **Personhood presentation**           | An external issuer's claim, at a declared assurance level, that one eligible credential represents one human         | Universal truth, fairness of enrollment, or cross-provider uniqueness                                          |
| **Eligibility/place presentation**    | Time-bounded membership in a declared population — preferably district membership without address disclosure         | A public address, permanent residence, or authorization to infer a position                                    |
| **Venn confirmation ceremony**        | Fresh authorization of one exact claim-bound consequence                                                             | Understanding, freedom from coercion, representativeness, or a formal vote                                     |

A versioned `CredentialAdmissionPolicy` names accepted issuers, credential types, assurance claims, expiry/status checks, nullifier domains, recovery rules, geographic predicates, and known limitations. Venn evaluates proofs under that policy; it never labels an issuer universally trustworthy.

**World ID posture.** World ID may be implemented as an optional, version-pinned personhood adapter. Its reviewed uniqueness-proof mode may support issuer-local one-human/one-action admission, and its RP/action-scoped anti-replay value may help bound a Venn measurement scope. The adapter declares the exact protocol version, proof type, credential identifier, SDK/preset, verifier endpoint, action derivation, context-binding behavior, and transition policy; it does not import nullifier semantics from another World ID release. This matters during the documented [World ID 3.0→4.0 transition](https://docs.world.org/world-id/4-0-migration), where uniqueness and session proofs have different continuity properties. A conformant Venn adapter does not use a session proof for political-profile continuity, persist `session_id`, or retain another cross-action handle. Where the chosen proof type cannot bind the encrypted contribution commitment directly, the Venn ceremony must bind the verified provider response to that commitment and the adapter must demonstrate replay safety. The adapter treats World ID as personhood rather than residence and never sends readable stance as provider context. World ID is neither required nor normative. Venn does not depend on World App, an Orb, World Chain, or WLD and provides non-biometric and non-World paths wherever the measurement design permits.

**Cross-provider honesty.** A person may hold World ID, a government wallet, a bank credential, and an institutional credential. Unless a reviewed interoperability construction proves the required uniqueness and unlinkability properties across those providers under its declared trust model, Venn cannot know that four presentations are one human. Provider-local distinct-human counts are never summed. Cohorts remain separate or use one declared admission path for the measure. A calibrated statistical estimate may synthesize separate cohorts under a disclosed model, but its combined distinct-human denominator remains unknown or explicitly modeled. The envelope publishes the duplicate and exclusion risk. "One human globally" is never inferred from a list of accepted providers.

**Long-term identity ambition.** Venn requires neither a mandatory globally linkable identifier nor dependence on any single identity provider. Widely adopted identity or personhood credentials may contribute to assurance only through scope-specific, privacy-preserving proofs and provider-neutral alternatives. Venn pursues more reliable one-human/one-count measurement through interoperable providers, scope-bound nullifiers, same-holder proofs, cross-provider overlap research, independent audits, accessible recovery and revocation, published assurance limits, versioned cryptographic suites, and periodic threat review. Popularity alone never makes a credential mandatory.

**Apple/Google and device-biometric posture.** OAuth or federated sign-in establishes account authorization under the provider's policy. Passkeys establish control of an RP-scoped credential. Face ID, Touch ID, Android biometrics, or a device PIN may locally unlock that key; they are not Venn-visible "biokeys." Synced, recoverable, and sometimes shared credential contexts are useful for access and continuity and are another reason passkeys cannot be treated as unique-person proof.

### 6.6 Private aggregation and release privacy (freeze-critical)

Deduplication and measurement must be partitioned:

1. a wallet or authorized originating surface bounds the contribution and produces the scope proof;
2. a deduplication role validates the `CredentialAdmissionPolicy` and rejects reused scope nullifiers without receiving readable signal;
3. the client secret-shares or encrypts the bounded measurement to independently operated aggregators;
4. collectors receive only thresholded aggregate results; and
5. public release applies suppression, rounding, query controls, and differential privacy where the registered output policy requires it.

The production design requires independently governed roles for any profile claiming non-collusion and records their operators and trust assumptions. No single role may observe identity or a cross-context identifier together with claim scope and readable signal. Claim-scoped participation metadata is itself sensitive and receives minimization, batching, short retention, access control, and deletion rules.

Cryptography does not erase endpoint metadata: timing, IP addresses, device fingerprints, small cohorts, credential-status requests, repeated releases, and collusion remain in the threat model. Clients batch and delay uploads where compatible with the measurement; public commitments are batch-level and delayed until thresholds hold; network relays or equivalent metadata-minimizing transport are used where the threat model requires them; credential-status checks are designed so the issuer does not learn which political claim is being answered; and deduplication logs have an explicit minimum retention and deletion schedule.

Differential privacy is a release discipline, not an anonymization sticker. Each applicable envelope declares the protected privacy unit (for example, person-per-claim-period), contribution bounds, mechanism, parameters, composition/accounting window, and exhaustion behavior. Once the release budget is exhausted, the conformant response is suppression or a new independently justified measurement period — never an unaccounted query.

### 6.7 Cross-surface continuity without a cross-platform dossier

When a person wants activity from several services counted as one bounded contribution, their wallet may prove control of those accounts locally and derive the same scope nullifier for the active measurement. The protocol's design objective is to reveal to the deduplication role only that admitted contributions share a scope, not which accounts were linked; no implementation may claim that property until its construction and metadata behavior have passed independent review. Platforms retain their pre-existing raw events, not a new Venn-derived account-keyed inference history; measurement roles receive only the minimum bounded contributions, declared provenance classes, and aggregate evidence required by the registered profile.

If a platform cannot support this flow, its account-level or probabilistic human-origin signal remains a separately labeled assurance cohort. Venn does not create a hidden account-linkage map to improve a headline number.

### 6.8 The wallet is a role, not a mandatory Venn destination

The "wallet" means a holder-controlled credential, policy, ceremony, and private-profile context. It may be supplied by an interoperable external wallet, an OS credential manager, a browser, a personal familiar, a native platform client, or an optional Venn reference wallet. Open presentation protocols are preferred over Venn-specific custody. A person must not be forced to adopt a dedicated Venn app merely to use a conformant surface.

### 6.9 Layered consent and adult-first political measurement

Consent is an architecture, not a terms-of-service paragraph. Venn recognizes distinct permissions for:

1. expression measurement;
2. claim confirmation;
3. eligibility and deduplication;
4. calibration research;
5. delegated action;
6. voting; and
7. secondary uses such as model training.

Consent for one never implies consent for another. Venn may analyze person-linked political expression only under specific, informed, affirmative, and revocable authorization. For enrolled participants, measurement authorization may be standing, but it must be scope-limited, reviewable, renewable, and easy to withdraw. Host or platform permission supplies a mechanism; it does not replace participant permission or authorize a platform to volunteer its users' political histories.

Public expression may lawfully inform event, claim, question, and frame discovery under a declared source-rights basis. It does not enter a person-counted public-opinion measure without an authorized measurement pathway. The transfer from probabilistic inference to confirmed position always requires a claim-bound human gesture such as Compose-and-Confirm. Refusal or withdrawal cannot silently become a signal.

The first political-signal, identity-assured, calibration, and delegated-action profiles are restricted to adults aged 18 or older. Younger people may read public reference material. A later youth-participation profile requires child-development and education expertise; independent ethics, rights, and privacy review; age-appropriate explanation; jurisdiction-specific capacity rules; protection from parental, institutional, and peer coercion; materially stronger release thresholds; no targeted advertising or content; and no durable political profile. Parental permission alone is not sufficient protection.

---

## 7. The record system

Indicative sketches; `spec/` holds the normative versions. Authentication is record-type-specific: public statements use canonical COSE/CBOR forms and signatures; designated-verifier receipts and private disposition records must not become ordinarily transferable signed stance evidence. Only layer-3 records enter the transparency log with inclusion proofs.

### 7.1 Confirmation ceremony contract (freeze-critical)

```ts
interface ConfirmationAuthorization {
  schema: "venn.confirmation-authorization/v0.3";
  public_context: {
    operation: "begin-private-confirmation";
    consequence_class: "count" | "post_and_count" | "deliver_and_count";
    private_flow_profile: string;
  };
  private_flow_handle: string; // opaque, randomized, non-enumerable;
  // not a commitment with a transferable opening
  challenge: string; // H(schema, canonical(public_context,
  // private_flow_handle,
  // surface, requested_by, nonce))
  surface: {
    kind: "embed" | "wallet" | "platform-secure-ui";
    origin: string;
    rp_id: string;
    display_class: "origin-bound" | "secure-display";
    independence_evidence: string; // verified evidence, not a self-asserted boolean
  };
  authorization_assertion_ref: string;
  requested_by: { kind: "self" } | { kind: "agent"; delegation_ref: string };
  nonce: string;
  issued_at: number;
}

interface PrivateDisposition {
  schema: "venn.private-disposition/v0.1";
  private_flow_handle: string;
  displayed: {
    artifact_version: string;
    claim_id: string;
    claim_version: string;
    canonical_claim_text_digest: string;
    response_schema: string;
    outcome_code: string;
    consequence: "count_only" | "post_and_count" | "deliver_and_count";
  };
  scope: {
    contribution_class: "confirmed";
    population_ref?: string;
    population_definition_digest?: string;
    period: string;
    credential_admission_policy: string;
    nullifier_domain: string;
  };
  admission_context_digest: string; // exact presentation digests, audience,
  // policy, status epoch, scope, flow handle
  admission_bundle_ref: string; // private same-holder proof bundle
  receipt_free_binding: string; // reviewed DV/receipt-free construction only
  encrypted_measurement_shares: string[];
  // Participant/source plane only. No ordinarily verifiable signature over outcome.
}
```

The trusted surface displays the exact claim, outcome, and consequence, but the ordinary WebAuthn assertion signs **no claim identifier, population, readable stance, small-enum outcome, deterministic digest of them, or commitment that the participant can later open to a third party**. It authorizes entry into an opaque private confirmation session. The exact claim, admission bundle, selected outcome, and encrypted contribution are mutually bound only inside an independently reviewed designated-verifier/receipt-free construction. `private_flow_handle` and `ceremony_ref` are opaque participant-local or role-limited handles; neither may expose a transferable assertion sufficient to enumerate or prove claim participation or outcome.

This separation is load-bearing. A normal passkey signature over `support`, `oppose`, or an enumerable commitment would recreate the political receipt §6.2 forbids. Until an implementation demonstrates same-holder binding, replay safety, outcome integrity, receipt deniability, and metadata resistance under independent cryptographic and coercion review, Venn may prototype the interface but **must not issue live confirmed-position records or claim conformance**. The freeze fixes the property and adversarial tests, not an unreviewed receipt-proof wire format.

The deployable authorization primitive is a WebAuthn user-verification assertion over the generic confirmation-session context and opaque flow handle. That proves credential control and a local authorization event, not unique humanity, claim participation, the selected outcome, comprehension, or freedom from coercion. The private construction must prevent the RP from substituting a claim or outcome after that authorization. The acknowledged display gap remains. Agentic commerce is likely to push platform vendors toward stronger attested human-approval rails for payments ("the agent cannot tap Pay"); the ceremony profile may adopt a reviewed rail that satisfies its evidence requirements without making any vendor normative.

### 7.2 EventArtifact and claim/wording governance

#### 7.2.1 EventArtifact

Evolved from VHC's `TopicSynthesisV2`, keeping its quorum block, divergence metrics, and provider mix (candidate generation may be multi-model; selection is deterministic and versioned), and adding:

- claims as first-class objects with stable IDs, versions, frames/counterframes, and citations;
- verified source-rights evidence (§7.2.2);
- publisher identity (§7.2.4);
- correction and supersession chains.

#### 7.2.2 Source rights as verified evidence

The Assent draft's self-declared license enum was insufficient — government works are not uniformly public domain (Crown copyright and equivalents). Corrected: each source carries `rights: { basis: 'public-domain' | 'gov-open' | 'licensed' | 'link-only'; verified_by; jurisdiction_notes }`, where `verified_by` references a logged verification record. Conformance rejects full text whose basis is not affirmatively verified; `link-only` sources contribute headline, link, and metadata only. News media default to `link-only`. The primary corpus is public records — statutes, bills, amendments, dockets, agendas, minutes, budgets, filings — verified per jurisdiction.

#### 7.2.3 Wording governance (freeze-critical: envelope field)

Claim wording is question wording; wording swings measured support by double digits, and in the agent era canonical wording propagates into every summary. Whoever writes claim text holds real power. Three mechanisms convert that power into measurement and process:

1. **Adversarial drafting** — claim text co-drafted or ratified from opposing frames; drafting provenance recorded in the artifact.
2. **Paraphrase sensitivity testing** — calibration panels receive randomized paraphrases; claims whose support swings beyond threshold are flagged `wording_unstable` in every envelope. A governance war becomes a published measurement.
3. **Logged contestation** — any qualified party may challenge wording; challenges and resolutions are transparency-log entries.

#### 7.2.4 Publisher pluralism (anti-Ministry-of-Claims)

The format supports multiple independent artifact publishers over one shared log discipline — the Certificate Transparency model. `spec/registry/publishers.json` lists publishers and their keys; envelopes and artifacts always name their publisher; conformance is defined against the format, not the operator. Venn-the-operator is publisher #1. The success criterion is an artifact publisher and an implementation that are _not ours_ passing conformance.

### 7.3 Expression, interpretation, and credential records (freeze-critical)

```ts
interface ExpressionEnvelope {
  schema: "venn.expression/v0.1";
  authorization_basis:
    | "participant-local"
    | "participant-authorized-api"
    | "publisher-authorized"
    | "platform-native";
  surface: { adapter_profile: string; origin: string; event_type: string };
  local_event_ref: string; // source-local; never exported
  scope_event_commitment?: string; // randomized/non-enumerable; only if profile requires
  context_commitment: string; // scope-specific and non-enumerable
  time_bucket: string; // coarse enough to satisfy the output policy
  source_assurance: string[];
  candidate_claims: Array<{
    claim_id: string;
    claim_version: string;
    probability: number;
  }>;
  custody: {
    raw_content_location: "participant" | "originating-platform";
    retention_policy: string;
  };
  // Deliberately no asserted-position field.
}

interface InferenceContribution {
  schema: "venn.inference-contribution/v0.1";
  local_expression_ref: string; // source-local only; excluded from submitted shares
  scope: {
    claim_id: string;
    claim_version: string;
    population_ref?: string;
    period: string;
    nullifier_domain: string;
  };
  interpretation: {
    model_registry_entry: string;
    stance: {
      support: number;
      oppose: number;
      neutral: number;
      mixed: number;
      uncertain: number;
    };
    salience: number;
    intensity: number;
    ambiguity: number;
    sarcasm_probability: number;
    confidence: number;
    coordination_risk?: number;
  };
  bounds: { contributor_headcount_max: 1; contribution_policy: string };
  dedup_proof_ref: string; // held/validated by the deduplication role
  encrypted_measurement_shares: string[];
  // No public or centrally readable per-person interpretation.
}

interface PresentationBinding {
  audience: string;
  ceremony_nonce: string;
  policy_ref: string;
  measurement_scope_digest: string;
  status_epoch: string;
  issued_at: number;
  expires_at: number;
  holder_binding_proof: string; // same-holder relation for this bundle only;
  // no stable cross-context subject identifier
}

interface AccountControlPresentation {
  schema: "venn.account-control-presentation/v0.1";
  method: "openid-connect" | "platform-account" | "other";
  provider_registry_entry: string;
  account_assurance_claims: string[];
  binding: PresentationBinding;
  proof: string;
}

interface AuthorizationAssertion {
  schema: "venn.authorization-assertion/v0.1";
  method: "webauthn" | "registered-human-authorization";
  rp_id: string;
  credential_ref: string; // RP-scoped; retained only by ceremony verifier
  user_presence: true;
  user_verification: true;
  binding: PresentationBinding;
  assertion: string;
}

interface PersonhoodPresentation {
  schema: "venn.personhood-presentation/v0.1";
  provider_registry_entry: string;
  credential_type: string;
  personhood_assurance_claims: string[];
  policy_ref: string;
  issued_at: number;
  expires_at: number;
  status_ref: string;
  binding: PresentationBinding;
  proof: string;
}

interface EligibilityPresentation {
  schema: "venn.eligibility-presentation/v0.1";
  provider_registry_entry: string;
  credential_type: string;
  policy_ref: string;
  predicate: string; // member_of(population D, period T, policy P)
  population_definition_digest: string;
  denominator_source?: string;
  denominator_as_of?: number;
  issued_at: number;
  expires_at: number;
  status_ref: string;
  binding: PresentationBinding;
  proof: string;
}

interface ScopedNullifierProof {
  schema: "venn.scoped-nullifier-proof/v0.1";
  policy_ref: string;
  nullifier_domain: string;
  measurement_scope_digest: string;
  contribution_class: "expression" | "inferred" | "confirmed";
  class_nullifier: string;
  private_reconciliation_tag?: string; // deduplication role only
  reconciliation_profile: string;
  deduplication_assurance: string[];
  binding: PresentationBinding;
  proof: string;
}
```

`ExpressionEnvelope` is provenance, not a copy of everyone's speech. `InferenceContribution` is a source-local assembly object: its readable interpretation and `local_expression_ref` do not leave the participant or ephemeral source-processing boundary; only its bounded encrypted or secret-shared measurements enter aggregation. Authorization, account control, personhood, eligibility, and deduplication are independent proofs evaluated under a referenced admission policy; a valid signature does not make the issuer universally trustworthy.

The admission bundle must prove — without introducing a global subject identifier — that every presentation belongs to the same holder and this exact audience, ceremony nonce, policy, measurement scope, and status epoch. `admission_context_digest` covers the canonical digest of every presentation and binding. Copying one person's personhood proof, another person's residence proof, and a third credential's authorization must fail. OIDC and platform-account proofs establish account control only; they cannot satisfy CER-1 unless a separately registered profile supplies fresh challenge-bound human authorization with the required presence and verification evidence.

### 7.4 ConfirmedPositionReceipt (freeze-critical)

```ts
interface ConfirmedPositionReceipt {
  schema: "venn.confirmed-position-receipt/v0.2";
  designated_verifier: string; // participant-controlled verifier
  body: {
    claim_id: string;
    claim_version: string;
    response_schema: string;
    outcome_code: string; // includes schema-defined not_applicable, etc.
    artifact_version: string;
    ceremony_ref: string; // opaque local handle; no transferable assertion
    scope: {
      population_ref?: string;
      period: string;
      nullifier_domain: string;
    };
    delegated_action_budget?: {
      delegation_ref: string;
      period: string;
      index: number;
      limit: number;
    };
    authorship:
      | "principal-authorized"
      | { kind: "agent-assisted"; delegation_ref: string };
    supersedes?: string;
    status: "current" | "withdrawn" | "superseded";
    issued_at: number;
  };
  receipt_free_evidence: string; // construction selected by reviewed profile
}
// Storage: participant vault only. Never published. Never demandable. (§6.2)
```

The sketch states the required deniability property; it does not freeze or validate a cryptographic wire format. No implementation may issue this record or be called conformant until the designated-verifier construction, ceremony linkage, coercion behavior, and metadata behavior pass independent review. Baseline response schemas include `support`, `oppose`, `neutral`, `mixed`, `uncertain`, `abstain`, `not_considered`, and `not_applicable`; custom schemas may add outcomes. Every outcome is reported separately, and the response schema declares which codes enter a stance denominator. `abstain`, `not_considered`, and `not_applicable` are excluded from that denominator by default, never silently dropped from the envelope.

### 7.5 CivicMeasureEnvelope — the crown jewel

The object any agent or institution must cite when making a population-opinion claim. The civic equivalent of a nutrition label: concise enough for machines and complete enough for auditors. Its schema requires a non-empty list of typed dimensions, every applicable dimension or a logged reason for omission, class-aware contributor counts, and explicit denominator treatment; a single opaque "sentiment score" is non-conformant.

```ts
interface OutcomeDistribution {
  response_schema: string;
  values: Record<string, number>;
  denominator_policy: {
    included_outcomes: string[];
    excluded_outcomes: string[];
  };
  uncertainty:
    | {
        kind: "per-outcome-intervals";
        intervals: Record<string, [number, number]>;
      }
    | { kind: "joint"; representation_ref: string };
}

type MeasureDimension =
  | { kind: "frequency"; value: number; unit: string }
  | {
      kind: "salience";
      estimate: number;
      uncertainty: [number, number];
      saturation_method: string;
    }
  | {
      kind: "intensity";
      estimate: number;
      uncertainty: [number, number];
      bound: [number, number];
    }
  | {
      kind: "inferred_position";
      distribution: OutcomeDistribution;
      interpretation_models: string[];
    }
  | { kind: "confirmed_position"; distribution: OutcomeDistribution }
  | {
      kind: "calibrated_estimate";
      distribution: OutcomeDistribution;
      run_ref: string;
    };

interface CivicMeasureEnvelope {
  schema: "venn.measure/v0.3";
  claim: {
    id: string;
    version: string;
    wording_stability: "stable" | "unstable" | "untested";
  };
  artifact: { version: string; publisher: string };
  population: {
    geo_scheme: string;
    geo: string;
    population_definition_digest: string;
    eligibility_predicate_ref: string;
    eligibility_credential_policy: string;
    denominator?: {
      value: number;
      source: string;
      as_of: number;
      method_version: string;
    };
  };
  period: { start: number; end: number };
  evidence: {
    expression_events: number;
    classes: Array<"expression" | "salience" | "inferred" | "confirmed">;
    contributors_by_class: Array<{
      class: "expression" | "salience" | "inferred" | "confirmed";
      count: number | "suppressed";
    }>;
    measurement_root_distinct_contributors?: number;
    cross_class_overlap:
      | "privately-reconciled"
      | "separate-unknown"
      | "modeled";
    acquisition_surfaces: string[];
  };
  dimensions: [MeasureDimension, ...MeasureDimension[]];
  omitted_dimensions: Array<{ kind: string; reason: string }>;
  identity: {
    credential_admission_policy: string;
    provider_and_assurance_mix: Array<{
      provider_or_cohort: string;
      assurance: string[];
      admitted: number | "suppressed";
    }>;
    nullifier_domain: string;
    cross_class_reconciliation_profile: string;
    cross_provider_dedup:
      | "proven"
      | "separate-cohorts"
      | "modeled"
      | "unresolved";
    limitations: string[];
  };
  contribution_bounds: {
    contributor_headcount_max: 1;
    repetition_policy: string;
    delegated_action_budget_policy?: string;
  };
  admission: {
    admitted_contributions: number;
    admitted_distinct_contributors_within_scope?: number;
    rejected_policy: number | "suppressed";
    rejected_duplicate: number | "suppressed";
    rejected_budget: number | "suppressed";
    rejected_stale_version: number | "suppressed";
  };
  coverage: {
    coverage_rate?: number;
    known_skews: string[];
    nonresponse_notes: string[];
  };
  interpretation?: {
    registry_entries: string[];
    validation_summary: string;
    known_language_or_frame_biases: string[];
  };
  calibration?: {
    run_ref: string;
    method_version: string;
    adjustment_summary: string;
  };
  privacy: {
    aggregation_profile: string;
    operator_set: string[];
    output_threshold: string;
    contribution_policy: string;
    differential_privacy?: {
      privacy_unit: string;
      mechanism: string;
      parameters: string;
      accounting_period: string;
      release_budget_status: string;
    };
  };
  corrections: { status: "current" | "superseded"; superseded_by?: string };
  log: { service: string; entry_id: string; inclusion_proof: string };
}
```

### 7.6 CalibrationRun, DelegationCertificate, ActionReceipt

- **CalibrationRun**: panel recruitment via sortition tooling (selection algorithms invoked out-of-process for license hygiene; binary hash recorded), published replayable selection transcript (public randomness beacon; pool commitment logged _before_ the draw), paraphrase randomization plan, weighting method, surface/evidence-class-specific comparison, model-error evaluation, and the resulting adjustment model. Honest claim boundary: the transcript proves **selection integrity** — a published algorithm correctly executed on a committed pool. Pool completeness, nonresponse, and representativeness are separate, disclosed problems; large first-stage invitation samples and stratification are mitigations, not proofs. Operator-integrity probes (canaries) run against dedicated audit pools and staging lanes only — never real participant pools.
- **DelegationCertificate**: ported from VHC's familiar model — capabilities (`draft`, `summarise`, `triage`, `submit-with-approval`), budget share _of the principal_ (never an independent budget), expiry, attenuation, revocation endpoint, and `disclosure: 'always'`. A person's private profile may guide their familiar's local recommendations; it is never standing permission to upload inference, fabricate a new assertion, or cast a vote. A materially changed claim requires a fresh ceremony (rule ADM-6).
- **ActionReceipt**: user-initiated delivery to a representative — channel, recipient, timestamp; receipt written locally on success, failure, _and_ cancellation; public side is a thresholded counter only. High-impact delivery requires a fresh ceremony (rule CER-3).

### 7.7 Transparency log profile

A SCITT (RFC 9943) profile. **Registered:** artifact versions and corrections; claim/wording history and contests; committed process rules; pool commitments and selection transcripts; aggregate commitments and envelopes; credential-admission policies; interpretation-model and calibration-method versions; aggregation-operator keys and trust assumptions; privacy-accounting commitments; threshold-registry changes; publisher registry changes; platform-adapter conformance versions. **Never registered:** per-person expression, inference, stance, receipts, nullifiers, pseudonym mappings, per-submission commitments, or any object enabling participation inference. Honest claim boundary: the log makes tampering _detectable_, not impossible — it prevents silent rewriting, not omission. Completeness is addressed by independent mirrors, third-party witnesses, offline verification from downloaded packets, and a logged appeals path for parties who believe their submission was dropped.

---

## 8. Surfaces

### 8.1 Human surfaces, in initial adoption order

1. **Publisher / community / municipal embeds** — the first and primary channel. No install, no ToS conflict; the host _wants_ the context widget; the claim-reaction control sits beside the article at the moment of reading. This is where ceremonies happen first.
2. **Bluesky-native feed + labeler** — the open-protocol laboratory: sanctioned third-party surface, public firehose, full loop demonstrable with zero platform risk.
3. **Share-to-agent** — share-sheet / DM-a-link / tag-the-bot; mobile coverage of closed apps without touching their surfaces.
4. **Lens browser extension** — a power-user amplifier that must degrade gracefully when platforms object. Never the substrate; extensions that overlay walled gardens get takedowns, and the install base self-selects toward the most politically engaged sliver.
5. **Authorized platform APIs** — enrichment for consenting users (activity import, reversal detection, cross-device continuity). Useful depth, not a foundation; access can be withdrawn.
6. **Native platform/comment-system kit** — the long-term scale carrier: an open adapter and interaction contract that a social, video, news, community, or municipal platform can implement inside its own composer. Native adoption is the strategic destination even though it is not required for the first proof.

The logical wallet role (§6.8) underlies all of them. A dedicated Venn application is optional.

### 8.2 Compose-and-Confirm — one gesture, two explicit acts

VHC's Slide-to-Post interaction proved the core gesture: a person can compose and, on slider release, both express a position and publish without visiting another destination. Venn ports the interaction idea after hostile review, not the old broad forum-stance ontology.

A conformant Compose-and-Confirm control:

1. displays the exact claim, version, response options, and relevant frame/counterframe;
2. lets a participant-local or ephemeral no-retention source component suggest a response while making uncertainty visible and never silently preselecting confirmation;
3. offers **Post and count this** and a comparably accessible **Post without counting this**;
4. treats publishing the platform expression and confirming the Venn position as two logically separate operations, even when one deliberate gesture authorizes both;
5. creates a platform expression under the host's rules and, only when chosen, a fresh Venn ceremony plus private contribution;
6. includes `uncertain`, `mixed`, `abstain`, `not_considered`, and any response-specific `not_applicable` outcome where appropriate; and
7. gives the platform no access to the person's broader private Venn profile.

The host adapter's minimal contract is: resolve content to claims; render a claim/frame chip; map native activity to typed expression; run or invoke participant-local or ephemeral no-retention interpretation; request optional confirmation; obtain the applicable credential proofs; submit a bounded private contribution; and retrieve an envelope. Raw activity and moderation control remain with the host; durable Venn-derived account-keyed inference does not.

### 8.3 Agent surfaces

The canonical protocol is transport-neutral signed HTTP/JSON. Adapters, in order:

- **MCP server** (early): read-oriented tools — `resolve_content`, `get_event`, `get_claim`, `get_frames`, `get_civic_measure`, `get_methodology`, `verify_evidence` — plus `request_human_confirmation`, which routes to a trusted surface via out-of-band elicitation. Participant-local or ephemeral no-retention adapters may expose `interpret_expression_locally`, and a conformant platform may submit an already bounded, encrypted contribution. **There is no general `record_stance` tool.** Anything scriptable will be scripted; a confirmed-position write exists only through the reviewed private ceremony.
- **Verifier CLI** (early): the boring trusted instrument — `venn resolve <url>`, `venn event inspect`, `venn claim inspect`, `venn measure get --claim <id> --geo <district>`, `venn packet verify <file>`, `venn methodology verify <snapshot>`. Fully offline-capable; exits non-zero on any failure; never mints receipts.
- **A2A agent card** (later, if warranted): discovery/communication for institutional agents — `resolve-policy-claim`, `retrieve-balanced-reference`, `retrieve-calibrated-civic-measure`, `verify-civic-evidence-card`.

### 8.4 The institutional verifier (consuming side; first wave)

A dedicated product for the office drowning in synthetic advocacy: triage inbound opinion claims into _enveloped-and-verifiable_ versus _everything else_, with drill-down into each envelope's evidence classes, identity basis, privacy posture, and methodology. This is the initial commercial wedge, not the limit of the thesis. If offices visibly discount unenveloped claims, advocacy tools, platforms, and familiars gain a reason to produce them; an unusually motivated platform may also lead adoption sooner.

### 8.5 Closing the representative loop

The original VHC loop ended at the representative with a receipt; that end survives. Envelopes and outcome packets are deliverable _into_ the constituent-management systems offices already run, and participants receive an aggregate-level echo — "your district's measure on claim C was delivered/cited." Participation without visible consequence decays; the echo is the retention mechanic, and it stays aggregate-safe.

---

## 9. The familiar's role (normative summary)

The familiar is a civic firewall and interpreter, not a substitute citizen.

**May:** notice relevance; resolve content to Venn events and claims; fetch shared evidence and frames; classify the person's expressions locally; estimate ambiguity, sarcasm, salience, intensity, and candidate position as distributions; maintain a private user-controlled civic profile; bind accounts locally when the person chooses; flag conflicts with prior confirmed positions; request confirmation; draft messages; execute low-risk tasks under bounded delegation; explain uncertainty, withdrawal, and reversal options; alert the person when a previously supported claim materially changes.

**May not (and non-conformant output does not count):** present inference as personal fact; export a joinable inferred political dossier; centralize the person's account links; convert browsing into a confirmed position; treat silence as assent; carry a stance onto a materially changed claim; let sub-agents multiply influence; present agent action as fresh human opinion; commit formal votes without a distinct, legally appropriate human ceremony.

---

## 10. Adoption physics and business

### 10.1 Sequencing follows the first testable buyer hypothesis

The initial hypothesis is that institutions consuming opinion claims — representative offices, agencies, newsrooms, and municipalities — will increasingly discount raw engagement as synthetic advocacy grows. The first commercial test is therefore the **envelope verifier for the consuming side** (§8.4), usable with confirmed and calibrated evidence before any familiar or platform-native ecosystem matures. V0 discovery must validate this buyer and workflow; the charter does not treat demand as proven.

### 10.2 Customers, in order of arrival

1. Representative offices and agencies (triage/verification).
2. Newsrooms and public broadcasters (context embeds; calibrated measures with methodology).
3. Municipalities and consultation platforms (instrumented consultations; calibration runs).
4. Survey/calibration providers (co-delivery of calibration runs).
5. Platform and comment-system operators (bot-resistant human reach, claim context, private aggregation, conformance support).
6. Researchers (participation-gap findings; methodology artifacts).
7. Familiars and legislative/policy agents (envelope-cited context) — potentially the largest class, arriving later.

### 10.3 Launch locally, standardize globally

Canada is the first national legal context and Ontario the initial operating base. The first person-linked political pilot is narrower: one identified adult Ontario civic population and a deliberately limited claim set. This supplies density, publisher cooperation, calibration, and a tractable methodology audit without making the protocol Canadian. Every measurement declares its jurisdiction and eligibility policy; registries rather than hard-coded assumptions carry jurisdictional differences. No person-linked political signal is collected before Canadian privacy counsel reviews the data flows and a DPIA-equivalent assessment passes.

### 10.4 Why a platform would adopt an open protocol

Venn should be more valuable to a platform than a proprietary sentiment API:

- **bot-resistant distinct-human reach** when the declared policy includes personhood and scoped deduplication assurance — otherwise honestly labeled contributor or account reach — instead of raw post counts;
- **separate attention, intensity, inference, and confirmation**, rather than an engagement score that confuses them;
- **claim-level context, frames, and corrections** beside the existing discussion;
- **institution-grade envelopes** that downstream offices, newsrooms, researchers, and agents can verify;
- **local custody** of raw activity, user relationships, moderation policy, and interface control; and
- **an open SDK and conformance suite**, so adopting Venn does not make the platform dependent on Venn-the-company.

The platform may run its own adapter and one aggregation role. It does not receive the participant's wider private profile and does not have to surrender its own identity graph. Conformance forbids using Venn-specific sensitive outputs for individual targeting or moderation discrimination; law, contracts, audits, and public detection remain necessary because an open protocol cannot control a malicious fork.

### 10.5 Venn Reader — first reference product, never protocol sovereign

The recovered VHC news experience remains strategically valuable as a separate first-party implementation. Venn Reader may combine:

- balanced, versioned event artifacts;
- evidentiary spines, contested facts, frame comparisons, and corrections;
- claim-level discussion and Compose-and-Confirm;
- participant-controlled familiar and position-management surfaces;
- calibrated public-opinion displays; and
- publisher embeds that demonstrate the same public protocol other clients can adopt.

Venn Reader is operated commercially by Carbon Caste under the same schemas, APIs, provenance rules, privacy rules, and conformance tests available to competitors. It receives no private protocol capability, privileged weighting, exclusive artifact status, or governance authority. The protocol, reference tooling, reader, calibration packages, and conformance packages may live in separate repositories as they mature. VHC remains preserved until a hostile salvage audit identifies what may be ported; it then becomes read-only historical source material.

### 10.6 What is public, what is sold, and what is never sold

Any political or civic measure published under the Venn name has a freely accessible public baseline: result, claim and version, population, evidence-class composition, coverage, uncertainty, methodology, correction history, and machine-readable envelope. No paying institution receives exclusive access to the underlying civic result or a materially earlier opportunity to act on secretly measured public opinion.

Sold: hosting, real-time APIs released no earlier than the public baseline, advanced exploration, custom dashboards, integration, artifact production, calibration, auditing, support, availability guarantees, hosted private aggregation, credential/verifier adapters, platform SDK support, and conformance certification.

Commercial and cultural research may produce private outputs only under a separately named profile that tells participants the output is private and identifies its recipients. It may not be represented as an open Venn public-opinion measure or evade the prohibitions on profiling, targeting, discrimination, and secondary use.

**Never sold:** individual political profiles, readable per-person inference, raw cross-platform histories, targeting segments, preferential protocol influence, or exclusive civic truth. Those businesses are constitutionally prohibited and excluded by conformant custody and role boundaries; independent conformance, audits, and governance — not an impossibility claim — make the promise durable.

The moat is trusted conformance, calibration quality, transparent methodology, operational reliability, and a network of independent adopters — not ownership of humanity's opinion data.

---

## 11. Honest-claims register

Carried from the claims-lint culture; these phrasings are enforced by gate 9. Venn never claims:

| Forbidden claim                                         | What may be said instead                                                                                                                                                                                                               |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Proof the person considered/understood X"              | Evidence that a registered human-authorization surface presented the version-hashed material and accepted a private disposition under the reviewed construction; no claim of comprehension and no publicly provable per-person outcome |
| "Provably representative panel"                         | Provable selection integrity from a committed pool; representativeness separately disclosed with method and limitations                                                                                                                |
| "The operator cannot cheat"                             | Tampering is detectable; omission is constrained by mirrors, witnesses, and appeals                                                                                                                                                    |
| "The district/humanity believes X"                      | Participant observation or calibrated population estimate with population, credential policy, coverage, method, uncertainty, and known skews                                                                                           |
| "We know what this person believes" (from model output) | "Model M estimated this distribution" or "the person confirmed this exact claim-bound outcome"                                                                                                                                         |
| "One unique human" (unqualified)                        | "One contribution unique within credential policy P and nullifier domain D"                                                                                                                                                            |
| "The passkey/biometric proves a unique person"          | The RP-scoped credential holder authorized this action with the declared local verification flags                                                                                                                                      |
| "Mixed providers equal distinct humans"                 | Provider cohorts and unresolved overlap are separate; any combined statistical model discloses that distinct-human denominator is unknown or modeled                                                                                   |
| "Encrypted means anonymous/untrackable"                 | Custody, identifier scope, linkability, role separation, retention, and metadata risks are declared                                                                                                                                    |
| "Privacy-preserving" (unqualified)                      | Mechanism, contribution bound, threshold, operator trust model, metadata controls, and privacy accounting are named                                                                                                                    |
| "Votes" (for any Venn signal)                           | Positions, assertions, measures; formal votes only in distinct, legally authorized ceremonies                                                                                                                                          |
| "This sentiment becomes a vote"                         | The credential infrastructure may support a separate fresh ballot ceremony; the sentiment itself never converts                                                                                                                        |
| "Anonymous" (unqualified)                               | Scoped-pseudonymous with declared linkability profile; aggregate-only publication above declared thresholds                                                                                                                            |
| "No agent can fake it"                                  | Agent-only submissions cannot satisfy the declared authenticator/credential policy; residual device, display, coercion, issuer, and collusion risks remain                                                                             |
| "Open source means neutral"                             | Stewardship, control rights, funding, conflicts, provider independence, and forkability are disclosed                                                                                                                                  |
| "Venn represents humanity" (as a present result)        | Venn's north star is an open representation protocol; each actual measure represents only its declared population and method                                                                                                           |
| "Trustless" / "nobody has to be trusted"                | No single actor is trusted with the whole system; each trust assumption is explicit, bounded, auditable, and replaceable                                                                                                               |
| "Government documents are public domain"                | Rights verified per source, per jurisdiction                                                                                                                                                                                           |

---

## 12. Repository design

### 12.1 Identity

Repo: **`venn`** (working name; final naming is an open decision, §16). Protocol: the Venn Protocol. CLI: `venn`. Conformance mark: _Venn-Conformant_, defined by the conformance suite, not by using our code.

### 12.2 Layout (spec-first)

```
venn/
├── CHARTER.md                      # §1–§3 of this document
├── CONSTITUTION.md                 # §5–§6
├── README.md                       # what it is + the 60-second verify demo
├── GOVERNANCE.md                   # steward/operator separation, RFCs, appeals, conflicts
├── SECURITY.md                     # threat model summary, disclosure, coercion-resistance notes
├── CONTRIBUTING.md                 # discipline rules (§12.5)
├── LICENSE-CODE                    # Apache-2.0
├── LICENSE-SPEC                    # CC BY 4.0
├── LICENSE-REGISTRY                # CC0
│
├── spec/
│   ├── 00-overview.md
│   ├── 01-event-artifact.md
│   ├── 02-claim-and-wording.md     # adversarial drafting, sensitivity, contestation
│   ├── 03-signal-ontology.md       # expression/salience/inference/confirmation/calibration
│   ├── 04-expression-envelope.md
│   ├── 05-inference-contribution.md
│   ├── 06-credential-admission.md  # provider-neutral assurance vector + policy
│   ├── 07-nullifier-and-dedup.md
│   ├── 08-confirmation-ceremony.md # generic authorization + private claim/outcome binding
│   ├── 09-confirmed-position-receipt.md # designated-verifier requirement
│   ├── 10-private-aggregation.md   # role separation, contribution bounds, metadata controls
│   ├── 11-privacy-accounting.md    # thresholds, DP composition, query/release budgets
│   ├── 12-aggregate-snapshot.md
│   ├── 13-calibration-run.md       # selection transcripts; paraphrase/model testing
│   ├── 14-civic-measure-envelope.md
│   ├── 15-delegation-certificate.md
│   ├── 16-action-and-delivery.md
│   ├── 17-linkability-domains.md
│   ├── 18-output-thresholds.md
│   ├── 19-transparency-log-profile.md   # SCITT profile; registered vs never-registered
│   ├── 20-platform-adapters.md     # Compose-and-Confirm + native comment systems
│   ├── 21-formal-ballot-boundary.md
│   ├── 22-threat-model.md          # coercion, profiling, issuer/platform/governance capture
│   ├── 23-conformance.md
│   ├── rfcs/
│   └── registry/
│       ├── linkability-domains.json
│       ├── evidence-classes.json
│       ├── assurance-dimensions.json
│       ├── assurance-profiles.json
│       ├── credential-providers.json
│       ├── credential-admission-policies.json
│       ├── interpretation-models.json
│       ├── aggregation-operators.json
│       ├── privacy-mechanisms.json
│       ├── output-thresholds.json
│       ├── source-rights.json
│       ├── publishers.json
│       └── platform-adapters.json
│
├── packages/
│   ├── schema/        # canonical COSE/CBOR + JSON mirrors + generated types
│   ├── artifacts/     # reference-layer production (ingest → candidates → deterministic select)
│   ├── wording/       # drafting provenance, paraphrase harness, contestation records
│   ├── expressions/   # origin adapters + minimal provenance envelopes
│   ├── interpretation/# participant-local/ephemeral inference + model provenance
│   ├── credentials/   # provider adapters + admission policy evaluation
│   ├── nullifiers/    # scope proofs, dedup domains, rotation/recovery rules
│   ├── ceremony/      # generic WebAuthn authorization + private disposition
│   ├── receipts/      # designated-verifier receipts + participant vault
│   ├── pseudonyms/    # scoped derivation + registry enforcement        ← PORT
│   ├── private-aggregate/ # non-colluding roles + bounded contributions
│   ├── privacy-accounting/# suppression, DP composition, release budgets
│   ├── aggregate/     # multidimensional measures + envelope assembly   ← PORT (rework)
│   ├── calibration/   # panel tooling, transcripts, sensitivity runs
│   ├── delegation/    # certificates, budgets, revocation               ← PORT
│   ├── platform-sdk/  # generic host adapter + Compose-and-Confirm
│   ├── envelope/      # CivicMeasureEnvelope build + verify
│   ├── log-client/    # SCITT-profile register/fetch/verify + mirrors
│   └── verify/        # offline verifier library + `venn` CLI
│
├── services/
│   ├── resolver/      # URL/content → event/claim resolution
│   ├── api/           # canonical signed HTTP/JSON (read-first)
│   ├── mcp/           # MCP adapter (no record_stance)
│   ├── dedup/         # policy/nullifier validation; no readable signal
│   ├── aggregator-a/  # encrypted share processor
│   ├── aggregator-b/  # independently operated share processor
│   └── log/           # transparency service + mirror protocol
│
├── apps/
│   ├── embed/         # publisher/community widget — first surface
│   ├── wallet/        # optional reference wallet; never mandatory
│   ├── verifier/      # institutional consuming-side triage — first wave
│   ├── auditor/       # public packet-check page
│   └── lens/          # extension (later; degrades gracefully)
│
├── conformance/
│   ├── fixtures/      # incl. adversarial corpora                        ← PORT (re-pointed)
│   ├── suites/
│   └── gates/
│
├── ops/               # deploy, mirrors, audit-lane canary runbook
└── docs/
    ├── salvage-map.md # provenance per ported module (§13)
    ├── adopters.md
    └── decisions/     # dated decision log, including rejected options
```

Tree rules: `spec/` precedes `packages/`; no package implements behavior the spec does not describe; `conformance/` arbitrates when they disagree.

### 12.3 The gates

CI-blocking, and published so adopters can run them against their own deployments:

1. **`check:placement`** — three-layer placement holds; no per-person expression, inference, stance, nullifier, or participation-inferable object in any public path. _(Port: public-namespace-leaks; extended.)_
2. **`check:semantic-separation`** — evidence classes and assurance dimensions remain distinct; red fixtures attempting inference-to-assertion promotion fail. _(New; freeze-critical.)_
3. **`check:linkability-domains` + `check:no-global-identifier`** — code matches the registry; cross-claim/cross-provider master handles and joinable account maps fail. _(Port + new.)_
4. **`check:contribution-bounds`** — headcount ≤ 1 inside the verified measurement-root scope; cross-class reconciliation status is explicit; repetition, intensity, salience, delegated-action, and privacy bounds are enforced independently. _(New.)_
5. **`check:credential-policy`** — every measure pins a valid provider-neutral policy and assurance vector; mixed-provider headcounts without proven deduplication fail. _(New; freeze-critical.)_
6. **`check:privacy-accounting`** — aggregation roles, metadata controls, suppression/noise, contribution bounds, repeated-release composition, and privacy-budget exhaustion match the policy. _(New; freeze-critical.)_
7. **`check:output-thresholds`** — every aggregate path applies its declared registry threshold; red fixtures must fail. _(Port: district-aggregate gate; generalized per §6.3.)_
8. **`check:source-rights`** — no artifact contains full text without affirmative rights verification; `link-only` carries no body text. _(New.)_
9. **`check:claims`** — README, site copy, spec abstracts, release notes contain no forbidden claim (§11) without a matching proof artifact. _(Port: forbidden-claims lint.)_
10. **`check:unprovability`** — the independently reviewed receipt construction and metadata behavior satisfy the declared deniability threat model; no conformant API is a participation oracle; red fixtures cannot enumerate or prove an outcome from any retained authorization, ceremony, receipt, ciphertext, commitment, opening, or metadata artifact. _(New; freeze-critical.)_
11. **`check:ceremony` + `check:compose-confirm`** — generic session authorization, reviewed private claim/outcome binding with substitution resistance, same-holder admission, origin/surface evidence, freshness, outcome-schema consistency, and a usable "post without counting" path are verified. _(New; freeze-critical.)_
12. **`check:envelope`** — no measure publishes without a reproducible population definition and denominator provenance; a non-empty typed dimension list; response-schema denominator rules and outcome-specific/joint uncertainty; credential policy; cross-class and cross-provider deduplication status; privacy fields; wording stability; and appropriately suppressed admission evidence. _(New.)_
13. **`check:conformance`** — record round-trips, transcript replay, budget monotonicity, saturation bounds, model fixtures, provider drift, offline verification, and adversarial corpora. _(Port + new.)_
14. **`check:coverage` + `check:docs`** — diff-aware full coverage on changed code, file-size cap, docs metadata, and link integrity. _(Port.)_

Deliberately not carried: the launch-control / distribution-packet / operator-packet / runsheet gate family. Its function is replaced by one rule — _a process is releasable when its packet verifies_ — enforced by `check:conformance`.

### 12.4 Governance

Openness is necessary and insufficient. Neutrality is earned through distributed authority, disclosed funding, enforceable process, replaceable operators, and credible exit rights. An absent board would be a governance vacuum, not proof of founderlessness.

Carbon Caste Inc is the disclosed founding custodian and commercial reference operator. During formation it may own and administer repositories, domains, infrastructure, and the Venn mark; fund development; employ contributors; operate Venn Reader; and integrate reviewed changes. It does so under a published transition covenant: no permanent constitutional veto, no sale of exclusive protocol control, separate accounting for protocol governance and operating revenue, disclosed material funding and conflicts, equal technical standing for conforming implementations, independently implementable core specifications, and transfer or irrevocable licensing of the protocol mark and governance rights to an independent steward.

Before general public collection of person-linked political signal or public conformance of an implementation not operated by Carbon Caste, governance must establish:

- an independent nonprofit specification steward, legally and operationally separated from any commercial Venn operator;
- no founder veto, permanent founder seat, token-weighted vote, sponsor privilege, or preferred credential provider;
- fixed governing terms, conflict and funding disclosures, public minutes, recorded votes, numbered RFCs, appeals, and time-limited emergency actions;
- meaningful civil-rights, privacy, accessibility, survey-science, jurisdictional, geographic, publisher, platform, institutional, and technical representation;
- independent security, cryptographic, privacy, methodology, and accessibility review;
- independently controlled trademark and conformance-mark policy;
- royalty-free specifications, registries, conformance suites, and test vectors, with practical fork rights; and
- success measures based on multiple publishers, credential providers, aggregation operators, and implementations — not adoption of our hosted service.

Venn governs itself progressively. Formation-stage measures of founder, reviewer, partner, and prospective-user views are advisory, and Carbon Caste publishes its decisions and reasoning. At the participatory stage, verified users and contributors may receive binding authority over ordinary questions when the rule is announced in advance. Constitutional processes later use Venn's own reference, signal, deliberation, and calibration machinery together with protected amendment safeguards. Every process states whom it represents; early participants are never described as humanity.

Early participant governance should help determine interface priorities, roadmap sequencing, registry policy, stewardship design, and operating questions. It may not use a simple majority to weaken the founding privacy, identity, human-authority, independent-implementation, ballot-separation, or fundamental-rights covenants.

Spec changes move through numbered RFCs with motivation, security/privacy, inclusion, and conformance-impact statements. Registries version independently and additively where compatibility permits. The reference implementation may never gain a capability the spec does not describe; if code needs it, the spec changes first. A dated decision log records choices and rejected options.

The legal form and transition sequence require counsel and founding-partner design. The constitutional outcome does not: **no individual, company, funder, platform, credential provider, or jurisdiction may control the protocol for representing everyone else.**

### 12.5 Discipline (ported from VHC, kept because it worked)

Diff-aware 100% line+branch coverage on changed code; 350-LOC source-file cap (tests/types/generated exempt); docs metadata governance; hostile review required for every ported module — **the old repo is a quarry, not a foundation**, and no port lands on trust.

---

## 13. Salvage map (VHC → venn)

Every port passes hostile review before landing; known deficiencies found in the audit (max-count cohort sizing in the aggregate path, unverified delegation signatures end-to-end, plaintext-cached document keys, user-attested-only delivery receipts) are fix-before-port items, not carry-overs.

| VHC asset                                                                                         | Disposition                                                                                                                                                                                                       | Destination                                                                |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Linkability domain registry + gate                                                                | Port; generalize to claim/population/period/provider-policy domains; prohibit a master handle                                                                                                                     | `packages/pseudonyms`, `spec/17`, gate 3                                   |
| Topology guard + district aggregate adapters + threshold gate                                     | Port; rework to registry-driven per-output thresholds and multidimensional envelopes; fix max-count cell sizing                                                                                                   | `packages/aggregate`, `spec/12`, `spec/14`, `spec/18`, gates 4, 7, 12      |
| `SentimentSignal` semantics (tri-state, bounded decay `next = current + 0.3 × (bound − current)`) | Port only the bounded/saturating-update lesson. Split the old object into expression, inference, and confirmation; decay may inform bounded salience or intensity, never human headcount or a confirmed position  | `spec/03–05`, `spec/08`, `packages/expressions`, `packages/interpretation` |
| `TopicSynthesisV2` (quorum, divergence, provider mix, deterministic selection)                    | Port; extend with claims-as-objects, rights evidence, publisher id                                                                                                                                                | `spec/01`, `packages/artifacts`                                            |
| Signed-write envelopes + writer/author headers                                                    | Re-express as COSE/SCITT statements                                                                                                                                                                               | `packages/schema`, `packages/log-client`                                   |
| Forbidden-claims lint + docs governance + production-profile gate                                 | Port; merge                                                                                                                                                                                                       | Gates 9 and 14                                                             |
| Diff-coverage, LOC cap, ownership preflight                                                       | Port as-is                                                                                                                                                                                                        | Gate 14                                                                    |
| StoryCluster adversarial corpus + replay harness                                                  | Port; re-point at bill/amendment lineage, agenda revisions, claim-version continuity                                                                                                                              | `conformance/fixtures`                                                     |
| Source admission/health/scout pipeline                                                            | Port; re-point at public-record sources with rights verification                                                                                                                                                  | `packages/artifacts`                                                       |
| Identity vault (compartments, salvage paths)                                                      | Port; becomes the participant-controlled wallet/profile holding receipts, local account bindings, and recovery material; fix plaintext key caching and shared-device leakage                                      | `packages/receipts`, `apps/wallet`                                         |
| Delegation runtime + 8 budget keys                                                                | Port; add end-to-end signature verification and make every delegated action debit the principal                                                                                                                   | `packages/delegation`, `spec/15`                                           |
| Civic Action Kit receipts (success/failure/cancel semantics; aggregate counters)                  | Port; keep delivery evidence separate from opinion evidence                                                                                                                                                       | `spec/16`                                                                  |
| Yjs + E2EE collaborative docs                                                                     | Port later (panel drafting); fix key custody first                                                                                                                                                                | `apps/wallet` / panel tooling                                              |
| Five-user live engagement harness                                                                 | Port; rename multi-participant acceptance                                                                                                                                                                         | `conformance/suites`                                                       |
| Evidence-packet-as-JSON pattern                                                                   | Re-scope: the packet is the public audit artifact                                                                                                                                                                 | `packages/verify`, `apps/auditor`                                          |
| 240-char reply cap → escalate-to-document                                                         | Port as a deliberation rule                                                                                                                                                                                       | panel tooling                                                              |
| Guest/Human/Constituent ladder                                                                    | Replace the scalar ladder with an orthogonal assurance vector: origin integrity, authorization, personhood, eligibility/place, deduplication scope, and aggregation/privacy profile                               | `spec/06`, assurance registries                                            |
| MACI receipt-freeness insight (GWC whitepaper)                                                    | Realize only through an independently reviewed designated-verifier construction; retain no ordinary transferable signature                                                                                        | `spec/09`, gate 10                                                         |
| Human/agent lane firewall (GWC)                                                                   | Keep the authority boundary; drop the economy                                                                                                                                                                     | `spec/15`, `spec/23`                                                       |
| Canary identities (LUMA whitepaper §4.2)                                                          | Build — **audit pools and staging lanes only**, never real participant pools                                                                                                                                      | `ops/`, `spec/13`, `spec/22`                                               |
| Slide-to-Post / `CommentComposer` gesture                                                         | Port the one-gesture composition pattern after usability and coercion review; replace the broad forum stance and mandatory alignment behavior with Compose-and-Confirm plus an equal "post without counting" path | `packages/platform-sdk`, `spec/20`                                         |
| GUN transport; relay/heap ops; mesh gates                                                         | Leave behind                                                                                                                                                                                                      | —                                                                          |
| RVU/UBE/Faucet/MedianOracle; token narrative                                                      | Leave behind (QF may return someday as an in-panel allocation method)                                                                                                                                             | —                                                                          |
| LUMA hardware roadmap (BioKey, VIO, acoustic anchors)                                             | Leave behind. Use platform passkeys only for authorization and consume external personhood/eligibility credentials under versioned policies                                                                       | `spec/06`, `spec/08`                                                       |
| Full-text extraction of copyrighted journalism                                                    | Leave behind; news is `link-only` context                                                                                                                                                                         | —                                                                          |
| Linked-social OAuth ingestion                                                                     | Leave behind as a centralized ingestion model. Rebuild only user-authorized local, publisher-authorized, platform-native, or authorized-API adapters that minimize and bound data                                 | `spec/04`, `spec/20`                                                       |
| Launch-control/distribution/runsheet bureaucracy                                                  | Leave behind                                                                                                                                                                                                      | —                                                                          |

No percentage of VHC is pre-approved for reuse. The table is a search map, not a migration plan; each module earns its place through current provenance, licensing, threat-model, semantic, and conformance review.

---

## 14. Sequencing, with go/no-go criteria

Each phase ends with an output a stranger can check. The first schema freeze must include every property whose absence would make already-issued records unsafe or semantically ambiguous: evidence classes; evidence/assurance separation; claim and wording versioning; three-layer placement; contribution bounds; credential-admission policy; measurement-root and class-subproof domains; cross-class and cross-provider status; non-stance authorization binding; same-holder admission; receipt-free private outcome binding requirements; aggregation-role separation; privacy-accounting fields; envelope disclosure; correction and supersession; and the ballot boundary. It freezes these security properties and adversarial tests, not an unreviewed cryptographic wire format. Feature breadth waits; these foundations do not.

### V0 — Validation before heavy build (weeks 1–4)

- Produce **ten reference artifacts** with full structure (spine, contested facts, claims with frames, citations, rights evidence) and test cross-partisan fairness: readers across the spectrum should say "that account is fair, and my frame is represented."
- Run **10–15 workflow and buyer interviews** across representative offices, newsrooms, municipalities, community/publisher hosts, deliberation practitioners, survey labs, and platform/comment-system teams. Target: two design partners, including one consuming institution.
- Secure **one publisher or community embed** letter of intent.
- Prototype Compose-and-Confirm as a disposable interaction test. Verify that people understand the exact claim, the difference between expression and counting, uncertainty options, and the equally accessible "post without counting" path.
- Establish Canada/Ontario as the first implementation profile and identify one bounded adult Ontario civic population for the first eventual signal pilot.
- Draft the signal/identity/privacy threat model with independent civil-rights, survey-method, security, and privacy reviewers before collecting political-opinion data.
- Inventory every cryptographic dependency and define algorithm identifiers, version negotiation, retirement, and migration requirements before freezing a wire format; do not claim post-quantum safety from design intent.
- _Go criterion:_ artifact fairness holds under partisan review; users understand and can refuse counting; and at least one consuming-side partner plus one embed host are committed. If the artifact test or informed-control test fails, stop and correct the relevant layer.

### V1 — Schema freeze + read surfaces + the consuming-side product (months 2–4)

- Freeze the complete semantic, custody, credential, nullifier, ceremony, aggregation, privacy, envelope, correction, and formal-ballot boundary contracts at v0.1.
- Build the reference artifact pipeline, schema package, resolver, envelope verifier, offline CLI, read-only API, mirrorable transparency log, generic host adapter, comment-system SDK, and first Venn Reader reference surface. Do not collect private inferred or confirmed political signal yet.
- Ship the **context embed** at the partner site and the **institutional verifier** MVP to one office.
- MCP read adapter + CLI.
- _Output:_ a stranger runs `venn packet verify` offline and gets green; a host not controlled by Venn renders the same claim/frame object through the generic adapter; an office triages a sample advocacy inbox into enveloped versus everything else.

### V2 — Signal + calibration (months 5–9)

- Complete Canadian counsel and DPIA-equivalent review plus independent cryptographic/privacy review — including consent separation, withdrawal, same-holder admission, outcome integrity, outcome-enumeration resistance, receipt deniability, and metadata leakage — before any live inferred or confirmed political-signal collection.
- Ship one passkey authorization flow, at least one optional personhood adapter, and one jurisdiction-appropriate eligibility/place adapter. Publish the admission policy, assurance vector, exclusion risks, recovery path, provider-version pinning, and cross-provider deduplication status.
- Run role-separated private aggregation for bounded expression, salience, inferred, and confirmed contributions. The first production lane is 18+, uses one narrow declared Ontario civic population and claim set, independent aggregation operators, thresholding, metadata controls, and privacy-budget accounting.
- Ship Compose-and-Confirm at the embed with withdrawal, correction, the full pinned response schema (including uncertain, mixed, abstain, not-considered, and not-applicable where defined), explicit denominator treatment, and "post without counting." The wallet remains a logical role that can be embedded or supplied by another provider.
- One **calibration run** on the same claim set with paraphrase randomization; publish the participation gap, the methodology, and the uncertainty — not merely the headline number.
- Deliver the first `calibrated` envelope into the partner office's workflow; aggregate echo back to participants.
- _Output:_ the first complete `CivicMeasureEnvelope`, containing typed evidence, declared assurance, provider mix, deduplication status, calibration, wording stability, privacy accounting, and limitations, is consumed by a real institution and independently verified.

### V3 — Native adoption and independent operation (months 10–18)

- Pilot the generic adapter with a second publisher/community and one platform or comment-system operator. Add authorized APIs only where the platform and participant permit them.
- Add a second credential provider as a **separate cohort** until cross-provider deduplication is actually proven; test outage, revocation, recovery, false-duplicate, and version-drift paths.
- Put deduplication and each aggregation role under different operators; add independent log mirrors and witnesses.
- Establish the independent stewardship body and complete the custody, mark, governance-rights, funding, and conflict transition required before general public person-linked political measurement or third-party public conformance.
- Permit agent-assisted ceremonies only through bounded delegation and a fresh human authorization surface; add A2A only if a real consumer requires it.
- _Output:_ an implementation not maintained by Venn passes conformance, an independent publisher produces artifacts, independent operators aggregate a real measure, and an institution accepts the resulting envelope by specification rather than vendor identity.

### V4 — Plural protocol network (months 18–36)

- Support multiple jurisdictions, languages, publishers, personhood and eligibility providers, private-aggregation deployments, survey/calibration partners, and platform-native integrations.
- Add separately named commercial and cultural measurement profiles only after their consent, recipient-disclosure, secondary-use, and non-profiling rules pass independent review; never relabel a private commercial result as open civic opinion.
- Publish multilingual, sarcasm, dialect, disability, and frame-bias benchmarks; require model cards and cohort-specific error reporting for any registered interpretation model.
- Mature the independent steward, appeals process, public funding/conflict record, conformance-mark licensing, progressive Venn-based governance, and a recurring security/privacy/methodology review cycle.
- Standardize transport-neutral evidence cards and envelope verification with agent, platform, publisher, and institutional implementers.
- _Output:_ no single provider or Venn-operated service is operationally necessary for a conformant end-to-end measure.

### V5 — Public infrastructure for the agentic internet (years 3–5)

- Make claim-resolved civic measures a routine input to policy-drafting agents, legislative assistants, public consultation, journalism, and platform context systems, always with population, method, uncertainty, and limitations attached.
- Maintain a plural ecosystem in which people may carry their private civic continuity between conformant wallets without exposing a global identifier or a transferable political dossier.
- Pursue progressively stronger one-human/one-count assurance through interoperable credential providers, scope-bound nullifiers, same-holder proofs, cross-provider overlap research, independent audits, accessible recovery and revocation, and published limits. No popular provider becomes mandatory or globally linkable.
- Research a **separately chartered formal-ballot profile** with election-law authorities, secret-ballot and coercion experts, accessibility communities, independent implementers, and the publics asked to adopt it. Progression is nonbinding internal consultation, binding ordinary Venn community decisions, low-stakes organizational votes, independently administered civic pilots, and only then legally recognized public decisions after external validation. No prior expression or position becomes a vote.
- Maintain cryptographic agility and a post-quantum migration program: versioned suites, hybrid trials where justified, long-lived confidentiality analysis, compromise and retirement procedures, and conformance fixtures that prove interoperable migration rather than merely naming an algorithm.
- _Success criterion:_ independent stewards, implementations, publishers, credential providers, aggregation operators, calibration partners, and consuming institutions can operate the protocol without permission from or dependence on Venn-the-company.

---

## 15. Risks

| Risk                                                                                                                                                                 | Mitigation                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Ceremony spoofing or confused authorization** — an agent, malicious page, or compromised device obtains a signature the person did not understand                  | Use WebAuthn only for a generic confirmation-session authorization; bind exact claim, consequence, admission scope, and outcome inside the reviewed receipt-free private construction with substitution resistance; require an independent human surface and usable refusal path; test hostile rendering, claim/outcome enumeration, and replay; adopt secure-display attestation when available |
| **Coercion / receipt resale** — political participation becomes provable to a buyer, employer, family member, or state                                               | Independently reviewed designated-verifier construction; no participation oracle; batching and metadata tests; no public per-submission commitment; explicit residual-risk disclosure; legal and institutional protections alongside protocol controls                                                                                                                                           |
| **Credential replay or Frankenstein composition** — account, authorization, personhood, place, and nullifier proofs from different people or ceremonies are combined | Audience/nonce/policy/scope/status binding on every presentation; canonical presentation digests in the authorization context; a reviewed bundle-local same-holder proof; short expiry and replay rejection; no global holder identifier                                                                                                                                                         |
| **Wording capture** — claim text as covert framing power                                                                                                             | Adversarial drafting, paraphrase sensitivity testing, logged contestation, `wording_unstable` flags                                                                                                                                                                                                                                                                                              |
| **Interpretation error** — sarcasm, dialect, multilingual speech, reclaimed language, or context produces a false stance estimate                                    | Preserve expression and inference as different classes; distributions and uncertainty, not labels; participant-local or ephemeral no-retention processing; registered model/version; cohort error benchmarks; no inference-to-assertion path; human correction and confirmation                                                                                                                  |
| **Central shadow profiling** — individually readable inferences accumulate into a political dossier                                                                  | Keep readable inference participant-local or in an ephemeral no-retention source component; a platform retains only its pre-existing raw expression under the source-custody exception; export only bounded encrypted/secret-shared contributions; forbid Venn measurement roles from joining stable identifiers to readable signal                                                              |
| **Global identifier or cross-platform map** — the identity layer becomes surveillance infrastructure                                                                 | No global Venn identifier; scope-specific nullifiers; local participant-controlled account binding; provider-neutral proofs; public linkability registry; conformance tests for joins and identifier reuse                                                                                                                                                                                       |
| **Cross-provider double counting** — the same person appears through multiple personhood providers                                                                   | Never sum provider cohorts as distinct humans without a proven cross-provider construction; otherwise publish cohorts separately or a statistical model that marks the denominator unknown/modeled                                                                                                                                                                                               |
| **Provider capture, exclusion, outage, or drift** — a World ID, government, wallet, or roster provider determines who counts                                         | Version-pinned adapters and admission policies; plural providers and accessible alternatives; no token/app/chain dependency; status and outage handling; due process, recovery, and false-duplicate appeals; publish provider mix and exclusion risks                                                                                                                                            |
| **Passkey, device, and recovery failure** — shared devices, lost wallets, cloned account access, or biometrics are mistaken for identity                             | Keep authorization, personhood, eligibility, and deduplication as separate assertions; multi-device and recovery ceremonies; no biometric-template access; shared-device threat tests; never claim a passkey proves a person                                                                                                                                                                     |
| **Aggregation-role collusion or compromise**                                                                                                                         | Separate deduplication from at least two independently operated aggregation roles; threshold cryptography/secret sharing; public keys and operator set in each envelope; rotation, compromise, and abort procedures; no silently degraded single-operator mode                                                                                                                                   |
| **Metadata and status-check leakage** — timing, network, credential-revocation checks, or small cells reveal participation                                           | Proxied, batched, or private-information-retrieval status checks under a declared trust model where feasible; upload batching and delay; coarse time; low-cardinality suppression; short retention; independent leakage tests; and declared residual risks                                                                                                                                       |
| **Repeated-query and differencing attacks** — many safe-looking releases reconstruct small groups                                                                    | Contribution bounds; fixed query families; threshold registry; differential-privacy composition where used; public release-budget accounting; halt when the budget is exhausted                                                                                                                                                                                                                  |
| **Ministry-of-Claims concentration**                                                                                                                                 | Publisher pluralism in the format; logged wording history and appeals; independently controlled conformance mark; forkable specification; a non-Venn publisher and implementation as release criteria                                                                                                                                                                                            |
| **Platform capture or semantic drift** — a host turns Venn into targeting, moderation discrimination, or an engagement score                                         | Minimal adapter contract; raw data stays with the host; semantic-separation fixtures; public adapter versions; contractual and audit restrictions on Venn-specific outputs; user-visible evidence class and refusal; revoke the conformance mark while preserving fork rights                                                                                                                    |
| **Verified-human coordination** — real humans are paid or organized to manufacture apparent consensus                                                                | One-person contribution bounds prevent amplification, not persuasion; publish acquisition surfaces, concentration and anomaly evidence, campaign context, coverage, and calibration; never equate verified participation with representativeness                                                                                                                                                 |
| **[GDPR Article 9](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/) and analogous political-opinion regimes**                                                     | Establish purpose and lawful basis per lane; data minimization, participant-local or ephemeral no-retention inference, strict retention, withdrawal/correction/access processes, processor boundaries, DPIA, transfer analysis, and counsel before V2; do not describe consent as curing every risk                                                                                              |
| **Walled familiars refuse integration**                                                                                                                              | Embeds, panels, and institutional verification need no platform cooperation; resilience rule (§3.2)                                                                                                                                                                                                                                                                                              |
| **Publisher/media IP**                                                                                                                                               | Public-record corpus; rights verified per jurisdiction; news `link-only`                                                                                                                                                                                                                                                                                                                         |
| **No carrier adopts**                                                                                                                                                | The consuming-side wedge can be tested now; V0 requires committed design partners before heavy build; every phase independently valuable                                                                                                                                                                                                                                                         |
| **Representativeness attacks**                                                                                                                                       | Never claimed; coverage/skew/denominator disclosure mandatory; calibration layer measures the gap instead of hiding it                                                                                                                                                                                                                                                                           |
| **Governance or funding capture** — founderlessness is claimed while one company, donor, platform, or credential provider controls outcomes                          | Independent steward/operator separation; fixed terms; conflict/funding disclosure; no founder veto, token voting, sponsor privilege, or preferred provider; recorded decisions, appeals, emergency expiry, independent mark control, and practical fork rights                                                                                                                                   |
| **Identity-token or Worldcoin perception** — Venn is mistaken for a biometric, crypto, or single-provider project                                                    | Venn issues no identity, biometric, token, or global uniqueness index; World ID is one optional, version-pinned adapter; no World App, Orb, WLD, or World Chain dependency; equivalent providers and provider-specific limitations stay visible                                                                                                                                                  |
| **Expression custody and platform rights** — ambient data is copied beyond user expectation or legal authority                                                       | No unauthorized scraping or central raw history; user-authorized, publisher-authorized, platform-native, or authorized-API acquisition only; provenance, purpose, retention, deletion, and rights basis declared                                                                                                                                                                                 |
| **Vote scope creep** — advisory measures are marketed or mechanically converted as elections                                                                         | Formal-ballot boundary in the frozen spec and claim lint; fresh legally appropriate ceremony; no conversion of expression, inference, confirmation, credential, or private profile into a vote                                                                                                                                                                                                   |
| **Solo-maintainer capacity**                                                                                                                                         | Spec and conformance are designed for independent implementation; V0 gates scope; steward succession and multiple operators are roadmap requirements, not post-launch aspirations                                                                                                                                                                                                                |
| **Scope regression** (the predecessor failure)                                                                                                                       | §2 non-goals are charter-level; amendment requires an RFC, threat/privacy/inclusion analysis, public review, and a decision-log entry                                                                                                                                                                                                                                                            |

---

## 16. Settled founding direction and remaining implementation questions

The founder-level direction is sufficiently complete to draft and review the constitutional packet:

- Venn measures defined populations today and is built to become capable of legitimate collective decision support only through later public choice, external validation, and separately gated authority.
- Political and civic public-interest measurement comes first; commercial, cultural, and other preference domains may follow under explicit profiles.
- Expression may inform salience and probabilistic aggregates but never silently becomes a confirmed position; Compose-and-Confirm is the transfer path.
- Layered authorization keeps expression measurement, confirmation, eligibility, calibration, delegation, voting, and secondary use distinct.
- Initial political measurement is 18+ in Canada, with Ontario as the operating base and one bounded first pilot.
- Venn pursues increasingly reliable one-human/one-count assurance without a mandatory globally linkable identifier or single provider.
- Public civic measures have a freely accessible baseline; personal political profiles, exclusive civic truth, and targeting segments are not products.
- Carbon Caste is the disclosed founding custodian under an enforceable transition covenant.
- Venn Reader is a separate first-party reference implementation with no protocol privilege.
- Foundational covenants require refounding to change; protected provisions require exceptional amendment; operations use an ordinary process.
- Venn governs itself progressively while stating honestly whom each process represents.
- A separate ballot profile is an explicit long-term ambition, never an automatic conversion of signal into a vote.

The remaining questions belong to implementation, adversarial review, partner selection, and legal design rather than hidden founder-value defaults:

1. exact open-code, specification, content, data, and conformance-mark licences;
2. independent stewardship legal form, selection rules, funding firewall, transition instruments, and dates;
3. protected-amendment approval thresholds and constituency definitions;
4. consent interfaces, renewal intervals, withdrawal effects, and retention/deletion periods;
5. pilot population, consuming institution, publisher/community host, calibration partner, and claim set;
6. conformance-mark investigation, appeal, suspension, and revocation procedure;
7. credential-admission providers, accessibility alternatives, recovery, revocation, and cross-provider research posture;
8. aggregation operators, thresholds, privacy mechanisms, query budgets, compromise response, and public audit scope;
9. receipt-free confirmation and future ballot cryptographic constructions, including algorithm-agility and post-quantum migration plans; and
10. repository, review, ratification, and VHC hostile-salvage mechanics.

---

## 17. The formulation

> **Venn is the open protocol for representing humanity in the age of AI.**
>
> It gives people, platforms, publishers, agents, and institutions a common way to turn everyday online expression into typed civic evidence without turning anyone into a public political profile. Expression records what happened under its stated origin assurance. Models may estimate salience, intensity, ambiguity, and possible position. Only a fresh human-facing ceremony admitted under its named authorization and, when claimed, personhood policy can create a confirmed position. Calibration turns declared participant evidence into a population estimate with coverage, method, uncertainty, and known skews attached.
>
> Venn does not issue identity and does not ask the world to trust one identity company. Passkeys authorize actions; plural external credentials may establish personhood or eligibility; scope-specific proofs allow duplicate rejection inside their declared policy without intentionally creating a global person identifier. Repetition can raise salience or intensity, but it cannot turn one admitted contributor into several inside a declared credential and nullifier scope verified under its named policy. A prior reaction never silently becomes a vote.
>
> The protocol is open enough for any comment system, publisher, familiar, wallet, survey lab, or public institution to implement. It publishes reference artifacts, aggregate commitments, correction histories, and complete civic-measure envelopes — never per-person stance rows. Its conformance mark may activate only when independent publishers, credential providers, aggregation operators, implementations, auditors, and a neutral steward make it possible to replace any one founder, company, platform, government, or provider.
>
> **Any surface may carry expression. Models may interpret it. Only a fresh human-facing authorization under declared assurance may create a confirmed position. Within a declared credential and nullifier scope verified under its named policy, no system may count one admitted contributor as a crowd. Any institution may audit the aggregate. No conformant public output may expose humanity person by person.**
>
> Humans express and confirm. Models interpret. Agents cite. Institutions verify. **No single actor is trusted with the whole system. Every remaining trust assumption is explicit, bounded, auditable, and replaceable.**
