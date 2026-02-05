"""Browser automation and session management."""

import asyncio
import zendriver as zd
from fake_useragent import UserAgent

from src.config import CHROME_PATH, TARGET_URL, BROWSER_ARGS, BROWSER_NAVIGATION_TIMEOUT, BROWSER_WAIT_TIMEOUT


class BrowserManager:
    """Manages browser sessions for token generation."""
    
    def __init__(self):
        self.ua = UserAgent(browsers="Chrome")
        self.browser = None
        self.tab = None
    
    async def create_session(self):
        """
        Create a fresh browser session with anti-detection features.
        
        Returns:
            tuple: (browser, tab) instances
        """
        browser_args = BROWSER_ARGS.copy()
        browser_args.append(f"--user-agent={self.ua.random}")
        
        self.browser = await zd.start(
            browser_executable_path=CHROME_PATH,
            sandbox=False,
            browser_args=browser_args,
        )

        self.tab = await self.browser.get(TARGET_URL)
        await asyncio.sleep(BROWSER_WAIT_TIMEOUT)

        return self.browser, self.tab
    
    async def navigate_to_url(self, url: str, wait_load: bool = True):
        """
        Navigate to a specific URL.
        
        Args:
            url: Target URL to navigate to
            wait_load: Whether to wait for navigation timeout (default: True)
        """
        if not self.tab:
            raise RuntimeError("Browser session not initialized")
        
        await self.tab.get(url)
        if wait_load:
            await asyncio.sleep(BROWSER_NAVIGATION_TIMEOUT)
    
    async def execute_script(self, script: str):
        """
        Execute JavaScript in the browser context.
        
        Args:
            script: JavaScript code to execute
            
        Returns:
            Result of script execution
            
        Raises:
            RuntimeError: If browser session not initialized or connection broken
        """
        if not self.tab:
            raise RuntimeError("Browser session not initialized")
        
        try:
            return await self.tab.evaluate(script)
        except Exception as e:
            # Check if it's a connection error
            error_msg = str(e).lower()
            if 'close frame' in error_msg or 'connection' in error_msg or 'websocket' in error_msg:
                raise RuntimeError(f"Browser connection lost: {e}")
            raise
    
    async def close(self):
        """Close the browser session and clean up resources."""
        if self.browser:
            try:
                # Clear references first
                tab = self.tab
                browser = self.browser
                self.tab = None
                self.browser = None
                
                # Close tab if it exists
                if tab:
                    try:
                        await tab.close()
                    except:
                        pass  # Ignore errors closing tab
                
                # Delay before stopping browser
                await asyncio.sleep(0.5)
                
                # Stop the browser
                await browser.stop()
                
                # IMPORTANT: Longer delay to ensure full cleanup before next browser starts
                await asyncio.sleep(2)
                
            except Exception as e:
                print(f"[BrowserManager] Error during browser close: {e}")
            finally:
                self.browser = None
                self.tab = None
