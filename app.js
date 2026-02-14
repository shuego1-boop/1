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
let isDOMManipulationSafe = true;
let selectedClass = null; // Currently selected class for capture

// v11: Firebase state
let isAdminMode = false;
let currentUser = null;
let db = null;
let storage = null;
let auth = null;
let modelCatalog = [];
let currentModelId = null;
let autosaveTimeout = null;

// Constants
const STORAGE_KEY = 'myCarDetectorModel';
const DATASET_STORAGE_KEY = 'carDetectorDataset';
const CONFIDENCE_THRESHOLD = 0.70; // v11: Changed to 0.7 for "Не распознано"
const HIGH_CONFIDENCE_THRESHOLD = 0.90;
const APP_VERSION = 'v11';
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const IOS_VIDEO_READY_DELAY = 400; // iOS needs more time for video initialization
const DEFAULT_VIDEO_READY_DELAY = 200;
const AUTOSAVE_DEBOUNCE_MS = 2000;

// v11: Firebase Configuration
// Note: Firebase API keys are designed to be public. Security is enforced
// through Firebase Security Rules, not by hiding the API key. Configure
// API key restrictions in Google Cloud Console and use App Check for
// additional protection against unauthorized access.
const firebaseConfig = {
    apiKey: "AIzaSyDUX-p3RKcnWXMIHF0Ofk5m7LupxdU9nZU",
    authDomain: "raspozn-ef99a.firebaseapp.com",
    projectId: "raspozn-ef99a",
    storageBucket: "raspozn-ef99a.firebasestorage.app",
    messagingSenderId: "978235404466",
    appId: "1:978235404466:web:bc11571d676cdb55f719ab",
    measurementId: "G-QBF2TE3M9Q"
};

// UI Elements
const trainingTab = document.getElementById('training-tab');
const recognitionTab = document.getElementById('recognition-tab');
const trainingMode = document.getElementById('training-mode');
const recognitionMode = document.getElementById('recognition-mode');
const addClassBtn = document.getElementById('add-class-btn');
const classList = document.getElementById('class-list');
const resultOverlay = document.getElementById('result-overlay');
const recognitionStatus = document.getElementById('recognition-status');
const saveModelBtn = document.getElementById('save-model-btn');
const loadModelBtn = document.getElementById('load-model-btn');
const clearModelBtn = document.getElementById('clear-model-btn');
const flipCameraBtn = document.getElementById('flip-camera-btn');
const restartCameraBtn = document.getElementById('restart-camera-btn');
const errorElement = document.getElementById('error');

// v11: New UI elements
const adminBtn = document.getElementById('admin-btn');
const adminModal = document.getElementById('admin-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const adminEmail = document.getElementById('admin-email');
const adminPassword = document.getElementById('admin-password');
const adminLoginForm = document.getElementById('admin-login-form');
const adminPanel = document.getElementById('admin-panel');
const loginError = document.getElementById('login-error');
const modeStatus = document.getElementById('mode-status');
const modelSelect = document.getElementById('model-select');
const exportModelBtn = document.getElementById('export-model-btn');
const renameModelBtn = document.getElementById('rename-model-btn');
const deleteModelBtn = document.getElementById('delete-model-btn');
const initDefaultsBtn = document.getElementById('init-defaults-btn');
const adminEmailDisplay = document.getElementById('admin-email-display');

// v11: Initialize Firebase
function initFirebase() {
    try {
        if (typeof firebase === 'undefined') {
            throw new Error('Firebase SDK not loaded');
        }
        
        firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        db = firebase.firestore();
        storage = firebase.storage();
        
        console.log(`[${APP_VERSION}] Firebase initialized`);
        
        // Listen for auth state changes
        auth.onAuthStateChanged(handleAuthStateChange);
        
        return true;
    } catch (error) {
        console.error(`[${APP_VERSION}] Firebase initialization error:`, error);
        return false;
    }
}

// v11: Auth state change handler
async function handleAuthStateChange(user) {
    currentUser = user;
    console.log(`[${APP_VERSION}] Auth state changed:`, user ? user.email : 'signed out');
    
    if (user) {
        // Check if user is admin
        try {
            const adminDoc = await db.collection('admins').doc(user.uid).get();
            if (adminDoc.exists && adminDoc.data().enabled) {
                isAdminMode = true;
                updateAdminUI();
                console.log(`[${APP_VERSION}] Admin mode enabled for ${user.email}`);
            } else {
                // Not an admin, sign out
                console.warn(`[${APP_VERSION}] User ${user.email} is not an admin`);
                isAdminMode = false;
                await auth.signOut();
                showLoginError('Access denied. You are not an admin.');
            }
        } catch (error) {
            console.error(`[${APP_VERSION}] Error checking admin status:`, error);
            isAdminMode = false;
            await auth.signOut();
            showLoginError('Error verifying admin status.');
        }
    } else {
        isAdminMode = false;
        updateAdminUI();
    }
}

// v11: Load model catalog from Firestore
async function loadModelCatalog() {
    try {
        const snapshot = await db.collection('models').orderBy('updatedAt', 'desc').get();
        modelCatalog = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        console.log(`[${APP_VERSION}] Loaded ${modelCatalog.length} models from catalog`);
        updateModelSelect();
        return modelCatalog;
    } catch (error) {
        console.error(`[${APP_VERSION}] Error loading model catalog:`, error);
        errorElement.textContent = 'Error loading model catalog: ' + error.message;
        return [];
    }
}

// v11: Update model selector dropdown
function updateModelSelect() {
    modelSelect.innerHTML = '';
    
    if (modelCatalog.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = isAdminMode ? 'No models - Initialize defaults' : 'No models available';
        modelSelect.appendChild(option);
        return;
    }
    
    modelCatalog.forEach(model => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = `${model.name} (${model.classesCount || 0} classes, ${model.examplesCount || 0} examples)`;
        if (model.id === currentModelId) {
            option.selected = true;
        }
        modelSelect.appendChild(option);
    });
}

