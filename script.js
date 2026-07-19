document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const uploadBox = document.getElementById('uploadBox');
    const fileInput = document.getElementById('fileInput');
    const previewContainer = document.getElementById('previewContainer');
    const resetBtn = document.getElementById('resetBtn');
    const generateBtn = document.getElementById('generateBtn');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const resultMessage = document.getElementById('resultMessage');
    const toolItems = document.querySelectorAll('.tool-list li');
    
    // API設定の初期化
    let googleMapsApiKey = '';
    async function initGoogleMaps() {
        try {
            const res = await fetch('/api/config');
            const config = await res.json();
            if (config.google_maps_api_key) {
                googleMapsApiKey = config.google_maps_api_key;
                const script = document.createElement('script');
                script.src = `https://maps.googleapis.com/maps/api/js?key=${googleMapsApiKey}&libraries=places&loading=async`;
                document.head.appendChild(script);
            }
        } catch (e) {
            console.error("API Config load failed:", e);
        }
    }
    initGoogleMaps();

    // Wizard Elements
    const step1View = document.getElementById('step1View');
    const step3View = document.getElementById('step3View');
    const ind1 = document.getElementById('indicator1');
    const ind2 = document.getElementById('indicator2');
    
    // Gmaps Elements
    const addressInput = document.getElementById('addressInput');
    const searchMapBtn = document.getElementById('searchMapBtn');
    
    // Properties Elements
    const colorPicker = document.getElementById('colorPicker');
    const colorInput = document.getElementById('colorInput');
    const referenceUploadBox = document.getElementById('referenceUploadBox');
    const referenceInput = document.getElementById('referenceInput');
    
    // Toolbar Elements
    const demolitionBrushBtn = document.getElementById('demolitionBrushBtn');
    const executeDemolitionBtn = document.getElementById('executeDemolitionBtn');
    const deleteBtn = document.getElementById('deleteBtn');
    const bringFrontBtn = document.getElementById('bringFrontBtn');
    const sendBackBtn = document.getElementById('sendBackBtn');
    const dimensionToggleBtn = document.getElementById('dimensionToggleBtn');

    let selectedTool = 'perspective';
    let dimensionsVisible = false;
    let dimensionGroup = null;
    let isDemolitionMode = false;
    let isSAMMode = false;
    
    // History & Undo
    const undoBtn = document.getElementById('undoBtn');
    let historyStack = [];
    
    function saveHistory() {
        if (!canvas) return;
        // Save the entire canvas state including background and objects
        historyStack.push(JSON.stringify(canvas.toJSON(['customType', 'id'])));
        if (historyStack.length > 15) historyStack.shift(); // Keep last 15
        undoBtn.disabled = historyStack.length === 0;
        undoBtn.style.color = historyStack.length > 0 ? 'var(--text-primary)' : 'var(--text-muted)';
    }

    undoBtn.addEventListener('click', () => {
        if (historyStack.length === 0) return;
        const prevState = historyStack.pop();
        undoBtn.disabled = historyStack.length === 0;
        undoBtn.style.color = historyStack.length > 0 ? 'var(--text-primary)' : 'var(--text-muted)';
        
        loadingText.textContent = "前の状態を読み込んでいます...";
        loadingOverlay.classList.remove('hidden');
        
        canvas.loadFromJSON(prevState, function() {
            canvas.renderAll();
            // Update currentImageSrc if background exists
            if (canvas.backgroundImage) {
                currentImageSrc = canvas.backgroundImage.getSrc();
            }
            loadingOverlay.classList.add('hidden');
        });
    });

    // SAM Interactive State
    let samMaskImageElement = new Image();
    samMaskImageElement.crossOrigin = "Anonymous";
    let samMaskCanvas = document.createElement('canvas');
    let samMaskCtx = samMaskCanvas.getContext('2d', {willReadFrequently: true});
    window.lastGeneratedAiMask = null;
    let accumulatedMaskCanvas = document.createElement('canvas');
    let accumulatedMaskCtx = accumulatedMaskCanvas.getContext('2d');
    let isAccumulatedCanvasInit = false;

    // Resize canvas responsive wrapper
    const maxCanvasWidth = 800;
    const maxCanvasHeight = 600;

    // Tool Selection
    toolItems.forEach(item => {
        item.addEventListener('click', () => {
            toolItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            selectedTool = item.getAttribute('data-tool');
            document.querySelector('.topbar h1').textContent = item.querySelector('span').textContent;
        });
    });

    // Upload Box Click & Drag
    uploadBox.addEventListener('click', () => {
        console.log("Upload box clicked");
        fileInput.click();
    });
    uploadBox.addEventListener('dragover', (e) => { e.preventDefault(); uploadBox.classList.add('dragover'); });
    uploadBox.addEventListener('dragleave', () => uploadBox.classList.remove('dragover'));
    uploadBox.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadBox.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
        console.log("File selected");
        if (e.target.files.length > 0) handleFile(e.target.files[0]);
    });

    // Upload Box Click & Drag (Reference Sketch)
    referenceUploadBox.addEventListener('click', () => referenceInput.click());
    referenceInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            const fileName = e.target.files[0].name;
            referenceUploadBox.querySelector('span').textContent = fileName;
            referenceUploadBox.style.borderColor = '#4ade80';
            referenceUploadBox.style.color = '#4ade80';
        }
    });

    // Color Picker Sync
    colorPicker.addEventListener('input', (e) => {
        colorInput.value = e.target.value;
    });
    colorInput.addEventListener('input', (e) => {
        if (/^#[0-9A-F]{6}$/i.test(e.target.value)) {
            colorPicker.value = e.target.value;
        }
    });

    // Initialize Fabric Canvas
    let canvas;
    try {
        canvas = new fabric.Canvas('editorCanvas', {
            width: maxCanvasWidth,
            height: 500,
            selection: true
        });
    } catch(e) {
        console.error("Fabric.js is not loaded yet.");
    }

    // --- Zoom & Pan (Space + Drag, Wheel) ---
    let isDragging = false;
    let isSpaceDown = false;
    let lastPosX, lastPosY;

    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && !e.repeat && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
            isSpaceDown = true;
            if (canvas) {
                canvas.defaultCursor = 'grab';
                canvas.requestRenderAll();
            }
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            isSpaceDown = false;
            if (canvas) {
                canvas.defaultCursor = 'default';
                canvas.requestRenderAll();
            }
        }
    });

    if (canvas) {
        canvas.on('mouse:wheel', function(opt) {
            if (opt.e.ctrlKey || opt.e.metaKey) {
                var delta = opt.e.deltaY;
                var zoom = canvas.getZoom();
                zoom *= 0.999 ** delta;
                if (zoom > 20) zoom = 20;
                if (zoom < 0.5) zoom = 0.5; // 最小ズームを0.5に制限
                canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
                opt.e.preventDefault();
                opt.e.stopPropagation();
            }
        });

        canvas.on('mouse:down', function(opt) {
            if (isSpaceDown || opt.e.altKey) {
                isDragging = true;
                canvas.selection = false;
                lastPosX = opt.e.clientX;
                lastPosY = opt.e.clientY;
                canvas.defaultCursor = 'grabbing';
            }
        });

        canvas.on('mouse:move', function(opt) {
            if (isDragging) {
                var e = opt.e;
                var vpt = this.viewportTransform;
                vpt[4] += e.clientX - lastPosX;
                vpt[5] += e.clientY - lastPosY;
                this.requestRenderAll();
                lastPosX = e.clientX;
                lastPosY = e.clientY;
            }
        });

        canvas.on('mouse:up', function(opt) {
            if (isDragging) {
                this.setViewportTransform(this.viewportTransform);
                isDragging = false;
                canvas.selection = true;
                if (isSpaceDown) {
                    canvas.defaultCursor = 'grab';
                } else {
                    canvas.defaultCursor = 'default';
                }
            }
        });
    }

    // --- Wizard Navigation Logic ---
    // --- Step 1: Image Input Logic ---
    let currentImageSrc = null;
    let currentStep = 1;

    function goToStep(step) {
        currentStep = step;
        // Hide all
        step1View.classList.add('hidden');
        step3View.classList.add('hidden');
        
        // Reset Indicators
        ind1.className = 'step';
        ind2.className = 'step';

        if (step === 1) {
            step1View.classList.remove('hidden');
            ind1.classList.add('active');
        } else if (step === 3 || step === 2) {
            step3View.classList.remove('hidden');
            ind1.classList.add('completed');
            ind2.classList.add('active');
        }
    }

    // --- Step 1: Image Input Logic ---

    function setImageSourceAndProceed(src) {
        currentImageSrc = src;
        
        window.samMaskUrls = null;
        window.isSamAnalyzing = true;
        
        // --- SAMモードをデフォルトでオンにする ---
        isSAMMode = true;
        // 他のモードをオフにする
        isDemolitionMode = false;
        const brushBtn = document.getElementById('demolitionBrushBtn');
        if(brushBtn) {
            brushBtn.style.color = 'var(--text-primary)';
            brushBtn.style.borderColor = 'var(--border-color)';
        }
        
        fabric.Image.fromURL(currentImageSrc, function(img) {
            const maxDim = 1280;
            const origWidth = img.width;
            const origHeight = img.height;
            let newWidth = origWidth;
            let newHeight = origHeight;
            if (Math.max(origWidth, origHeight) > maxDim) {
                if (origWidth > origHeight) {
                    newWidth = maxDim;
                    newHeight = Math.round((origHeight * maxDim) / origWidth);
                } else {
                    newHeight = maxDim;
                    newWidth = Math.round((origWidth * maxDim) / origHeight);
                }
            }
            
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = newWidth;
            tempCanvas.height = newHeight;
            const tempCtx = tempCanvas.getContext('2d');
            // 注意: img.getElement() で元の画像要素を取得
            tempCtx.drawImage(img.getElement(), 0, 0, newWidth, newHeight);
            const optimizedImageB64 = tempCanvas.toDataURL('image/jpeg', 0.9);
            
            // バックグラウンドで解析開始
            function preloadWithRetry() {
                console.log("バックグラウンド解析を開始します...");
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 300000); // 5分でフロント側でもタイムアウト

                fetch('/api/segment_preload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: optimizedImageB64 }),
                    signal: controller.signal
                })
                .then(res => {
                    clearTimeout(timeoutId);
                    if (!res.ok) {
                        // 504 Gateway TimeoutなどでHTMLが返ってきた場合のパースエラーを防ぐ
                        return res.text().then(text => {
                            throw new Error(`HTTP ${res.status}: ${text.substring(0, 100)}`);
                        });
                    }
                    return res.json();
                })
                .then(data => {
                    if (!data.success) {
                        throw new Error(data.error || "Unknown API error");
                    }
                    window.isSamAnalyzing = false;
                    window.samMaskUrls = data.mask_urls;
                    console.log("全自動解析完了:", data.mask_urls.length, "個のブロックを検出");
                    
                    // ローディング画面を消す
                    loadingOverlay.classList.add('hidden');
                    
                    // ユーザーがクリックして待機していた場合は完了を知らせる
                    if (loadingText.textContent.includes("事前解析中")) {
                        setTimeout(() => {
                            alert("事前解析が完了しました！キャンバス上の抽出したい建物をクリックしてください。");
                        }, 100);
                    }
                })
                .catch(err => {
                    window.isSamAnalyzing = false;
                    window.samMaskUrls = null; // エラー時は明示的にnullにする
                    console.error("全自動解析エラー:", err);
                    loadingOverlay.classList.add('hidden'); // エラー時にも確実ローディングを消す
                    
                    setTimeout(() => {
                        if (err.name === 'AbortError') {
                            alert("事前解析がタイムアウトしました（5分超過）。画像が複雑すぎるか、サーバーが混雑しています。手動ブラシをご利用ください。");
                        } else {
                            alert("自動ブロック解析に失敗しました。\n詳細: " + err.message + "\n手動の解体ブラシをご利用ください。");
                        }
                    }, 100);
                });
            }
            preloadWithRetry();
        
            const scale = maxCanvasWidth / img.width;
            canvas.setWidth(maxCanvasWidth);
            canvas.setHeight(img.height * scale);
            
            img.set({
                scaleX: scale,
                scaleY: scale,
                originX: 'left',
                originY: 'top'
            });
            canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
            
            // SAMモード用のカーソル
            canvas.defaultCursor = 'crosshair';
            
            // Clear previous layers
            canvas.getObjects().forEach(o => canvas.remove(o));
            
            goToStep(3);
        });
    }

    // 1-A. File Upload (Drag & Drop)
    const handleFile = (file) => {
        if (!file.type.startsWith('image/')) {
            alert('画像ファイルを選択してください。');
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            setImageSourceAndProceed(e.target.result);
        };
        reader.readAsDataURL(file);
    };

    uploadBox.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadBox.style.borderColor = 'var(--accent-color)';
    });

    uploadBox.addEventListener('dragleave', () => {
        uploadBox.style.borderColor = 'var(--border-color)';
    });

    uploadBox.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadBox.style.borderColor = 'var(--border-color)';
        if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
    });

    uploadBox.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleFile(e.target.files[0]);
    });

    // 1-B. Google Maps Mock (Address Search) -> Real API Integration
    const gmapsPanel = document.getElementById('gmapsPanel');
    const streetViewPanoramaDiv = document.getElementById('streetViewPanorama');
    const captureMapBtn = document.getElementById('captureMapBtn');
    let currentPanorama = null;
    let currentGeoLocation = null;

    searchMapBtn.addEventListener('click', async () => {
        const address = addressInput.value.trim();
        if (!address) {
            alert("住所を入力してください。");
            return;
        }
        if (!window.google || !window.google.maps) {
            alert("Google Maps APIの読み込み中です。少し待ってから再度お試しください。");
            return;
        }
        
        loadingText.textContent = "住所からストリートビューを検索中...";
        loadingOverlay.classList.remove('hidden');
        
        try {
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ address: address }, (results, status) => {
                if (status === 'OK' && results[0]) {
                    currentGeoLocation = results[0].geometry.location;
                    
                    // ストリートビュー画像が対象座標の近く（半径100m以内）に存在するかを確認
                    const svService = new google.maps.StreetViewService();
                    svService.getPanorama({ location: currentGeoLocation, radius: 100 }, (data, svStatus) => {
                        loadingOverlay.classList.add('hidden');
                        
                        if (svStatus === 'OK') {
                            streetViewPanoramaDiv.classList.remove('hidden');
                            captureMapBtn.classList.remove('hidden');
                            
                            // DOMの再描画（hidden除去によるサイズ再計算）を待ってからマップを初期化
                            setTimeout(() => {
                                currentPanorama = new google.maps.StreetViewPanorama(
                                    streetViewPanoramaDiv, {
                                        position: data.location.latLng,
                                        pov: { heading: 0, pitch: 0 },
                                        zoom: 1,
                                        addressControl: false,
                                        linksControl: true,
                                        panControl: true,
                                        enableCloseButton: false
                                    }
                                );
                            }, 50);
                        } else {
                            alert("指定された住所の付近にストリートビューのデータが見つかりませんでした。別の住所や大通り沿いの住所をお試しください。");
                        }
                    });
                } else {
                    loadingOverlay.classList.add('hidden');
                    alert("住所が見つかりませんでした。別の住所をお試しください。");
                }
            });
        } catch (error) {
            console.error("Geocoding error:", error);
            loadingOverlay.classList.add('hidden');
            alert("エラーが発生しました。");
        }
    });

    captureMapBtn.addEventListener('click', async () => {
        if (!currentPanorama) return;
        
        const pov = currentPanorama.getPov();
        const position = currentPanorama.getPosition();
        
        loadingText.textContent = "高解像度の背景画像をキャプチャ中...";
        loadingOverlay.classList.remove('hidden');
        gmapsPanel.classList.add('hidden');
        
        try {
            // ローカルのPythonサーバーへリクエストを送信
            const response = await fetch('/api/get_streetview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    address: `${position.lat()},${position.lng()}`,
                    heading: pov.heading,
                    pitch: pov.pitch,
                    fov: 90 / currentPanorama.getZoom() // 近似fov
                })
            });
            
            const data = await response.json();
            
            if (response.ok && data.success) {
                setImageSourceAndProceed(data.image_url);
                streetViewPanoramaDiv.classList.add('hidden');
                captureMapBtn.classList.remove('hidden');
                addressInput.value = '';
            } else {
                alert("キャプチャエラー: " + (data.error || "不明なエラーが発生しました。"));
            }
        } catch (error) {
            console.error("Fetch error:", error);
            alert("サーバー通信エラー: バックエンドサーバーが起動しているか確認してください。");
        } finally {
            loadingOverlay.classList.add('hidden');
        }
    });
    // --- Modal Logic ---
    const aiBuildingModal = document.getElementById('aiBuildingModal');
    const openAiModalBtn = document.getElementById('openAiModalBtn');
    const closeAiModalBtn = document.getElementById('closeAiModalBtn');

    openAiModalBtn.addEventListener('click', () => {
        aiBuildingModal.classList.remove('hidden');
    });
    
    closeAiModalBtn.addEventListener('click', () => {
        aiBuildingModal.classList.add('hidden');
    });

    // --- Generate AI Content ---
    generateBtn.addEventListener('click', async () => {
        if (!currentImageSrc) return;

        const prompt = document.getElementById('prompt').value;

        // Show loading
        loadingText.textContent = "AIが建物をデザイン・合成しています...";
        loadingOverlay.classList.remove('hidden');
        resultMessage.textContent = '';
        generateBtn.disabled = true;

        try {
            const response = await fetch('/api/generate_building', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: currentImageSrc,
                    mask: "dummy_mask_for_initial_generation",
                    prompt: `${prompt}, 【Absolute Rule: Keep the original background environment strictly unchanged, exactly preserve all surroundings, do not alter adjacent buildings or roads】, architectural photography, highly detailed`
                })
            });
            const data = await response.json();
            
            loadingOverlay.classList.add('hidden');
            generateBtn.disabled = false;
            
            // モーダルを閉じる
            aiBuildingModal.classList.add('hidden');

            if (data.error) {
                    setTimeout(() => {
                        alert("APIエラー: " + data.error + "\n（※現在はキーがないためエラーを返していますが、システムは正常に疎通しています！）");
                    }, 50);
                    
                    // フォールバック: ダミー画像の追加
                    const dummyGeneratedBuildingUrl = 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?q=80&w=600&auto=format&fit=crop';
                    fabric.Image.fromURL(dummyGeneratedBuildingUrl, function(aiImg) {
                        if (!aiImg) return;
                        const aiScale = (canvas.width * 0.6) / aiImg.width;
                        aiImg.set({
                            scaleX: aiScale,
                            scaleY: aiScale,
                            left: canvas.width / 2,
                            top: canvas.height / 2,
                            originX: 'center',
                            originY: 'center',
                            hasControls: true,
                            hasBorders: true,
                            borderColor: '#6366f1',
                            cornerColor: '#6366f1',
                            transparentCorners: false,
                            cornerSize: 8,
                            cornerStyle: 'circle'
                        });
                        canvas.add(aiImg);
                        canvas.setActiveObject(aiImg);
                        canvas.renderAll();
                    }, { crossOrigin: 'anonymous' });
                } else {
                    saveHistory(); // Save before adding new AI object
                    fabric.Image.fromURL(data.image_url, function(aiImg) {
                        if (!aiImg) return;
                        let aiScaleX, aiScaleY, aiLeft, aiTop, aiOriginX, aiOriginY;
                        if (canvas.backgroundImage) {
                            // Perfect fit to the original background scale and position
                            aiScaleX = (canvas.backgroundImage.width * canvas.backgroundImage.scaleX) / aiImg.width;
                            aiScaleY = (canvas.backgroundImage.height * canvas.backgroundImage.scaleY) / aiImg.height;
                            aiLeft = 0;
                            aiTop = 0;
                            aiOriginX = 'left';
                            aiOriginY = 'top';
                        } else {
                            aiScaleX = (canvas.width * 0.6) / aiImg.width;
                            aiScaleY = aiScaleX;
                            aiLeft = canvas.width / 2;
                            aiTop = canvas.height / 2;
                            aiOriginX = 'center';
                            aiOriginY = 'center';
                        }

                        aiImg.set({
                            scaleX: aiScaleX,
                            scaleY: aiScaleY,
                            left: aiLeft,
                            top: aiTop,
                            originX: aiOriginX,
                            originY: aiOriginY,
                            hasControls: true,
                            hasBorders: true,
                            borderColor: '#6366f1',
                            cornerColor: '#6366f1',
                            transparentCorners: false,
                            cornerSize: 8,
                            cornerStyle: 'circle'
                        });
                        canvas.add(aiImg);
                        canvas.setActiveObject(aiImg);
                        canvas.renderAll();
                    }, { crossOrigin: 'anonymous' });
                }
        } catch (error) {
            loadingOverlay.classList.add('hidden');
            generateBtn.disabled = false;
            setTimeout(() => {
                alert("サーバー通信エラー: " + error);
            }, 50);
        }
    });

    // --- Step 3: Canvas Resets ---
    resetBtn.addEventListener('click', () => {
        canvas.clear();
        canvas.setBackgroundImage(null, canvas.renderAll.bind(canvas));
        fileInput.value = '';
        addressInput.value = '';
        currentImageSrc = null;
        
        // Reset dimensions
        dimensionGroup = null;
        dimensionsVisible = false;
        dimensionToggleBtn.innerHTML = '<i class="fa-solid fa-ruler"></i> 寸法 (OFF)';
        dimensionToggleBtn.style.color = 'var(--text-primary)';
        dimensionToggleBtn.style.borderColor = 'var(--border-color)';
        
        goToStep(1);
    });

    // --- Layer Operations (The Magic) ---

    // --- モード切替の排他制御リセット ---
    function resetToolModes() {
        // 解体ブラシモードOFF
        isDemolitionMode = false;
        canvas.isDrawingMode = false;
        demolitionBrushBtn.style.color = 'var(--text-primary)';
        demolitionBrushBtn.style.borderColor = 'var(--border-color)';
        executeDemolitionBtn.classList.add('hidden');
        
        // SAMモードON (デフォルト)
        isSAMMode = true;
    }

    // Demolition Brush (Inpainting Mask Mock)
    demolitionBrushBtn.addEventListener('click', () => {
        const wasDemolition = isDemolitionMode;
        resetToolModes();
        
        if (!wasDemolition) {
            isDemolitionMode = true;
            isSAMMode = false; // 解体ブラシ時はSAMをOFF
            canvas.isDrawingMode = true;
            
            demolitionBrushBtn.style.color = '#ef4444';
            demolitionBrushBtn.style.borderColor = '#ef4444';
            executeDemolitionBtn.classList.remove('hidden');
            
            // Set brush properties (semi-transparent red)
            canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
            canvas.freeDrawingBrush.color = 'rgba(239, 68, 68, 0.5)';
            canvas.freeDrawingBrush.width = 30;
        }
    });

    // 解体ブラシ：長押しで塗る＆タッチで消す仕様
    canvas.on('mouse:down', function(o) {
        if (isSpaceDown || (o.e && o.e.altKey)) return;
        if (!isDemolitionMode) return;
    });

    canvas.on('path:created', function(opt) {
        if (isDemolitionMode) {
            const newPath = opt.path;
            // 単なるクリック（点）はパスの頂点数が少ない
            if (newPath.path && newPath.path.length <= 4) {
                // ゴミパス（点）を削除
                canvas.remove(newPath);
                
                // クリック位置
                const pointer = { x: newPath.left + newPath.width / 2, y: newPath.top + newPath.height / 2 };
                
                // 重なる赤いパスを削除（消しゴム機能）
                const objects = canvas.getObjects();
                for (let i = objects.length - 1; i >= 0; i--) {
                    const obj = objects[i];
                    if (obj.isDemolitionPath && obj !== newPath) {
                        if (obj.containsPoint(pointer)) {
                            canvas.remove(obj);
                            break; // 1つ消したら終了
                        }
                    }
                }
                canvas.renderAll();
            } else {
                // ドラッグで描かれた正常なパス
                newPath.set({ 
                    isDemolitionPath: true, 
                    selectable: false,
                    evented: false
                });
            }
        }
    });

    executeDemolitionBtn.addEventListener('click', () => {
        // --- Mask Generation Logic ---
        let finalMaskB64 = null;

        if (window.lastGeneratedAiMask) {
            finalMaskB64 = window.lastGeneratedAiMask;
        } else {
            // 1. Save original background state
            const originalBg = canvas.backgroundImage;
            const originalBgColor = canvas.backgroundColor;
            canvas.setBackgroundImage(null, () => {});
            canvas.backgroundColor = 'black';
            
            // 2. Hide non-mask objects and turn red paths white
            const objects = canvas.getObjects();
            const hiddenObjects = [];
            const maskPaths = [];
            
            objects.forEach(obj => {
                if (obj instanceof fabric.Path && obj.stroke === 'rgba(239, 68, 68, 0.5)') {
                    maskPaths.push({
                        obj: obj,
                        originalStroke: obj.stroke,
                        originalOpacity: obj.opacity
                    });
                    obj.set('stroke', 'white');
                    obj.set('opacity', 1); // Make it fully opaque
                } else {
                    if (obj.visible) {
                        hiddenObjects.push(obj);
                        obj.set('visible', false);
                    }
                }
            });
            
            // 3. Render and get base64 mask
            canvas.renderAll();
            finalMaskB64 = canvas.toDataURL({ format: 'png' });
            
            // 4. Revert everything back
            canvas.setBackgroundImage(originalBg, () => {});
            canvas.backgroundColor = originalBgColor;
            maskPaths.forEach(item => {
                item.obj.set('stroke', item.originalStroke);
                item.obj.set('opacity', item.originalOpacity);
                canvas.remove(item.obj);
            });
            hiddenObjects.forEach(obj => obj.set('visible', true));
            canvas.renderAll();
        }
        
        // --- Execution ---
        loadingText.textContent = "AIが指定領域の建物を撤去し、背景を自動補完（インペインティング）しています...";
        loadingOverlay.classList.remove('hidden');
        executeDemolitionBtn.disabled = true;

        fetch('/api/generate_building', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image: canvas.backgroundImage ? canvas.backgroundImage.getSrc() : "",
                mask: finalMaskB64, 
                action_type: 'demolition',
                prompt: "Seamless background, natural continuation of the surroundings, empty space, clear sky, empty ground, neighborhood landscape, photorealistic, no buildings"
            })
        })
        .then(res => {
            if (!res.ok) {
                return res.text().then(text => {
                    throw new Error(`HTTP ${res.status}: ${text.substring(0, 100)}`);
                });
            }
            return res.json();
        })
        .then(data => {
            loadingOverlay.classList.add('hidden');
            executeDemolitionBtn.disabled = false;
            
            // Turn off drawing mode
            isDemolitionMode = false;
            canvas.isDrawingMode = false;
            demolitionBrushBtn.style.color = 'var(--text-primary)';
            demolitionBrushBtn.style.borderColor = 'var(--border-color)';
            executeDemolitionBtn.classList.add('hidden');

            if (data.error) {
                setTimeout(() => {
                    alert("APIエラー: " + data.error + "\n（※現在はキーがないためエラーを返していますが、システムは正常に疎通しています！）");
                }, 100);
            } else {
                saveHistory(); // Save state before changing
                fabric.Image.fromURL(data.image_url, function(bgImg) {
                    if (!bgImg) return;
                    const scale = maxCanvasWidth / bgImg.width;
                    canvas.setWidth(maxCanvasWidth);
                    canvas.setHeight(bgImg.height * scale);
                    bgImg.set({ scaleX: scale, scaleY: scale, originX: 'left', originY: 'top' });
                    canvas.setBackgroundImage(bgImg, canvas.requestRenderAll.bind(canvas));
                    currentImageSrc = data.image_url;
                }, { crossOrigin: 'anonymous' });
            }
        })
        .catch(err => {
            loadingOverlay.classList.add('hidden');
            executeDemolitionBtn.disabled = false;
            setTimeout(() => {
                alert("通信エラーが発生しました。\n詳細: " + err.message);
            }, 100);
        });
    });

    // Dimension Toggle (Mock BIM Feature)
    dimensionToggleBtn.addEventListener('click', () => {
        if (!canvas.backgroundImage) return;

        dimensionsVisible = !dimensionsVisible;

        if (dimensionsVisible) {
            // Update button style
            dimensionToggleBtn.innerHTML = '<i class="fa-solid fa-ruler"></i> 寸法 (ON)';
            dimensionToggleBtn.style.color = '#4ade80';
            dimensionToggleBtn.style.borderColor = '#4ade80';

            // Create mock dimensions if they don't exist
            if (!dimensionGroup) {
                const bg = canvas.backgroundImage;
                const objects = [];

                // Helper to create a dimension line with text
                const createDimension = (x1, y1, x2, y2, textStr, offsetLabelX, offsetLabelY) => {
                    const line = new fabric.Line([x1, y1, x2, y2], {
                        stroke: '#ef4444', // Red dimension lines
                        strokeWidth: 2,
                        selectable: false,
                        evented: false
                    });
                    
                    // Small ticks at ends
                    const tickSize = 10;
                    const isVertical = x1 === x2;
                    const tick1 = new fabric.Line(
                        isVertical ? [x1 - tickSize, y1, x1 + tickSize, y1] : [x1, y1 - tickSize, x1, y1 + tickSize],
                        { stroke: '#ef4444', strokeWidth: 2, selectable: false }
                    );
                    const tick2 = new fabric.Line(
                        isVertical ? [x2 - tickSize, y2, x2 + tickSize, y2] : [x2, y2 - tickSize, x2, y2 + tickSize],
                        { stroke: '#ef4444', strokeWidth: 2, selectable: false }
                    );

                    const textBg = new fabric.Rect({
                        left: (x1 + x2) / 2 + offsetLabelX - 5,
                        top: (y1 + y2) / 2 + offsetLabelY - 5,
                        fill: 'rgba(0,0,0,0.7)',
                        width: 70,
                        height: 25,
                        rx: 4,
                        ry: 4,
                        originX: 'center',
                        originY: 'center',
                        selectable: false
                    });

                    const text = new fabric.Text(textStr, {
                        left: (x1 + x2) / 2 + offsetLabelX,
                        top: (y1 + y2) / 2 + offsetLabelY,
                        fontSize: 16,
                        fontFamily: 'Inter',
                        fill: '#ffffff',
                        originX: 'center',
                        originY: 'center',
                        selectable: false
                    });

                    objects.push(line, tick1, tick2, textBg, text);
                };

                // Add some mock dimensions based on canvas size
                // Example: Building height (vertical line on the left side)
                createDimension(
                    bg.width * 0.2, bg.height * 0.1, 
                    bg.width * 0.2, bg.height * 0.8, 
                    "H: 28.5m", -45, 0
                );
                
                // Example: Road width (horizontal line near bottom)
                createDimension(
                    bg.width * 0.3, bg.height * 0.9, 
                    bg.width * 0.7, bg.height * 0.9, 
                    "W: 6.0m", 0, 20
                );

                dimensionGroup = new fabric.Group(objects, {
                    selectable: false,
                    evented: false
                });
                canvas.add(dimensionGroup);
            }
            dimensionGroup.set({ visible: true });
            
        } else {
            // Hide
            dimensionToggleBtn.innerHTML = '<i class="fa-solid fa-ruler"></i> 寸法 (OFF)';
            dimensionToggleBtn.style.color = 'var(--text-primary)';
            dimensionToggleBtn.style.borderColor = 'var(--border-color)';
            if (dimensionGroup) {
                dimensionGroup.set({ visible: false });
            }
        }
        canvas.renderAll();
    });


    canvas.on('mouse:down', function(opt) {
        if (isSpaceDown || (opt.e && opt.e.altKey)) return;
        if (isDemolitionMode) return; // 解体ブラシ中は動作しない
        if (!isSAMMode) return; // SAM抽出モードでない場合は動作しない

        if(canvas.backgroundImage) {
            // 他のオブジェクトをクリックした場合は無視
            if (opt.target && opt.target !== canvas.backgroundImage && opt.target.customType !== 'ai-mask-visual') {
                return;
            }

            if (window.isSamAnalyzing) {
                loadingText.textContent = "AIが建物のブロック構造を事前解析中です（完了まで約30秒）...";
                loadingOverlay.classList.remove('hidden');
                return;
            }
            
            if (!window.samMaskUrls || window.samMaskUrls.length === 0) {
                alert("自動ブロック抽出に失敗したか、準備ができていません。手動の「解体ブラシ」をご利用ください。");
                return;
            }

            let pointer = canvas.getPointer(opt.e);
            const bg = canvas.backgroundImage;
            const scale = bg.scaleX || 1;
            
            // Map pointer to original image coordinates (accounting for origin dynamically)
            let bgLeft = bg.left;
            let bgTop = bg.top;
            if (bg.originX === 'center') bgLeft -= (bg.width * scale) / 2;
            if (bg.originY === 'center') bgTop -= (bg.height * scale) / 2;
            const imgX = Math.floor((pointer.x - bgLeft) / scale);
            const imgY = Math.floor((pointer.y - bgTop) / scale);
            
            if (imgX < 0 || imgY < 0 || imgX >= bg.width || imgY >= bg.height) return;

            // 初回クリック時の初期化
            if (!isAccumulatedCanvasInit) {
                accumulatedMaskCanvas.width = bg.width;
                accumulatedMaskCanvas.height = bg.height;
                accumulatedMaskCtx.fillStyle = "black";
                accumulatedMaskCtx.fillRect(0, 0, accumulatedMaskCanvas.width, accumulatedMaskCanvas.height);
                isAccumulatedCanvasInit = true;
                window.lastGeneratedAiMask = null;
            }

            // --- 画像圧縮ロジック (Max 1280px) ---
            const maxDim = 1280;
            const origWidth = bg.width;
            const origHeight = bg.height;
            let newWidth = origWidth;
            let newHeight = origHeight;
            
            if (Math.max(origWidth, origHeight) > maxDim) {
                if (origWidth > origHeight) {
                    newWidth = maxDim;
                    newHeight = Math.round((origHeight * maxDim) / origWidth);
                } else {
                    newHeight = maxDim;
                    newWidth = Math.round((origWidth * maxDim) / origHeight);
                }
            }
            
            loadingOverlay.classList.remove('hidden');
            loadingText.textContent = "クリックしたブロックを高速抽出中...";
            
            fetch('/api/segment_pick', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mask_urls: window.samMaskUrls,
                    x: Math.round(imgX * (newWidth / origWidth)),
                    y: Math.round(imgY * (newHeight / origHeight))
                })
            })
            .then(res => {
                if (!res.ok) {
                    return res.text().then(text => {
                        throw new Error(`HTTP ${res.status}: ${text.substring(0, 100)}`);
                    });
                }
                return res.json();
            })
            .then(data => {
                if (data.error) {
                    loadingOverlay.classList.add('hidden');
                    setTimeout(() => alert("APIエラー: " + data.error), 100);
                } else {
                    // APIから返ってきたマスク画像を読み込み、既存のマスクと合成する
                    const newMaskImg = new Image();
                    newMaskImg.crossOrigin = "anonymous";
                    newMaskImg.onload = () => {
                        samMaskCanvas.width = newMaskImg.width;
                        samMaskCanvas.height = newMaskImg.height;
                        samMaskCtx.drawImage(newMaskImg, 0, 0);
                        
                        accumulatedMaskCtx.globalCompositeOperation = "source-over";
                        accumulatedMaskCtx.drawImage(samMaskCanvas, 0, 0, origWidth, origHeight);
                        accumulatedMaskCtx.globalCompositeOperation = "source-over";
                        
                        const accImgData = accumulatedMaskCtx.getImageData(0, 0, origWidth, origHeight);
                        const accData = accImgData.data;
                        
                        const visualCanvas = document.createElement('canvas');
                        visualCanvas.width = origWidth;
                        visualCanvas.height = origHeight;
                        const visualCtx = visualCanvas.getContext('2d');
                        const visualImgData = visualCtx.createImageData(origWidth, origHeight);
                        const vData = visualImgData.data;
                        
                        let hasAnyMask = false;
                        for (let i = 0; i < accData.length; i += 4) {
                            if (accData[i] > 128) {
                                hasAnyMask = true;
                                vData[i] = 239; vData[i+1] = 68; vData[i+2] = 68; vData[i+3] = 128;
                                accData[i] = 255; accData[i+1] = 255; accData[i+2] = 255; accData[i+3] = 255;
                            } else {
                                vData[i] = 0; vData[i+1] = 0; vData[i+2] = 0; vData[i+3] = 0;
                                accData[i] = 0; accData[i+1] = 0; accData[i+2] = 0; accData[i+3] = 255;
                            }
                        }
                        
                        accumulatedMaskCtx.putImageData(accImgData, 0, 0);
                        visualCtx.putImageData(visualImgData, 0, 0);
                        
                        const objects = canvas.getObjects();
                        for (let i = objects.length - 1; i >= 0; i--) {
                            if (objects[i].customType === 'ai-mask-visual') {
                                canvas.remove(objects[i]);
                            }
                        }
                        
                        if (hasAnyMask) {
                            window.lastGeneratedAiMask = accumulatedMaskCanvas.toDataURL('image/png');
                            fabric.Image.fromURL(visualCanvas.toDataURL('image/png'), function(img) {
                                img.set({ scaleX: scale, scaleY: scale, left: 0, top: 0, originX: 'left', originY: 'top', customType: 'ai-mask-visual', selectable: false, evented: false });
                                canvas.add(img);
                                canvas.renderAll();
                                loadingOverlay.classList.add('hidden');
                                
                                // 抽出に成功したら、すぐにAI合成モーダルを立ち上げてシームレスに促す
                                setTimeout(() => {
                                    document.getElementById('aiBuildingModal').classList.remove('hidden');
                                }, 300);
                            });
                        } else {
                            window.lastGeneratedAiMask = null;
                            canvas.renderAll();
                            loadingOverlay.classList.add('hidden');
                        }
                    };
                    newMaskImg.src = data.mask_url;
                }
            })
            .catch(err => {
                loadingOverlay.classList.add('hidden');
                setTimeout(() => alert("通信エラーが発生しました。\n詳細: " + err.message), 100);
            });
        }
    });

    // Download Image
    downloadBtn.addEventListener('click', () => {
        if (!canvas.backgroundImage) {
            alert("ダウンロードする画像がありません");
            return;
        }
        
        // Temporarily deselect all objects so bounding boxes don't show up in the image
        canvas.discardActiveObject();
        canvas.renderAll();

        const dataURL = canvas.toDataURL({
            format: 'png',
            quality: 1
        });
        
        const link = document.createElement('a');
        link.download = 'nespakono_result.png';
        link.href = dataURL;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    // --- Sidebar Menu Logic (Mock) ---
    const sidebarItems = document.querySelectorAll('.tool-list li:not(.disabled)');
    const itemGeneratorPanel = document.getElementById('itemGeneratorPanel');
    const blueprintPanel = document.getElementById('blueprintPanel');
    const generateItemBtn = document.getElementById('generateItemBtn');
    const itemPrompt = document.getElementById('itemPrompt');
    const closeBlueprintBtn = document.getElementById('closeBlueprintBtn');
    const generate3DBuildingBtn = document.getElementById('generate3DBuildingBtn');

    sidebarItems.forEach(item => {
        item.addEventListener('click', () => {
            // Remove active class from all
            sidebarItems.forEach(li => li.classList.remove('active'));
            // Add active class to clicked
            item.classList.add('active');

            const toolName = item.getAttribute('data-tool');
            
            // Item Generator logic
            if (toolName === 'fence') { // "アイテム生成" is using data-tool="fence"
                if (currentStep === 3) {
                    itemGeneratorPanel.classList.remove('hidden');
                    blueprintPanel.classList.add('hidden');
                    gmapsPanel.classList.add('hidden');
                } else {
                    alert("まずはベース画像を設定し、キャンバス画面（Step 3）に進んでください。");
                }
            } else if (toolName === '2d-to-3d') {
                if (currentStep === 3) {
                    blueprintPanel.classList.remove('hidden');
                    itemGeneratorPanel.classList.add('hidden');
                    gmapsPanel.classList.add('hidden');
                } else {
                    alert("まずはベース画像を設定し、キャンバス画面（Step 3）に進んでください。");
                }
            } else if (toolName === 'gmaps') {
                gmapsPanel.classList.remove('hidden');
                itemGeneratorPanel.classList.add('hidden');
                blueprintPanel.classList.add('hidden');
            } else {
                itemGeneratorPanel.classList.add('hidden');
                blueprintPanel.classList.add('hidden');
                gmapsPanel.classList.add('hidden');
            }
        });
    });

    closeBlueprintBtn.addEventListener('click', () => {
        blueprintPanel.classList.add('hidden');
    });

    // Generate 3D Building Mock
    generate3DBuildingBtn.addEventListener('click', () => {
        blueprintPanel.classList.add('hidden');
        loadingOverlay.classList.remove('hidden');
        loadingText.textContent = `AIが2D図面を解析し、3Dパースを生成しています...`;

        setTimeout(() => {
            loadingOverlay.classList.add('hidden');
            
            // Dummy high-quality modern house (as a proxy for 3D model)
            // In a real app, this would be a rendered image with transparent background
            const dummyBuildingUrl = 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?q=80&w=600&auto=format&fit=crop';

            fabric.Image.fromURL(dummyBuildingUrl, function(mockImg) {
                mockImg.set({
                    left: canvas.width / 2,
                    top: canvas.height / 2,
                    originX: 'center',
                    originY: 'center',
                    scaleX: 0.7,
                    scaleY: 0.7,
                    cornerStyle: 'circle',
                    cornerColor: '#eab308',
                    borderColor: '#eab308',
                    transparentCorners: false,
                    hasControls: true,
                    hasBorders: true,
                    shadow: new fabric.Shadow({
                        color: 'rgba(0,0,0,0.8)',
                        blur: 20,
                        offsetX: 0,
                        offsetY: 15
                    })
                });
                canvas.add(mockImg);
                canvas.setActiveObject(mockImg);
                canvas.renderAll();
                
                resultMessage.style.color = '#eab308';
                resultMessage.textContent = `【Enterprise限定】図面から3Dパースを生成し、配置しました！`;
            });
        }, 2500);
    });

    // Generate Item Mock
    generateItemBtn.addEventListener('click', () => {
        const prompt = itemPrompt.value.trim();
        if (!prompt) {
            alert("生成したいアイテムを入力してください（例：車、樹木）");
            return;
        }

        loadingOverlay.classList.remove('hidden');
        loadingText.textContent = `AIが「${prompt}」を生成しています...`;

        setTimeout(() => {
            loadingOverlay.classList.add('hidden');
            
            // Dummy transparent PNG (Tree as placeholder)
            const dummyItemUrl = 'https://images.unsplash.com/photo-1596541604085-3b96fa1a113d?q=80&w=300&auto=format&fit=crop';
            // Note: Since it's hard to find a perfect isolated transparent PNG URL quickly, we use a small crop of a regular image with rounded corners to mock an object.

            fabric.Image.fromURL(dummyItemUrl, function(mockImg) {
                mockImg.set({
                    left: canvas.width / 2,
                    top: canvas.height / 2,
                    originX: 'center',
                    originY: 'center',
                    scaleX: 0.8,
                    scaleY: 0.8,
                    cornerStyle: 'circle',
                    cornerColor: '#4ade80',
                    borderColor: '#4ade80',
                    transparentCorners: false,
                    hasControls: true,
                    hasBorders: true,
                    shadow: new fabric.Shadow({
                        color: 'rgba(0,0,0,0.6)',
                        blur: 15,
                        offsetX: 0,
                        offsetY: 10
                    })
                });
                canvas.add(mockImg);
                canvas.setActiveObject(mockImg);
                canvas.renderAll();
                
                resultMessage.style.color = '#4ade80';
                resultMessage.textContent = `「${prompt}」を配置しました！自由に移動・縮小してください。`;
                
                // Hide panel after generation
                itemGeneratorPanel.classList.add('hidden');
                itemPrompt.value = '';
            });
        }, 1500);
    });

    // Delete Active Layer
    deleteBtn.addEventListener('click', () => {
        const activeObj = canvas.getActiveObject();
        if (activeObj) {
            canvas.remove(activeObj);
            canvas.discardActiveObject();
            canvas.renderAll();
        }
    });

    // Bring to Front
    bringFrontBtn.addEventListener('click', () => {
        const activeObj = canvas.getActiveObject();
        if (activeObj) {
            canvas.bringToFront(activeObj);
            canvas.renderAll();
        }
    });

    // Send to Back
    sendBackBtn.addEventListener('click', () => {
        const activeObj = canvas.getActiveObject();
        if (activeObj) {
            canvas.sendBackwards(activeObj);
            canvas.renderAll();
        }
    });

    // Keyboard support for Delete
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            // Check if we are not in the textarea
            if (e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
                const activeObj = canvas.getActiveObject();
                if (activeObj) {
                    canvas.remove(activeObj);
                    canvas.discardActiveObject();
                    canvas.renderAll();
                }
            }
        }
    });

});
