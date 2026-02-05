"""HTTP server initialization and configuration."""

import asyncio
from aiohttp import web
import colorama

from handlers import handle_sign

PORT = 11000
SERVER_HOST = "0.0.0.0"


async def start_server():
    """
    Start aiohttp web server for token generation API.
    
    The server runs indefinitely until interrupted.
    """
    app = web.Application()
    app.router.add_post('/sign', handle_sign)
    
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, SERVER_HOST, PORT)
    
    print(f"{colorama.Fore.CYAN}[*] API Server running at http://localhost:{PORT}{colorama.Fore.WHITE}")
    await site.start()
    
    # Keep alive forever
    while True:
        await asyncio.sleep(3600)
