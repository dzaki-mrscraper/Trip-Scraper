import hashlib
import json
from models.w_payload_models import WPayload

# Trip type mapping
TRIP_TYPE_MAPPING = {
    1: 'OW',  # One Way
    2: 'RT',  # Round Trip
    3: 'MT'   # Multi Trip
}

def get_result(input_payload):
    """
    Generate W payload dictionary and its MD5 hash
    
    Args:
        input_payload: Input search payload dictionary
        
    Returns:
        tuple: (payload_dict, md5_hash) or (None, None) if error occurs
    """
    try:
        # Create W payload using factory method
        w_payload = WPayload.from_input_payload(input_payload, TRIP_TYPE_MAPPING)
        
        # Convert to dictionary
        payload_dict = w_payload.to_dict()
        
        # Debug output
        print(f"W Payload: {json.dumps(payload_dict, indent=2)[:500]}...")
        
        # Generate MD5 hash
        md5_hash = hashlib.md5(
            json.dumps(payload_dict, separators=(',', ':')).encode()
        ).hexdigest()
        
        print(f"W Payload MD5: {md5_hash}")
        return payload_dict, md5_hash
        
    except Exception as e:
        import traceback
        print(f"[ERROR] w_payload_source: {e}")
        print(traceback.format_exc())
        return None, None