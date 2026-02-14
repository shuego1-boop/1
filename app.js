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

// v12: Firebase state (storage no longer used - using Firestore chunks)
let isAdminMode = false;
let currentUser = null;
let db = null;
let auth = null;
let modelCatalog = [];
let currentModelId = null;
let autosaveTimeout = null;

// Constants
const STORAGE_KEY = 'myCarDetectorModel';
const DATASET_STORAGE_KEY = 'carDetectorDataset';
const CONFIDENCE_THRESHOLD = 0.70; // v11: Changed to 0.7 for "Не распознано"
const HIGH_CONFIDENCE_THRESHOLD = 0.90;
const APP_VERSION = 'v15';
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const IOS_VIDEO_READY_DELAY = 400; // iOS needs more time for video initialization
const DEFAULT_VIDEO_READY_DELAY = 200;
const AUTOSAVE_DEBOUNCE_MS = 2000;
const DEFAULT_MODEL_ID = 'model-1'; // v12: Default model for public mode
const CHUNK_SIZE = 500 * 1024; // v12: 500KB chunks before encoding (~667KB after base64, stays under 1MB with metadata)

// v16: External model storage configuration
// WARNING: API key is visible in client-side code. This is NOT strong security.
// For production, consider Firebase token verification or OAuth 2.0.
const EXTERNAL_MODEL_STORE_BASE_URL = ''; // Set to your server URL (e.g., 'https://models.example.com')
const EXTERNAL_MODEL_STORE_API_KEY = ''; // Set to your API key from server .env
const EXTERNAL_STORAGE_THRESHOLD = 800 * 1024; // 800KB - models larger than this use external storage
const USE_EXTERNAL_STORAGE = false; // Set to true to force external storage for all models (ignores threshold)

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
const createModelBtn = document.getElementById('create-model-btn');
const exportModelBtn = document.getElementById('export-model-btn');
const renameModelBtn = document.getElementById('rename-model-btn');
const deleteModelBtn = document.getElementById('delete-model-btn');
const initDefaultsBtn = document.getElementById('init-defaults-btn');
const adminEmailDisplay = document.getElementById('admin-email-display');

// v12: Initialize Firebase (Storage no longer needed - using Firestore chunks)
function initFirebase() {
    try {
        if (typeof firebase === 'undefined') {
            throw new Error('Firebase SDK not loaded');
        }
        
        firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        db = firebase.firestore();
        // v12: No longer initializing storage - using Firestore chunks instead
        
        console.log(`[${APP_VERSION}] Firebase initialized`);
        console.log(`[${APP_VERSION}] Project ID: ${firebaseConfig.projectId}`);
        console.log(`[${APP_VERSION}] Auth Domain: ${firebaseConfig.authDomain}`);
        
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

// v13: Helper to get selected model id from UI
function getSelectedModelId() {
    // Prioritize UI select value over internal state
    const selectValue = modelSelect.value;
    return selectValue !== '' ? selectValue : (currentModelId || '');
}

// v14: Helper for management operations (save/load/rename/delete/export)
// Validates admin mode and model selection with Russian error message
function requireSelectedModelIdForManagement() {
    if (!isAdminMode) {
        alert('Admin access required');
        console.log(`[${APP_VERSION}] Action blocked: admin access required`);
        return null;
    }
    
    const selectedId = getSelectedModelId();
    if (!selectedId) {
        alert('Сначала создайте или выберите модель в каталоге.');
        console.log(`[${APP_VERSION}] Action blocked: no model selected for management`);
        return null;
    }
    
    // Sync currentModelId with UI selection
    currentModelId = selectedId;
    return selectedId;
}


// v11: Update model selector dropdown
function updateModelSelect() {
    // v13: Remember the current selection before clearing
    const previousSelection = modelSelect.value;
    
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
        modelSelect.appendChild(option);
    });
    
    // v13: Restore selection - prioritize currentModelId, then previousSelection
    if (currentModelId && modelCatalog.find(m => m.id === currentModelId)) {
        modelSelect.value = currentModelId;
    } else if (previousSelection && modelCatalog.find(m => m.id === previousSelection)) {
        modelSelect.value = previousSelection;
        currentModelId = previousSelection; // Sync back
    }
    
    // v14: Update management button states after updating select
    updateManagementButtonStates();
}

