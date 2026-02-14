// State
let mobilenetModel = null;
let classifier = null;
let videoElement = null;
let stream = null;
let classes = {};
let currentMode = 'training';
let recognitionRunning = false;
let recognitionAnimationId = null;
let useFrontCamera = false;
let isSwitchingCamera = false;
let modeSwitchTimeout = null;

// Constants
const STORAGE_KEY = 'myCarDetectorModel';
const CONFIDENCE_THRESHOLD = 0.80;
const APP_VERSION = 'v7';

// UI Elements
const trainingTab = document.getElementById('training-tab');
const recognitionTab = document.getElementById('recognition-tab');
const trainingMode = document.getElementById('training-mode');
const recognitionMode = document.getElementById('recognition-mode');
const addClassBtn = document.getElementById('add-class-btn');
const classesContainer = document.getElementById('classes-container');
const resultOverlay = document.getElementById('result-overlay');
const recognitionStatus = document.getElementById('recognition-status');
const saveModelBtn = document.getElementById('save-model-btn');
const loadModelBtn = document.getElementById('load-model-btn');
const clearModelBtn = document.getElementById('clear-model-btn');
const flipCameraBtn = document.getElementById('flip-camera-btn');
const errorElement = document.getElementById('error');

// Initialize on page load
async function init() {
    try {
        errorElement.textContent = 'Загрузка моделей...';
        
        // Check TensorFlow availability with retry logic
        let retries = 0;
        const maxRetries = 5;
        while (typeof tf === 'undefined' || typeof mobilenet === 'undefined' || typeof knnClassifier === 'undefined') {
            if (retries >= maxRetries) {
                throw new Error('Не удалось загрузить TensorFlow.js. Проверьте подключение к интернету и отключите блокировщики рекламы.');
            }
            // Yield control back to event loop between checks
            await new Promise(resolve => setTimeout(resolve, 500));
            retries++;
        }
        
        // Load MobileNet
        mobilenetModel = await mobilenet.load();
        console.log('MobileNet loaded');
        
        // Create KNN Classifier
        classifier = knnClassifier.create();
        console.log('KNN Classifier created');
        
        // Initialize camera
        await initCamera();
        
        errorElement.textContent = '';
        console.log(`🚗 My Car Detector ${APP_VERSION} loaded`);
        
        // Try to load saved model
        loadModelFromStorage();
        
    } catch (error) {
        console.error('Initialization error:', error);
        errorElement.textContent = `Ошибка инициализации: ${error.message}`;
    }
}

// Camera initialization
async function initCamera() {
    try {
        videoElement = document.getElementById('webcam');
        
        const constraints = {
            video: {
                facingMode: useFrontCamera ? 'user' : 'environment',
                width: { ideal: 640 },
                height: { ideal: 480 }
            }
        };
        
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        videoElement.srcObject = stream;
        
        return new Promise((resolve) => {
            videoElement.onloadedmetadata = () => {
                resolve();
            };
        });
        
    } catch (error) {
        console.error('Camera error:', error);
        throw new Error('Не удалось получить доступ к камере. Проверьте разрешения.');
    }
}

// Flip camera
async function flipCamera() {
    // Prevent race condition from double-clicking
    if (isSwitchingCamera) {
        console.log('Camera switch already in progress');
        return;
    }
    
    isSwitchingCamera = true;
    flipCameraBtn.disabled = true;
    flipCameraBtn.textContent = '🔄 Переключение...';
    
    useFrontCamera = !useFrontCamera;
    
    const wasRecognizing = recognitionRunning;
    stopRecognition();
    
    try {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        
        await initCamera();
        
        // Wait for video to be ready before restarting recognition
        if (wasRecognizing) {
            setTimeout(() => {
                if (currentMode === 'recognition') {
                    startRecognition();
                }
            }, 500);
        }
    } catch (error) {
        console.error('Flip camera error:', error);
        errorElement.textContent = 'Ошибка переключения камеры: ' + error.message;
    } finally {
        isSwitchingCamera = false;
        flipCameraBtn.disabled = false;
        flipCameraBtn.textContent = '🔄 Переключить камеру';
    }
}

