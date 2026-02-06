````markdown
# Carboncaste Bootstrap Server (Phase 0) — State of Play

This repo/server config defines the **Phase 0 “bootstrap” home node** for `carboncaste.io` and its first subdomains:

- **`carboncaste.io`** → interactive landing page (routes users to gov/edu/etc.)
- **`gov.carboncaste.io`** → Venn-Hermes (future governance + GWC + LUMA UI)  
  - **Phase 0:** runs a **GUN relay/bootstrap peer** as the initial network entry point
- **`edu.carboncaste.io`** → education tools/services  
  - **Phase 0:** placeholder (Digital-Queue will be added first)

This Phase 0 node is deliberately boring: one box, one reverse-proxy “front door,” and services behind it.

---

## Architecture (Invariant Pattern)

**Caddy is the only public-facing “front door”** on the home server.
All apps/tools run behind it on internal ports (Docker network), and are routed by hostname.

### Public routing (hostname → internal service)
- `carboncaste.io`, `www.carboncaste.io` → landing page static files
- `gov.carboncaste.io` → GUN relay container (bootstrap peer)
- `edu.carboncaste.io` → (future) Digital-Queue / other edu services

### Edge modes (how traffic reaches Caddy)
- **Mode A (current):** Internet → router port-forward `80/443` → home Caddy
- **Mode B (later):** Internet → tunnel provider → home Caddy (no open ports)
- **Mode C (later):** Internet → VPS “front desk” → WireGuard tunnel → home Caddy

Domains/URLs stay constant across modes; only the “edge plumbing” changes.

---

## Host + Access

- Host machine: **Geekom A6** (Ubuntu 24.04 LTS)
- Primary interface: **Ethernet (`eno1`)**
- LAN IP: **DHCP reservation** set on router (currently `192.168.0.50`)
- Admin access: **SSH over Tailscale** (preferred)
  - Developers typically connect with: `ssh ccibootstrap` (SSH config alias on their machine)

---

## Network Prereqs (Router + DNS)

### Router requirements
- **DHCP reservation:** `ccibootstrap` → `192.168.0.50`
- **UPnP:** OFF
- **Port forwards (only):**
  - TCP `80`  → `192.168.0.50:80`
  - TCP `443` → `192.168.0.50:443`
- **Do NOT port-forward 22** (SSH remains Tailscale-only)

### DNS records
During Phase 0, A records point to the router WAN IP:
- `@` → WAN IP (carboncaste.io)
- `www` → WAN IP
- `gov` → WAN IP
- `edu` → WAN IP

**Note:** WAN IP is dynamic (ISP). If it changes, DNS must be updated (manual now; DDNS automation later).

---

## Repo/Server Layout

Everything for the bootstrap stack lives under:

- **`/srv/bootstrap/`**

Current files:
- **`/srv/bootstrap/Caddyfile`** — hostname routing + TLS
- **`/srv/bootstrap/docker-compose.yml`** — services + volumes
- **`/srv/bootstrap/site/index.html`** — landing page content
- **`/srv/bootstrap/gun-relay/`** — minimal GUN relay container
  - `server.js`
  - `package.json`
  - `Dockerfile`

Persistent data (Docker volumes):
- `caddy_data` — TLS certs + ACME storage
- `caddy_config` — autosave/config state
- `gun_data` — GUN relay persistence (if used)

---

## Running Services (Phase 0)

### Services
1. **caddy**
   - Exposes: `0.0.0.0:80`, `0.0.0.0:443`
   - Handles: HTTP→HTTPS redirect, Let’s Encrypt certs, host-based routing
2. **gun-relay**
   - Internal: `:8765` (Docker network)
   - Exposed publicly via: `gov.carboncaste.io` → `reverse_proxy gun-relay:8765`

---

## Operations: Common Commands

From the server:

```bash
cd /srv/bootstrap
````

### Start / update the stack

```bash
docker compose up -d --build
```

### Status

```bash
docker compose ps
```

### Logs

```bash
docker compose logs -f --tail=200 caddy
docker compose logs -f --tail=200 gun-relay
```

### Restart a service

```bash
docker compose restart caddy
docker compose restart gun-relay
```

### Validate local routing (without relying on public DNS)

Use `--resolve` to simulate correct TLS SNI locally:

```bash
# landing
curl -s --resolve carboncaste.io:443:127.0.0.1 https://carboncaste.io/ | head

