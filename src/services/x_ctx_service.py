"""X-CTX-WCLIENT-REQ header generation service."""

import hashlib
import random
import time

from src.config import TRIP_API_ENDPOINT


def generate_x_ctx_header(input_payload: dict) -> str:
    """
    Generate X-CTX-WCLIENT-REQ header value.
    
    Args:
        input_payload: Request payload containing client ID and extensions
        
    Returns:
        MD5 hash string for X-CTX header
    """
    # Extract extensions
    extensions = {
        ext['name']: ext.get('value', '') 
        for ext in input_payload['head']['extension']
    }
    
    method = 'POST'
    timestamp = '-' + str(int(time.time() * 1000)) + "-" + str(random.randint(1000000, 9999999))
    guid = input_payload["head"].get('ClientID')
    ubtvid = extensions.get('vid')
    
    # Create hash string
    hash_input = f"{method}{TRIP_API_ENDPOINT}{timestamp}{guid}{ubtvid}"
    md5_hash = hashlib.md5(hash_input.encode()).hexdigest()
    
    print(f"[*] X-CTX hash input: {hash_input}")
    print(f"[*] X-CTX hash: {md5_hash}")
    
    return md5_hash
