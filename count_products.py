import urllib.request, json, os
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(r'C:\Users\davie\dtdpaymentsbot\.env'))
url = os.getenv('SUPABASE_URL','')
key = os.getenv('SUPABASE_SERVICE_ROLE_KEY','') or os.getenv('SUPABASE_ANON_KEY','')
if not url or not key:
    print('No supabase config'); exit()
req = urllib.request.Request(f'{url}/rest/v1/products?select=id,name&order=name',
    headers={'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
with urllib.request.urlopen(req, timeout=15) as resp:
    data = json.loads(resp.read())
print(f'Total products: {len(data)}')
for p in data[:10]:
    print(f'  - {p["name"]}')
if len(data) > 10:
    print(f'  ... and {len(data)-10} more')
