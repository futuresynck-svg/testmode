import replicate
import os
from dotenv import load_dotenv
import time

load_dotenv('g:/マイドライブ/マイルール/888_価値創造ワークスペース/Nespakono/nespakono_ai_app/.env')

start = time.time()
try:
    prediction = replicate.predictions.create(
        version="fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003",
        input={"image": "https://replicate.delivery/pbxt/Lw0kP2b31kGbb0uQ6N3Q6w9F0o2IuH4xY7t4q6n7Lw0kP2b3/input.jpg"}
    )
    print(f"Prediction created: {prediction.id}, status: {prediction.status}")
    while prediction.status not in ["succeeded", "failed", "canceled"]:
        time.sleep(1)
        prediction.reload()
    print(f"Status: {prediction.status}, output: {prediction.output}")
except Exception as e:
    print(e)
