import replicate
import os
import time
from dotenv import load_dotenv

load_dotenv('g:/マイドライブ/マイルール/888_価値創造ワークスペース/Nespakono/nespakono_ai_app/.env')

img_url = "https://raw.githubusercontent.com/pytorch/hub/master/images/dog.jpg"

try:
    print("Testing pablodawson/segment-anything-automatic")
    model = replicate.models.get("pablodawson/segment-anything-automatic")
    print(model.latest_version.id)
except Exception as e:
    print(f"Failed pablodawson: {e}")

