import asyncio
import contextlib
import socket
import subprocess
import sys
import time
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = 8766
BASE = f"http://{HOST}:{PORT}/"


def wait_for_server(timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        with contextlib.closing(socket.socket()) as sock:
            sock.settimeout(0.25)
            if sock.connect_ex((HOST, PORT)) == 0:
                return
        time.sleep(0.1)
    raise RuntimeError("local test server did not start")


async def enter_test_app(page):
    await page.goto(f"{BASE}?postbrew-qr={int(time.time())}", wait_until="domcontentloaded")
    await page.wait_for_timeout(1200)
    if await page.locator("#splashScreen:not(.hidden)").count():
        await page.locator("#splashScreen").click(force=True)
        await page.wait_for_timeout(700)
    await page.locator("#testBtn").click()
    await page.wait_for_selector("#appShell:not(.hidden)")


async def main():
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", HOST],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        wait_for_server()
        page_errors = []
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            context = await browser.new_context(
                viewport={"width": 390, "height": 844},
                locale="zh-CN",
                service_workers="block",
            )
            page = await context.new_page()
            page.set_default_timeout(30000)
            page.on("pageerror", lambda error: page_errors.append(str(error)))

            await enter_test_app(page)

            # “三段式” means three total stages, with bloom as stage one.
            await page.locator('[data-page-target="brew"]').click()
            await page.wait_for_selector("#generatePlanBtn")
            await page.locator("#brewProfile").select_option("recommended")
            await page.locator("#brewSegments").select_option("3")
            await page.wait_for_function("document.querySelector('#brewProfile')?.value === 'three-pulse'")
            await page.locator("#generatePlanBtn").click()
            await page.wait_for_selector("#generatedPlan")
            assert await page.locator("#generatedPlan .plan-profile-label").inner_text() == "三段式"
            assert await page.locator("#generatedPlan .plan-stage").count() == 3

            # Exact v17 visual grammar: four phase backgrounds, executable
            # temperature/flow bands, cumulative water, flavor windows and risk guides.
            trajectory = page.locator('#generatedPlan .trajectory-chart.detailed[data-v098-trajectory-model="v17-stage-time-window"]')
            await trajectory.wait_for(state="visible")
            assert await trajectory.locator('.v098-temp-line').count() == 1
            assert await trajectory.locator('.v098-flow-line').count() == 1
            assert await trajectory.locator('.v098-temp-band').count() == 1
            assert await trajectory.locator('.v098-flow-band').count() == 1
            assert await trajectory.locator('.v098-cumulative-line').count() == 1
            assert await trajectory.locator('.v098-flavor-line').count() <= 1
            assert await trajectory.locator('.v098-flavor-window').count() >= 1
            assert await trajectory.locator('.v098-phase-line').count() == 3
            assert await page.locator('#generatedPlan .v098-phase-bar .phase-seg').count() == 4

            # Complete the brew and verify that it lands on the mode selector,
            # not inside any sensory workflow.
            await page.locator("#startBrewBtn").click()
            await page.wait_for_selector("#timerEndBtn")
            await page.locator("#timerEndBtn").click()
            await page.wait_for_selector("#recordConsumptionBtn")
            await page.locator("#recordConsumptionBtn").click()

            mode_panel = page.locator('.v095-sensory-modes[data-mode-version="professional-v2"]')
            await mode_panel.wait_for(state="visible")
            assert await page.locator("#pageSensory.active").count() == 1
            assert await page.locator("#sensoryContent .sensory-evaluation").count() == 0
            assert await mode_panel.locator("button > strong").all_text_contents() == ["专业品鉴", "玩家互动品鉴", "札记"]

            # Open the QR camera UI and verify both FAB taps and automatic capture.
            await page.locator('[data-page-target="beans"]').click()
            await page.locator("#fabAddBtn").click()
            await page.locator('[data-add-mode="qr"]').click()
            await page.wait_for_selector('[data-overlay="camera"] .v095-qr-stage')
            assert await page.locator('.v095-qr-frame').count() == 1
            assert await page.get_by_text("自动捕捉中", exact=True).count() == 1
            help_text = await page.locator('.v095-qr-help').inner_text()
            assert "无需按快门" in help_text
            assert "识别成功后会自动进入豆卡确认" in help_text

            await page.screenshot(path=str(ROOT / "docs" / "smoke-postbrew-qr.png"), full_page=True)
            await browser.close()

        if page_errors:
            raise AssertionError(f"page errors: {page_errors}")
        print("bloom-inclusive three-stage, exact v17 trajectory, post-brew choice and QR auto-capture smoke passed")
    finally:
        server.terminate()
        with contextlib.suppress(subprocess.TimeoutExpired):
            server.wait(timeout=3)
        if server.poll() is None:
            server.kill()


if __name__ == "__main__":
    asyncio.run(main())