// v12: Set mode UI - controls visibility of admin-only sections
function setModeUI(isAdmin) {
    const adminWrappers = document.querySelectorAll('.admin-only-wrapper');
    
    if (isAdmin) {
        // Show all admin-only sections
        adminWrappers.forEach(wrapper => {
            wrapper.style.display = '';
        });
        // Switch to training mode by default for admins
        switchMode('training');
    } else {
        // Hide all admin-only sections
        adminWrappers.forEach(wrapper => {
            wrapper.style.display = 'none';
        });
        // Force recognition mode for public users
        switchMode('recognition');
    }
}

// v12: Update admin UI state
function updateAdminUI() {
    if (isAdminMode) {
        modeStatus.textContent = 'Admin mode';
        modeStatus.classList.add('admin-active');
        adminBtn.textContent = '🔓 Logout';
        
        // Show admin panel, hide login form
        adminLoginForm.style.display = 'none';
        adminPanel.style.display = 'block';
        adminEmailDisplay.textContent = currentUser.email;
        
        // v14: Update management buttons based on selection
        updateManagementButtonStates();
        
        // Show admin-only UI sections
        setModeUI(true);
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
        exportModelBtn.disabled = true;
        loadModelBtn.disabled = true;
        
        // Hide admin-only UI sections
        setModeUI(false);
    }
}

// v14: Update management button states based on model selection
function updateManagementButtonStates() {
    if (!isAdminMode) {
        // All disabled in public mode
        saveModelBtn.disabled = true;
        renameModelBtn.disabled = true;
        deleteModelBtn.disabled = true;
        exportModelBtn.disabled = true;
        loadModelBtn.disabled = true;
        return;
    }
    
    // In admin mode, enable/disable based on model selection
    const hasSelection = getSelectedModelId() !== '';
    
    // Management operations require model selection
    saveModelBtn.disabled = !hasSelection;
    renameModelBtn.disabled = !hasSelection;
    deleteModelBtn.disabled = !hasSelection;
    exportModelBtn.disabled = !hasSelection;
    loadModelBtn.disabled = !hasSelection;
}

// v12: Format Firebase auth errors with user-friendly messages
function formatFirebaseAuthError(error) {
    const code = error.code || '';
    
    // Map error codes to user-friendly Russian messages
    const errorMessages = {
        'auth/invalid-login-credentials': 'Неверный email или пароль',
        'auth/user-not-found': 'Пользователь не найден',
        'auth/wrong-password': 'Неверный пароль',
        'auth/user-disabled': 'Учетная запись отключена',
        'auth/too-many-requests': 'Слишком много попыток входа. Попробуйте позже',
        'auth/network-request-failed': 'Ошибка сети. Проверьте подключение к интернету',
        'auth/invalid-email': 'Неверный формат email',
        'auth/user-token-expired': 'Сессия истекла. Войдите снова',
        'auth/requires-recent-login': 'Требуется повторный вход'
    };
    
    const friendlyMessage = errorMessages[code] || `Ошибка входа: ${error.message}`;
    return `${friendlyMessage} (${code})`;
}

// v11: Show login error
function showLoginError(message) {
    loginError.textContent = message;
    setTimeout(() => {
        loginError.textContent = '';
    }, 5000);
}