// Mode switching
function switchMode(mode) {
    currentMode = mode;
    
    // Always stop recognition first
    stopRecognition();
    
    // Clear any pending mode switch timeout
    if (modeSwitchTimeout) {
        clearTimeout(modeSwitchTimeout);
        modeSwitchTimeout = null;
    }
    
    if (mode === 'training') {
        trainingTab.classList.add('active');
        recognitionTab.classList.remove('active');
        trainingMode.classList.add('active');
        recognitionMode.classList.remove('active');
        
        // Auto-save when leaving recognition mode (if there's data)
        autoSave();
    } else {
        trainingTab.classList.remove('active');
        recognitionTab.classList.add('active');
        trainingMode.classList.remove('active');
        recognitionMode.classList.add('active');
        
        // Small delay to ensure video is ready after UI switch
        modeSwitchTimeout = setTimeout(() => {
            if (currentMode === 'recognition') {
                startRecognition();
            }
            modeSwitchTimeout = null;
        }, 300);
    }
}

// Class management
function addClassPrompt() {
    const className = prompt('Введите название класса:', '');
    
    if (className && className.trim()) {
        const name = className.trim();
        
        // Validate class name length
        if (name.length > 50) {
            alert('Название класса слишком длинное (максимум 50 символов)');
            return;
        }
        
        // Validate class name: only letters, numbers, spaces, hyphen, underscore
        const validNameRegex = /^[a-zA-Zа-яА-ЯёЁ0-9\s_\-]+$/;
        if (!validNameRegex.test(name)) {
            alert('Название класса может содержать только буквы, цифры, пробелы, дефис и подчёркивание');
            return;
        }
        
        if (classes[name]) {
            alert('Класс с таким названием уже существует');
            return;
        }
        
        classes[name] = {
            name: name,
            examples: 0
        };
        
        renderClasses();
    }
}

function deleteClass(className) {
    if (confirm(`Удалить класс "${className}"?`)) {
        delete classes[className];
        
        // Remove from classifier
        if (classifier) {
            const classIndices = classifier.getClassifierDataset();
            if (classIndices[className]) {
                classifier.clearClass(className);
            }
        }
        
        renderClasses();
        
        // Auto-save after deletion
        autoSave();
    }
}

// Render classes
function renderClasses() {
    // iOS Safari: check if stream is still active
    if (stream && !stream.active && videoElement) {
        console.log('[MOBILE FIX] Stream lost, reinitializing camera...');
        initCamera().catch(err => {
            console.error('[MOBILE FIX] Failed to reinit camera:', err);
        });
    }
    
    classesContainer.innerHTML = '';
    
    Object.keys(classes).forEach(className => {
        const classData = classes[className];
        
        const card = document.createElement('div');
        card.className = 'class-card';
        
        // Create elements safely to prevent XSS
        const classHeader = document.createElement('div');
        classHeader.className = 'class-header';
        
        const headerContent = document.createElement('div');
        
        const nameDiv = document.createElement('div');
        nameDiv.className = 'class-name';
        nameDiv.textContent = classData.name; // Safe text content
        
        const examplesDiv = document.createElement('div');
        examplesDiv.className = 'class-examples';
        examplesDiv.textContent = `📸 ${classData.examples} примеров`;
        
        headerContent.appendChild(nameDiv);
        headerContent.appendChild(examplesDiv);
        classHeader.appendChild(headerContent);
        
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'class-actions';
        
        const captureBtn = document.createElement('button');
        captureBtn.className = 'capture-btn';
        captureBtn.dataset.class = className;
        captureBtn.textContent = 'Захватить';
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.dataset.class = className;
        deleteBtn.textContent = '🗑️';
        
        actionsDiv.appendChild(captureBtn);
        actionsDiv.appendChild(deleteBtn);
        
        card.appendChild(classHeader);
        card.appendChild(actionsDiv);
        classesContainer.appendChild(card);
    });
    
    // Remove ALL old listeners by cloning buttons (prevents accumulation on mobile)
    document.querySelectorAll('.capture-btn').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
    });
    
    // Add event listeners to fresh buttons
    document.querySelectorAll('.capture-btn').forEach(btn => {
        const className = btn.dataset.class;
        
        btn.addEventListener('mousedown', () => startCapture(className));
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            startCapture(className);
        });
        btn.addEventListener('mouseup', stopCapture);
        btn.addEventListener('touchend', stopCapture);
        btn.addEventListener('mouseleave', stopCapture);
        btn.addEventListener('touchcancel', stopCapture);
    });
    
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteClass(btn.dataset.class));
    });
    
    // iOS Safari fix: ensure video keeps playing after DOM manipulation
    if (videoElement && videoElement.paused && videoElement.srcObject) {
        console.log('[MOBILE FIX] Resuming video playback after DOM changes');
        videoElement.play().catch(err => {
            console.warn('[MOBILE FIX] Video autoplay prevented:', err);
        });
    }
}

