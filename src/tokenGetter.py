"""
Trip.com Token Generator - Main Entry Point

This module serves as the entry point for the Trip.com token generation service.
The application starts an HTTP server that generates authentication tokens for Trip.com flights API.
"""

import asyncio
import colorama

from server import start_server

# Initialize Colorama
colorama.init(autoreset=True)


async def main():
    """Main entry point - starts the token generation server."""
    await start_server()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print(f"{colorama.Fore.YELLOW}[!] Stopping server...{colorama.Fore.WHITE}")