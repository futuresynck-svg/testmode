from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import os
from dotenv import load_dotenv
import base64
import replicate
import io
import time

# 上の階層（nespakono_ai_appフォルダ直下）にある .env ファイルを読み込む
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

app = Flask(__name__)
CORS(app) # フロントエンドからの通信を許可

@app.route('/api/get_streetview', methods=['POST'])
def get_streetview():
    data = request.json
    address = data.get('address')
    
    if not address:
        return jsonify({'error': 'Address is required'}), 400

    api_key = os.getenv('GOOGLE_MAPS_API_KEY')
    
    # APIキーが未設定、もしくは初期文字列のままの場合のエラーハンドリング
    if not api_key or "AIza" not in api_key:
        return jsonify({'error': 'Google Maps API key is not properly configured in .env file'}), 500

    heading = data.get('heading')
    pitch = data.get('pitch')
    fov = data.get('fov')

    # Google Street View Static APIのエンドポイント（サイズは640x640に設定）
    url = f"https://maps.googleapis.com/maps/api/streetview?size=640x640&location={address}&key={api_key}"
    
    # オプションパラメータがあれば付与
    if heading is not None:
        url += f"&heading={heading}"
    if pitch is not None:
        url += f"&pitch={pitch}"
    if fov is not None:
        url += f"&fov={fov}"
    
    try:
        response = requests.get(url)
        if response.status_code == 200:
            # フロントエンドで直接表示できるようにBase64エンコードして返す
            encoded_string = base64.b64encode(response.content).decode('utf-8')
            mime_type = response.headers.get('Content-Type', 'image/jpeg')
            data_uri = f"data:{mime_type};base64,{encoded_string}"
            
            return jsonify({'success': True, 'image_url': data_uri})
        else:
            return jsonify({'error': f'Failed to fetch image: {response.status_code}'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/config', methods=['GET'])
def get_config():
    api_key = os.getenv('GOOGLE_MAPS_API_KEY')
    return jsonify({
        'google_maps_api_key': api_key if (api_key and "AIza" in api_key) else None
    })

@app.route('/api/segment_preload', methods=['POST'])
def segment_preload():
    """
    バックグラウンド事前解析
    画像をReplicateのSAM-2に投げ、画像全体を構成するすべてのブロック（マスク群）のURLリストを取得する
    """
    data = request.json
    image_b64 = data.get('image')

    replicate_token = os.getenv('REPLICATE_API_TOKEN')
    if not replicate_token:
        return jsonify({'error': 'REPLICATE_API_TOKENが設定されていません。.envファイルにAPIキーを設定してください。'}), 500

    try:
        # Base64文字列をバイナリのファイルオブジェクトに変換
        if image_b64 and image_b64.startswith('data:image'):
            import tempfile
            header, encoded = image_b64.split(',', 1)
            image_data = base64.b64decode(encoded)
            fd, temp_path = tempfile.mkstemp(suffix=".jpg")
            with os.fdopen(fd, 'wb') as f:
                f.write(image_data)
            inputs = {"image": open(temp_path, "rb")}
        else:
            inputs = {"image": image_b64}
            
        import time
        max_retries = 3
        for attempt in range(max_retries):
            try:
                prediction = replicate.predictions.create(
                    version="cbd95fb76192174268b6b303aeeb7a736e8dab0cbc38177f09db79b2299da30b",
                    input=inputs
                )
                break
            except Exception as e:
                if "429" in str(e) and attempt < max_retries - 1:
                    print(f"Rate limited by Replicate. Retrying in 12 seconds... (Attempt {attempt+1}/{max_retries})")
                    time.sleep(12)
                else:
                    raise e
        
        start_time = time.time()
        while prediction.status not in ["succeeded", "failed", "canceled"]:
            if time.time() - start_time > 80:
                prediction.cancel()
                return jsonify({'error': '事前解析がタイムアウトしました。'}), 504
            time.sleep(1)
            prediction.reload()
            
        if prediction.status == "succeeded":
            masks = prediction.output.get('individual_masks', [])
            return jsonify({'success': True, 'mask_urls': masks})
        else:
            return jsonify({'error': f'Replicate SAM failed: {prediction.error}'}), 500
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/segment_pick', methods=['POST'])
def segment_pick():
    """
    クリック座標からの高速マスク抽出
    フロントエンドから送られた数十枚のマスクURLリストの中から、クリック座標(x, y)を含む最小面積のマスクを返す
    """
    data = request.json
    masks = data.get('mask_urls', [])
    x = data.get('x')
    y = data.get('y')

    if not masks:
        return jsonify({'error': 'マスクリストが空です。'}), 400

    import concurrent.futures
    import urllib.request
    import numpy as np
    from PIL import Image
    
    def fetch_and_check_mask(url, target_x, target_y):
        try:
            resp = urllib.request.urlopen(url)
            img = Image.open(resp).convert('L')
            arr = np.array(img)
            
            radius = 10
            y_min = max(0, target_y - radius)
            y_max = min(arr.shape[0], target_y + radius + 1)
            x_min = max(0, target_x - radius)
            x_max = min(arr.shape[1], target_x + radius + 1)
            
            if y_min < y_max and x_min < x_max:
                if np.any(arr[y_min:y_max, x_min:x_max] > 128):
                    area = np.sum(arr > 128)
                    return url, area
        except Exception as e:
            print(f"Error fetching mask {url}: {e}")
            pass
        return None, float('inf')

    best_mask_url = None
    min_area = float('inf')
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(masks), 50)) as executor:
        futures = [executor.submit(fetch_and_check_mask, url, int(x), int(y)) for url in masks]
        for future in concurrent.futures.as_completed(futures):
            url, area = future.result()
            if url and area < min_area:
                min_area = area
                best_mask_url = url
                
    if best_mask_url:
        return jsonify({'success': True, 'mask_url': best_mask_url})
    else:
        return jsonify({'error': 'クリックした位置に明確なブロックが見つかりませんでした。別の場所をクリックするか、手動ブラシをお使いください。'}), 500