// Capture logic
let captureInterval = null;
let isCapturing = false;
let captureDebounceTimer = null;
let currentCapturingClass = null;

async function startCapture(className) {
    // Debounce for mobile touch events
    if (captureDebounceTimer) {
        console.log('[MOBILE FIX] Capture debounced');
        return;
    }
    captureDebounceTimer = setTimeout(() => {
        captureDebounceTimer = null;
    }, 150); // 150ms protection from double tap
    
    if (!className || !classes[className]) {
        console.error('Invalid class name for capture:', className);
        return;
    }
    
    if (!mobilenetModel || !classifier) {
        errorElement.textContent = 'Модели не загружены';
        return;
    }
    
    if (isCapturing && currentCapturingClass !== className) {
        // Already capturing a different class, stop the previous one
        console.log(`[MOBILE FIX] Stopping previous capture of ${currentCapturingClass}`);
        stopCapture();
    }
    
    if (isCapturing && currentCapturingClass === className) {
        // Already capturing THIS class, ignore
        console.log('[MOBILE FIX] Already capturing this class, ignoring');
        return;
    }
    
    isCapturing = true;
    currentCapturingClass = className;
    console.log(`[MOBILE FIX] Starting capture for ${className}`);
    
    const btn = document.querySelector(`.capture-btn[data-class="${className}"]`);
    if (btn) {
        btn.classList.add('capturing');
        btn.textContent = 'Захват...';
    }
    
    async function captureFrame() {
        if (!isCapturing) {
            return;
        }
        
        try {
            // Check video is ready - ensure it has actual pixel data
            if (!videoElement.videoWidth || !videoElement.videoHeight || videoElement.readyState < 2) {
                // iOS needs more time for video to be ready
                const retryDelay = /iPhone|iPad|iPod/.test(navigator.userAgent) ? 400 : 200;
                captureInterval = setTimeout(captureFrame, retryDelay);
                return;
            }
            
            const img = tf.browser.fromPixels(videoElement);
            const activation = mobilenetModel.infer(img, true);
            classifier.addExample(activation, className);
            img.dispose();
            // Note: do NOT dispose activation - KNN classifier keeps a reference to it
            
            classes[className].examples++;
            
            // Update UI
            const examplesEl = document.querySelector(`.capture-btn[data-class="${className}"]`)
                ?.parentElement?.parentElement?.querySelector('.class-examples');
            if (examplesEl) {
                examplesEl.textContent = `📸 ${classes[className].examples} примеров`;
            }
            
            captureInterval = setTimeout(captureFrame, 100);
            
        } catch (error) {
            console.error('Capture error:', error);
            stopCapture();
        }
    }
    
    captureFrame();
}

function stopCapture() {
    console.log('[MOBILE FIX] Stopping capture');
    isCapturing = false;
    currentCapturingClass = null;
    
    if (captureInterval) {
        clearTimeout(captureInterval);
        captureInterval = null;
    }
    
    document.querySelectorAll('.capture-btn').forEach(btn => {
        btn.classList.remove('capturing');
        btn.textContent = 'Захватить';
    });
    
    // Debounce auto-save to avoid blocking UI on mobile
    setTimeout(() => autoSave(), 500);
}