# gov GUN relay
curl -s --resolve gov.carboncaste.io:443:127.0.0.1 https://gov.carboncaste.io/ | head
```

---

## Caddy (TLS + Formatting)

Caddy auto-provisions Let’s Encrypt certs via HTTP-01 challenge (requires inbound port 80).

Optional (recommended): set ACME email at the top of `Caddyfile`:

```caddy
{
  email you@carboncaste.io
}
```

Format the file:

```bash
docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile" caddy:2 caddy fmt --overwrite /etc/caddy/Caddyfile
docker compose restart caddy
```

---

## Security Posture (Phase 0)

* SSH is intended to be **Tailscale-only**
* UFW is enabled; inbound is minimal (80/443 public; 22 only on `tailscale0`)
* No other services should bind to the public interface

Quick check:

```bash
sudo ufw status verbose
```

---

## Integrating New Apps/Tools (How to Add a Service)

### Goal

Add a new service behind Caddy on a subdomain (no public port except 80/443).

### Pattern

1. Add a Docker service to `docker-compose.yml` (no host port mapping; internal only)
2. Add a hostname block in `Caddyfile` routing that subdomain to the service name + port
3. Deploy: `docker compose up -d --build` and `docker compose restart caddy`

### Example: add Digital-Queue on `edu.carboncaste.io`

In `Caddyfile`:

```caddy
edu.carboncaste.io {
  reverse_proxy digital-queue:8888
}
```

In `docker-compose.yml` (example skeleton):

```yaml
  digital-queue:
    image: your-org/digital-queue:latest
    environment:
      - NODE_ENV=production
      - PORT=8888
    restart: unless-stopped
```

Deploy:

```bash
docker compose up -d --build
docker compose restart caddy
```

**Rule:** Do not expose new ports publicly. Everything goes through Caddy.

---

## Roadmap (Next 6–12 Months)

### Phase 0 (now): single home bootstrap node

* ✅ Stable LAN IP via DHCP reservation
* ✅ Router forwards 80/443 only
* ✅ Caddy front door + Let’s Encrypt
* ✅ gov subdomain provides initial bootstrap peer (GUN relay)
* ⏭ Add edu subdomain services (Digital-Queue first)

### Phase 1 (weeks 1–4): “test users can use it”

* Add `edu.carboncaste.io` services
* Improve landing page UX + navigation
* Add basic monitoring/uptime checks
* Add fallback seed hostnames (e.g., `seed1`, `seed2`) even if they point to same node initially

### Phase 2 (months 3–6): redundancy + resilience

* Stand up additional seed nodes in other locations (different ISP + power backup)
* Clients attempt multiple seeds in parallel; keep best connections

### Phase 3 (months 6–12): community bootstrap + minimal discoverable seeds

* Define node roles (seed/relay/guardian/turn) + incentives
* Publish a signed seed manifest from a small trusted root set
* Gradually decentralize signing/governance (threshold/multi-signer)
* Add relay/TURN capacity where needed (likely VPS for TURN at first)

---

## Known Reality Checks

* **Dynamic WAN IP:** DNS breaks when ISP changes WAN IP unless DDNS is automated.
* **Router hairpin NAT:** accessing `https://carboncaste.io` from inside the LAN may behave differently than from LTE. Always validate from outside.
* **TLS local testing:** use `--resolve` (SNI matters).
* **No secrets in repo:** do not commit API keys, OAuth secrets, etc. Use env files / secret management per-service.

---

## Ownership / Contact

This Phase 0 node is a stepping stone toward a distributed, community-supported bootstrap/relay foundation.
Treat this configuration as the reference pattern: **Caddy front door + services behind it + swap edge plumbing later**.

```

If you want, I can also generate:
- a matching `deploy/` folder layout (so `/srv/bootstrap` can be recreated from a repo checkout),
- a “Phase 1 add edu.carboncaste.io / Digital-Queue” section with the exact compose service once you share the Digital-Queue runtime expectations (port, env vars, persistence).
::contentReference[oaicite:0]{index=0}
```
