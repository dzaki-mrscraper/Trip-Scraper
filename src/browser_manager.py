"""Browser session management for Trip.com scraper."""

import asyncio
import zendriver as zd
from fake_useragent import UserAgent

TARGET_URL = "https://id.trip.com/flights"
ua = UserAgent(browsers="Chrome")


async def create_fresh_session():
    """
    Create a fresh browser session with zendriver.
    
    Returns:
        tuple: (browser, tab) - Browser instance and main tab
    """
    chrome_path = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"

    browser = await zd.start(
        browser_executable_path=chrome_path,
        sandbox=False,
        browser_args=[
            "--no-sandbox",
            f"--user-agent={ua.random}",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--disable-blink-features=AutomationControlled",
            "--force-dark-mode",
            "--enable-features=WebUIDarkMode",
            "--enable-features=WebContentsForceDark"
        ],
    )

    tab = await browser.get(TARGET_URL)
    await asyncio.sleep(3)

    return browser, tab
