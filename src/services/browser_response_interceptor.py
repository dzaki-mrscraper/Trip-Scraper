"""Browser response interceptor for capturing FlightListSearchSSE responses."""

import asyncio
import json
from typing import Dict, Any, Optional, List
import base64


class BrowserResponseInterceptor:
    """Intercepts network responses in browser to capture FlightListSearchSSE data."""
    
    def __init__(self, browser_manager):
        self.browser_manager = browser_manager
        self.flight_data = None
        self.response_captured = False
        self.captured_responses = []
        self.request_id_map = {}
    
    async def intercept_flight_search_response(self, url: str, timeout: int = 90) -> Dict[str, Any]:
        """
        Open URL in browser and intercept FlightListSearchSSE response.
        
        Args:
            url: Trip.com flight search URL
            timeout: Maximum wait time in seconds (default: 90)
            
        Returns:
            Dictionary containing intercepted flight data
            
        Raises:
            TimeoutError: If response not captured within timeout period
            Exception: For other errors during interception
        """
        print(f"[BrowserResponseInterceptor] Opening URL: {url}")
        
        # Reset interceptor state for new request
        self.flight_data = None
        self.response_captured = False
        self.captured_responses = []
        self.request_id_map = {}
        
        # Navigate to URL first
        print(f"[BrowserResponseInterceptor] Navigating to URL...") 
        tab = self.browser_manager.tab
        await tab.get(url)
        
        # Wait a bit for page to start loading
        await asyncio.sleep(1)
        
        # Inject interceptor ASAP after navigation but before page fully loads
        print(f"[BrowserResponseInterceptor] Injecting interceptor on new page...")
        await self._setup_js_interception()
        
        # Wait for page to fully load and make API requests
        print(f"[BrowserResponseInterceptor] Waiting for API requests...")
        await asyncio.sleep(3)
        
        # Wait for FlightListSearchSSE response
        print(f"[BrowserResponseInterceptor] Waiting for FlightListSearchSSE response...")
        await self._wait_for_response(timeout)
        
        if not self.flight_data:
            raise Exception("Failed to capture FlightListSearchSSE response")
        
        print(f"[BrowserResponseInterceptor] Successfully captured response")
        return self.flight_data
    
    async def _setup_cdp_interception(self):
        """Setup CDP network interception for capturing responses."""
        try:
            # Access the CDP session via browser tab
            tab = self.browser_manager.tab
            
            # Enable network tracking
            await tab.send("Network.enable")
            print(f"[BrowserResponseInterceptor] CDP Network domain enabled")
            
            # Note: zendriver's event handling is different from playwright
            # For now, we'll rely on JavaScript interception which is more reliable
            # TODO: Implement proper zendriver CDP event handling
            
            print(f"[BrowserResponseInterceptor] CDP tracking enabled (using JS fallback for events)")
            
        except Exception as e:
            print(f"[BrowserResponseInterceptor] CDP setup failed: {e}, using JS interception")
    
    async def _setup_js_interception(self):
        """Setup JavaScript-based interception with Stream Support."""
        enable_script = """
        (() => {
            // Always reset for fresh state
            window._flightSearchResponses = [];
            window._allRequests = [];
            window._interceptorsActive = true;
            
            const decoder = new TextDecoder("utf-8");

            // INTERCEPT FETCH (Trip.com uses this for API requests)
            const originalFetch = window.fetch;
            window.fetch = async function(...args) {
                const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
                
                // Log ALL requests for debugging
                window._allRequests.push({
                    url: url,
                    timestamp: Date.now(),
                    method: 'fetch'
                });
                console.log('[Interceptor] Fetch request:', url);
                
                const response = await originalFetch.apply(this, args);
                
                if (url && url.includes('FlightListSearchSSE')) {
                    console.log('[Interceptor] ✓ MATCHED FlightListSearchSSE request!');
                    
                    // Clone response to avoid disrupting original flow
                    const clonedResponse = response.clone();
                    
                    // Read stream in background (non-blocking)
                    (async () => {
                        try {
                            const reader = clonedResponse.body.getReader();
                            let fullBody = "";
                            
                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;
                                
                                // Decode chunk data
                                const chunk = decoder.decode(value, {stream: true});
                                fullBody += chunk;
                                
                                // Update or create entry in global array
                                const existingIndex = window._flightSearchResponses.findIndex(r => r.url === url);
                                const entry = {
                                    url: url,
                                    status: response.status,
                                    statusText: response.statusText,
                                    body: fullBody,
                                    timestamp: Date.now(),
                                    type: 'fetch_stream',
                                    isComplete: false
                                };
                                
                                if (existingIndex >= 0) {
                                    window._flightSearchResponses[existingIndex] = entry;
                                } else {
                                    window._flightSearchResponses.push(entry);
                                }
                                
                                console.log('[Interceptor] Stream chunk received, total size:', fullBody.length);
                            }
                            
                            // Mark as complete
                            const finalIndex = window._flightSearchResponses.findIndex(r => r.url === url);
                            if (finalIndex >= 0) {
                                window._flightSearchResponses[finalIndex].isComplete = true;
                                console.log('[Interceptor] ✓ Stream complete. Total size:', window._flightSearchResponses[finalIndex].body.length);
                            }
                            
                        } catch (err) {
                            console.error("[Interceptor] Stream reading error:", err);
                        }
                    })();
                }
                
                return response;
            };
            
            // INTERCEPT XMLHttpRequest (Backup method)
            const XHR = XMLHttpRequest.prototype;
            const originalOpen = XHR.open;
            const originalSend = XHR.send;
            
            XHR.open = function(method, url, ...args) {
                this._url = url;
                this._method = method;
                
                // Log ALL requests for debugging
                window._allRequests.push({
                    url: url,
                    timestamp: Date.now(),
                    method: 'xhr'
                });
                console.log('[Interceptor] XHR request:', url);
                
                return originalOpen.call(this, method, url, ...args);
            };
            
            XHR.send = function(...args) {
                this.addEventListener('load', function() {
                    if (this._url && this._url.includes('FlightListSearchSSE')) {
                        console.log('[XHR-Interceptor] ✓ MATCHED FlightListSearchSSE!');
                        window._flightSearchResponses.push({
                            url: this._url,
                            method: this._method,
                            status: this.status,
                            statusText: this.statusText,
                            body: this.responseText,
                            timestamp: Date.now(),
                            type: 'xhr',
                            isComplete: true
                        });
                        console.log('[XHR-Interceptor] Captured, size:', this.responseText.length);
                    }
                });
                return originalSend.call(this, ...args);
            };
            
            console.log('[Interceptor] ✓ Setup complete - monitoring ALL requests');
            return 'JS Stream Interceptor Active';
        })()
        """
        
        result = await self.browser_manager.execute_script(enable_script)
        print(f"[BrowserResponseInterceptor] {result}")

    async def _on_response_received(self, event):
        """Handle Network.responseReceived CDP event."""
        try:
            response = event.get('response', {})
            url = response.get('url', '')
            request_id = event.get('requestId')
            
            if 'FlightListSearchSSE' in url:
                print(f"[BrowserResponseInterceptor] Detected FlightListSearchSSE request: {request_id}")
                self.request_id_map[request_id] = {
                    'url': url,
                    'status': response.get('status'),
                    'statusText': response.get('statusText'),
                    'headers': response.get('headers', {}),
                    'mimeType': response.get('mimeType', ''),
                    'timestamp': event.get('timestamp')
                }
        except Exception as e:
            print(f"[BrowserResponseInterceptor] Error in _on_response_received: {e}")
    
    async def _on_loading_finished(self, event):
        """Handle Network.loadingFinished CDP event."""
        try:
            request_id = event.get('requestId')
            
            if request_id in self.request_id_map:
                print(f"[BrowserResponseInterceptor] Loading finished for FlightListSearchSSE: {request_id}")
                
                # Get response body
                try:
                    tab = self.browser_manager.tab
                    result = await tab.send("Network.getResponseBody", {"requestId": request_id})
                    
                    body = result.get('body', '')
                    is_base64 = result.get('base64Encoded', False)
                    
                    if is_base64:
                        body = base64.b64decode(body).decode('utf-8', errors='ignore')
                    
                    response_info = self.request_id_map[request_id]
                    response_info['body'] = body
                    
                    self.captured_responses.append(response_info)
                    print(f"[BrowserResponseInterceptor] ✓ CDP captured response body (length: {len(body)} bytes)") 
                    
                except Exception as e:
                    print(f"[BrowserResponseInterceptor] Error getting response body: {e}")
                    
        except Exception as e:
            print(f"[BrowserResponseInterceptor] Error in _on_loading_finished: {e}")
    
    async def _wait_for_response(self, timeout: int):
        start_time = asyncio.get_event_loop().time()
        check_interval = 0.5  # Check every 500ms
        check_count = 0
        
        while asyncio.get_event_loop().time() - start_time < timeout:
            check_count += 1
            
            # Check CDP captured responses first (if implemented)
            if self.captured_responses:
                print(f"[BrowserResponseInterceptor] Found {len(self.captured_responses)} CDP captured response(s)")
                response_data = self.captured_responses[-1]
                self.flight_data = self._parse_response(response_data)
                self.response_captured = True
                return
            
            # Check JS-captured responses with stream support
            check_script = """
            (() => {
                // Debug: Log what we have
                console.log('[Interceptor-Check] window._flightSearchResponses:', window._flightSearchResponses?.length || 0);
                
                if (window._flightSearchResponses && window._flightSearchResponses.length > 0) {
                    const last = window._flightSearchResponses[window._flightSearchResponses.length - 1];
                    console.log('[Interceptor-Check] Last response size:', last.body?.length || 0);
                    
                    // Return if body has meaningful data (> 500 chars)
                    if (last.body && last.body.length > 500) {
                        return JSON.stringify({
                            url: last.url,
                            status: last.status,
                            statusText: last.statusText,
                            body: last.body,
                            timestamp: last.timestamp,
                            type: last.type
                        });
                    }
                }
                return null;
            })()
            """
            
            try:
                result = await self.browser_manager.execute_script(check_script)
                
                # Every 10 checks (5 seconds), print debug info
                if check_count % 10 == 0:
                    debug_script = """
                    (() => {
                        if (window._flightSearchResponses) {
                            return {
                                count: window._flightSearchResponses.length,
                                responses: window._flightSearchResponses.map(r => ({
                                    url: r.url.substring(r.url.lastIndexOf('/') + 1),
                                    bodySize: r.body?.length || 0,
                                    type: r.type
                                }))
                            };
                        }
                        return {count: 0, responses: [], message: '_flightSearchResponses not initialized'};
                    })()
                    """
                    try:
                        debug_info = await self.browser_manager.execute_script(debug_script)
                        print(f"[BrowserResponseInterceptor] Check #{check_count}: {debug_info}")
                    except RuntimeError as e:
                        print(f"[BrowserResponseInterceptor] Browser disconnected during check: {e}")
                        raise TimeoutError(f"Browser connection lost")
                
                if result and result != 'null':
                    response_data = json.loads(result)
                    print(f"[BrowserResponseInterceptor] ✓ JS captured stream data. Size: {len(response_data['body'])} bytes")
                    
                    # Parse the response
                    self.flight_data = self._parse_response(response_data)
                    
                    # Check if we have actual flight data
                    response_str = str(self.flight_data)
                    if "flightList" in response_str or "itineraryList" in response_str or "basicInfo" in response_str:
                        print("[BrowserResponseInterceptor] ✓ Flight data found in response")
                        print("[BrowserResponseInterceptor] Waiting 10 seconds for additional SSE events...")
                        
                        # Wait 10 seconds to collect any additional SSE responses
                        initial_size = len(response_data['body'])
                        await asyncio.sleep(10)
                        
                        # Check if more data arrived
                        final_check = await self.browser_manager.execute_script(check_script)
                        if final_check and final_check != 'null':
                            final_data = json.loads(final_check)
                            if len(final_data['body']) > initial_size:
                                print(f"[BrowserResponseInterceptor] ✓ Collected additional data: {len(final_data['body']) - initial_size} bytes")
                                self.flight_data = self._parse_response(final_data)
                            else:
                                print(f"[BrowserResponseInterceptor] No additional data received")
                        
                        self.response_captured = True
                        return
                    else:
                        print("[BrowserResponseInterceptor] Waiting for complete flight data...")
            
            except Exception as e:
                print(f"[BrowserResponseInterceptor] Error checking responses: {e}")
                
            await asyncio.sleep(check_interval)
            
        raise TimeoutError(f"FlightListSearchSSE response not captured within {timeout} seconds")

    def _parse_response(self, response_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Parse intercepted response data.
        
        Handles both SSE (Server-Sent Events) format and regular JSON responses.
        
        Args:
            response_data: Raw response data from browser
            
        Returns:
            Parsed response dictionary
        """
        body = response_data.get('body', '')
        
        print(f"[BrowserResponseInterceptor] Parsing response body (length: {len(body)})")
        
        # Parse SSE format (data: lines)
        if 'data:' in body:
            events = []
            current_event = {}
            
            for line in body.split('\n'):
                line = line.strip()
                
                if line.startswith('data:'):
                    data_str = line[5:].strip()
                    try:
                        event_data = json.loads(data_str)
                        events.append(event_data)
                    except json.JSONDecodeError:
                        events.append(data_str)
                elif line.startswith('event:'):
                    current_event['event'] = line[6:].strip()
                elif line.startswith('id:'):
                    current_event['id'] = line[3:].strip()
                elif line == '':
                    if current_event:
                        current_event = {}
            
            print(f"[BrowserResponseInterceptor] Parsed {len(events)} SSE events")
            
            return {
                'status': 'success',
                'url': response_data.get('url'),
                'statusCode': response_data.get('status'),
                'events': events,
                'eventCount': len(events),
                'raw': body[:1000] + '...' if len(body) > 1000 else body,  # Truncate for readability
                'fullBodyLength': len(body),
                'timestamp': response_data.get('timestamp')
            }
        else:
            # Try to parse as JSON
            try:
                data = json.loads(body)
                print(f"[BrowserResponseInterceptor] Parsed as JSON")
                return {
                    'status': 'success',
                    'url': response_data.get('url'),
                    'statusCode': response_data.get('status'),
                    'data': data,
                    'timestamp': response_data.get('timestamp')
                }
            except json.JSONDecodeError:
                print(f"[BrowserResponseInterceptor] Unable to parse as JSON, returning raw")
                return {
                    'status': 'success',
                    'url': response_data.get('url'),
                    'statusCode': response_data.get('status'),
                    'raw': body[:1000] + '...' if len(body) > 1000 else body,
                    'fullBodyLength': len(body),
                    'timestamp': response_data.get('timestamp')
                }