// Recognition
async function startRecognition() {
    const numClasses = classifier.getNumClasses();
    
    if (numClasses < 2) {
        resultOverlay.textContent = 'Добавь минимум 2 класса!';
        resultOverlay.className = 'result-overlay no-model';
        recognitionStatus.textContent = numClasses === 0 
            ? 'Нет обученных классов' 
            : 'Нужно минимум 2 класса для сравнения';
        return;
    }
    
    // Check that all classes have examples
    const classesWithoutExamples = Object.keys(classes).filter(c => classes[c].examples === 0);
    if (classesWithoutExamples.length > 0) {
        resultOverlay.textContent = `Добавь примеры в: ${classesWithoutExamples.join(', ')}`;
        resultOverlay.className = 'result-overlay no-model';
        return;
    }
    
    recognitionRunning = true;
    recognitionStatus.textContent = 'Распознавание активно...';
    predict();
}

function stopRecognition() {
    recognitionRunning = false;
    
    if (recognitionAnimationId) {
        clearTimeout(recognitionAnimationId);
        recognitionAnimationId = null;
    }
    
    if (resultOverlay) {
        resultOverlay.className = 'result-overlay';
        resultOverlay.textContent = '';
    }
}

async function predict() {
    if (!recognitionRunning || !mobilenetModel || !classifier) {
        return;
    }
    
    let img = null;
    let activation = null;
    
    try {
        // Check video is actually playing and ready
        if (!videoElement.videoWidth || !videoElement.videoHeight || videoElement.readyState < 2 || videoElement.paused) {
            if (recognitionRunning) {
                recognitionAnimationId = setTimeout(predict, 300);
            }
            return;
        }
        
        const numClasses = classifier.getNumClasses();
        
        if (numClasses >= 2) {
            img = tf.browser.fromPixels(videoElement);
            activation = mobilenetModel.infer(img, true);
            
            const prediction = await classifier.predictClass(activation);
            
            const predictedClass = prediction.label;
            const confidence = prediction.confidences[predictedClass];
            const confidencePercent = Math.round(confidence * 100);
            
            resultOverlay.textContent = `${predictedClass} (${confidencePercent}%)`;
            
            if (confidence >= CONFIDENCE_THRESHOLD) {
                resultOverlay.className = 'result-overlay high-confidence';
            } else {
                resultOverlay.className = 'result-overlay low-confidence';
            }
            
            recognitionStatus.textContent = `Последнее: ${predictedClass} (${confidencePercent}%)`;
        }
        
    } catch (error) {
        console.error('Prediction error:', error);
        recognitionStatus.textContent = 'Ошибка, повтор...';
    } finally {
        // ALWAYS dispose tensors, even on error
        if (img) img.dispose();
        if (activation) activation.dispose();
    }
    
    if (recognitionRunning) {
        recognitionAnimationId = setTimeout(predict, 200);
    }
}

// Save/Load model
function saveModelToStorage() {
    try {
        const numClasses = classifier.getNumClasses();
        
        if (numClasses === 0) {
            alert('Нечего сохранять - модель не обучена');
            return;
        }
        
        const dataset = classifier.getClassifierDataset();
        const datasetObj = {};
        
        Object.keys(dataset).forEach((className) => {
            const data = dataset[className].dataSync();
            datasetObj[className] = Array.from(data);
        });
        
        const modelData = {
            classes: classes,
            dataset: datasetObj
        };
        
        const modelJson = JSON.stringify(modelData);
        const modelSizeMB = (modelJson.length / (1024 * 1024)).toFixed(2);
        
        try {
            localStorage.setItem(STORAGE_KEY, modelJson);
            alert(`✅ Модель сохранена! (${modelSizeMB} MB)`);
        } catch (storageError) {
            if (storageError.name === 'QuotaExceededError') {
                alert(`❌ Недостаточно места в localStorage!\n\nРазмер модели: ${modelSizeMB} MB\nЛимит: ~5-10 MB\n\nРекомендации:\n• Удалите старые классы\n• Уменьшите количество примеров\n• Очистите localStorage`);
            } else {
                throw storageError;
            }
        }
        
    } catch (error) {
        console.error('Save error:', error);
        alert('Ошибка сохранения: ' + error.message);
    }
}

