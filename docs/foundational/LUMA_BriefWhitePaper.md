# LUMA: The Protocol for Sovereign, Unlinkable Identity

White Paper v1.0
Based on Protocol Specification v3.0

## Abstract

The digital world faces a dual crisis: the erosion of trust caused by AI-driven sybil attacks, and the erosion of liberty caused by surveillance capitalism and state-level data harvesting. LUMA (Local, Unlinkable, Minimal‑Attribution) is a decentralized identity protocol designed to solve both. It establishes two cryptographic truths—Singular Humanness and Local Residency—without creating a central repository of biometric data. By leveraging Visual-Inertial Odometry, Zero-Knowledge Proofs, and Intent-Based Decryption, LUMA offers a "Proof of Human" standard that is mathematically private, physically secure, and resilient against adversarial coercion.

1. The Identity Crisis

Current identity solutions present a false dichotomy:

Centralized Safety: Hand over your biometrics to a corporation or state, creating a "honey-pot" target for hackers and enabling total surveillance.

Anarchic Privacy: Remain anonymous, but suffer from bot swarms, sybil attacks, and the inability to prove community membership or ownership.

LUMA rejects this trade-off. We assert that you can prove that you are a unique human without revealing who you are. We assert that digital systems can verify residency without knowing your address.

2. Core Philosophy & Guarantees

LUMA is built on four non-negotiable guarantees, enforced by cryptography and physics rather than policy.

2.1 Singular Humanness (PoH-1)

One human, one Digital DNA (DDNA). This is not enforced by a central list of faces, but by a decentralized uniqueness index using encrypted, "holographic" vectors. This eliminates bot farms and enables true one-person-one-vote governance.

2.2 Local Residency (PoR)

Proof that a user resides within a service area (e.g., a city or jurisdiction) without revealing their coordinates. This enables "Geofenced Anonymity"—the ability to participate in local civics digitally, without doxxing oneself.

2.3 Consent-Gated Sovereignty

The link between a user's legal identity (KYC) and their anonymous DDNA is sealed in a cryptographic escrow. In LUMA v3.0, this seal cannot be broken by the platform, the government, or the escrow holders alone. It requires Intent-Based Decryption: the user must biometrically authorize the specific warrant or recovery request on their own trusted device to release the decryption key.

2.4 Asymmetric Defense

We assume our adversaries are state-level actors with unlimited compute and physical access. Therefore, our security relies on the one thing they cannot spoof: Physics. We bind identity to time, entropy, and physical interaction with the real world.

2.5 Delegated Agents (Familiars) — Inheritance Rule (Note)

Agents (“familiars”) are delegated sub‑processes of a verified human. They **inherit** the principal’s trust gate and never multiply influence. All agent actions must resolve to a human principal nullifier and are scoped, expiring, and revocable.

3. Technical Architecture: The "Physics of Trust"

LUMA replaces static passwords and simple selfies with dynamic, physics-bound proofs.

3.1 Silver Assurance: Visual-Inertial Odometry (VIO)

To defeat deepfakes and "injection attacks" (where a hacker feeds a pre-recorded video into the camera), LUMA Silver requires a continuous interaction with the physical environment.

The Flight Path: The user follows a moving target on their screen.

Sensor Fusion: The protocol correlates the phone's accelerometer and gyroscope data (IMU) with the optical flow of the background and the motion of the user's face.

The Guarantee: A deepfake generator cannot simulate the chaotic micro-tremors of a human hand and the precise optical shifts of a specific background room simultaneously in real-time.

3.2 Gold Assurance: Continuously Attested Proof-of-Work (CAPoW)

For high-value use cases, we introduce the BioKey ($20 hardware). To defeat supply-chain attacks (fake hardware), we rely on Time.

The BioKey performs a memory-hard computation on fingerprint data.

The algorithm is tuned to take exactly 300ms on genuine silicon.

The phone's Secure Enclave times the response. If it is too fast (malicious optimized chip) or too slow (emulator), the proof is rejected.

3.3 The Privacy Engine: Holographic Vectors & ZK-SNARKs

How do we ensure you haven't enrolled twice without keeping a database of your face?

Pedersen Vector Commitments: We encrypt your biometric features into a mathematical curve.

Homomorphic Encryption: This allows the network to calculate the "distance" between your encrypted vector and others without ever decrypting them.

Zero-Knowledge Proofs: The network proves "This user is unique" without knowing who the user is or what they look like.

3.4 Anti-Wormhole Residency

To prevent users from faking residency by relaying signals (a "Wormhole Attack"), the LUMA Distance-Bounding Anchor (DBA) uses Acoustic Fingerprinting. Both the phone and the home anchor record 5 seconds of ambient room noise. If the spectral footprints (traffic hum, room reverb) don't match, the user is not physically present, regardless of what the GPS says.

4. Operational Integrity & Governance

4.1 The Lazarus Protocol

We acknowledge that users lose keys. LUMA employs Shamir’s Secret Sharing to split the user's private recovery key into shards distributed to trusted family or friends. Recovery requires social consensus (e.g., 3-of-5 friends), ensuring no single person (including LUMA) can commandeer an identity.

4.2 The Canary System

To ensure our network operators aren't secretly censoring users or allowing duplicates, an independent Auditor injects "Canary Identities" (synthetic users) into the system. If the operators fail to flag a duplicate Canary, or falsely flag a unique one, the system raises a public, automated alarm.

4.3 The Region Notary (IETF ARC)

To prevent "Oracle Attacks" (where an attacker pings the residency server to triangulate a user's exact home), we use Anonymous Rate-Limited Credentials. Users receive a monthly budget of "Oblivious Stamps." The server validates the stamp, not the user, making it impossible to build a location history profile.

5. Roadmap to Decentralization 

LUMA will roll out in five hardened phases, prioritizing security over speed.

Phase 1: Silver Core. Launch of the Wallet App with VIO Liveness and OID4VC issuance.

Phase 2: The Lock. Implementation of the Linkage Escrow with Intent-Based Decryption and the Lazarus Protocol.

Phase 3: Gold Hardware. Manufacturing and distribution of the BioKey with CAPoW firmware.

Phase 4: Privacy Hardening. Full migration to Pedersen Vector Commitments and ZK-SNARKs for the Uniqueness Index.

Phase 5: Residency. Release of the DBA hardware and activation of acoustic fingerprinting.

6. Conclusion

LUMA is not just an identity app; it is a defense mechanism for the human individual in the age of AI. By weaving together the physics of the real world with the mathematical certainty of Zero-Knowledge cryptography, we offer a path forward where digital convenience does not require the sacrifice of human sovereignty.

One Human. One DDNA. Zero Surveillance.
