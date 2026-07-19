import requests
import os
import concurrent.futures
from dotenv import load_dotenv

load_dotenv('.env')
headers = {'Authorization': 'Token ' + os.getenv('REPLICATE_API_TOKEN')}
res = requests.get('https://api.replicate.com/v1/models?query=sam', headers=headers).json().get('results', [])

def check_schema(m):
    try:
        if m['owner'] == 'ultralytics': return None
        v = requests.get(f"https://api.replicate.com/v1/models/{m['owner']}/{m['name']}/versions", headers=headers).json().get('results', [])
        if not v: return None
        schema = v[0].get('openapi_schema', {})
        if 'components' in schema and 'schemas' in schema['components'] and 'Input' in schema['components']['schemas']:
            props = schema['components']['schemas']['Input'].get('properties', {})
            if 'point_coords' in props or 'points' in props:
                return f"{m['owner']}/{m['name']}:{v[0]['id']}"
    except Exception as e: pass
    return None

with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
    results = executor.map(check_schema, res)
    valid = [r for r in results if r]
    print('FOUND:', valid)
