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
PORT = 8765
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


async def main():
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", HOST],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        wait_for_server()
        errors = []
        console_errors = []
        async with async_playwright() as playwright:
            system_chromium = Path("/usr/bin/chromium")
            launch_options = {
                "headless": True,
                "args": ["--no-sandbox", "--disable-dev-shm-usage"],
            }
            if system_chromium.exists():
                launch_options["executable_path"] = str(system_chromium)
            browser = await playwright.chromium.launch(**launch_options)
            context = await browser.new_context(
                viewport={"width": 390, "height": 844},
                locale="zh-CN",
                service_workers="block",
            )
            page = await context.new_page()
            page.set_default_timeout(12000)
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on(
                "console",
                lambda message: console_errors.append(message.text)
                if message.type == "error"
                else None,
            )

            await page.goto(f"{BASE}?sensory-smoke={int(time.time())}", wait_until="domcontentloaded")
            await page.wait_for_timeout(1500)
            if await page.locator("#splashScreen:not(.hidden)").count():
                await page.locator("#splashScreen").click()
                await page.wait_for_timeout(700)
            await page.locator("#testBtn").click()
            await page.wait_for_selector("#appShell:not(.hidden)")
            await page.locator('[data-page-target="sensory"]').click()

            mode_panel = page.locator('.v095-sensory-modes[data-mode-version="professional-v2"]')
            await mode_panel.wait_for(state="visible")
            labels = await mode_panel.locator("button > strong").all_text_contents()
            subtitles = await mode_panel.locator("button > small").all_text_contents()
            assert labels == ["专业品鉴", "玩家互动品鉴", "札记"], labels
            assert subtitles == [
                "专业杯测品鉴 / 雷达图 / 札记",
                "风味互动 / 札记",
                "自然语言记录，评分",
            ], subtitles
            assert await page.get_by_text("雷达图 / 互动品鉴 / 札记", exact=True).count() == 0

            await mode_panel.locator('[data-v095-mode="professional"]').click()
            professional_overlay = page.locator(".v095-professional-overlay")
            await professional_overlay.wait_for(state="visible")
            professional_text = await professional_overlay.inner_text()
            assert "干香 / 湿香" in professional_text
            assert "排序靠前的标签代表强度更高" in professional_text
            assert await professional_overlay.locator("[data-cata-tag]").count() > 10
            await page.locator("[data-pro-cancel]").click()
            await page.wait_for_selector('.v095-sensory-modes[data-mode-version="professional-v2"]')

            await page.locator('[data-v095-mode="player"]').click()
            await page.wait_for_selector(".sensory-evaluation")
            assert await page.locator("#nextSensoryNodeBtn").count() == 1
            await page.locator("#cancelEvaluationBtn").click()
            await page.wait_for_selector('.v095-sensory-modes[data-mode-version="professional-v2"]')

            await page.locator('[data-v095-mode="note"]').click()
            await page.wait_for_selector("#sensoryDeltaWheel", state="visible")
            assert not await page.locator("html").evaluate("node => node.classList.contains('v095-native-bypass')")
            await page.locator("#nextSensoryNodeBtn").click()
            await page.wait_for_selector("#sensoryNaturalNote", state="visible")

            await page.screenshot(path=str(ROOT / "docs" / "smoke-sensory-modes.png"), full_page=True)
            await browser.close()

        if errors:
            raise AssertionError(f"page errors: {errors}")
        if console_errors:
            raise AssertionError(f"console errors: {console_errors}")
        print("sensory modes browser smoke passed")
    finally:
        server.terminate()
        with contextlib.suppress(subprocess.TimeoutExpired):
            server.wait(timeout=3)
        if server.poll() is None:
            server.kill()


if __name__ == "__main__":
    asyncio.run(main())