// v12: Admin login with improved error handling
async function adminLogin() {
    const email = adminEmail.value.trim();
    const password = adminPassword.value;
    
    if (!email || !password) {
        showLoginError('Введите email и пароль');
        return;
    }
    
    loginBtn.disabled = true;
    loginBtn.textContent = 'Вход...';
    loginError.textContent = '';
    
    try {
        await auth.signInWithEmailAndPassword(email, password);
        // Auth state change handler will check admin status
        adminEmail.value = '';
        adminPassword.value = '';
    } catch (error) {
        console.error(`[${APP_VERSION}] Login error code:`, error.code);
        console.error(`[${APP_VERSION}] Login error:`, error);
        const formattedError = formatFirebaseAuthError(error);
        showLoginError(formattedError);
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Войти';
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

// v12: Open/close admin modal
function openAdminModal() {
    if (isAdminMode) {
        // If already admin, open to show admin panel
        adminModal.classList.add('active');
    } else {
        // If not admin, open to show login form
        adminModal.classList.add('active');
        
        // Populate Firebase diagnostics
        const diagProjectId = document.getElementById('diag-project-id');
        const diagAuthDomain = document.getElementById('diag-auth-domain');
        if (diagProjectId) diagProjectId.textContent = firebaseConfig.projectId;
        if (diagAuthDomain) diagAuthDomain.textContent = firebaseConfig.authDomain;
        
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
                format: 'knn-mobilenet-v1',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                sizeBytes: 0,
                classesCount: 0,
                examplesCount: 0,
                appVersion: APP_VERSION,
                datasetVersion: 0,
                chunksCount: 0
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

// v15: Helper function to safely convert Uint8Array to base64 (avoids stack overflow)
function uint8ArrayToBase64(bytes) {
    let binaryString = '';
    const chunkSize = 8192; // Process in 8KB slices to avoid stack overflow
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binaryString += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binaryString);
}

// v16: External storage helper - check if model should use external storage
function shouldUseExternalStorage(modelSizeBytes) {
    if (!EXTERNAL_MODEL_STORE_BASE_URL || !EXTERNAL_MODEL_STORE_API_KEY) {
        return false; // Not configured
    }
    
    if (USE_EXTERNAL_STORAGE) {
        return true; // Forced external storage
    }
    
    return modelSizeBytes > EXTERNAL_STORAGE_THRESHOLD;
}

// v16: External storage helper - compress data using gzip
async function compressData(jsonString) {
    const encoder = new TextEncoder();
    const data = encoder.encode(jsonString);
    
    // Use CompressionStream if available (modern browsers)
    if (typeof CompressionStream !== 'undefined') {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(data);
                controller.close();
            }
        });
        
        const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
        const reader = compressedStream.getReader();
        const chunks = [];
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }
        
        // Combine chunks into single Uint8Array
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        
        return result;
    } else {
        // Fallback: use pako library if CompressionStream not available
        throw new Error('Compression not supported in this browser. CompressionStream API required.');
    }
}

// v16: External storage helper - decompress gzipped data
async function decompressData(compressedData) {
    // Use DecompressionStream if available (modern browsers)
    if (typeof DecompressionStream !== 'undefined') {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(compressedData);
                controller.close();
            }
        });
        
        const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
        const reader = decompressedStream.getReader();
        const chunks = [];
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }
        
        // Combine chunks and decode to string
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        
        const decoder = new TextDecoder();
        return decoder.decode(result);
    } else {
        throw new Error('Decompression not supported in this browser. DecompressionStream API required.');
    }
}

// v16: Upload model to external server
async function uploadModelToExternalServer(modelId, modelJson) {
    const jsonString = typeof modelJson === 'string' ? modelJson : JSON.stringify(modelJson);
    const sizeBytes = jsonString.length;
    const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);
    
    console.log(`[${APP_VERSION}] Compressing model for external storage: ${sizeMB} MB`);
    
    // Compress the data
    const compressedData = await compressData(jsonString);
    const compressedSizeMB = (compressedData.length / (1024 * 1024)).toFixed(2);
    
    console.log(`[${APP_VERSION}] Compressed to: ${compressedSizeMB} MB`);
    console.log(`[${APP_VERSION}] Uploading to external server: ${EXTERNAL_MODEL_STORE_BASE_URL}`);
    
    const url = `${EXTERNAL_MODEL_STORE_BASE_URL}/api/models/${modelId}`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'X-API-Key': EXTERNAL_MODEL_STORE_API_KEY,
            'Content-Type': 'application/octet-stream'
        },
        body: compressedData
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        let errorMsg;
        
        try {
            const errorJson = JSON.parse(errorText);
            errorMsg = errorJson.message || errorJson.error || errorText;
        } catch {
            errorMsg = errorText;
        }
        
        // Provide actionable error messages
        if (response.status === 401) {
            throw new Error(`❌ Authentication failed: Invalid API key. Please check EXTERNAL_MODEL_STORE_API_KEY in app.js`);
        } else if (response.status === 413) {
            throw new Error(`❌ Model too large: Server rejected the upload (${compressedSizeMB} MB). Consider increasing server upload limit.`);
        } else if (response.status === 0 || !response.status) {
            throw new Error(`❌ Network error: Cannot reach server at ${EXTERNAL_MODEL_STORE_BASE_URL}. Check CORS settings and server availability.`);
        } else {
            throw new Error(`❌ Upload failed (${response.status}): ${errorMsg}`);
        }
    }
    
    const result = await response.json();
    console.log(`[${APP_VERSION}] External upload successful:`, result);
    
    return {
        artifactUrl: url.replace('/api/models/', '/api/models/').replace('POST', 'GET'),
        artifactSizeBytes: compressedData.length,
        artifactContentEncoding: 'gzip',
        originalSizeBytes: sizeBytes
    };
}

