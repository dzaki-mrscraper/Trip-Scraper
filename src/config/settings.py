"""Application configuration settings."""

import os

# Server Configuration
SERVER_HOST = "0.0.0.0"
SERVER_PORT = 11000

# Browser Configuration
CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
TARGET_URL = "https://id.trip.com/flights"

# Browser Arguments
BROWSER_ARGS = [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--force-dark-mode",
    "--enable-features=WebUIDarkMode",
    "--enable-features=WebContentsForceDark"
]

# Trip.com API Configuration
TRIP_API_ENDPOINT = "/restapi/soa2/14427/GetLowPriceInCalender"

# Trip type mapping
TRIP_TYPE_MAPPING = {
    1: 'OW',  # One Way
    2: 'RT',  # Round Trip
    3: 'MT'   # Multi Trip
}

# Timeouts (in seconds)
BROWSER_NAVIGATION_TIMEOUT = 5
BROWSER_WAIT_TIMEOUT = 3
TOKEN_GENERATION_TIMEOUT = 10
