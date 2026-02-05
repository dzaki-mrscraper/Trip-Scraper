"""Test script for /scrape-browser endpoint."""

import requests
import json


def test_scrape_browser():
    """Test the /scrape-browser endpoint with a sample Trip.com URL."""
    
    # API endpoint
    url = "http://localhost:11000/scrape-browser"
    
    # Request payload
    payload = {
        "url": "https://id.trip.com/flights/showfarefirst?pagesource=list&lowpricesource=searchForm&triptype=RT&class=Y&quantity=1&childqty=0&babyqty=0&dcity=jkt&acity=sin&ddate=2026-02-01&locale=en-ID&curr=IDR&rdate=2026-02-03&airline="
    }
    
    print(f"Testing /scrape-browser endpoint...")
    print(f"Target URL: {payload['url']}")
    print(f"\nSending request to {url}...")
    
    try:
        response = requests.post(url, json=payload, timeout=120)
        
        print(f"\nStatus Code: {response.status_code}")
        print(f"\nResponse:")
        print(json.dumps(response.json(), indent=2))
        
        if response.status_code == 200:
            print(f"\n✓ Success! Flight data captured from browser.")
        else:
            print(f"\n✗ Failed with status {response.status_code}")
            
    except requests.exceptions.ConnectionError:
        print(f"\n✗ Error: Could not connect to server at {url}")
        print(f"Make sure the server is running (python main.py)")
    except requests.exceptions.Timeout:
        print(f"\n✗ Error: Request timed out")
    except Exception as e:
        print(f"\n✗ Error: {e}")


if __name__ == "__main__":
    test_scrape_browser()
