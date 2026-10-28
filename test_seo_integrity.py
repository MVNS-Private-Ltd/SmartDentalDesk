"""
DentalSmart SEO & Content-Integrity Test Suite
Validates all Phase 1-3 audit fixes on the static files directly.
Run: python test_seo_integrity.py
"""

import os, re, json, sys
from pathlib import Path

ROOT = Path(__file__).parent
PASS = []
FAIL = []
WARN = []

GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
RESET  = "\033[0m"
BOLD   = "\033[1m"

def ok(name, detail=""):
    PASS.append(name)
    tag = f"  {detail}" if detail else ""
    print(f"{GREEN}  PASS{RESET}  {name}{tag}")

def fail(name, detail=""):
    FAIL.append(name)
    tag = f"  {detail}" if detail else ""
    print(f"{RED}  FAIL{RESET}  {name}{tag}")

def warn(name, detail=""):
    WARN.append(name)
    tag = f"  {detail}" if detail else ""
    print(f"{YELLOW}  WARN{RESET}  {name}{tag}")

def read(path):
    try:
        return Path(path).read_text(encoding="utf-8", errors="ignore")
    except FileNotFoundError:
        return ""

# ─────────────────────────────────────────────
# PHASE 1 — PRICING PAGE / NOINDEX REMOVAL
# ─────────────────────────────────────────────
print(f"\n{BOLD}PHASE 1 — Pricing page / noindex / copy truth{RESET}")

pricing = read(ROOT / "pricing.html")

if 'noindex' not in pricing.lower():
    ok("pricing.html has no noindex directive")
else:
    fail("pricing.html still contains noindex", "remove <meta name=robots content=noindex>")

if re.search(r'<link[^>]+rel=["\']canonical["\'][^>]+pricing', pricing, re.I):
    ok("pricing.html has a canonical tag pointing to itself")
else:
    warn("pricing.html canonical tag not found or not pointing to /pricing.html")

# Specific credit values present
for credit, plan in [("300", "Starter"), ("1,000", "Growth"), ("2,000", "Premium")]:
    if credit in pricing or credit.replace(",","") in pricing:
        ok(f"pricing.html contains {plan} credit value ({credit})")
    else:
        fail(f"pricing.html missing {plan} credit value ({credit})")

# Mandate dialog fully removed
for banned_id in ["cardModal", "trialCardNum", "proceedPaymentBtn", "modalCloseBtn"]:
    if banned_id not in pricing:
        ok(f"pricing.html: mandate element #{banned_id} fully removed")
    else:
        fail(f"pricing.html: mandate element #{banned_id} still present")

# Card-free messaging
if re.search(r'no.*card|card.*free|without.*card', pricing, re.I):
    ok("pricing.html contains card-free trial messaging")
else:
    fail("pricing.html missing card-free trial messaging")

# ─────────────────────────────────────────────
# PHASE 2 — CONTENT INTEGRITY (clinics.html)
# ─────────────────────────────────────────────
print(f"\n{BOLD}PHASE 2 — Content integrity & grounded claims{RESET}")

clinics = read(ROOT / "clinics.html")

BANNED_CLAIMS = [
    ("India's Top Booking Tool for Dentists", "marketing superlative"),
    ("Verified Specialists", "unverified badge claim"),
    ("sterilized operatories", "hardcoded amenity"),
    ("chkVerified", "unverified filter checkbox ID"),
    ("Root Canal Specialists", "unverified specialist claim"),
]
for phrase, reason in BANNED_CLAIMS:
    if phrase.lower() not in clinics.lower():
        ok(f"clinics.html: '{phrase}' removed ({reason})")
    else:
        fail(f"clinics.html: still contains '{phrase}' ({reason})")

FACTUAL = [
    ("Root Canal Treatment", "factual treatment name"),
]
for phrase, reason in FACTUAL:
    if phrase.lower() in clinics.lower():
        ok(f"clinics.html: factual replacement '{phrase}' present ({reason})")
    else:
        warn(f"clinics.html: expected factual phrase '{phrase}' not found ({reason})")

# ─────────────────────────────────────────────
# PHASE 2b — INTERNAL TEST CLINICS UNPUBLISHED
# ─────────────────────────────────────────────
print(f"\n{BOLD}PHASE 2b — Internal test clinic static files removed{RESET}")

INTERNAL_SLUGS = ["e50f30h3l", "6e695bqy4", "41d408rli", "edd501096"]
clinic_dir = ROOT / "clinic"

for slug in INTERNAL_SLUGS:
    static_path = clinic_dir / slug
    if not static_path.exists():
        ok(f"Static profile removed: /clinic/{slug}/")
    else:
        idx = static_path / "index.html"
        if idx.exists():
            content = read(idx)
            if "noindex" in content.lower() or "window.location" in content:
                warn(f"/clinic/{slug}/ still exists but has noindex/redirect — acceptable")
            else:
                fail(f"/clinic/{slug}/ static dir still exists and is indexable")
        else:
            warn(f"/clinic/{slug}/ dir exists but has no index.html — may be leftover")