// v16: Download model from external server
async function downloadModelFromExternalServer(artifactUrl) {
    console.log(`[${APP_VERSION}] Downloading model from external server: ${artifactUrl}`);
    
    const response = await fetch(artifactUrl, {
        method: 'GET',
        headers: {
            'Accept': 'application/octet-stream'
        }
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        let errorMsg;
        
        try {
            const errorJson = JSON.parse(errorText);
            errorMsg = errorJson.message || errorJson.error || errorText;
        } catch {
            errorMsg = errorText;
        }
        
        if (response.status === 404) {
            throw new Error(`❌ Model not found on external server. The model may have been deleted.`);
        } else if (response.status === 0 || !response.status) {
            throw new Error(`❌ Network error: Cannot reach external server. Check your internet connection.`);
        } else {
            throw new Error(`❌ Download failed (${response.status}): ${errorMsg}`);
        }
    }
    
    // Get the compressed data
    const compressedData = await response.arrayBuffer();
    const compressedArray = new Uint8Array(compressedData);
    
    console.log(`[${APP_VERSION}] Downloaded ${(compressedArray.length / (1024 * 1024)).toFixed(2)} MB, decompressing...`);
    
    // Decompress the data
    const jsonString = await decompressData(compressedArray);
    
    console.log(`[${APP_VERSION}] Decompressed to ${(jsonString.length / (1024 * 1024)).toFixed(2)} MB`);
    
    return JSON.parse(jsonString);
}

// v12: Save model dataset to Firestore chunks
async function saveModelToFirestoreChunks(modelId, modelJson, datasetVersion) {
    const jsonString = typeof modelJson === 'string' ? modelJson : JSON.stringify(modelJson);
    const chunks = [];
    
    // Split into chunks of CHUNK_SIZE (500KB before encoding)
    for (let i = 0; i < jsonString.length; i += CHUNK_SIZE) {
        const chunk = jsonString.substring(i, Math.min(i + CHUNK_SIZE, jsonString.length));
        // Use TextEncoder for proper UTF-8 handling
        const encoder = new TextEncoder();
        const utf8Bytes = encoder.encode(chunk);
        // v15: Use safe base64 conversion to avoid RangeError with large arrays
        const base64Chunk = uint8ArrayToBase64(utf8Bytes);
        chunks.push({
            v: datasetVersion,
            i: chunks.length,
            data: base64Chunk,
            bytes: base64Chunk.length
        });
    }
    
    console.log(`[${APP_VERSION}] Saving ${chunks.length} chunks for model ${modelId}`);
    
    // Delete old chunks first
    const oldChunksSnapshot = await db.collection('modelDatasets')
        .doc(modelId)
        .collection('chunks')
        .get();
    
    const deleteBatch = db.batch();
    oldChunksSnapshot.docs.forEach(doc => {
        deleteBatch.delete(doc.ref);
    });
    await deleteBatch.commit();
    console.log(`[${APP_VERSION}] Deleted ${oldChunksSnapshot.size} old chunks`);
    
    // Save new chunks
    const saveBatch = db.batch();
    chunks.forEach((chunkData, idx) => {
        const chunkRef = db.collection('modelDatasets')
            .doc(modelId)
            .collection('chunks')
            .doc(`chunk-${idx}`);
        saveBatch.set(chunkRef, chunkData);
    });
    
    // Update dataset metadata
    const datasetRef = db.collection('modelDatasets').doc(modelId);
    saveBatch.set(datasetRef, {
        datasetVersion: datasetVersion,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    await saveBatch.commit();
    console.log(`[${APP_VERSION}] Saved ${chunks.length} chunks to Firestore`);
    
    return chunks.length;
}

// v12: Load model dataset from Firestore chunks
async function loadModelFromFirestoreChunks(modelId) {
    console.log(`[${APP_VERSION}] Loading model from Firestore chunks: ${modelId}`);
    
    // Get chunks ordered by index
    const chunksSnapshot = await db.collection('modelDatasets')
        .doc(modelId)
        .collection('chunks')
        .orderBy('i')
        .get();
    
    if (chunksSnapshot.empty) {
        throw new Error('No chunks found for this model');
    }
    
    console.log(`[${APP_VERSION}] Found ${chunksSnapshot.size} chunks`);
    
    // Reconstruct JSON from chunks
    let jsonString = '';
    chunksSnapshot.docs.forEach(doc => {
        const chunkData = doc.data();
        const base64Chunk = chunkData.data;
        // Use TextDecoder for proper UTF-8 handling
        const decoder = new TextDecoder();
        const binaryString = atob(base64Chunk);
        const utf8Bytes = Uint8Array.from(binaryString, c => c.charCodeAt(0));
        const decodedChunk = decoder.decode(utf8Bytes);
        jsonString += decodedChunk;
    });
    
    console.log(`[${APP_VERSION}] Reconstructed JSON string, length: ${jsonString.length}`);
    
    const modelData = JSON.parse(jsonString);
    return modelData;
}

// v16: Save model to Firestore chunks or external storage (replaces Firebase Storage)
async function saveModelToFirebase() {
    try {
        const numClasses = classifier.getNumClasses();
        
        if (numClasses === 0) {
            alert('Nothing to save - model not trained');
            return;
        }
        
        // v14: Use management helper to validate and get selected model
        const selectedModelId = requireSelectedModelIdForManagement();
        if (!selectedModelId) {
            return;
        }
        
        saveModelBtn.disabled = true;
        saveModelBtn.textContent = '💾 Saving...';
        errorElement.textContent = 'Preparing model for save...';
        
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
        
        console.log(`[${APP_VERSION}] Model size: ${sizeMB} MB`);
        
        // v12: Get or create dataset version
        const modelDoc = await db.collection('models').doc(selectedModelId).get();
        const currentDatasetVersion = modelDoc.exists ? (modelDoc.data().datasetVersion || 0) : 0;
        const newDatasetVersion = currentDatasetVersion + 1;
        
        // v16: Decide whether to use external storage or Firestore chunks
        const useExternal = shouldUseExternalStorage(sizeBytes);
        let storageLocation = 'firestore';
        let metadataUpdate = {};
        
        if (useExternal) {
            // Upload to external server
            errorElement.textContent = `Uploading model to external server (${sizeMB} MB)...`;
            console.log(`[${APP_VERSION}] Using external storage for model ${selectedModelId}`);
            
            try {
                const externalResult = await uploadModelToExternalServer(selectedModelId, modelJson);
                
                console.log(`[${APP_VERSION}] Model uploaded to external server`);
                storageLocation = 'external';
                
                // Prepare metadata for external storage
                metadataUpdate = {
                    name: modelDoc.exists ? modelDoc.data().name : `Model ${selectedModelId}`,
                    format: 'knn-mobilenet-v1',
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    sizeBytes: sizeBytes,
                    classesCount: Object.keys(classes).length,
                    examplesCount: Object.values(classes).reduce((sum, cls) => sum + cls.examples, 0),
                    appVersion: APP_VERSION,
                    datasetVersion: newDatasetVersion,
                    artifactStorage: 'external',
                    artifactUrl: externalResult.artifactUrl,
                    artifactSizeBytes: externalResult.artifactSizeBytes,
                    artifactContentEncoding: externalResult.artifactContentEncoding
                };
                
                // Clean up old Firestore chunks if they exist (migrating from chunked to external)
                try {
                    const oldChunksSnapshot = await db.collection('modelDatasets')
                        .doc(selectedModelId)
                        .collection('chunks')
                        .get();
                    
                    if (!oldChunksSnapshot.empty) {
                        console.log(`[${APP_VERSION}] Cleaning up ${oldChunksSnapshot.size} old Firestore chunks`);
                        const deleteBatch = db.batch();
                        oldChunksSnapshot.docs.forEach(doc => {
                            deleteBatch.delete(doc.ref);
                        });
                        await deleteBatch.commit();
                    }
                } catch (cleanupError) {
                    console.warn(`[${APP_VERSION}] Could not clean up old chunks:`, cleanupError);
                }
                
            } catch (externalError) {
                // If external storage fails, fall back to Firestore chunks
                console.warn(`[${APP_VERSION}] External storage failed, falling back to Firestore:`, externalError);
                errorElement.textContent = `External storage failed, using Firestore chunks... (${sizeMB} MB)`;
                
                const chunksCount = await saveModelToFirestoreChunks(selectedModelId, modelJson, newDatasetVersion);
                storageLocation = 'firestore-fallback';
                
                metadataUpdate = {
                    name: modelDoc.exists ? modelDoc.data().name : `Model ${selectedModelId}`,
                    format: 'knn-mobilenet-v1',
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    sizeBytes: sizeBytes,
                    classesCount: Object.keys(classes).length,
                    examplesCount: Object.values(classes).reduce((sum, cls) => sum + cls.examples, 0),
                    appVersion: APP_VERSION,
                    datasetVersion: newDatasetVersion,
                    chunksCount: chunksCount,
                    artifactStorage: 'firestore'
                };
                
                // Show warning about external storage failure
                console.error(`[${APP_VERSION}] External storage error:`, externalError);
                alert(`⚠️ External storage failed: ${externalError.message}\n\nFalling back to Firestore chunks.`);
            }
        } else {
            // Use Firestore chunks
            errorElement.textContent = `Saving model to Firestore chunks (${sizeMB} MB)...`;
            console.log(`[${APP_VERSION}] Using Firestore chunks for model ${selectedModelId}`);
            
            const chunksCount = await saveModelToFirestoreChunks(selectedModelId, modelJson, newDatasetVersion);
            
            console.log(`[${APP_VERSION}] Model uploaded to Firestore (${chunksCount} chunks)`);
            
            metadataUpdate = {
                name: modelDoc.exists ? modelDoc.data().name : `Model ${selectedModelId}`,
                format: 'knn-mobilenet-v1',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                sizeBytes: sizeBytes,
                classesCount: Object.keys(classes).length,
                examplesCount: Object.values(classes).reduce((sum, cls) => sum + cls.examples, 0),
                appVersion: APP_VERSION,
                datasetVersion: newDatasetVersion,
                chunksCount: chunksCount,
                artifactStorage: 'firestore'
            };
        }
        
        // Update Firestore metadata
        await db.collection('models').doc(selectedModelId).set(metadataUpdate, { merge: true });
        
        console.log(`[${APP_VERSION}] Firestore metadata updated`);
        
        currentModelId = selectedModelId;
        
        // Display success message with storage location
        const storageMsg = storageLocation === 'external' 
            ? '☁️ external server'
            : storageLocation === 'firestore-fallback'
            ? '💾 Firestore (fallback)'
            : `💾 Firestore (${metadataUpdate.chunksCount} chunks)`;
        
        errorElement.textContent = `✅ Model saved to ${storageMsg}! (${sizeMB} MB)`;
        setTimeout(() => { errorElement.textContent = ''; }, 5000);
        
        // Reload catalog to get updated metadata
        await loadModelCatalog();
        
    } catch (error) {
        console.error(`[${APP_VERSION}] Save to Firebase error:`, error);
        
        // v15: Detect permission-denied errors and provide actionable guidance
        let errorMessage = 'Error saving model: ' + error.message;
        if (error.code === 'permission-denied' || (error.message && error.message.includes('permission'))) {
            errorMessage = '❌ Permission denied. Please check:\n' +
                '1. Your admin user has admins/{uid} document with enabled: true\n' +
                '2. Firestore rules allow admin write to modelDatasets/{modelId}/chunks/*\n' +
                '3. You are logged in as an admin user\n\n' +
                'Original error: ' + error.message;
        }
        
        errorElement.textContent = errorMessage;
        alert(errorMessage);
    } finally {
        saveModelBtn.disabled = false;
        saveModelBtn.textContent = '💾 Save to Server';
    }
}

// v12: Load model from Firestore chunks (replaces Firebase Storage)
// v16: Load model from Firestore chunks or external storage (replaces Firebase Storage)
async function loadModelFromFirebase() {
    try {
        // v14: Use management helper to validate and get selected model
        const selectedModelId = requireSelectedModelIdForManagement();
        if (!selectedModelId) {
            return;
        }
        
        loadModelBtn.disabled = true;
        loadModelBtn.textContent = '📂 Loading...';
        errorElement.textContent = 'Loading model...';
        
        // Get model metadata
        const modelDoc = await db.collection('models').doc(selectedModelId).get();
        if (!modelDoc.exists) {
            throw new Error('Model not found in catalog');
        }
        
        const modelMeta = modelDoc.data();
        let modelData;
        
        // v16: Check if model uses external storage
        if (modelMeta.artifactStorage === 'external' && modelMeta.artifactUrl) {
            console.log(`[${APP_VERSION}] Loading model from external storage: ${selectedModelId}`);
            errorElement.textContent = 'Downloading model from external server...';
            
            // Load from external server
            modelData = await downloadModelFromExternalServer(modelMeta.artifactUrl);
            
            console.log(`[${APP_VERSION}] Model loaded from external storage`);
        } else {
            // v12: Load from Firestore chunks (default/backward compatible)
            console.log(`[${APP_VERSION}] Loading model from Firestore chunks: ${selectedModelId}`);
            errorElement.textContent = 'Loading model from Firestore...';
            
            modelData = await loadModelFromFirestoreChunks(selectedModelId);
            
            console.log(`[${APP_VERSION}] Model loaded from Firestore chunks`);
        }
        
        console.log(`[${APP_VERSION}] Model data loaded, format: ${modelData.format}`);
        
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
        const storageType = modelMeta.artifactStorage === 'external' ? '☁️ external server' : '💾 Firestore';
        errorElement.textContent = `✅ Model loaded from ${storageType}! (${sizeMB} MB)`;
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

// v12: Export model as JSON download (admin only)
function exportModel() {
    // v14: Use management helper to validate and get selected model
    const selectedModelId = requireSelectedModelIdForManagement();
    if (!selectedModelId) {
        return;
    }
    
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
    // v14: Use management helper to validate and get selected model
    const selectedModelId = requireSelectedModelIdForManagement();
    if (!selectedModelId) {
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

// v12: Delete model (admin only)
async function deleteModel() {
    // v14: Use management helper to validate and get selected model
    const selectedModelId = requireSelectedModelIdForManagement();
    if (!selectedModelId) {
        return;
    }
    
    const modelName = modelCatalog.find(m => m.id === selectedModelId)?.name || selectedModelId;
    
    if (!confirm(`Delete model "${modelName}"? This will remove the model from Firestore.`)) {
        return;
    }
    
    try {
        deleteModelBtn.disabled = true;
        deleteModelBtn.textContent = '🗑️ Deleting...';
        
        // v12: Delete chunks from Firestore
        const chunksSnapshot = await db.collection('modelDatasets')
            .doc(selectedModelId)
            .collection('chunks')
            .get();
        
        const deleteBatch = db.batch();
        chunksSnapshot.docs.forEach(doc => {
            deleteBatch.delete(doc.ref);
        });
        
        // Delete dataset metadata
        deleteBatch.delete(db.collection('modelDatasets').doc(selectedModelId));
        
        await deleteBatch.commit();
        console.log(`[${APP_VERSION}] Deleted ${chunksSnapshot.size} chunks from Firestore`);
        
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

// v14: Create new model (admin only)
async function createNewModel() {
    if (!isAdminMode) {
        alert('Admin access required');
        console.log(`[${APP_VERSION}] Create model blocked: admin access required`);
        return;
    }
    
    try {
        createModelBtn.disabled = true;
        createModelBtn.textContent = '➕ Creating...';
        
        // Find next available model ID (model-1 to model-10)
        const existingIds = modelCatalog.map(m => m.id);
        let nextId = null;
        
        for (let i = 1; i <= 10; i++) {
            const candidateId = `model-${i}`;
            if (!existingIds.includes(candidateId)) {
                nextId = candidateId;
                break;
            }
        }
        
        if (!nextId) {
            alert('Достигнут лимит 10 моделей');
            console.log(`[${APP_VERSION}] Cannot create model: limit of 10 models reached`);
            return;
        }
        
        // Extract model number for naming
        const modelNum = nextId.split('-')[1];
        
        // Create Firestore document
        await db.collection('models').doc(nextId).set({
            name: `Model ${modelNum}`,
            format: 'knn-mobilenet-v1',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            appVersion: APP_VERSION,
            classesCount: 0,
            examplesCount: 0,
            chunksCount: 0,
            datasetVersion: 0,
            sizeBytes: 0
        });
        
        console.log(`[${APP_VERSION}] Created model: ${nextId}`);
        errorElement.textContent = `✅ Model ${modelNum} created!`;
        setTimeout(() => { errorElement.textContent = ''; }, 2000);
        
        // Refresh catalog and select the new model
        await loadModelCatalog();
        modelSelect.value = nextId;
        currentModelId = nextId;
        
        // Update button states
        updateManagementButtonStates();
        
    } catch (error) {
        console.error(`[${APP_VERSION}] Create model error:`, error);
        alert('Error creating model: ' + error.message);
    } finally {
        createModelBtn.disabled = false;
        createModelBtn.textContent = '➕ Create Model';
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
        
        // v12: Auto-load default model in public mode
        if (!isAdminMode && modelCatalog.length > 0) {
            const defaultModel = modelCatalog.find(m => m.id === DEFAULT_MODEL_ID);
            if (defaultModel) {
                console.log(`[${APP_VERSION}] Auto-loading default model: ${DEFAULT_MODEL_ID}`);
                try {
                    modelSelect.value = DEFAULT_MODEL_ID;
                    await loadModelFromFirebase();
                    console.log(`[${APP_VERSION}] Default model loaded successfully`);
                } catch (error) {
                    console.error(`[${APP_VERSION}] Failed to auto-load default model:`, error);
                    errorElement.textContent = 'Could not load default model. Recognition may not work.';
                }
            }
        }
        
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
    // v12: Prevent switching to training mode in public mode
    if (mode === 'training' && !isAdminMode) {
        console.log(`[${APP_VERSION}] Training mode blocked: admin access required`);
        return;
    }
    
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

// v12: Class management (admin only)
function addClassPrompt() {
    // v12: Block in public mode
    if (!isAdminMode) {
        alert('Admin access required');
        return;
    }
    
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
    // v12: Block in public mode
    if (!isAdminMode) {
        alert('Admin access required');
        console.log(`[${APP_VERSION}] Delete class blocked: admin access required`);
        return;
    }
    
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
    // v12: Block in public mode
    if (!isAdminMode) {
        console.log(`[${APP_VERSION}] Capture blocked: admin access required`);
        return;
    }
    
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
    
    // v14: Variant A workflow - Training operations (add class, take photo) work without model selection.
    // Model selection is only required for persistence operations (save/load/rename/delete/export).
    // Admin must explicitly create or select a model using the Create Model button to save trained data.
    
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
    // v12: Fix NPE - check if classifier exists
    if (!classifier) {
        resultOverlay.textContent = 'Модель не инициализирована';
        resultOverlay.className = 'result-overlay no-model';
        recognitionStatus.textContent = 'Сначала загрузи или обучи модель';
        return;
    }
    
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
        // v15: Guard against null classifier to prevent null-pointer errors
        if (!classifier) {
            console.log('Auto-save skipped: classifier not initialized');
            return;
        }
        
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
    createModelBtn.addEventListener('click', createNewModel);
    
    // v14: Sync currentModelId when select changes and update button states
    modelSelect.addEventListener('change', () => {
        const newValue = modelSelect.value;
        if (newValue && newValue !== currentModelId) {
            currentModelId = newValue;
            console.log(`[${APP_VERSION}] Model selection changed to: ${currentModelId}`);
        }
        // Update management button states based on new selection
        updateManagementButtonStates();
    });
    
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
