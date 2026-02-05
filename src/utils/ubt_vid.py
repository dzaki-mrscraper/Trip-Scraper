import time
import random
import string

def generate_ubtvid():
   timestamp = int(time.time() * 1000)
   random_id = ''.join(random.choices(string.ascii_letters + string.digits, k=12))
   return f"{timestamp}.{random_id}"

def main():
    ubtvid_info = generate_ubtvid()
    print(ubtvid_info)

main()