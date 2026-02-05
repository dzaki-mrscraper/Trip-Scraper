"""Core token generation logic."""

import json
import asyncio

from src.core.browser_manager import BrowserManager
from src.services.url_builder import build_flight_url
from src.services.w_payload_service import generate_w_payload
from src.services.x_ctx_service import generate_x_ctx_header


class TokenGenerator:
    """Handles generation of all required tokens."""
    
    def __init__(self):
        self.browser_manager = BrowserManager()
    
    async def generate_tokens(self, data: dict) -> dict:
        """
        Generate all required tokens for Trip.com API.
        
        Args:
            data: Request payload containing flight search parameters
            
        Returns:
            dict: Contains signature, w_payload_source, and x_ctx_wclient_req
        """
        browser = None
        
        try:
            # Create browser session
            browser, tab = await self.browser_manager.create_session()
            
            # Build and navigate to URL
            url = build_flight_url(data)
            await self.browser_manager.navigate_to_url(url)
            
            # Generate signature token
            signature = await self._generate_signature(data)
            
            # Generate W payload
            w_payload_dict, w_payload_md5 = generate_w_payload(data)
            w_payload_source = await self._generate_w_payload_source(w_payload_md5)
            
            # Generate X-CTX header
            x_ctx = generate_x_ctx_header(data)
            
            return {
                "signature": signature,
                "w_payload_source": w_payload_source,
                "x_ctx_wclient_req": x_ctx
            }
        
        finally:
            if browser:
                await self.browser_manager.close()
    
    async def _generate_signature(self, data: dict) -> str:
        """
        Generate signature token using browser JavaScript execution.
        
        Args:
            data: Request payload
            
        Returns:
            Signature token string
        """
        input_token = json.dumps(data)
        
        script = f"""
        (() => {{
            try {{
                if (typeof window.signature === 'function') {{
                    return window.signature({input_token});
                }} else {{
                    return "ERROR: window.signature not found";
                }}
            }} catch (err) {{
                return "ERROR: " + err.toString();
            }}
        }})()
        """
        
        return await self.browser_manager.execute_script(script)
    
    async def _generate_w_payload_source(self, w_payload_md5: str) -> str:
        """
        Generate W payload source using browser JavaScript execution.
        
        Args:
            w_payload_md5: MD5 hash of W payload
            
        Returns:
            W payload source string
        """
        script = f"""
        (() => {{
            try {{
                return window.c_sign.toString({json.dumps(w_payload_md5)});
            }} catch (e) {{
                return "ERROR: " + e.toString();
            }}
        }})()
        """
        
        return await self.browser_manager.execute_script(script)
