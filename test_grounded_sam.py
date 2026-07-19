import replicate
import os
import requests
import io
from dotenv import load_dotenv

load_dotenv('g:/マイドライブ/マイルール/888_価値創造ワークスペース/Nespakono/nespakono_ai_app/.env')

img_url = "https://raw.githubusercontent.com/pytorch/hub/master/images/dog.jpg"
img_data = requests.get(img_url).content
image_file = io.BytesIO(img_data)
image_file.name = "image.jpg"

try:
    prediction = replicate.predictions.create(
        version="65bb6d3cbca722a47291a2fc7daaf1fba3efc1e6c79a92a5adbc23b2c2db3525", # version ID from Replicate (or just use model name)
        input={"image": image_file, "mask_prompt": "dog"}
    )
    import time
    start = time.time()
    while prediction.status not in ["succeeded", "failed", "canceled"]:
        time.sleep(1)
        prediction.reload()
    print(f"Status: {prediction.status}, output: {prediction.output}")
    print(f"Elapsed: {time.time()-start:.1f}s")
except Exception as e:
    print(f"Failed: {e}")