// v11: Update admin UI state
function updateAdminUI() {
    if (isAdminMode) {
        modeStatus.textContent = 'Admin mode';
        modeStatus.classList.add('admin-active');
        adminBtn.textContent = '🔓 Logout';
        
        // Show admin panel, hide login form
        adminLoginForm.style.display = 'none';
        adminPanel.style.display = 'block';
        adminEmailDisplay.textContent = currentUser.email;
        
        // Enable admin-only buttons
        saveModelBtn.disabled = false;
        renameModelBtn.disabled = false;
        deleteModelBtn.disabled = false;
    } else {
        modeStatus.textContent = 'Public mode';
        modeStatus.classList.remove('admin-active');
        adminBtn.textContent = '🔐 Admin';
        
        // Show login form, hide admin panel
        adminLoginForm.style.display = 'block';
        adminPanel.style.display = 'none';
        
        // Disable admin-only buttons
        saveModelBtn.disabled = true;
        renameModelBtn.disabled = true;
        deleteModelBtn.disabled = true;
    }
}

// v11: Show login error
function showLoginError(message) {
    loginError.textContent = message;
    setTimeout(() => {
        loginError.textContent = '';
    }, 5000);
}

// v11: Admin login
async function adminLogin() {
    const email = adminEmail.value.trim();
    const password = adminPassword.value;
    
    if (!email || !password) {
        showLoginError('Please enter email and password');
        return;
    }
    
    loginBtn.disabled = true;
    loginBtn.textContent = 'Logging in...';
    loginError.textContent = '';
    
    try {
        await auth.signInWithEmailAndPassword(email, password);
        // Auth state change handler will check admin status
        adminEmail.value = '';
        adminPassword.value = '';
    } catch (error) {
        console.error(`[${APP_VERSION}] Login error:`, error);
        showLoginError('Login failed: ' + error.message);
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
    }
}

// v11: Admin logout
async function adminLogout() {
    try {
        await auth.signOut();
        closeAdminModal();
    } catch (error) {
        console.error(`[${APP_VERSION}] Logout error:`, error);
    }
}

// v11: Open/close admin modal
function openAdminModal() {
    if (isAdminMode) {
        // If already admin, open to show admin panel
        adminModal.classList.add('active');
    } else {
        // If not admin, open to show login form
        adminModal.classList.add('active');
        adminEmail.focus();
    }
}

function closeAdminModal() {
    adminModal.classList.remove('active');
    loginError.textContent = '';
}

