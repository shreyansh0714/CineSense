# AWS Deployment Runbook — CineSense (EC2 Free Tier)

**Owner:** Shreyansh Jain ([@shreyansh0714](https://github.com/shreyansh0714))
**Status:** runbook prepared; fill in the [Deployment record](#9-deployment-record) below once the service is live.

> **Why EC2 and not App Runner:** the first version of this runbook targeted AWS
> App Runner. It turns out App Runner has **no free tier** — the smallest
> instance runs roughly $2.5–3/month while active. Our course brief requires a
> **free** deployment, so we switched to **EC2**, which genuinely costs **$0**
> for a single small instance run continuously, as long as your AWS account is
> within its free-tier window (see §1). This pivot — and why — belongs in the
> report's "challenges & resolutions" section.

This is the exact, copy-pasteable procedure for deploying CineSense to a free-tier
AWS EC2 instance with real HTTPS at no cost, plus the required budget alert and
an end-to-end verification checklist. Issues hit during the real deployment go
in [Troubleshooting](#8-troubleshooting--issues-hit) — that feeds the report.

---

## 0. Why these choices (decision rationale)

Course rule: every teammate must be able to explain every decision. Here they are.

| Decision | Why |
|---|---|
| **EC2** (not App Runner/ECS/Lambda) | The only mainstream AWS compute option that is genuinely **free** for a small always-on web app, via the free-tier hour allowance. |
| **`t2.micro` or `t3.micro`** | The specific instance sizes AWS free tier covers — 750 hours/month, which is enough for **one** instance to run 24/7 for a full calendar month (a month has ~730 hours). Whichever of the two shows "Free tier eligible" in your region's launch wizard is the one to pick. |
| **Amazon Linux 2023 AMI** | Free-tier eligible, comes with `dnf`, minimal setup to get Docker running. |
| **One Elastic IP** | Free *while attached to a running instance* — gives us a stable public IP that doesn't change if the instance reboots. (Caution in §7: it stops being free the moment the instance is stopped without releasing the IP.) |
| **Caddy reverse proxy + a [nip.io](https://nip.io) hostname** | We need a public **HTTPS** URL but don't own a domain. `nip.io` is a free DNS trick: a hostname like `3-101-45-67.nip.io` automatically resolves to IP `3.101.45.67` — a real, resolvable hostname, so Caddy can get a **real, free** Let's Encrypt certificate for it. Zero cost, zero domain purchase. |
| **Plain `docker run`, manual redeploy** | One container, no orchestration needed; `git pull && docker build` on the instance is enough for a project this size. |
| **Budget alert kept** | Safety net — if free-tier hours run out, an instance type changes by mistake, or the Elastic IP gets left dangling on a stopped instance, this catches it before it becomes real money. |

> **AWS free-tier terms vary by account age** — some newer accounts get a
> time-limited credit instead of the classic "12 months of free resources"
> list. Check **Billing → Free Tier / Credits** in your own console to see
> exactly what applies to your account; either way, one small instance running
> continuously for the project's duration should stay within it.

---

## 1. Prerequisites (one-time, on your machine)

```powershell
docker --version
aws --version
aws sts get-caller-identity        # must print your Account ID
```

Also confirm free-tier eligibility yourself: AWS Console → **Billing and Cost
Management** → **Free Tier** (or **Credits**) — note what it says, screenshot
it for the report (evidence this was a deliberate, verified choice, not a guess).

You'll also want an SSH client, which macOS/Linux have built in (`ssh`) and
Windows 10+ has too (via PowerShell or Git Bash).

---

## 2. Launch the EC2 instance

AWS Console → set your region → **EC2** → **Launch instance**:

1. **Name:** `cinesense`
2. **AMI:** Amazon Linux 2023 (should be marked "Free tier eligible")
3. **Instance type:** `t2.micro` — if it's not offered as free-tier eligible in
   your region, use `t3.micro` instead (whichever is marked free-tier eligible).
4. **Key pair:** Create a new key pair, name it `cinesense-key`, download the
   `.pem` file and keep it somewhere safe — you cannot re-download it.
5. **Network settings → Edit:**
   - Allow SSH (port 22) from **My IP** only (not "Anywhere" — keep this locked to you)
   - Allow HTTP (port 80) from **Anywhere** (needed for the HTTPS certificate handshake)
   - Allow HTTPS (port 443) from **Anywhere**
6. **Storage:** leave the default (8 GiB gp3 is within the free 30 GiB/month allowance).
7. **Launch instance.**

📸 Screenshot: the instance in *Running* state, showing "Free tier eligible" on the instance type.

## 3. Allocate a stable public IP (Elastic IP)

1. EC2 Console → **Elastic IPs** → **Allocate Elastic IP address** → Allocate.
2. Select it → **Actions** → **Associate Elastic IP address** → choose the
   `cinesense` instance → Associate.
3. Note the IP address, e.g. `3.101.45.67` — you'll need it below.

> This IP is free *only while attached to a running instance*. See §7 for what
> happens if you stop the instance.

## 4. Connect and install Docker

```sh
chmod 400 cinesense-key.pem
ssh -i cinesense-key.pem ec2-user@<ELASTIC_IP>

sudo dnf update -y
sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user
exit
# log back in so the docker group membership takes effect
ssh -i cinesense-key.pem ec2-user@<ELASTIC_IP>
```

## 5. Get the code and build the image, on the instance

```sh
git clone https://github.com/shreyansh0714/CineSense.git
cd CineSense
docker build -t cinesense .
```

## 6. Run the app container

```sh
docker run -d --name cinesense --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -e GEMINI_API_KEY=your-real-key-here \
  cinesense
```

Bound to `127.0.0.1` only — the app is not exposed to the internet directly;
Caddy (next step) is the public-facing side and terminates HTTPS. This is also
where the "no keys in code" requirement lives in production: the key exists
only in this `docker run` command on the server, never in the repo.

## 7. Free automatic HTTPS with Caddy + nip.io

Take your Elastic IP and replace the dots with dashes, then append `.nip.io`.
Example: `3.101.45.67` → `3-101-45-67.nip.io`. This hostname will resolve back
to your IP automatically — no DNS setup or domain purchase needed.

```sh
sudo dnf install -y 'dnf-command(copr)'
sudo dnf copr enable -y @caddy/caddy
sudo dnf install -y caddy

sudo tee /etc/caddy/Caddyfile <<'EOF'
3-101-45-67.nip.io {
    reverse_proxy localhost:8080
}
EOF
# replace 3-101-45-67 with YOUR elastic IP, dashes for dots

sudo systemctl enable --now caddy
sudo systemctl reload caddy
```

Caddy automatically requests and renews a real Let's Encrypt certificate for
that hostname the first time it starts. Your public URL is now
`https://3-101-45-67.nip.io` (using your own IP).

📸 Screenshots: the running `docker ps` output; the Caddyfile; the browser
padlock/certificate details on the live URL.

## 8. Verify end-to-end (the deployment isn't done until this passes)

```powershell
$URL = "https://3-101-45-67.nip.io"    # your actual nip.io URL
curl "$URL/api/health"
curl -N -X POST "$URL/api/recommend" -H "Content-Type: application/json" -d '{\"mood\":\"fried after work\",\"favorites\":[{\"title\":\"Whiplash\",\"why\":\"the obsession\"}],\"constraints\":\"under 2 hours\"}'
```

Then in a **browser**:

- [ ] Open the nip.io URL on desktop → real HTTPS padlock, no warnings
- [ ] Submit mood + 2 favorites + a constraint → reasoning streams before the pick
- [ ] Refine with "too heavy" → new pick, no repeat
- [ ] Open the same URL on your **phone** → layout works (responsive requirement)

## 9. Budget alert (required by the course brief, and a genuine safety net here)

Console → **Billing and Cost Management** → **Budgets** → **Create budget**:

1. Customize (advanced) → Cost budget
2. Monthly, **$5.00**, name `cinesense-budget`
3. Alert threshold: **80% of budgeted amount**, on **Actual**
4. Your email → Create

📸 Screenshot: the budget with its alert threshold.

## 10. Operating the instance (staying inside the free tier)

- **You do not need to stop the instance between demos.** The free tier is
  750 hours/month for one instance — a full month is ~730 hours — so leaving
  it running continuously for the whole project stays inside the limit.
- **If you do stop it anyway:** EC2 → select instance → *Instance state* →
  *Stop*. Careful — a Stopped instance's Elastic IP starts accruing a small
  hourly charge (it's only free while attached to a *running* instance). Either
  leave the instance running, or release the Elastic IP when you stop it
  (accepting that you'll get a new IP — and a new nip.io hostname — next time
  you start it and reassociate).
- **Redeploy after a code change:**
  ```sh
  ssh -i cinesense-key.pem ec2-user@<ELASTIC_IP>
  cd CineSense && git pull
  docker build -t cinesense .
  docker stop cinesense && docker rm cinesense
  docker run -d --name cinesense --restart unless-stopped -p 127.0.0.1:8080:8080 -e GEMINI_API_KEY=your-key cinesense
  ```
- **Logs:** `docker logs cinesense`
- **Teardown after grading:** EC2 → *Instance state* → *Terminate*; then
  **Elastic IPs** → select yours → *Release Elastic IP address*; then delete
  the security group if you want to fully clean up.

## 11. Troubleshooting / issues hit

| Symptom | Cause → Fix |
|---|---|
| `ssh: Permission denied (publickey)` | Wrong username (`ec2-user` for Amazon Linux, not `ubuntu`/`root`) or `.pem` file permissions too open → `chmod 400` |
| Browser can't reach the nip.io URL at all | Security group missing port 80/443 from Anywhere, or Elastic IP not associated → check §2 step 5 and §3 |
| Caddy fails to get a certificate | Port 80 blocked (Let's Encrypt validates over HTTP first) → confirm the security group rule; or the nip.io hostname doesn't match your actual current Elastic IP (typo in the dashes) |
| App container exits immediately | Check `docker logs cinesense` — usually a missing/wrong `GEMINI_API_KEY` |
| SSE error "Server misconfiguration — is GEMINI_API_KEY set?" in the browser | Same as above — the app fails soft on a bad key by design; fix the `docker run` command and restart the container |
| Instance stopped working after a few weeks | Check Billing → Free Tier usage — confirm you're still within the 750 hrs/month and haven't accidentally launched a second instance |
| *(fill in real issues from the actual deployment here)* | |

## 12. Deployment record (fill in after deploying)

| Field | Value |
|---|---|
| Deployed by | Shreyansh Jain |
| Date | *(fill in)* |
| Region | *(fill in)* |
| Instance type | t2.micro / t3.micro *(circle one)* |
| Public URL | *(https://x-x-x-x.nip.io)* |
| Monthly cost | $0 (free tier) |
| Budget alert | $5/month, email at 80% |
| End-to-end checklist (§8) | *(pass/fail + date)* |

---

## 13. Vibe-coding log — prompts used for this deliverable

1. **Handoff brief** — the full project-context prompt lives in
   [`docs/HANDOFF_SHREYANSH.md`](HANDOFF_SHREYANSH.md).
2. **From this session:** initial ask was "deploy to AWS App Runner" per the
   original README. Verified the app runs, drafted an App Runner runbook —
   then the requester flagged that the assignment brief requires the
   deployment to cost **nothing**, and asked to check this against App
   Runner's actual pricing. That surfaced that App Runner has no free tier at
   all. The AI then researched and proposed the free alternative that still
   satisfies "AWS deployment": an EC2 free-tier instance, plus a nip.io + Caddy
   trick for free HTTPS without owning a domain — and rewrote this runbook
   around it before any real money was spent. This sequence (wrong initial
   assumption → caught by re-reading the actual requirement → corrected before
   execution) is itself good material for the report's "challenges &
   resolutions" section.
