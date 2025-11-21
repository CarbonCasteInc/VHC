# syntax=docker/dockerfile:1
FROM rust:1.75 as builder
WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/attestation-verifier /usr/local/bin/attestation-verifier

EXPOSE 3000

CMD ["attestation-verifier"]
