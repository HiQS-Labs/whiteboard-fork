# Whiteboard Review Hub — Staging Operations Runbook

## Topology & Architecture

* **Host:** New staging/dev GCP GCE VM (`e2-standard-4`, Debian 12, `ltvera-gce-and-bigquery`), co-located with `LTVera-Pandas` staging.
* **Service:** `review-hub.service` (`systemd`, Node 22/24, loopback `127.0.0.1:8787`).
* **Reverse Proxy:** Caddy via Cloudflare Full SSL (`reviews.staging.ltvera.com`).
* **Authentication:**
  * Publisher: Static Bearer token (`REVIEW_HUB_TOKEN`).
  * Viewers: HTTP Basic Auth configured in Caddy / Hub env (`REVIEW_HUB_USER`, `REVIEW_HUB_PASSWORD`).
* **Git Repository Resolution:**
  * Target: `BinoidCBD/LTVera-Pandas.git`.
  * Authenticated via machine `GITHUB_TOKEN` in `/etc/review-hub.env`.

---

## 1. Initial VM Setup (One-Time)

1. Create dedicated user and data directory:
   ```bash
   sudo useradd -r -s /usr/sbin/nologin -d /var/lib/review-hub review-hub
   sudo mkdir -p /var/lib/review-hub
   sudo chown -R review-hub:review-hub /var/lib/review-hub
   ```

2. Create environment file `/etc/review-hub.env`:
   ```ini
   REVIEW_HUB_HOME=/var/lib/review-hub
   REVIEW_HUB_PORT=8787
   REVIEW_HUB_ORIGIN=https://reviews.staging.ltvera.com
   REVIEW_HUB_TOKEN=<generate-random-token>
   GITHUB_TOKEN=<github-pat-with-read-access-to-ltvera-pandas>
   REVIEW_HUB_USER=team
   REVIEW_HUB_PASSWORD=<choose-password>
   ```
   Secure permissions:
   ```bash
   sudo chmod 0600 /etc/review-hub.env
   sudo chown root:root /etc/review-hub.env
   ```

3. Generate Caddy Basic Auth password hash:
   ```bash
   caddy hash-password --plaintext "<choose-password>"
   # Example output: $2a$14$abc...
   ```
   Export this hash into Caddy's systemd environment (e.g. via `/etc/systemd/system/caddy.service.d/override.conf` or `/etc/caddy/Caddyfile` directly):
   ```ini
   [Service]
   Environment="REVIEW_HUB_BASIC_AUTH_HASH=$2a$14$abc..."
   ```

4. Install systemd service unit:
   ```bash
   sudo cp deploy/review-hub.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable review-hub
   ```

5. Append `deploy/Caddyfile.snippet` into the host's `/etc/caddy/Caddyfile` and reload Caddy:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl reload caddy
   ```

---

## 2. Deployment Procedure

Deployments are shipped as prebuilt tarballs without building on the VM:

1. **Pack the tarball on your development machine:**
   ```bash
   node scripts/pack-review-hub.mjs
   # Output: dist-release/dev.fast-review-hub-0.1.0.tgz
   ```

2. **Copy and extract on the VM:**
   ```bash
   scp dist-release/dev.fast-review-hub-0.1.0.tgz <vm-user>@<staging-vm-ip>:/tmp/
   
   # On the VM (strip npm pack top-level 'package/' directory):
   sudo tar -xzf /tmp/dev.fast-review-hub-0.1.0.tgz -C /var/lib/review-hub/ --strip-components=1
   sudo chown -R review-hub:review-hub /var/lib/review-hub
   sudo systemctl restart review-hub
   ```

3. **Verify Health:**
   ```bash
   curl -i http://127.0.0.1:8787/healthz
   ```

---

## 3. Publisher Workflow

To share a review from your local CLI to the staging review hub:

```bash
export DEV_REVIEW_SHARE_ORIGIN="https://reviews.staging.ltvera.com"
export DEV_REVIEW_SHARE_TOKEN="<REVIEW_HUB_TOKEN>"

# Run inside your local LTVera-Pandas checkout:
whiteboard share
```

The CLI outputs:
```
https://reviews.staging.ltvera.com/s/<share-id>#<capability>
```

Open the link in any modern browser, log in with the team Basic Auth credentials, and view the review complete with document, maps, and live Git diffs.
