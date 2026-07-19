import requests
import base64
import time

url = 'http://127.0.0.1:5000/api/segment'

# Valid JPEG image
img_url = "https://raw.githubusercontent.com/pytorch/hub/master/images/dog.jpg"
img_data = requests.get(img_url).content

print(img_data[:10]) # Verify it's a JPEG (b'\xff\xd8\xff')

b64 = base64.b64encode(img_data).decode('utf-8')

data = {
    "image": f"data:image/jpeg;base64,{b64}",
    "x": 200,
    "y": 200
}

print("Sending request with real dog JPEG...")
start = time.time()
try:
    res = requests.post(url, json=data, timeout=60)
    print(res.status_code)
    print(res.text)
except Exception as e:
    print(e)
print(f"Elapsed: {time.time()-start:.1f}s")
