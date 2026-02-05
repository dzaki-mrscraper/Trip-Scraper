"""HTTP request handlers for API endpoints."""

import json
import asyncio
from aiohttp import web

from src.core.token_generator import TokenGenerator
from src.core.browser_manager import BrowserManager
from src.services.flight_scraper import FlightScraper
from src.services.browser_response_interceptor import BrowserResponseInterceptor


async def handle_sign(request):
    """
    Handle POST /sign endpoint for token generation.
    
    Args:
        request: aiohttp request object containing flight search parameters
        
    Returns:
        JSON response with generated tokens or error message
    """
    try:
        data = await request.json()
        print(f"[*] Received token generation request")

        # Initialize token generator
        generator = TokenGenerator()
        
        # Generate all tokens
        result = await generator.generate_tokens(data)
        
        return web.json_response({
            "status": "success",
            **result
        })

    except Exception as e:
        import traceback
        print(f"[!] Error in handle_sign: {e}")
        print(traceback.format_exc())
        return web.json_response({
            "status": "error",
            "error": str(e)
        }, status=500)


async def handle_scrape(request):
    """
    Handle POST /scrape endpoint for flight scraping.
    
    Request body:
    {
        "url": "https://id.trip.com/flights/showfarefirst?dcity=jkt&acity=sin&ddate=2026-02-01&rdate=2026-02-03&triptype=rt&class=y&locale=en-ID&curr=IDR&quantity=1"
    }
    
    Args:
        request: aiohttp request object containing search URL
        
    Returns:
        JSON response with flight data or error message
    """
    try:
        data = await request.json()
        url = data.get('url')
        
        if not url:
            return web.json_response({
                "status": "error",
                "error": "URL is required"
            }, status=400)
        
        print(f"[*] Received scrape request for URL: {url}")
        
        # Initialize scraper
        scraper = FlightScraper()
        
        # Scrape flights
        result = await scraper.scrape_flights(url)
        
        return web.json_response(result)
    
    except Exception as e:
        import traceback
        print(f"[!] Error in handle_scrape: {e}")
        print(traceback.format_exc())
        return web.json_response({
            "status": "error",
            "error": str(e),
            "traceback": traceback.format_exc()
        }, status=500)


async def handle_scrape_browser(request):
    """
    Handle POST /scrape-browser endpoint for browser-based flight scraping.
    
    This endpoint opens the Trip.com URL in a real browser and intercepts
    the FlightListSearchSSE response directly from the network.
    
    Request body:
    {
        "url": "https://id.trip.com/flights/showfarefirst?dcity=jkt&acity=sin&ddate=2026-02-01&rdate=2026-02-03&triptype=rt&class=y&locale=en-ID&curr=IDR&quantity=1"
    }
    
    Args:
        request: aiohttp request object containing search URL
        
    Returns:
        JSON response with intercepted flight data or error message
    """
    browser_manager = None
    
    try:
        data = await request.json()
        url = data.get('url')
        
        if not url:
            return web.json_response({
                "status": "error",
                "error": "URL is required"
            }, status=400)
        
        print(f"[*] Received scrape-browser request for URL: {url}")
        
        # Initialize browser manager
        print(f"[*] Initializing browser...")
        browser_manager = BrowserManager()
        await browser_manager.create_session()
        
        # Initialize interceptor
        interceptor = BrowserResponseInterceptor(browser_manager)
        
        # Intercept response (increased timeout for SSE responses)
        print(f"[*] Opening URL and intercepting FlightListSearchSSE response...")
        result = await interceptor.intercept_flight_search_response(url, timeout=90)
        
        print(f"[+] Successfully intercepted flight data")
        return web.json_response(result)
        
    except TimeoutError as e:
        print(f"[!] Timeout error: {e}")
        return web.json_response({
            "status": "error",
            "error": str(e),
            "message": "FlightListSearchSSE response was not captured within timeout period"
        }, status=408)
        
    except Exception as e:
        import traceback
        print(f"[!] Error in handle_scrape_browser: {e}")
        print(traceback.format_exc())
        return web.json_response({
            "status": "error",
            "error": str(e),
            "traceback": traceback.format_exc()
        }, status=500)
        
    finally:
        # Clean up browser
        if browser_manager:
            try:
                await browser_manager.close()
                print(f"[*] Browser closed")
            except Exception as e:
                print(f"[!] Error closing browser: {e}")
