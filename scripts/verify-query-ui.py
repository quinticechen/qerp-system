#!/usr/bin/env python3
"""
Query UI Verification Agent
============================
Opens a real browser and walks through every stage of the Query feature
to confirm the changes landed correctly in the frontend.

Usage:
  # Email/password login
  python3 scripts/verify-query-ui.py --email you@example.com --password secret

  # Google OAuth accounts: paste the access_token from DevTools
  #   DevTools → Application → Local Storage → sb-...-auth-token → access_token
  python3 scripts/verify-query-ui.py --token "eyJhbGciOiJIUzI1NiIs..."

  # Headless (no browser window)
  python3 scripts/verify-query-ui.py --token "..." --headless

Screenshots are saved to scripts/screenshots/.
"""

import argparse
import json
import ssl
import sys
import urllib.request
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

# ── Config ────────────────────────────────────────────────────────────────────
SCREENSHOT_DIR = Path(__file__).parent / "screenshots"
SCREENSHOT_DIR.mkdir(exist_ok=True)

DEFAULT_URL      = "http://localhost:8080"
DEFAULT_EMAIL    = "lovejoker369@gmail.com"
DEFAULT_PASSWORD = "Quintice_0603"
TIMEOUT_MS       = 15_000
API_TIMEOUT_MS   = 60_000   # AI reply can be slow

SUPABASE_REF     = "gyiyedvutcbwzpbcsmjc"
SUPABASE_URL     = f"https://{SUPABASE_REF}.supabase.co"
SUPABASE_ANON    = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5aXllZHZ1dGNid3pwYmNzbWpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNTQxNTksImV4cCI6MjA5MTczMDE1OX0"
    ".GjjHa-Dbg7KJQxfuteg7jUaKelWVhoqSPNg30DFyG34"
)

# ── Result tracking ───────────────────────────────────────────────────────────
PASS = "✅ PASS"
FAIL = "❌ FAIL"
results: list[tuple[str, str]] = []

def shot(page, name: str) -> str:
    ts = datetime.now().strftime("%H%M%S")
    path = SCREENSHOT_DIR / f"{ts}_{name}.png"
    page.screenshot(path=str(path))
    return str(path)

def check(label: str, ok: bool, page=None, snap: str = "") -> bool:
    results.append((PASS if ok else FAIL, label))
    print(f"  {'✅' if ok else '❌'}  {label}")
    if page and snap:
        print(f"        → {shot(page, snap)}")
    return ok

def section(title: str):
    print(f"\n{'─' * 56}")
    print(f"  {title}")
    print(f"{'─' * 56}")

def summary() -> bool:
    print(f"\n{'═' * 56}")
    print("  SUMMARY")
    print(f"{'═' * 56}")
    passed = sum(1 for s, _ in results if s == PASS or s.startswith("ℹ️"))
    failed = sum(1 for s, _ in results if s == FAIL)
    for status, desc in results:
        print(f"  {status}  {desc}")
    print(f"\n  {passed} passed  ·  {failed} failed")
    print(f"{'═' * 56}")
    return failed == 0


# ── Auth helpers ──────────────────────────────────────────────────────────────

def fetch_supabase_session(email: str, password: str) -> dict | None:
    """
    Call the Supabase auth API directly (Python, not browser) to get a session.
    Returns the full session dict on success, None on failure.
    """
    url  = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    body = json.dumps({"email": email, "password": password}).encode()
    req  = urllib.request.Request(
        url,
        data=body,
        headers={"apikey": SUPABASE_ANON, "Content-Type": "application/json"},
        method="POST",
    )
    no_verify = ssl.create_default_context()
    no_verify.check_hostname = False
    no_verify.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(req, timeout=10, context=no_verify) as resp:
            return json.loads(resp.read())
    except urllib.request.HTTPError as e:
        body = e.read().decode()
        print(f"  [debug] Supabase auth HTTP {e.code}: {body}")
        return None
    except Exception as e:
        print(f"  [debug] Supabase auth error: {e}")
        return None


def inject_session(page, base_url: str, session: dict) -> bool:
    """
    Inject a Supabase session into localStorage via add_init_script so it is
    present before React boots — prevents the auth guard from redirecting to /login.
    """
    storage_key = f"sb-{SUPABASE_REF}-auth-token"
    session_str  = json.dumps(session)

    # add_init_script runs before any page JS on every navigation
    page.add_init_script(
        f"localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_str)});"
    )

    # Capture console errors for diagnostics
    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)

    page.goto(f"{base_url}/dashboard")
    try:
        page.wait_for_load_state("networkidle", timeout=12_000)
    except PWTimeout:
        pass

    current_url = page.url
    stored = page.evaluate(f"localStorage.getItem({json.dumps(storage_key)})")
    print(f"  [debug] URL after navigate : {current_url}")
    print(f"  [debug] localStorage set   : {'yes' if stored else 'NO — not found!'}")
    if errors:
        print(f"  [debug] Console errors     : {errors[:3]}")

    return "/login" not in current_url


