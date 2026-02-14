# External Model Storage Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Web App (app.js)                             │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │ Configuration                                              │    │
│  │ • EXTERNAL_MODEL_STORE_BASE_URL = 'https://models.com'   │    │
│  │ • EXTERNAL_MODEL_STORE_API_KEY = 'secret-key'            │    │
│  │ • EXTERNAL_STORAGE_THRESHOLD = 800KB                      │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │ Save Model Flow                                           │    │
│  │                                                            │    │
│  │ 1. Serialize classifier dataset to JSON                   │    │
│  │ 2. Check if size > threshold (800KB)                      │    │
│  │ 3a. IF YES → External Storage Path:                       │    │
│  │     • Compress with gzip (CompressionStream)             │    │
│  │     • Upload to external server via HTTPS POST           │    │
│  │     • Store metadata in Firestore:                        │    │
│  │       - artifactStorage: 'external'                       │    │
│  │       - artifactUrl: 'https://models.com/api/...'        │    │
│  │ 3b. IF NO → Firestore Path:                              │    │
│  │     • Split into 500KB chunks                             │    │
│  │     • Base64 encode chunks                                │    │
│  │     • Store in Firestore chunks collection               │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │ Load Model Flow                                           │    │
│  │                                                            │    │
│  │ 1. Read metadata from Firestore                          │    │
│  │ 2. Check artifactStorage field                            │    │
│  │ 3a. IF 'external':                                        │    │
│  │     • Download from artifactUrl via HTTPS GET            │    │
│  │     • Decompress gzip (DecompressionStream)              │    │
│  │     • Parse JSON and restore classifier                   │    │
│  │ 3b. IF 'firestore' or undefined:                         │    │
│  │     • Load chunks from Firestore                          │    │
│  │     • Decode base64 and concatenate                       │    │
│  │     • Parse JSON and restore classifier                   │    │
│  └────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                             │
                             │ HTTPS
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Firestore Database                                │
│                                                                      │
│  models/{modelId}                                                   │
│  ├─ name: "Model 1"                                                │
│  ├─ sizeBytes: 2048000                                             │
│  ├─ artifactStorage: "external" or "firestore"                     │
│  ├─ artifactUrl: "https://models.com/api/models/model-1" (if ext) │
│  └─ chunksCount: 5 (if firestore)                                 │
│                                                                      │
│  modelDatasets/{modelId}/chunks/{chunkId} (if firestore)          │
│  ├─ data: "base64..."                                              │
│  └─ i: 0, 1, 2...                                                  │
└─────────────────────────────────────────────────────────────────────┘
                             │
                             │ HTTPS (if external)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  External Storage Server                             │
│                  (model-storage-server/)                             │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │ Caddy (Reverse Proxy + HTTPS)                           │      │
│  │ • Automatic SSL certificates via Let's Encrypt          │      │
│  │ • Reverse proxy to Node.js API                          │      │
│  └──────────────────────────────────────────────────────────┘      │
│                             ▼                                        │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │ Express API Server                                       │      │
│  │ • POST /api/models/:modelId (upload, requires API key)  │      │
│  │ • GET /api/models/:modelId (download, public)           │      │
│  │ • DELETE /api/models/:modelId (delete, requires API key)│      │
│  │ • Rate limiting: 100 req/15min general                  │      │
│  │                 20 req/15min writes                      │      │
│  │ • CORS: GitHub Pages origin                             │      │
│  └──────────────────────────────────────────────────────────┘      │
│                             ▼                                        │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │ File System                                              │      │
│  │ data/                                                    │      │
│  │ ├─ model-1.gz (gzipped model data)                      │      │
│  │ ├─ model-1.meta.json (metadata)                         │      │
│  │ ├─ model-2.gz                                            │      │
│  │ └─ model-2.meta.json                                     │      │
│  └──────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘


Data Flow Diagram:
═══════════════════

Small Model (<800KB):
Web App → Firestore Chunks → Web App

Large Model (>800KB):
Web App → Compress → External Server → Decompress → Web App
         ↓
      Firestore Metadata Only


Security Layers:
═══════════════

1. API Key Authentication (X-API-Key header)
   └─ Required for POST/DELETE, not for GET

2. Rate Limiting
   └─ 100 requests per 15 min (general)
   └─ 20 requests per 15 min (writes)

3. CORS Restrictions
   └─ Only configured origins allowed

4. Input Validation
   └─ Model ID must match: ^[a-zA-Z0-9_-]+$

5. HTTPS
   └─ Automatic via Caddy + Let's Encrypt


Compression Ratios:
══════════════════

Typical ML Model Data:
• Original JSON: 10 MB
• Gzipped: 1-3 MB (70-90% reduction)
• Transfer time: ~5x faster


Browser Compatibility:
═════════════════════

CompressionStream/DecompressionStream API:
• Chrome 80+ ✓
• Safari 16.4+ ✓
• Firefox 113+ ✓
• Edge 80+ ✓

Fallback for unsupported browsers:
• Use Firestore chunks automatically
• Clear error message shown
```