@app.route('/api/generate_building', methods=['POST'])
def generate_building():
    """
    AI更地化＆合成（SDXL Inpainting）
    フロントエンドから背景画像、マスク画像（赤塗り部分）、プロンプトを受け取り、Replicateに投げて合成画像を返す
    """
    data = request.json
    image_b64 = data.get('image')
    mask_b64 = data.get('mask')
    prompt = data.get('prompt', 'A modern house, realistic, architectural photography')

    action_type = data.get('action_type', 'generation')

    replicate_token = os.getenv('REPLICATE_API_TOKEN')
    if not replicate_token:
        return jsonify({'error': 'REPLICATE_API_TOKENが設定されていません。.envファイルにAPIキーを設定してください。'}), 500

    # 本番稼働時のReplicate連携処理
    # 例: stability-ai/sdxl-inpainting モデル等を使用
    try:
        def b64_to_tempfile(b64_str):
            if b64_str and b64_str.startswith('data:image'):
                import tempfile
                header, encoded = b64_str.split(',', 1)
                image_data = base64.b64decode(encoded)
                fd, temp_path = tempfile.mkstemp(suffix=".png")
                with os.fdopen(fd, 'wb') as f:
                    f.write(image_data)
                return open(temp_path, "rb")
            return b64_str

        inputs = {
            "prompt": prompt,
            "image": b64_to_tempfile(image_b64),
            "prompt_strength": 0.99 if action_type == 'demolition' else 0.85
        }
        
        # 更地化の場合は、建物を生成しないようにネガティブプロンプトを強く指定
        if action_type == 'demolition':
            inputs["negative_prompt"] = "building, house, structure, architecture, object, artifact, distortion, blurry, weird textures, roof, wall"
            inputs["guidance_scale"] = 7.5

        # マスクがある場合はInpainting（合成）、無い場合はImg2Imgとして処理
        if mask_b64 and mask_b64 != "dummy_mask_for_initial_generation":
            inputs["mask"] = b64_to_tempfile(mask_b64)
            
        import time
        max_retries = 3
        for attempt in range(max_retries):
            try:
                prediction = replicate.predictions.create(
                    version="7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc",
                    input=inputs
                )
                break
            except Exception as e:
                if "429" in str(e) and attempt < max_retries - 1:
                    print(f"Rate limited by Replicate (SDXL). Retrying in 12 seconds... (Attempt {attempt+1}/{max_retries})")
                    time.sleep(12)
                else:
                    raise e
        
        while prediction.status not in ["succeeded", "failed", "canceled"]:
            time.sleep(3)
            prediction.reload()
        
        if prediction.status == "succeeded" and prediction.output:
            output_url = str(prediction.output[0])
            
            # If generating a standalone object (img2img/txt2img mode), remove background
            if not mask_b64 or mask_b64 == "dummy_mask_for_initial_generation":
                try:
                    import time
                    max_retries = 3
                    for attempt in range(max_retries):
                        try:
                            rembg_pred = replicate.predictions.create(
                                version="95fcc2a26d3899cd6c2691c900465aaeff466285a65c14638cc5f36f34befaf1",
                                input={"image": output_url}
                            )
                            break
                        except Exception as e:
                            if "429" in str(e) and attempt < max_retries - 1:
                                print(f"Rate limited by Replicate (rembg). Retrying in 12 seconds... (Attempt {attempt+1}/{max_retries})")
                                time.sleep(12)
                            else:
                                raise e
                    
                    while rembg_pred.status not in ["succeeded", "failed", "canceled"]:
                        time.sleep(2)
                        rembg_pred.reload()
                    
                    if rembg_pred.status == "succeeded" and rembg_pred.output:
                        output_url = str(rembg_pred.output)
                except Exception as e:
                    print("Background removal failed:", e)
                    # Proceed with original output_url if rembg fails
            
            return jsonify({'success': True, 'image_url': output_url})
        else:
            return jsonify({'error': f'生成に失敗しました: {prediction.error}'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # サーバー起動 (ポート5000番)
    print("Starting Nespakono AI Backend Server...")
    app.run(port=5000, debug=True)