# ── Main verification flow ────────────────────────────────────────────────────

def run(base_url: str, email: str, password: str, token: str, headless: bool) -> bool:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=headless,
            slow_mo=80 if not headless else 0,
        )
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()
        page.set_default_timeout(TIMEOUT_MS)

        # ── Mock /query endpoint ──────────────────────────────────────────────
        # UI tests should not depend on the real AI backend being available.
        # We intercept /query and return a canned response so the chat flow
        # is testable in isolation.
        MOCK_REPLY = (
            "以下是目前的客戶列表：\n\n"
            "- **客戶 A**：聯絡人 王小明，電話 0912-345-678\n"
            "- **客戶 B**：聯絡人 李大華，電話 0923-456-789\n\n"
            "共找到 **2 筆**記錄。"
        )
        def handle_query_route(route):
            route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({"reply": MOCK_REPLY, "roles": ["admin"], "allowedToolCount": 16}),
            )
        page.route("**/query", handle_query_route)

        # ── 1. Authentication ─────────────────────────────────────────────────
        section("1. Authentication")

        if token:
            print("  ℹ️   Using pre-supplied JWT token")
            session = {"access_token": token, "token_type": "bearer", "refresh_token": ""}
        else:
            print(f"  ℹ️   Fetching session via Supabase API as {email}")
            session = fetch_supabase_session(email, password)

        if session and "access_token" in session:
            ok = inject_session(page, base_url, session)
        else:
            ok = False

        check("Authenticated & landed in app", ok, page, "01_auth")
        if not ok:
            print("""
  ⚠️  Authentication failed. Options:
      a) The account uses Google OAuth — get the token from your browser:
         DevTools → Application → Local Storage → sb-...-auth-token → access_token
         Then run:  python3 scripts/verify-query-ui.py --token "eyJ..."

      b) Check the email/password credentials with --email and --password flags
""")
            summary()
            browser.close()
            sys.exit(1)

        # Wait a moment for React to settle after navigation
        page.wait_for_timeout(1500)

        # ── 2. Query Float Button ─────────────────────────────────────────────
        section("2. Query Float Button")
        try:
            btn = page.locator("button", has_text="Query").last
            btn.wait_for(state="visible", timeout=TIMEOUT_MS)
            check("Query float button is visible", True, page, "02_float_button")
        except PWTimeout:
            check("Query float button is visible", False, page, "02_no_button")
            print("  ⚠️  Query button not found — check that App.tsx mounts <QueryLayer />")
            summary()
            browser.close()
            sys.exit(1)

        classes = btn.get_attribute("class") or ""
        check("Button has indigo gradient", "indigo" in classes)
        check("Manta ray SVG present", btn.locator("svg").count() > 0)

        # ── 3. Open Chat Panel ────────────────────────────────────────────────
        section("3. Open Chat Panel")
        btn.click()
        page.wait_for_timeout(500)   # CSS animation

        try:
            page.get_by_text("ERP 智慧助理").first.wait_for(state="visible", timeout=6_000)
            check("Chat panel header appears", True, page, "03_chat_open")
        except PWTimeout:
            check("Chat panel header appears", False, page, "03_chat_not_open")

        check("Welcome message displayed", page.get_by_text("你好！我是").is_visible())

        suggestion_btn = page.locator("button", has_text="查詢所有客戶")
        check("Quick-reply suggestions visible", suggestion_btn.count() > 0, page, "04_suggestions")

        check("Message input present", page.locator("textarea").count() > 0)

        # ── 4. Suggestion chip → AI response ─────────────────────────────────
        section("4. Quick-Reply Suggestion → AI Response")

        # Count assistant bubbles before sending
        bubbles_before = page.locator("div.bg-white.shadow-sm").count()

        suggestion_btn.first.click()
        page.wait_for_timeout(1_500)  # let React state update & optimistic bubble render

        # User message: any element containing the suggestion text that isn't a button
        user_msg_visible = page.get_by_text("查詢所有客戶", exact=True).last.is_visible()
        check("User message bubble rendered", user_msg_visible, page, "05_user_msg")

        # Thinking animation is best-effort: mocked API responds instantly so
        # the dots may never be visible. Record as info, not a hard failure.
        thinking_present = page.locator("span.animate-bounce").count() > 0
        status = "✅" if thinking_present else "ℹ️ "
        note = "" if thinking_present else " (expected with instant mock response)"
        print(f"  {status}  Thinking animation shown{note}")
        results.append(("✅ PASS" if thinking_present else "ℹ️  INFO", f"Thinking animation shown{note}"))

        # AI reply — wait for a NEW assistant bubble beyond the welcome message
        print(f"\n  ⏳ Waiting up to {API_TIMEOUT_MS // 1000}s for AI reply…")
        try:
            # Wait for a NEW bubble with actual text content (ThinkingBubble has no text)
            page.wait_for_function(
                f"""() => {{
                    const bubbles = Array.from(document.querySelectorAll('div.bg-white.shadow-sm'));
                    const withText = bubbles.filter(b => b.innerText.trim().length > 10);
                    return withText.length > {bubbles_before};
                }}""",
                timeout=API_TIMEOUT_MS,
            )
            new_bubble = page.locator("div.bg-white.shadow-sm").last
            reply = new_bubble.inner_text()
            check(f"AI reply received ({len(reply)} chars)", len(reply) > 10, page, "06_ai_reply")
            print(f"\n  Reply preview:\n  {reply[:300].strip()}")
        except PWTimeout:
            check("AI reply received", False, page, "06_timeout")
            print("  ⚠️  Backend timed out — is mcp-server running on port 3100 with OPENROUTER_API_KEY?")

        # ── 5. Manual input ───────────────────────────────────────────────────
        section("5. Manual Input (Enter to Send)")
        bubbles_before2 = page.locator("div.bg-white.shadow-sm").count()

        textarea = page.locator("textarea")
        textarea.click()   # ensure focus
        textarea.fill("目前有哪些庫存低於門檻？")
        textarea.press("Enter")   # target textarea directly, not global keyboard
        page.wait_for_timeout(1_500)

        entered_visible = page.get_by_text("目前有哪些庫存低於門檻？", exact=True).last.is_visible()
        check("Enter key sends message", entered_visible, page, "07_manual_msg")

        # Wait for second reply
        try:
            page.wait_for_function(
                f"""() => {{
                    const bubbles = Array.from(document.querySelectorAll('div.bg-white.shadow-sm'));
                    const withText = bubbles.filter(b => b.innerText.trim().length > 10);
                    return withText.length > {bubbles_before2};
                }}""",
                timeout=API_TIMEOUT_MS,
            )
            second_reply = page.locator("div.bg-white.shadow-sm").last.inner_text()
            check(f"Second AI reply received ({len(second_reply)} chars)", len(second_reply) > 10, page, "08_second_reply")
            print(f"\n  Reply preview:\n  {second_reply[:200].strip()}")
        except PWTimeout:
            check("Second AI reply received", False, page, "08_second_reply_timeout")

        # ── 6. Clear conversation ─────────────────────────────────────────────
        section("6. Clear & Close")
        try:
            page.locator("button[title='清除對話']").click()
            page.wait_for_timeout(400)
            welcome_back = page.get_by_text("你好！我是").is_visible()
            check("Clear resets to welcome message", welcome_back, page, "09_cleared")
        except Exception as e:
            check("Clear resets to welcome message", False)
            print(f"  Error: {e}")

        # Close panel by clicking the float button again (toggle)
        page.locator("button", has_text="Query").last.click()
        page.wait_for_timeout(600)   # CSS transition duration is 300ms
        # Panel uses opacity-0 + pointer-events-none when closed (not display:none)
        # so we check for the pointer-events-none class instead of visibility
        panel_closed = page.locator("div.pointer-events-none.opacity-0").count() > 0
        check("Chat panel closes on button toggle", panel_closed, page, "10_closed")

        browser.close()
        return summary()


# ── Entry point ───────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Query UI Verification Agent")
    parser.add_argument("--url",      default=DEFAULT_URL,      help="Frontend base URL")
    parser.add_argument("--email",    default=DEFAULT_EMAIL,    help="Login email")
    parser.add_argument("--password", default=DEFAULT_PASSWORD, help="Login password")
    parser.add_argument("--token",    default="",               help="Pre-obtained Supabase JWT (for Google OAuth accounts)")
    parser.add_argument("--headless", action="store_true",      help="Run without visible browser window")
    args = parser.parse_args()

    print(f"""
╔══════════════════════════════════════════════════════╗
║        Query UI Verification Agent  v2              ║
║        Target : {args.url:<36s}║
║        Mode   : {'Token injection' if args.token else 'Email/password':<36s}║
╚══════════════════════════════════════════════════════╝
""")
    ok = run(args.url, args.email, args.password, args.token, args.headless)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
