"""Payload encoding utilities."""

import json
import urllib.parse

from src.models.payload_models import PayloadData


def encode_payload():
    """
    Create a payload encoder function using Trip.com's compression algorithm.
    
    Returns:
        Function that encodes payload strings
    """
    e = 16384
    t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    
    def encoder(i):
        # Convert string to bytes (UTF-8 encoded)
        encoded = i.encode('utf-8')
        n = list(encoded)
        
        def compress(i):
            # Initialize variables
            hash_table = []
            r = []
            s = -1
            o = 0
            a = 0
            l = 0
            c = 0
            d = []
            
            def get_min(x, y):
                return min(x, y)
            
            def calculate_hash():
                nonlocal a
                hash_val = 0
                for idx in range(a, min(a + 3, len(i))):
                    hash_val *= 16777619
                    hash_val ^= i[idx]
                return hash_val & 16383
            
            def find_match_length(pos):
                nonlocal a
                r_limit = get_min(pos + 130, a)
                t_idx = pos
                n_idx = a
                while t_idx < r_limit and n_idx < len(i) and i[t_idx] == i[n_idx]:
                    t_idx += 1
                    n_idx += 1
                return t_idx - pos
            
            def encode_literals():
                nonlocal s, a
                e_pos = s
                while e_pos < a:
                    chunk_size = get_min(127, a - e_pos)
                    encode_byte(255 & -chunk_size)
                    for n in range(e_pos, min(a, e_pos + chunk_size)):
                        encode_byte(i[n])
                    e_pos += 127
            
            def encode_byte(byte):
                nonlocal l, c
                t = l << (6 - c)
                l = 255 & byte
                c += 2
                t |= l >> c
                write_char(63 & t)
                if c >= 6:
                    c -= 6
                    t = l >> c
                    write_char(63 & t)
            
            def write_char(idx):
                d.append(t[idx])
            
            def process_chunk():
                nonlocal a, o, s
                chunk_end = get_min(u + 16384, len(i))
                l_limit = get_min(chunk_end, len(i) - 3 + 1)
                
                while a < chunk_end:
                    match_len = 0
                    match_offset = 0
                    
                    if a < l_limit:
                        hash_val = calculate_hash()
                        
                        if a >= o:
                            # Initialize hash_table and r if needed
                            while len(hash_table) <= hash_val:
                                hash_table.append(0)
                            
                            pos = hash_table[hash_val] - 1
                            
                            while match_len != 130 and pos >= 0 and pos >= a - e:
                                length = find_match_length(pos)
                                if length >= 3 and length > match_len:
                                    match_len = length
                                    match_offset = a - pos - match_len
                                
                                if pos >= u and pos - u < len(r):
                                    pos = r[pos - u]
                                else:
                                    break
                        
                        # Update hash table
                        while len(hash_table) <= hash_val:
                            hash_table.append(0)
                        
                        if a >= u:
                            while len(r) <= a - u:
                                r.append(-1)
                            r[a - u] = hash_table[hash_val] - 1
                        
                        hash_table[hash_val] = a + 1
                    
                    if match_len >= 3:
                        o = a + match_len
                        if s != -1:
                            encode_literals()
                            s = -1
                        
                        encode_byte(match_len - 3)
                        
                        while match_offset > 127:
                            encode_byte((127 & match_offset) | 128)
                            match_offset >>= 7
                        encode_byte(match_offset)
                    else:
                        if a >= o and s == -1:
                            s = a
                    
                    a += 1
            
            # Main compression logic
            encode_byte(19)
            
            u = 0
            while u < len(i) and a < len(i):
                if u > 0:
                    r = r[e:]
                process_chunk()
                u += e
            
            if s != -1:
                encode_literals()
            
            if c == 2:
                write_char((l << 4) & 63)
            elif c == 4:
                write_char((l << 2) & 63)
            
            return ''.join(d)
        
        return compress(n)
    
    return encoder


def simple_url_encode(payload_dict: dict) -> str:
    """
    Simple URL encoding for payload data.
    
    Args:
        payload_dict: Payload dictionary to encode
        
    Returns:
        URL encoded string
    """
    payload_json = json.dumps(payload_dict, separators=(',', ':'), ensure_ascii=False)
    return urllib.parse.quote(payload_json, safe='')


if __name__ == "__main__":
    # Example usage
    encode_payload_func = encode_payload()
    
    payload = PayloadData.create_flight_payload(
        dcity="JKT",
        acity="SIN",
        ddate="2026-02-01",
        rdate="2026-02-03",
        adult=1,
        currency="IDR",
        locale="en-ID",
        init_cki="E-VHVUlEPTA5MDM0MTc3NDEwMjQwNjE0NDI1...",
        ab_test_string="M:44,240912_IBU_jpwjo:A;M:43,241224_IBU_TOLNG:B;..."
    )
    
    payload_dict = payload.to_dict()
    encoded = encode_payload_func(json.dumps(payload_dict, separators=(',', ':'), ensure_ascii=False))
    result = f"d={encoded}&ac=b"
    print(result)
