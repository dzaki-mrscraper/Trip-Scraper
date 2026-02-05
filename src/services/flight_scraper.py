"""Flight scraper service for Trip.com API."""

import json
import asyncio
from typing import Dict, Any, Optional

from src.core.browser_manager import BrowserManager
from src.services.cookie_extractor import CookieExtractor
from src.services.flight_url_parser import FlightSearchURLParser
from src.services.ubt_manager import UBTManager
from src.services.w_payload_service import generate_w_payload
from src.services.x_ctx_service import generate_x_ctx_header
from src.models.w_payload_models import WPayload


class FlightScraper:
    """Main service for scraping Trip.com flight search API."""
    
    def __init__(self):
        self.browser_manager = None
        self.cookie_extractor = None
    
    async def scrape_flights(self, url: str) -> Dict[str, Any]:
        """
        Scrape flight data from Trip.com.
        
        Args:
            url: Trip.com flight search URL
            
        Returns:
            Dictionary containing flight results
        """
        try:
            # Step 1: Parse URL
            print(f"[FlightScraper] Parsing URL: {url}")
            parsed = FlightSearchURLParser.parse_url(url)
            
            # Step 2: Initialize browser
            print(f"[FlightScraper] Initializing browser...")
            self.browser_manager = BrowserManager()
            await self.browser_manager.create_session()
            
            # Step 3: Extract cookies from hostname
            self.cookie_extractor = CookieExtractor(self.browser_manager)
            cookies = await self.cookie_extractor.get_cookies_from_hostname(
                hostname=parsed['hostname'],
                region=parsed['region'],
                locale=parsed['params']['locale'],
                currency=parsed['params']['curr']
            )
            
            # Step 4: Navigate to search URL
            print(f"[FlightScraper] Navigating to search URL...")
            await self.browser_manager.navigate_to_url(url)
            await asyncio.sleep(5)
            
            # Step 5: Extract tokens from browser
            print(f"[FlightScraper] Extracting tokens...")
            tokens = await self._extract_tokens(parsed, cookies)
            
            # Step 6: Build request payload
            print(f"[FlightScraper] Building request payload...")
            payload = self._build_flight_search_payload(parsed, cookies, tokens)
            
            # Step 7: Build headers
            print(f"[FlightScraper] Building headers...")
            headers = self._build_request_headers(parsed, cookies, tokens)
            
            # Step 8: Make API request via browser
            print(f"[FlightScraper] Making API request...")
            response = await self._make_api_request(
                parsed['hostname'],
                payload,
                headers,
                cookies
            )
            
            return {
                'status': 'success',
                'data': response,
                'tokens': tokens,
            }
        
        finally:
            if self.browser_manager:
                await self.browser_manager.close()
    
    async def _extract_tokens(self, parsed: Dict[str, Any], cookies: Dict[str, Any]) -> Dict[str, str]:
        """Extract all required tokens from browser."""
        ubt_manager = UBTManager(cookies)
        batch_id = ubt_manager.get_batch_id()
        
        # Build payload for token generation
        token_payload = self._build_token_payload(parsed, cookies, batch_id)
        
        # Extract signature token from browser
        input_token = json.dumps(token_payload)
        signature_script = f"""
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
        
        signature = await self.browser_manager.execute_script(signature_script)
        
        # Generate W payload
        w_payload_dict, w_payload_md5 = generate_w_payload(token_payload)
        
        # Extract w-payload-source from browser
        w_payload_script = f"""
        (() => {{
            try {{
                return window.c_sign.toString({json.dumps(w_payload_md5)});
            }} catch (e) {{
                return "ERROR: " + e.toString();
            }}
        }})()
        """
        
        w_payload_source = await self.browser_manager.execute_script(w_payload_script)
        
        # Generate X-CTX header
        x_ctx = generate_x_ctx_header(token_payload)
        
        # Extract main token from browser
        token_script = """
        (() => {
            try {
                // Try to get token from various possible locations
                if (window.__token) return window.__token;
                if (window.token) return window.token;
                if (window._token) return window._token;
                
                // Try to get from local storage
                const tokenFromStorage = localStorage.getItem('token') || localStorage.getItem('__token');
                if (tokenFromStorage) return tokenFromStorage;
                
                return "TOKEN_NOT_FOUND";
            } catch (e) {
                return "ERROR: " + e.toString();
            }
        })()
        """
        
        main_token = await self.browser_manager.execute_script(token_script)
        
        return {
            'signature': signature,
            'w_payload_source': w_payload_source,
            'x_ctx_wclient_req': x_ctx,
            'token': main_token,
            'batch_id': batch_id,
        }
    
    def _build_token_payload(self, parsed: Dict[str, Any], cookies: Dict[str, Any], batch_id: str) -> Dict[str, Any]:
        """Build payload for token generation."""
        params = parsed['params']
        ubt_manager = UBTManager(cookies)
        
        journey_infos = FlightSearchURLParser.build_journey_info(params)
        trip_type = FlightSearchURLParser.get_trip_type_code(params['triptype'])
        cabin_class = FlightSearchURLParser.get_cabin_class_code(params['class'])
        
        return {
            'mode': 0,
            'searchCriteria': {
                'grade': 3,
                'realGrade': cabin_class,
                'tripType': trip_type,
                'journeyNo': 1,
                'passengerInfoType': {
                    'adultCount': params['quantity'],
                    'childCount': params['childqty'],
                    'infantCount': params['babyqty'],
                },
                'journeyInfoTypes': journey_infos,
                'policyId': None,
            },
            'sortInfoType': {
                'direction': True,
                'orderBy': 'Direct',
                'topList': [],
            },
            'tagList': [],
            'flagList': ['NEED_RESET_SORT'],
            'filterType': {
                'filterFlagTypes': [],
                'queryItemSettings': [],
                'studentsSelectedStatus': True,
            },
            'abtList': [
                {'abCode': '250811_IBU_wjrankol', 'abVersion': 'A'},
                {'abCode': '250806_IBU_FiltersOpt', 'abVersion': 'A'},
                {'abCode': '250812_IBU_FiltersOp2', 'abVersion': 'A'},
                {'abCode': '251023_IBU_pricetool', 'abVersion': 'D'},
            ],
            'head': {
                'cid': cookies.get('GUID', ''),
                'ctok': '',
                'cver': '3',
                'lang': '01',
                'sid': '8888',
                'syscode': '40',
                'auth': '',
                'xsid': '',
                'extension': ubt_manager.build_extension_list(params, batch_id),
                'Locale': params['locale'],
                'Language': params['locale'].split('-')[0],
                'Currency': params['curr'],
                'ClientID': '',
                'appid': '700020',
            },
        }
    
    def _build_flight_search_payload(self, parsed: Dict[str, Any], cookies: Dict[str, Any], tokens: Dict[str, str]) -> Dict[str, Any]:
        """Build full flight search payload."""
        return self._build_token_payload(parsed, cookies, tokens['batch_id'])
    
    def _build_request_headers(self, parsed: Dict[str, Any], cookies: Dict[str, Any], tokens: Dict[str, str]) -> Dict[str, str]:
        """Build all request headers."""
        params = parsed['params']
        ubt_manager = UBTManager(cookies)
        cookie_header = self.cookie_extractor.get_cookie_header(cookies)
        
        headers = {
            'accept': 'text/event-stream',
            'accept-language': 'en-US,en;q=0.9',
            'content-type': 'application/json; charset=utf-8',
            'cookie': cookie_header,
            'cookieorigin': f"https://{parsed['hostname']}",
            'currency': params['curr'].upper(),
            'locale': params['locale'],
            'origin': f"https://{parsed['hostname']}",
            'priority': 'u=1, i',
            'referer': parsed['url'],
            'token': tokens.get('token', ''),
            'w-payload-source': tokens['w_payload_source'],
            'x-ctx-country': parsed['region'].upper(),
            'x-ctx-currency': params['curr'].upper(),
            'x-ctx-locale': params['locale'],
            'x-ctx-wclient-req': tokens['x_ctx_wclient_req'],
            **ubt_manager.build_ubt_headers(),
        }
        
        return headers
    
    async def _make_api_request(self, hostname: str, payload: Dict[str, Any], headers: Dict[str, str], cookies: Dict[str, Any]) -> Any:
        """Make API request to FlightListSearchSSE via browser fetch."""
        api_url = f"https://{hostname}/restapi/soa2/27015/FlightListSearchSSE"
        
        # Use browser's fetch API to make the request
        fetch_script = f"""
        (async () => {{
            try {{
                const response = await fetch({json.dumps(api_url)}, {{
                    method: 'POST',
                    headers: {json.dumps(headers)},
                    body: {json.dumps(json.dumps(payload))},
                }});
                
                const text = await response.text();
                return {{
                    status: response.status,
                    statusText: response.statusText,
                    body: text,
                    headers: Object.fromEntries(response.headers.entries())
                }};
            }} catch (error) {{
                return {{
                    error: error.toString(),
                    stack: error.stack
                }};
            }}
        }})()
        """
        
        result = await self.browser_manager.execute_script(fetch_script)
        
        # Parse SSE response
        if 'body' in result:
            return self._parse_sse_response(result['body'])
        else:
            raise Exception(f"API request failed: {result.get('error', 'Unknown error')}")
    
    def _parse_sse_response(self, sse_text: str) -> Dict[str, Any]:
        """Parse Server-Sent Events response."""
        events = []
        current_event = {}
        
        for line in sse_text.split('\n'):
            line = line.strip()
            
            if not line:
                if current_event:
                    events.append(current_event)
                    current_event = {}
                continue
            
            if line.startswith('event:'):
                current_event['event'] = line[6:].strip()
            elif line.startswith('data:'):
                data_str = line[5:].strip()
                try:
                    current_event['data'] = json.loads(data_str)
                except:
                    current_event['data'] = data_str
        
        if current_event:
            events.append(current_event)
        
        return {
            'events': events,
            'raw': sse_text,
        }
