"""Main entry point for Trip.com Flight Scraper."""

import asyncio
import colorama

from src.api.server import start_server

# Initialize colorama
colorama.init(autoreset=True)


async def main():
    """Application entry point."""
    try:
        await start_server()
    except KeyboardInterrupt:
        print(f"\n{colorama.Fore.YELLOW}[*] Shutting down gracefully...{colorama.Fore.WHITE}")
    except Exception as e:
        print(f"{colorama.Fore.RED}[!] Fatal error: {e}{colorama.Fore.WHITE}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
