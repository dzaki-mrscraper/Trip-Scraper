"""W payload generation service."""

import hashlib
import json

from src.models.w_payload_models import WPayload
from src.config import TRIP_TYPE_MAPPING


def generate_w_payload(input_payload: dict) -> tuple[dict, str]:
    """
    Generate W payload and its MD5 hash.
    
    Args:
        input_payload: Request payload data
        
    Returns:
        tuple: (w_payload_dict, w_payload_md5_hash)
    """
    try:
        # Create W payload using factory method
        w_payload = WPayload.from_input_payload(input_payload, TRIP_TYPE_MAPPING)
        
        # Convert to dictionary
        w_payload_dict = w_payload.to_dict()
        
        # Debug output
        print(f"[*] W Payload: {json.dumps(w_payload_dict, indent=2)[:500]}...")
        
        # Generate MD5 hash
        w_payload_json = json.dumps(w_payload_dict, separators=(',', ':'), ensure_ascii=False)
        w_payload_md5 = hashlib.md5(w_payload_json.encode()).hexdigest()
        
        print(f"[*] W Payload MD5: {w_payload_md5}")
        
        return w_payload_dict, w_payload_md5
        
    except Exception as e:
        import traceback
        print(f"[ERROR] W payload generation: {e}")
        print(traceback.format_exc())
        raise
