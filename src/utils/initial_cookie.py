import requests
from http.cookiejar import CookieJar

def get_initial_cookies():
    """Get initial cookies from id.trip.com"""
    
    url = "https://id.trip.com/"
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
    }
    
    session = requests.Session()
    
    try:
        print("[*] Fetching initial cookies from id.trip.com...")
        response = session.get(url, headers=headers, timeout=10)
        
        print(f"[+] Status Code: {response.status_code}")
        print(f"[+] Cookies received: {len(session.cookies)} cookies\n")

        new_url = "https://id.trip.com/flights/showfarefirst?dcity=jkt&acity=pku&ddate=2026-01-25&rdate=2026-01-27&triptype=rt&class=y&lowpricesource=searchform&quantity=1&searchboxarg=t&nonstoponly=off&locale=en-ID&curr=IDR" 
        print("[*] Accessing flight search page to get additional cookies...")
        response2 = session.get(new_url, headers=headers, timeout=10)
        print(f"[+] Status Code: {response2.status_code}")
        
        # Display all cookies
        cookies_dict = {}
        for cookie in session.cookies:
            cookies_dict[cookie.name] = cookie.value
            print(f"  {cookie.name}: {cookie.value}")
        
        # Format for request headers
        cookie_string = '; '.join([f"{k}={v}" for k, v in cookies_dict.items()])
        print(f"\n[+] Cookie String:\n{cookie_string}")


        
        return {
            'cookies_dict': cookies_dict,
            'cookie_string': cookie_string,
            'session': session
        }
        
    except Exception as e:
        print(f"[!] Error: {e}")
        return None

if __name__ == "__main__":
    result = get_initial_cookies()
    
    if result:
        print("\n" + "="*50)
        print("Cookies successfully retrieved!")
        print("="*50)