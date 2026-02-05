"""Quick test for /scrape-browser endpoint"""

import requests
import json

url = "http://localhost:11000/scrape-browser"
payload = {
    "url": "https://id.trip.com/flights/showfarefirst?dcity=jkt&acity=sin&ddate=2026-01-25&rdate=2026-01-27&triptype=rt&class=y&locale=en-ID&curr=IDR"
}

print("Sending request to /scrape-browser...")
print(f"Target URL: {payload['url']}\n")

try:
    response = requests.post(url, json=payload, timeout=120)
    print(f"Status Code: {response.status_code}\n")
    
    result = response.json()
    
    if response.status_code == 200:
        print("✓ SUCCESS!")
        print(json.dumps(result, indent=2)[:2000])  # Show first 2000 chars
        
        # Save full response
        with open("captured_response.json", "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        print("\n✓ Full response saved to captured_response.json")
    else:
        print("✗ FAILED")
        print(json.dumps(result, indent=2))
        
except Exception as e:
    print(f"✗ Error: {e}")
