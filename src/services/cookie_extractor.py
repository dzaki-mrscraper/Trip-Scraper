"""Cookie extraction service for Trip.com scraping."""

import asyncio
import json
from typing import Dict, Any, Optional
from urllib.parse import urlparse
import uuid


class CookieExtractor:
    """Extracts and manages cookies from Trip.com browser sessions."""
    
    def __init__(self, browser_manager):
        self.browser_manager = browser_manager
    
    async def get_cookies_from_hostname(
        self, 
        hostname: str, 
        region: str, 
        locale: str, 
        currency: str
    ) -> Dict[str, Any]:
        """
        Visit hostname root to get initial cookies (equivalent to getWithRedirects in dump.ts).
        
        Args:
            hostname: Trip.com hostname (e.g., 'id.trip.com')
            region: Region code (e.g., 'id', 'vn')
            locale: Locale code (e.g., 'en-ID')
            currency: Currency code (e.g., 'IDR')
            
        Returns:
            Dictionary containing cookies and headers
        """
        root_url = f"https://{hostname}"
        
        print(f"[CookieExtractor] Visiting root URL: {root_url}")
        
        # Navigate to root to get cookies
        await self.browser_manager.navigate_to_url(root_url)
        await asyncio.sleep(3)
        
        # Extract cookies from browser
        cookies_script = """
        (() => {
            const cookies = {};
            document.cookie.split(';').forEach(cookie => {
                const [name, value] = cookie.trim().split('=');
                if (name && value) {
                    cookies[name] = decodeURIComponent(value);
                }
            });
            return cookies;
        })()
        """
        
        browser_cookies = await self.browser_manager.execute_script(cookies_script)
        
        # Extract important cookies
        cookies = {}
        
        # GUID - User identifier
        if 'GUID' in browser_cookies:
            cookies['GUID'] = browser_cookies['GUID']
        else:
            # Generate if not present
            cookies['GUID'] = self._generate_guid()
        
        # UBT_VID - User behavior tracking visitor ID
        if 'UBT_VID' in browser_cookies:
            cookies['UBT_VID'] = browser_cookies['UBT_VID']
        else:
            # Generate format: timestamp.randomstring
            import time
            timestamp = int(time.time() * 1000)
            random_str = uuid.uuid4().hex[:12]
            cookies['UBT_VID'] = f"{timestamp}.{random_str}"
        
        # _combined cookie parsing
        if '_combined' in browser_cookies:
            combined_value = browser_cookies['_combined']
            cookies['_combined'] = self._parse_combined_cookie(combined_value)
        else:
            cookies['_combined'] = self._generate_combined_cookie()
        
        # Other important cookies
        important_cookies = [
            'ibusite', 'ibugroup', 'ibu_country', 'ibu_cookie_strict',
            'ibulanguage', 'ibulocale', 'cookiePricesDisplayed',
            '_RGUID', '_RSG', '_RDG', '_RF1', 'ibu_flt_pref_cfg'
        ]
        
        for cookie_name in important_cookies:
            if cookie_name in browser_cookies:
                cookies[cookie_name] = browser_cookies[cookie_name]
        
        # Generate _abtest_userid if not present
        if '_abtest_userid' not in browser_cookies:
            cookies['_abtest_userid'] = str(uuid.uuid4())
        else:
            cookies['_abtest_userid'] = browser_cookies['_abtest_userid']
        
        # Build headers
        headers = {
            'x-ctx-country': region.upper(),
            'x-ctx-currency': currency.upper(),
            'x-ctx-locale': locale,
            'x-ctx-ubt-pageid': cookies['_combined'].get('pageId', '10320667452'),
            'x-ctx-ubt-pvid': '1',
            'x-ctx-ubt-sid': '1',
            'x-ctx-ubt-vid': cookies.get('UBT_VID', ''),
            'x-ctx-user-recognize': 'NON_EU',
        }
        
        print(f"[CookieExtractor] Extracted cookies: GUID={cookies.get('GUID', 'N/A')}, UBT_VID={cookies.get('UBT_VID', 'N/A')}")
        
        return {
            **cookies,
            'headers': headers,
            'allCookies': browser_cookies,
        }
    
    def _generate_guid(self) -> str:
        """Generate GUID format: 14 digits."""
        import random
        return ''.join([str(random.randint(0, 9)) for _ in range(14)])
    
    def _parse_combined_cookie(self, combined_value: str) -> Dict[str, str]:
        """Parse _combined cookie value."""
        from urllib.parse import unquote
        
        decoded = unquote(combined_value)
        parts = decoded.split('&')
        
        result = {}
        for part in parts:
            if '=' in part:
                key, value = part.split('=', 1)
                result[key] = value
        
        return result
    
    def _generate_combined_cookie(self) -> Dict[str, str]:
        """Generate _combined cookie if not present."""
        import time
        from datetime import datetime
        
        now = datetime.now()
        timestamp = now.strftime('%Y%m%d%H%M%S%f')[:-3]  # YYYYMMDDHHMMSSmmm
        transaction_id = f"1-mf-{timestamp}-WEB"
        page_id = '10320667452'
        
        return {
            'transactionId': transaction_id,
            'pageId': page_id,
            'initPageId': page_id,
            'usedistributionchannels': 'False',
        }
    
    def get_cookie_header(self, cookies: Dict[str, Any]) -> str:
        """
        Build Cookie header string from cookies dict.
        
        Args:
            cookies: Dictionary of cookies
            
        Returns:
            Cookie header string
        """
        cookie_parts = []
        
        # Add simple cookies
        simple_cookies = ['GUID', 'UBT_VID', '_abtest_userid', '_RGUID', 
                         'ibusite', 'ibugroup', 'ibu_country', 'ibulanguage',
                         'ibulocale', 'cookiePricesDisplayed', '_RF1',
                         'ibu_flt_pref_cfg']
        
        for name in simple_cookies:
            if name in cookies and cookies[name]:
                cookie_parts.append(f"{name}={cookies[name]}")
        
        # Add _combined cookie
        if '_combined' in cookies:
            combined = cookies['_combined']
            if isinstance(combined, dict):
                # Rebuild _combined string
                from urllib.parse import quote
                raw = '&'.join([f"{k}={v}" for k, v in combined.items()])
                encoded = quote(raw, safe='')
                cookie_parts.append(f"_combined={encoded}")
            else:
                cookie_parts.append(f"_combined={combined}")
        
        return '; '.join(cookie_parts)