function loadModelFromStorage() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        
        if (!saved) {
            console.log('No saved model found');
            return;
        }
        
        const modelData = JSON.parse(saved);
        classes = modelData.classes || {};
        
        // Restore classifier dataset
        Object.keys(modelData.dataset).forEach((className) => {
            const data = modelData.dataset[className];
            
            // Validate data length
            if (!data || !Array.isArray(data) || data.length === 0) {
                console.warn(`Skipping invalid data for class ${className}`);
                return;
            }
            
            if (data.length % 1024 !== 0) {
                console.warn(`Invalid data length for class ${className}: ${data.length}. Expected multiple of 1024.`);
                return;
            }
            
            const numExamples = data.length / 1024;
            const tensor = tf.tensor(data, [numExamples, 1024]);
            classifier.addExample(tensor, className);
            tensor.dispose();
        });
        
        // Recalculate actual example counts from classifier to ensure synchronization
        const dataset = classifier.getClassifierDataset();
        Object.keys(classes).forEach((className) => {
            if (dataset[className]) {
                const actualExamples = dataset[className].shape[0];
                const savedExamples = classes[className].examples;
                
                if (actualExamples !== savedExamples) {
                    console.warn(`Example count mismatch for class ${className}: saved=${savedExamples}, actual=${actualExamples}`);
                }
                
                classes[className].examples = actualExamples;
            } else {
                // Class exists in metadata but has no data in classifier
                console.warn(`Class ${className} has no data in classifier, setting examples to 0`);
                classes[className].examples = 0;
            }
        });
        
        renderClasses();
        console.log('Model loaded from storage');
        errorElement.textContent = '✅ Модель загружена из памяти';
        setTimeout(() => { errorElement.textContent = ''; }, 3000);
        
    } catch (error) {
        console.error('Load error:', error);
        errorElement.textContent = 'Ошибка загрузки модели: ' + error.message;
    }
}

function clearModel() {
    if (confirm('Удалить все классы и сохранённую модель?')) {
        // Clear classifier
        if (classifier) {
            classifier.clearAllClasses();
        }
        
        // Clear classes
        classes = {};
        renderClasses();
        
        // Clear storage
        localStorage.removeItem(STORAGE_KEY);
        
        alert('✅ Всё очищено');
    }
}

// Auto-save function (silent save without alert)
function autoSave() {
    try {
        const numClasses = classifier.getNumClasses();
        if (numClasses === 0) {
            console.log('Auto-save skipped: no classes to save');
            return;
        }
        
        const dataset = classifier.getClassifierDataset();
        const datasetObj = {};
        
        Object.keys(dataset).forEach((className) => {
            const data = dataset[className].dataSync();
            datasetObj[className] = Array.from(data);
        });
        
        const modelData = {
            classes: classes,
            dataset: datasetObj
        };
        
        const modelJson = JSON.stringify(modelData);
        
        try {
            localStorage.setItem(STORAGE_KEY, modelJson);
            console.log('Model auto-saved');
        } catch (storageError) {
            if (storageError.name === 'QuotaExceededError') {
                const modelSizeMB = (modelJson.length / (1024 * 1024)).toFixed(2);
                console.error(`QuotaExceededError: Model size is ${modelSizeMB} MB`);
                errorElement.textContent = `⚠️ Автосохранение не удалось: модель слишком большая (${modelSizeMB} MB). Удалите старые классы.`;
            } else {
                throw storageError;
            }
        }
    } catch (error) {
        console.error('Auto-save error:', error);
    }
}

// Event listeners
trainingTab.addEventListener('click', () => switchMode('training'));
recognitionTab.addEventListener('click', () => switchMode('recognition'));
addClassBtn.addEventListener('click', addClassPrompt);
saveModelBtn.addEventListener('click', saveModelToStorage);
loadModelBtn.addEventListener('click', loadModelFromStorage);
clearModelBtn.addEventListener('click', clearModel);
flipCameraBtn.addEventListener('click', flipCamera);

// Auto-save on page unload
window.addEventListener('beforeunload', () => {
    autoSave();
});

// Initialize
init();