// v11: Initialize default models (admin only)
async function initializeDefaultModels() {
    if (!isAdminMode) {
        alert('Admin access required');
        return;
    }
    
    if (!confirm('Initialize 10 default model documents in Firestore? This will create empty model entries.')) {
        return;
    }
    
    initDefaultsBtn.disabled = true;
    initDefaultsBtn.textContent = 'Initializing...';
    
    try {
        const batch = db.batch();
        
        for (let i = 1; i <= 10; i++) {
            const modelId = `model-${i}`;
            const modelRef = db.collection('models').doc(modelId);
            batch.set(modelRef, {
                name: `Model ${i}`,
                storagePath: `models/${modelId}/dataset.json`,
                format: 'knn-mobilenet-v1',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                sizeBytes: 0,
                classesCount: 0,
                examplesCount: 0,
                appVersion: APP_VERSION
            });
        }
        
        await batch.commit();
        console.log(`[${APP_VERSION}] Initialized 10 default models`);
        alert('✅ Default models initialized!');
        
        // Reload catalog
        await loadModelCatalog();
    } catch (error) {
        console.error(`[${APP_VERSION}] Error initializing defaults:`, error);
        alert('Error initializing defaults: ' + error.message);
    } finally {
        initDefaultsBtn.disabled = false;
        initDefaultsBtn.textContent = 'Initialize Default Models';
    }
}

// v11: Save model to Firebase Storage and Firestore
async function saveModelToFirebase() {
    if (!isAdminMode) {
        alert('Admin access required to save models');
        return;
    }
    
    try {
        const numClasses = classifier.getNumClasses();
        
        if (numClasses === 0) {
            alert('Nothing to save - model not trained');
            return;
        }
        
        const selectedModelId = modelSelect.value;
        if (!selectedModelId) {
            alert('Please select a model from the catalog');
            return;
        }
        
        saveModelBtn.disabled = true;
        saveModelBtn.textContent = '💾 Saving...';
        errorElement.textContent = 'Saving model to Firebase...';
        
        // Serialize classifier dataset
        const dataset = classifier.getClassifierDataset();
        const datasetObj = {};
        
        Object.keys(dataset).forEach((className) => {
            const tensorData = dataset[className];
            datasetObj[className] = {
                shape: Array.from(tensorData.shape),
                data: Array.from(tensorData.dataSync())
            };
        });
        
        // Create model JSON
        const modelData = {
            format: 'knn-mobilenet-v1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            appVersion: APP_VERSION,
            classes: classes,
            dataset: datasetObj
        };
        
        const modelJson = JSON.stringify(modelData);
        const sizeBytes = modelJson.length;
        const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);
        
        console.log(`[${APP_VERSION}] Uploading model ${selectedModelId}, size: ${sizeMB} MB`);
        
        // Upload to Firebase Storage
        const storagePath = `models/${selectedModelId}/dataset.json`;
        const storageRef = storage.ref(storagePath);
        
        await storageRef.putString(modelJson, 'raw', {
            contentType: 'application/json'
        });
        
        console.log(`[${APP_VERSION}] Model uploaded to Storage`);
        
        // Update Firestore metadata
        await db.collection('models').doc(selectedModelId).update({
            storagePath: storagePath,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            sizeBytes: sizeBytes,
            classesCount: Object.keys(classes).length,
            examplesCount: Object.values(classes).reduce((sum, cls) => sum + cls.examples, 0),
            appVersion: APP_VERSION
        });
        
        console.log(`[${APP_VERSION}] Firestore metadata updated`);
        
        currentModelId = selectedModelId;
        errorElement.textContent = `✅ Model saved! (${sizeMB} MB)`;
        setTimeout(() => { errorElement.textContent = ''; }, 3000);
        
        // Reload catalog to get updated metadata
        await loadModelCatalog();
        
    } catch (error) {
        console.error(`[${APP_VERSION}] Save to Firebase error:`, error);
        errorElement.textContent = 'Error saving model: ' + error.message;
        alert('Error saving model: ' + error.message);
    } finally {
        saveModelBtn.disabled = false;
        saveModelBtn.textContent = '💾 Save to Server';
    }
}

