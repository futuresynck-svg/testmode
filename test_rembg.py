import replicate
import os
import io
import base64
import requests
from dotenv import load_dotenv

load_dotenv('g:/マイドライブ/マイルール/888_価値創造ワークスペース/Nespakono/nespakono_ai_app/.env')

img_url = "https://raw.githubusercontent.com/pytorch/hub/master/images/dog.jpg"
img_data = requests.get(img_url).content
image_file = io.BytesIO(img_data)
image_file.name = "image.jpg"

try:
    prediction = replicate.predictions.create(
        version="fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003",
        input={"image": image_file}
    )
    import time
    start = time.time()
    while prediction.status not in ["succeeded", "failed", "canceled"]:
        time.sleep(1)
        prediction.reload()
    print(f"Status: {prediction.status}, output: {prediction.output}")
    print(f"Elapsed: {time.time()-start:.1f}s")
except Exception as e:
    print(e)
