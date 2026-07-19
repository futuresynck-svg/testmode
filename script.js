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


        // SAM Masks State
        window.activeSamMasks = new Set(); 
        const accumulatedMaskCanvas = document.createElement('canvas');
        const accumulatedMaskCtx = accumulatedMaskCanvas.getContext('2d');
        let isAccumulatedCanvasInit = false;

        function updateAccumulatedMask() {
            if (window.activeSamMasks.size === 0) {
                window.lastGeneratedAiMask = null;
                return;
            }
            // Generate a combined mask from all active visual masks
            const bg = canvas.backgroundImage;
            if (!bg) return;
            
            accumulatedMaskCanvas.width = bg.width;
            accumulatedMaskCanvas.height = bg.height;
            accumulatedMaskCtx.fillStyle = 'black';
            accumulatedMaskCtx.fillRect(0, 0, bg.width, bg.height);
            
            const scale = maxCanvasWidth / bg.width;
            
            const objects = canvas.getObjects();
            objects.forEach(obj => {
                if (obj.customType === 'ai-mask-visual' && obj.maskUrl) {
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = bg.width;
                    tempCanvas.height = bg.height;
                    const tempCtx = tempCanvas.getContext('2d');
                    
                    // We need to draw the original mask image to accumulate.
                    // But wait, the ai-mask-visual is a red version of it.
                    // We can just create a white mask by reading the pixels of the red visual mask.
                    const objCanvas = obj.toCanvasElement();
                    tempCtx.drawImage(objCanvas, 0, 0, bg.width, bg.height);
                    const imgData = tempCtx.getImageData(0, 0, bg.width, bg.height);
                    const data = imgData.data;
                    
                    const accImgData = accumulatedMaskCtx.getImageData(0, 0, bg.width, bg.height);
                    const accData = accImgData.data;
                    
                    for (let i = 0; i < data.length; i += 4) {
                        if (data[i+3] > 0) { // If it has alpha (it's the red mask)
                            accData[i] = 255;
                            accData[i+1] = 255;
                            accData[i+2] = 255;
                            accData[i+3] = 255;
                        }
                    }
                    accumulatedMaskCtx.putImageData(accImgData, 0, 0);
                }
            });
            window.lastGeneratedAiMask = accumulatedMaskCanvas.toDataURL('image/png');
        }

        canvas.on('mouse:down', function(opt) {
            if (isSpaceDown || (opt.e && opt.e.altKey)) {
                isDragging = true;
                canvas.selection = false;
                lastPosX = opt.e.clientX;
                lastPosY = opt.e.clientY;
                canvas.defaultCursor = 'grabbing';
                return;
            }

            if (isDemolitionMode) return;
            
            if (isSAMMode) {
                if (canvas.backgroundImage) {
                    // Check if they clicked an existing AI mask
                    if (opt.target && opt.target.customType === 'ai-mask-visual') {
                        // Toggle OFF
                        canvas.remove(opt.target);
                        canvas.renderAll();
                        if (opt.target.maskUrl) {
                            window.activeSamMasks.delete(opt.target.maskUrl);
                        }
                        updateAccumulatedMask();
                        
                        if (window.activeSamMasks.size === 0) {
                            document.getElementById('aiBuildingModal').classList.add('hidden');
                        }
                        return; // Done toggling off
                    }

                    if (window.isSamAnalyzing) {
                        loadingText.textContent = "AIが画像を事前解析中です...完了までしばらくお待ちください。";
                        loadingOverlay.classList.remove('hidden');
                        setTimeout(() => { loadingOverlay.classList.add('hidden'); }, 3000);
                        return;
                    }
                    
                    if (!window.samMaskUrls || window.samMaskUrls.length === 0) {
                        alert("自動ブロック抽出に失敗したか、準備ができていません。手動の「解体ブラシ」をご利用ください。");
                        return;
                    }

                    let pointer = canvas.getPointer(opt.e);
                    const bg = canvas.backgroundImage;
                    const scale = bg.scaleX || 1;
                    
                    const imgX = Math.floor(pointer.x / scale);
                    const imgY = Math.floor(pointer.y / scale);
                    
                    if (imgX < 0 || imgY < 0 || imgX >= bg.width || imgY >= bg.height) return;

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
                    loadingText.textContent = "ブロックを抽出中...";
                    
                    fetch('/api/segment_pick', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            mask_urls: window.samMaskUrls,
                            x: Math.round(imgX * (newWidth / origWidth)),
                            y: Math.round(imgY * (newHeight / origHeight))
                        })
                    })
                    .then(res => res.json())
                    .then(data => {
                        if (data.error) {
                            loadingOverlay.classList.add('hidden');
                            alert("APIエラー: " + data.error);
                        } else {
                            // Check if this mask was already selected
                            if (window.activeSamMasks.has(data.mask_url)) {
                                loadingOverlay.classList.add('hidden');
                                return; 
                            }

                            const newMaskImg = new Image();
                            newMaskImg.crossOrigin = "anonymous";
                            newMaskImg.onload = () => {
                                const tempCanvas = document.createElement('canvas');
                                tempCanvas.width = newMaskImg.width;
                                tempCanvas.height = newMaskImg.height;
                                const tempCtx = tempCanvas.getContext('2d');
                                tempCtx.drawImage(newMaskImg, 0, 0);
                                
                                const maskImgData = tempCtx.getImageData(0, 0, origWidth, origHeight);
                                const mData = maskImgData.data;
                                
                                const visualCanvas = document.createElement('canvas');
                                visualCanvas.width = origWidth;
                                visualCanvas.height = origHeight;
                                const visualCtx = visualCanvas.getContext('2d');
                                const visualImgData = visualCtx.createImageData(origWidth, origHeight);
                                const vData = visualImgData.data;
                                
                                let hasAnyMask = false;
                                for (let i = 0; i < mData.length; i += 4) {
                                    if (mData[i] > 128) {
                                        hasAnyMask = true;
                                        vData[i] = 239; vData[i+1] = 68; vData[i+2] = 68; vData[i+3] = 128; // Red semi-transparent
                                    }
                                }
                                
                                if (hasAnyMask) {
                                    visualCtx.putImageData(visualImgData, 0, 0);
                                    window.activeSamMasks.add(data.mask_url);
                                    
                                    fabric.Image.fromURL(visualCanvas.toDataURL('image/png'), function(img) {
                                        img.set({ scaleX: scale, scaleY: scale, left: 0, top: 0, originX: 'left', originY: 'top', customType: 'ai-mask-visual', maskUrl: data.mask_url, selectable: true, evented: true, hasControls: false, hasBorders: false, hoverCursor: 'pointer' });
                                        canvas.add(img);
                                        canvas.renderAll();
                                        updateAccumulatedMask();
                                        loadingOverlay.classList.add('hidden');
                                        
                                        setTimeout(() => {
                                            document.getElementById('aiBuildingModal').classList.remove('hidden');
                                        }, 100);
                                    });
                                } else {
                                    loadingOverlay.classList.add('hidden');
                                }
                            };
                            newMaskImg.src = data.mask_url;
                        }
                    })
                    .catch(err => {
                        loadingOverlay.classList.add('hidden');
                        console.error(err);
                    });
                }
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
        if (window.activeSamMasks) window.activeSamMasks.clear();
        window.lastGeneratedAiMask = null;
        const aiModal = document.getElementById('aiBuildingModal');
        if (aiModal) aiModal.classList.add('hidden');
        
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
                loadingText.textContent = "AIが画像を事前解析中です...完了までしばらくお待ちください。";
                loadingOverlay.classList.remove('hidden');
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

    const quickPromptBtns = document.querySelectorAll('.quick-prompt-btn');
    const promptTextarea = document.getElementById('prompt');
    quickPromptBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            promptTextarea.value = btn.getAttribute('data-prompt');
        });
    });
    
    closeAiModalBtn.addEventListener('click', () => {
        aiBuildingModal.classList.add('hidden');
    });

    // --- Generate AI Content ---
    // --- Generate AI Content (Unified with Mask generation) ---
    generateBtn.addEventListener('click', async () => {
        const prompt = document.getElementById('prompt').value;
        if (!prompt) {
            alert("AIへの指示（プロンプト）を入力してください。");
            return;
        }

        // --- Mask Generation Logic ---
        let finalMaskB64 = null;

        // 1. Save original background state
        const originalBg = canvas.backgroundImage;
        const originalBgColor = canvas.backgroundColor;
        
        // Use SAM mask as background if exists, else black
        let maskBgPromise = new Promise((resolve) => {
            if (window.lastGeneratedAiMask) {
                fabric.Image.fromURL(window.lastGeneratedAiMask, function(img) {
                    img.set({ scaleX: canvas.width / img.width, scaleY: canvas.height / img.height, originX: 'left', originY: 'top' });
                    canvas.setBackgroundImage(img, () => { resolve(); });
                });
            } else {
                canvas.setBackgroundImage(null, () => {});
                canvas.backgroundColor = 'black';
                resolve();
            }
        });

        await maskBgPromise;
        
        // 2. Hide non-mask objects and turn red paths white
        const objects = canvas.getObjects();
        const hiddenObjects = [];
        const maskPaths = [];
        
        objects.forEach(obj => {
            // Include brush paths
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
        });
        hiddenObjects.forEach(obj => obj.set('visible', true));
        canvas.renderAll();
        
        // --- Execution ---
        aiBuildingModal.classList.add('hidden');
        loadingText.textContent = "AIが指定領域を処理しています...";
        loadingOverlay.classList.remove('hidden');
        generateBtn.disabled = true;

        fetch('/api/generate_building', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image: canvas.backgroundImage ? canvas.backgroundImage.getSrc() : "",
                mask: finalMaskB64, 
                action_type: 'generation',
                prompt: `${prompt}, 【Absolute Rule: Keep the original background environment strictly unchanged, exactly preserve all surroundings, do not alter adjacent buildings or roads】, architectural photography, highly detailed`
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
            generateBtn.disabled = false;
            
            // Turn off drawing mode
            isDemolitionMode = false;
            canvas.isDrawingMode = false;
            demolitionBrushBtn.style.color = 'var(--text-primary)';
            demolitionBrushBtn.style.borderColor = 'var(--border-color)';

            if (data.error) {
                setTimeout(() => {
                    alert("APIエラー: " + data.error + "\n（※現在はキーがないためエラーを返していますが、システムは正常に疎通しています！）");
                }, 100);
            } else {
                saveHistory(); // Save state before changing
                
                // Clear the visual red masks from canvas
                const objects = canvas.getObjects();
                for (let i = objects.length - 1; i >= 0; i--) {
                    if (objects[i].customType === 'ai-mask-visual' || objects[i].isDemolitionPath) {
                        canvas.remove(objects[i]);
                    }
                }
                
                setImageSourceAndProceed(data.image_url);
            }
        })
        .catch(err => {
            loadingOverlay.classList.add('hidden');
            generateBtn.disabled = false;
            setTimeout(() => {
                alert("通信エラーが発生しました。\n詳細: " + err.message);
            }, 100);
        });
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