// v11: Load model from Firebase Storage
async function loadModelFromFirebase() {
    try {
        const selectedModelId = modelSelect.value;
        if (!selectedModelId) {
            alert('Please select a model from the catalog');
            return;
        }
        
        loadModelBtn.disabled = true;
        loadModelBtn.textContent = '📂 Loading...';
        errorElement.textContent = 'Loading model from Firebase...';
        
        // Get model metadata
        const modelDoc = await db.collection('models').doc(selectedModelId).get();
        if (!modelDoc.exists) {
            throw new Error('Model not found in catalog');
        }
        
        const modelMeta = modelDoc.data();
        const storagePath = modelMeta.storagePath || `models/${selectedModelId}/dataset.json`;
        
        console.log(`[${APP_VERSION}] Loading model from ${storagePath}`);
        
        // Download from Storage
        const storageRef = storage.ref(storagePath);
        const downloadURL = await storageRef.getDownloadURL();
        
        const response = await fetch(downloadURL);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const modelData = await response.json();
        
        console.log(`[${APP_VERSION}] Model data downloaded, format: ${modelData.format}`);
        
        // Clear existing classifier
        if (classifier) {
            classifier.clearAllClasses();
        }
        
        classes = modelData.classes || {};
        
        // Restore classifier dataset
        const dataset = modelData.dataset || {};
        Object.keys(dataset).forEach((className) => {
            try {
                const classData = dataset[className];
                if (!classData.shape || !classData.data) {
                    console.warn(`[${APP_VERSION}] Invalid data for class ${className}`);
                    return;
                }
                
                const tensor = tf.tensor(classData.data, classData.shape);
                classifier.addExample(tensor, className);
                tensor.dispose();
            } catch (error) {
                console.error(`[${APP_VERSION}] Error restoring class ${className}:`, error);
                // Shape mismatch - clear and prompt user
                if (error.message.includes('shape')) {
                    classifier.clearAllClasses();
                    classes = {};
                    throw new Error('Shape mismatch detected. Model cleared. Please retrain.');
                }
            }
        });
        
        // Verify example counts
        const classifierDataset = classifier.getClassifierDataset();
        Object.keys(classes).forEach((className) => {
            if (classifierDataset[className]) {
                const actualExamples = classifierDataset[className].shape[0];
                classes[className].examples = actualExamples;
            } else {
                classes[className].examples = 0;
            }
        });
        
        currentModelId = selectedModelId;
        renderClasses();
        
        const sizeMB = (modelMeta.sizeBytes / (1024 * 1024)).toFixed(2);
        errorElement.textContent = `✅ Model loaded! (${sizeMB} MB)`;
        setTimeout(() => { errorElement.textContent = ''; }, 3000);
        
        console.log(`[${APP_VERSION}] Model ${selectedModelId} loaded successfully`);
        
    } catch (error) {
        console.error(`[${APP_VERSION}] Load from Firebase error:`, error);
        errorElement.textContent = 'Error loading model: ' + error.message;
        alert('Error loading model: ' + error.message);
    } finally {
        loadModelBtn.disabled = false;
        loadModelBtn.textContent = '📂 Load Model';
    }
}