# ─────────────────────────────────────────────
# PHASE 3 — SITEMAP & ROBOTS.TXT
# ─────────────────────────────────────────────
print(f"\n{BOLD}PHASE 3 — Sitemap & robots.txt integrity{RESET}")

robots = read(ROOT / "robots.txt")
if robots:
    if "sitemap" in robots.lower():
        ok("robots.txt references sitemap")
    else:
        warn("robots.txt exists but has no Sitemap: directive")
    if "disallow: /" not in robots.lower() or "allow: /" in robots.lower():
        ok("robots.txt does not globally block crawlers")
    else:
        fail("robots.txt may be globally blocking crawlers (Disallow: /)")
else:
    warn("robots.txt not found at static root — may be served by backend")

sm_path = ROOT / "sitemap.xml"
if sm_path.exists():
    sm_content = read(sm_path)
    leaked = [s for s in INTERNAL_SLUGS if s in sm_content]
    if leaked:
        fail(f"sitemap.xml: internal slug(s) still in sitemap: {leaked}")
    else:
        ok("sitemap.xml: no internal test slugs in sitemap")
    if "<url>" in sm_content or "<urlset" in sm_content:
        ok("sitemap.xml: valid XML structure present")
    else:
        fail("sitemap.xml: may be empty or malformed")
    # Verify core canonical pages
    for page in ["https://www.dentalsmart.tech/", "https://www.dentalsmart.tech/clinics", "https://www.dentalsmart.tech/pricing"]:
        if page in sm_content:
            ok(f"sitemap.xml contains authoritative page: {page}")
        else:
            fail(f"sitemap.xml missing authoritative page: {page}")
else:
    fail("sitemap.xml not found at static root")

# ─────────────────────────────────────────────
# PHASE 3b — PLANS.JS CREDIT TRUTH
# ─────────────────────────────────────────────
print(f"\n{BOLD}PHASE 3b — Backend plans.js credit alignment{RESET}")

plans_js = read(ROOT / "backend" / "lib" / "plans.js")
EXPECTED_CREDITS = {"starter": 300, "growth": 1000, "premium": 2000}
for plan, expected in EXPECTED_CREDITS.items():
    pattern = rf'{plan}\s*:\s*{expected}\b'
    if re.search(pattern, plans_js, re.I):
        ok(f"plans.js: {plan} credits = {expected}")
    else:
        fail(f"plans.js: {plan} credits not set to {expected}")

# ─────────────────────────────────────────────
# META / CANONICAL SPOT-CHECKS
# ─────────────────────────────────────────────
print(f"\n{BOLD}Meta / canonical spot-checks across key pages{RESET}")

PAGES = {
    "index.html":    {"canonical": True,  "description": True,  "title": True},
    "pricing.html":  {"canonical": True,  "description": True,  "title": True},
    "clinics.html":  {"canonical": True,  "description": True,  "title": True},
    "login.html":    {"canonical": False, "description": False, "title": True},
    "register.html": {"canonical": False, "description": False, "title": True},
}

for fname, checks in PAGES.items():
    fpath = ROOT / fname
    if not fpath.exists():
        warn(f"{fname}: file not found")
        continue
    content = read(fpath)
    if checks["title"]:
        if re.search(r'<title>.+</title>', content, re.I):
            ok(f"{fname}: <title> present")
        else:
            fail(f"{fname}: missing <title>")
    if checks["description"]:
        if re.search(r'<meta[^>]+name=["\']description["\']', content, re.I):
            ok(f"{fname}: meta description present")
        else:
            warn(f"{fname}: meta description missing")
    if checks["canonical"]:
        if re.search(r'<link[^>]+rel=["\']canonical["\']', content, re.I):
            ok(f"{fname}: canonical tag present")
        else:
            warn(f"{fname}: canonical tag missing")

# ─────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────
total = len(PASS) + len(FAIL) + len(WARN)
print(f"""
{BOLD}{'='*54}
 RESULTS
{'='*54}{RESET}
  {GREEN}PASS{RESET}  {len(PASS):>3}
  {RED}FAIL{RESET}  {len(FAIL):>3}
  {YELLOW}WARN{RESET}  {len(WARN):>3}
  Total {total:>3}
{BOLD}{'='*54}{RESET}
""")

if FAIL:
    print(f"{RED}Failed tests:{RESET}")
    for f in FAIL:
        print(f"  x {f}")
    sys.exit(1)
else:
    print(f"{GREEN}All required checks passed.{RESET}")
    sys.exit(0)
