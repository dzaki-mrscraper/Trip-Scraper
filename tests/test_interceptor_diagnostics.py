"""Diagnostic test for browser interception - with verbose logging"""

import asyncio
import sys
sys.path.insert(0, 'e:/coding/mrscrapper/trip com/Trip-Flights-Scraper')

from src.core.browser_manager import BrowserManager
from src.services.browser_response_interceptor import BrowserResponseInterceptor
import json


async def test_with_diagnostics():
    """Test browser interception with detailed diagnostics"""
    
    test_url = "https://id.trip.com/flights/showfarefirst?dcity=jkt&acity=sin&ddate=2026-01-25&rdate=2026-01-27&triptype=rt&class=y&lowpricesource=searchform&quantity=1&searchboxarg=t&nonstoponly=off&locale=en-ID&curr=IDR"
    
    print("=" * 80)
    print("DIAGNOSTIC TEST: Browser Response Interceptor")
    print("=" * 80)
    print(f"\nTarget URL: {test_url}\n")
    
    browser_manager = None
    
    try:
        print("[1/5] Initializing browser manager...")
        browser_manager = BrowserManager()
        await browser_manager.create_session()
        print("     ✓ Browser initialized\n")
        
        print("[2/5] Creating interceptor...")
        interceptor = BrowserResponseInterceptor(browser_manager)
        print("     ✓ Interceptor created\n")
        
        print("[3/5] Setting up network interception...")
        print("     This will enable both CDP and JavaScript interception\n")
        
        print("[4/5] Opening URL and waiting for FlightListSearchSSE response...")
        print("     This may take 30-90 seconds...\n")
        
        result = await interceptor.intercept_flight_search_response(test_url, timeout=90)
        
        print("\n[5/5] Response captured successfully!")
        print("=" * 80)
        print("\nRESPONSE DETAILS:")
        print("-" * 80)
        print(f"Status: {result.get('status')}")
        print(f"URL: {result.get('url')}")
        print(f"Status Code: {result.get('statusCode')}")
        
        if 'events' in result:
            print(f"Event Count: {result.get('eventCount')}")
            print(f"Response Type: SSE (Server-Sent Events)")
            print(f"\nFirst Event Preview:")
            if result['events']:
                print(json.dumps(result['events'][0], indent=2)[:500])
        elif 'data' in result:
            print(f"Response Type: JSON")
            print(f"\nData Keys: {list(result['data'].keys())}")
            
            # Check for flight data
            if 'basicInfo' in result['data']:
                basic_info = result['data']['basicInfo']
                print(f"\n✓ Flight Data Found!")
                print(f"  - Record Count: {basic_info.get('recordCount', 'N/A')}")
                print(f"  - Currency: {basic_info.get('currency', 'N/A')}")
                if 'lowestPrice' in basic_info:
                    lowest = basic_info['lowestPrice']
                    print(f"  - Lowest Price: {lowest.get('totalPrice', 'N/A')} {basic_info.get('currency', '')}")
            
            # Save full response to file
            output_file = "captured_flight_response.json"
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
            print(f"\n✓ Full response saved to: {output_file}")
        else:
            print(f"Raw Response Length: {result.get('fullBodyLength', len(result.get('raw', '')))}")
        
        print("\n" + "=" * 80)
        print("TEST PASSED ✓")
        print("=" * 80)
        
    except TimeoutError as e:
        print("\n" + "=" * 80)
        print("TEST FAILED: TIMEOUT")
        print("=" * 80)
        print(f"\nError: {e}")
        print("\nPossible reasons:")
        print("1. FlightListSearchSSE request was not made by the page")
        print("2. Network interception failed")
        print("3. Response format changed")
        print("\nTroubleshooting:")
        print("- Check browser console logs")
        print("- Verify the URL is correct")
        print("- Try increasing timeout")
        
    except Exception as e:
        print("\n" + "=" * 80)
        print("TEST FAILED: ERROR")
        print("=" * 80)
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
        
    finally:
        if browser_manager:
            try:
                await browser_manager.close()
                print("\n✓ Browser closed cleanly")
            except Exception as e:
                print(f"\n✗ Error closing browser: {e}")


if __name__ == "__main__":
    asyncio.run(test_with_diagnostics())