// v11: Export model as JSON download
function exportModel() {
    try {
        const numClasses = classifier.getNumClasses();
        
        if (numClasses === 0) {
            alert('Nothing to export - model not trained');
            return;
        }
        
        // Serialize classifier dataset
        const dataset = classifier.getClassifierDataset();
        const datasetObj = {};
        
        Object.keys(dataset).forEach((className) => {
            const tensorData = dataset[className];
            datasetObj[className] = {
                shape: Array.from(tensorData.shape),
                data: Array.from(tensorData.dataSync())
            };
        });
        
        const modelData = {
            format: 'knn-mobilenet-v1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            appVersion: APP_VERSION,
            classes: classes,
            dataset: datasetObj
        };
        
        const modelJson = JSON.stringify(modelData, null, 2);
        const blob = new Blob([modelJson], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `model-${currentModelId || 'export'}-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        const sizeMB = (modelJson.length / (1024 * 1024)).toFixed(2);
        errorElement.textContent = `✅ Model exported! (${sizeMB} MB)`;
        setTimeout(() => { errorElement.textContent = ''; }, 3000);
        
    } catch (error) {
        console.error(`[${APP_VERSION}] Export error:`, error);
        alert('Error exporting model: ' + error.message);
    }
}

// v11: Rename model (admin only)
async function renameModel() {
    if (!isAdminMode) {
        alert('Admin access required');
        return;
    }
    
    const selectedModelId = modelSelect.value;
    if (!selectedModelId) {
        alert('Please select a model from the catalog');
        return;
    }
    
    const currentName = modelCatalog.find(m => m.id === selectedModelId)?.name || '';
    const newName = prompt('Enter new model name:', currentName);
    
    if (!newName || newName === currentName) {
        return;
    }
    
    try {
        await db.collection('models').doc(selectedModelId).update({
            name: newName,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`[${APP_VERSION}] Model ${selectedModelId} renamed to "${newName}"`);
        errorElement.textContent = '✅ Model renamed!';
        setTimeout(() => { errorElement.textContent = ''; }, 2000);
        
        await loadModelCatalog();
    } catch (error) {
        console.error(`[${APP_VERSION}] Rename error:`, error);
        alert('Error renaming model: ' + error.message);
    }
}

// v11: Delete model (admin only)
async function deleteModel() {
    if (!isAdminMode) {
        alert('Admin access required');
        return;
    }
    
    const selectedModelId = modelSelect.value;
    if (!selectedModelId) {
        alert('Please select a model from the catalog');
        return;
    }
    
    const modelName = modelCatalog.find(m => m.id === selectedModelId)?.name || selectedModelId;
    
    if (!confirm(`Delete model "${modelName}"? This will remove the model from Storage and Firestore.`)) {
        return;
    }
    
    try {
        deleteModelBtn.disabled = true;
        deleteModelBtn.textContent = '🗑️ Deleting...';
        
        // Delete from Storage
        const storagePath = `models/${selectedModelId}/dataset.json`;
        const storageRef = storage.ref(storagePath);
        
        try {
            await storageRef.delete();
            console.log(`[${APP_VERSION}] Deleted from Storage: ${storagePath}`);
        } catch (storageError) {
            // File might not exist, continue anyway
            console.warn(`[${APP_VERSION}] Storage delete warning:`, storageError);
        }
        
        // Delete from Firestore
        await db.collection('models').doc(selectedModelId).delete();
        console.log(`[${APP_VERSION}] Deleted from Firestore: ${selectedModelId}`);
        
        errorElement.textContent = '✅ Model deleted!';
        setTimeout(() => { errorElement.textContent = ''; }, 2000);
        
        if (currentModelId === selectedModelId) {
            currentModelId = null;
        }
        
        await loadModelCatalog();
        
    } catch (error) {
        console.error(`[${APP_VERSION}] Delete error:`, error);
        alert('Error deleting model: ' + error.message);
    } finally {
        deleteModelBtn.disabled = false;
        deleteModelBtn.textContent = '🗑️ Delete';
    }
}

// v11: Autosave with debounce (admin only)
function scheduleAutosave() {
    if (!isAdminMode) {
        return; // No autosave in public mode
    }
    
    // Clear existing timeout
    if (autosaveTimeout) {
        clearTimeout(autosaveTimeout);
    }
    
    // Schedule new autosave
    autosaveTimeout = setTimeout(() => {
        console.log(`[${APP_VERSION}] Autosaving...`);
        saveModelToFirebase();
    }, AUTOSAVE_DEBOUNCE_MS);
}

// Initialize on page load
async function init() {
    try {
        errorElement.textContent = 'Загрузка моделей...';
        
        // v11: Initialize Firebase first
        initFirebase();
        
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
        
        // v11: Load model catalog from Firestore
        await loadModelCatalog();
        
        errorElement.textContent = '';
        console.log(`🚗 My Car Detector ${APP_VERSION} loaded`);
        
        console.log(`[${APP_VERSION}] 📱 User Agent:`, navigator.userAgent);
        console.log(`[${APP_VERSION}] 🎥 Video element:`, !!videoElement);
        console.log(`[${APP_VERSION}] 📹 Stream active:`, stream?.active);
        console.log(`[${APP_VERSION}] Firebase enabled with public read, admin write`);
        
        // Setup event listeners
        setupEventListeners();
        
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
        
        // Track if camera was active before creating class
        const wasCameraActive = stream && stream.active;
        
        renderClasses();
        
        // iOS Safari: ensure camera restarts after class creation
        if (wasCameraActive && videoElement) {
            setTimeout(() => {
                if (videoElement.paused && videoElement.srcObject) {
                    console.log('[FIX] Restarting camera after class creation');
                    videoElement.play().catch(err => {
                        console.error('Failed to restart:', err);
                        initCamera(); // Last resort
                    });
                }
            }, 200); // Wait for renderClasses to complete
        }
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
let renderClassesRetryCount = 0;
const MAX_RENDER_RETRIES = 10; // Prevent infinite recursion

function renderClasses() {
    console.log(`[${APP_VERSION}] Rendering classes, current count:`, Object.keys(classes).length);
    
    const container = document.getElementById('class-list');
    if (!container) return;
    
    // v10: Safe to use innerHTML here - class-list is separate from video container
    container.innerHTML = '';
    
    if (Object.keys(classes).length === 0) {
        container.innerHTML = '<div style="color: #8b949e; text-align: center; padding: 20px;">No classes yet. Add your first class!</div>';
        document.getElementById('capture-btn').disabled = true;
        return;
    }
    
    Object.keys(classes).forEach(className => {
        const classItem = document.createElement('div');
        classItem.style.cssText = `
            display: flex;
            align-items: center;
            padding: 12px;
            margin: 8px 0;
            background: #0d1117;
            border: 2px solid ${selectedClass === className ? '#58a6ff' : '#21262d'};
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
        `;
        
        // Radio button
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'class-selector';
        radio.checked = selectedClass === className;
        radio.style.cssText = 'margin-right: 12px; cursor: pointer;';
        
        // Class name + examples
        const label = document.createElement('label');
        label.style.cssText = 'flex: 1; cursor: pointer; color: #c9d1d9; font-size: 16px;';
        label.textContent = `${className} (${classes[className].examples} примеров)`;
        
        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '🗑️';
        deleteBtn.style.cssText = `
            padding: 8px 12px;
            background: #21262d;
            border: 1px solid #30363d;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
        `;
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteClass(className);
        };
        
        // Click handler for entire row
        classItem.onclick = () => {
            selectedClass = className;
            document.getElementById('capture-btn').disabled = false;
            renderClasses(); // Re-render to update selection
        };
        
        classItem.appendChild(radio);
        classItem.appendChild(label);
        classItem.appendChild(deleteBtn);
        container.appendChild(classItem);
    });
    
    // Auto-select first class if none selected
    if (!selectedClass && Object.keys(classes).length > 0) {
        selectedClass = Object.keys(classes)[0];
        document.getElementById('capture-btn').disabled = false;
    }
}

// Capture logic
let captureInterval = null;
let isCapturing = false;
let captureDebounceTimer = null;
let currentCapturingClass = null;
let flashTimeout = null;

async function startCapture(className) {
    console.log('🎬 Starting capture for:', className);
    console.log('📹 Video readyState:', videoElement?.readyState);
    console.log('📐 Video dimensions:', videoElement?.videoWidth, 'x', videoElement?.videoHeight);
    console.log('🧠 Models loaded:', !!mobilenetModel, !!classifier);
    
    // CRITICAL: Verify stream is active before ANYTHING
    if (!stream || !stream.active) {
        console.error('[v10] Stream not active! Current state:', {
            streamExists: !!stream,
            streamActive: stream?.active,
            videoSrc: !!videoElement?.srcObject
        });
        
        errorElement.textContent = '⚠️ Камера не активна! Нажмите кнопку "Перезапустить"';
        restartCameraBtn.classList.add('pulse'); // Add animation
        return;
    }
    
    // Verify video element (removed readyState check for iOS compatibility)
    if (!videoElement) {
        console.error('[v10] Video element not found');
        errorElement.textContent = '⚠️ Видео не готово. Подождите или перезапустите камеру.';
        return;
    }
    
    // Check debounce timer for mobile touch events
    if (captureDebounceTimer) {
        console.log('[MOBILE FIX] Capture debounced');
        return;
    }
    
    if (!className || !classes[className]) {
        console.error('Invalid class name for capture:', className);
        return;
    }
    
    if (!mobilenetModel || !classifier) {
        errorElement.textContent = 'Модели не загружены';
        return;
    }
    
    // Prevent multiple simultaneous captures
    if (isCapturing && currentCapturingClass !== className) {
        // Already capturing a different class, stop the previous one
        console.log(`[MOBILE FIX] Stopping previous capture of ${currentCapturingClass}`);
        stopCapture();
    } else if (isCapturing && currentCapturingClass === className) {
        // Already capturing THIS class, ignore
        console.log('[MOBILE FIX] Already capturing this class, ignoring');
        return;
    }
    
    // Set debounce timer after all checks pass
    captureDebounceTimer = setTimeout(() => {
        captureDebounceTimer = null;
    }, 150); // 150ms protection from double tap
    
    isCapturing = true;
    isDOMManipulationSafe = false;
    currentCapturingClass = className;
    console.log(`[v10] Starting capture for ${className}`);
    
    const btn = document.getElementById('capture-btn');
    if (btn) {
        btn.textContent = '🔴 Capturing...';
        btn.style.background = 'linear-gradient(135deg, #f85149 0%, #da3633 100%)';
    }
    
    async function captureFrame() {
        if (!isCapturing) {
            return;
        }
        
        try {
            // iOS Safari aggressive fix - skip readyState check entirely
            if (!videoElement || !videoElement.videoWidth || !videoElement.videoHeight) {
                console.warn(`[${APP_VERSION}] Video not ready, retrying...`);
                captureInterval = setTimeout(captureFrame, 200);
                return;
            }
            
            // iOS Safari: Force check that video is actually playing
            if (videoElement.paused) {
                console.warn(`[${APP_VERSION}] Video paused, attempting to play...`);
                videoElement.play().catch(err => console.error(`[${APP_VERSION}] Play failed:`, err));
                captureInterval = setTimeout(captureFrame, 200);
                return;
            }
            
            console.log(`[${APP_VERSION}] ✅ Capturing frame, video:`, videoElement.videoWidth, 'x', videoElement.videoHeight);
            
            const img = tf.browser.fromPixels(videoElement);
            const activation = mobilenetModel.infer(img, true);
            
            try {
                classifier.addExample(activation, className);
            } catch (error) {
                if (error.message && error.message.includes('shape')) {
                    console.warn(`[${APP_VERSION}] ⚠️ Shape mismatch detected - recreating classifier`);
                    
                    // Dispose old classifier
                    classifier.dispose();
                    
                    // Create fresh classifier
                    classifier = knnClassifier.create();
                    
                    // Clear localStorage to prevent reload of bad data
                    localStorage.removeItem(STORAGE_KEY);
                    localStorage.removeItem(DATASET_STORAGE_KEY);
                    
                    // Reset all class example counts
                    Object.keys(classes).forEach(cls => {
                        classes[cls].examples = 0;
                    });
                    
                    // Try again with fresh classifier
                    classifier.addExample(activation, className);
                    
                    console.log(`[${APP_VERSION}] ✅ Classifier recreated successfully`);
                } else {
                    throw error; // Re-throw if not shape error
                }
            }
            
            img.dispose();
            // Note: do NOT dispose activation - KNN classifier keeps a reference to it
            
            classes[className].examples++;
            
            // v9: Visual flash for user feedback
            if (flashTimeout) {
                clearTimeout(flashTimeout);
            }
            videoElement.style.filter = 'brightness(1.8)';
            flashTimeout = setTimeout(() => {
                videoElement.style.filter = 'brightness(1)';
                flashTimeout = null;
            }, 80);
            
            // v9: Haptic feedback on iOS
            if (navigator.vibrate) {
                navigator.vibrate(30);
            }
            
            // v10: Console log for debugging
            console.log(`[${APP_VERSION}] 📸 Frame captured! ${className} now has ${classes[className].examples} examples`);
            
            // Update UI - find the label for the selected class in the radio button list
            const labels = document.querySelectorAll('#class-list label');
            labels.forEach(label => {
                if (label.textContent.startsWith(className + ' (')) {
                    label.textContent = `${className} (${classes[className].examples} примеров)`;
                }
            });
            
            captureInterval = setTimeout(captureFrame, 100);
            
        } catch (error) {
            console.error('Capture error:', error);
            stopCapture();
        }
    }
    
    captureFrame();
}

function stopCapture() {
    console.log(`[${APP_VERSION}] Stopping capture`);
    isCapturing = false;
    isDOMManipulationSafe = true;
    currentCapturingClass = null;
    
    if (captureInterval) {
        clearTimeout(captureInterval);
        captureInterval = null;
    }
    
    const btn = document.getElementById('capture-btn');
    if (btn) {
        btn.textContent = '📸 Take Photo';
        btn.style.background = 'linear-gradient(135deg, #58a6ff 0%, #1f6feb 100%)';
    }
    
    // v11: Schedule autosave (admin only, debounced)
    scheduleAutosave();
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
            
            // v11: Show "Не распознано" when confidence below threshold
            if (confidence < CONFIDENCE_THRESHOLD) {
                resultOverlay.textContent = `Не распознано (${confidencePercent}%)`;
                resultOverlay.className = 'result-overlay unknown';
                recognitionStatus.textContent = `Последнее: Не распознано (${confidencePercent}%)`;
            } else {
                resultOverlay.textContent = `${predictedClass} (${confidencePercent}%)`;
                
                // v11: Use HIGH_CONFIDENCE_THRESHOLD for green vs blue distinction
                if (confidence >= HIGH_CONFIDENCE_THRESHOLD) {
                    resultOverlay.className = 'result-overlay high-confidence';
                } else {
                    resultOverlay.className = 'result-overlay low-confidence';
                }
                
                recognitionStatus.textContent = `Последнее: ${predictedClass} (${confidencePercent}%)`;
            }
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

// v11: Setup all event listeners
function setupEventListeners() {
    // Mode tabs
    trainingTab.addEventListener('click', () => switchMode('training'));
    recognitionTab.addEventListener('click', () => switchMode('recognition'));
    addClassBtn.addEventListener('click', addClassPrompt);
    
    // Single capture button
    const captureBtn = document.getElementById('capture-btn');
    
    captureBtn.addEventListener('mousedown', () => {
        if (selectedClass) {
            startCapture(selectedClass);
        }
    });
    
    captureBtn.addEventListener('mouseup', stopCapture);
    captureBtn.addEventListener('mouseleave', stopCapture);
    
    captureBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (selectedClass) {
            startCapture(selectedClass);
        }
    }, { passive: false });
    
    captureBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        stopCapture();
    }, { passive: false });
    
    // v11: Model management buttons
    loadModelBtn.addEventListener('click', loadModelFromFirebase);
    saveModelBtn.addEventListener('click', saveModelToFirebase);
    exportModelBtn.addEventListener('click', exportModel);
    renameModelBtn.addEventListener('click', renameModel);
    deleteModelBtn.addEventListener('click', deleteModel);
    clearModelBtn.addEventListener('click', clearModel);
    
    // Camera controls
    flipCameraBtn.addEventListener('click', flipCamera);
    
    if (restartCameraBtn) {
        restartCameraBtn.addEventListener('click', restartCamera);
    }
    
    // v11: Admin modal and login
    adminBtn.addEventListener('click', openAdminModal);
    
    closeModalBtn.addEventListener('click', closeAdminModal);
    
    adminModal.addEventListener('click', (e) => {
        if (e.target === adminModal) {
            closeAdminModal();
        }
    });
    
    loginBtn.addEventListener('click', adminLogin);
    
    adminPassword.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            adminLogin();
        }
    });
    
    logoutBtn.addEventListener('click', adminLogout);
    
    initDefaultsBtn.addEventListener('click', initializeDefaultModels);
    
    // Show restart button on video/stream errors
    window.addEventListener('error', (e) => {
        if (restartCameraBtn) {
            const errorMessage = e.message || (e.error && e.error.message) || '';
            if (errorMessage.toLowerCase().includes('video') || errorMessage.toLowerCase().includes('stream')) {
                restartCameraBtn.style.display = 'block';
            }
        }
    });
    
    // Auto-save on page unload (admin only)
    window.addEventListener('beforeunload', () => {
        if (isAdminMode && autosaveTimeout) {
            // Try to save immediately on unload
            clearTimeout(autosaveTimeout);
        }
    });
}

// Restart camera button handler
async function restartCamera() {
    console.log(`[${APP_VERSION}] Manual camera restart requested`);
    
    restartCameraBtn.disabled = true;
    restartCameraBtn.textContent = '⏳ Перезапуск...';
    
    // Stop everything
    stopCapture();
    stopRecognition();
    
    try {
        // Stop old stream
        if (stream) {
            stream.getTracks().forEach(track => {
                console.log(`[${APP_VERSION}] Stopping track:`, track.kind);
                track.stop();
            });
        }
        
        // Clear video
        if (videoElement) {
            videoElement.srcObject = null;
        }
        
        // Wait a bit for iOS
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Reinitialize camera
        await initCamera();
        
        alert('✅ Камера перезапущена!');
        restartCameraBtn.textContent = '⚠️ Камера зависла? Перезапустить';
        restartCameraBtn.classList.remove('pulse');
        
    } catch (error) {
        console.error(`[${APP_VERSION}] Restart failed:`, error);
        alert('❌ Не удалось перезапустить: ' + error.message);
        restartCameraBtn.textContent = '⚠️ Попробовать ещё раз';
    } finally {
        restartCameraBtn.disabled = false;
    }
}

// Initialize
init();
