# Risk Register

## Technical Risks

### 1. Lamport Clock Overflow
- **Risk**: 53-bit integer overflow in JavaScript could cause ordering issues after millennia of high-frequency updates.
- **Mitigation**: Monitor clock drift; potential migration to BigInt (requires widespread support).
- **Status**: Low probability, monitored.

### 2. TURN Server Costs
- **Risk**: High bandwidth usage on CoTURN relays if P2P connection fails frequently.
- **Mitigation**: Enforce aggressive ICE candidate gathering; implement data caps/quotas on relay usage.
- **Status**: Accepted for Sprint 0.

### 3. AI Model Drift & Hallucination
- **Risk**: Local LLM (WebLLM) may produce inconsistent or biased outputs.
- **Mitigation**: Strict prompt engineering (JSON enforcement); user feedback loop (thumbs up/down); periodic model updates.
- **Status**: Active mitigation via `packages/ai-engine` prompt logic.

### 4. Local Storage Limits
- **Risk**: IndexedDB quotas on mobile devices may be reached with heavy graph data.
- **Mitigation**: Implement graph pruning (GC) policies; warn user when storage is low.
- **Status**: Pending implementation in `packages/gun-client`.

## Operational Risks

### 1. Key Management
- **Risk**: Users losing their private keys results in permanent data loss (Local-First).
- **Mitigation**: Implement social recovery or paper backup flows (Milestone B).
- **Status**: Accepted for Sprint 0 (Developer-only).
