import hashlib
import random
import time

def get_result(input_payload):
    extensions = {ext['name']: ext.get('value', '') for ext in input_payload['head']['extension']}

    link = '/restapi/soa2/14427/GetLowPriceInCalender'
    method = 'POST'
    n = '-' + str(int(time.time() * 1000)) + "-" + str(random.randint(1000000, 9999999))
    GUID = input_payload["head"].get('ClientID')
    ubtvid = extensions.get('vid')
    print(f"{method}{link}{n}{GUID}{ubtvid}")
    md5_hash = hashlib.md5(f"{method}{link}{n}{GUID}{ubtvid}".encode()).hexdigest()
    print(md5_hash)

    return md5_hash