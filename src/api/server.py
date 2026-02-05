"""HTTP server initialization and configuration."""

import asyncio
from aiohttp import web
import colorama

from src.api.handlers import handle_sign, handle_scrape, handle_scrape_browser
from src.config import SERVER_HOST, SERVER_PORT


async def start_server():
    """
    Start aiohttp web server for token generation and scraping API.
    
    The server runs indefinitely until interrupted.
    
    Endpoints:
    - POST /sign - Generate tokens for Trip.com API
    - POST /scrape - Scrape flight data from Trip.com
    """
    app = web.Application()
    app.router.add_post('/sign', handle_sign)
    app.router.add_post('/scrape', handle_scrape)
    app.router.add_post('/scrape-browser', handle_scrape_browser)
    
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, SERVER_HOST, SERVER_PORT)
    
    print(f"{colorama.Fore.CYAN}[*] API Server running at http://localhost:{SERVER_PORT}{colorama.Fore.WHITE}")
    print(f"{colorama.Fore.GREEN}[*] Available endpoints:")
    print(f"  - POST /sign           - Generate tokens")
    print(f"  - POST /scrape         - Scrape flight data")
    print(f"  - POST /scrape-browser - Scrape via browser interception{colorama.Fore.WHITE}")
    await site.start()
    
    # Keep alive forever
    while True:
        await asyncio.sleep(3600)
