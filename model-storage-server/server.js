const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const DATA_DIR = process.env.DATA_DIR || './data';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['https://shuego1-boop.github.io', 'http://localhost:8080', 'http://127.0.0.1:8080'];

// Validate API_KEY is set
if (!API_KEY) {
  console.error('[CRITICAL] API_KEY environment variable is not set!');
  console.error('[CRITICAL] Server will not accept uploads or deletes without an API key.');
  console.error('[CRITICAL] Please set API_KEY in .env file or environment variables.');
  process.exit(1);
}

// Ensure data directory exists
(async () => {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    console.log(`[Server] Data directory ready: ${DATA_DIR}`);
  } catch (error) {
    console.error('[Server] Failed to create data directory:', error);
    process.exit(1);
  }
})();

// CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key']
};

app.use(cors(corsOptions));
app.use(morgan('combined'));

// Middleware to verify API key for protected routes
const requireApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ 
      error: 'Missing API key',
      message: 'X-API-Key header is required' 
    });
  }
  
  if (apiKey !== API_KEY) {
    console.warn(`[Auth] Invalid API key attempt from ${req.ip}`);
    return res.status(401).json({ 
      error: 'Invalid API key',
      message: 'The provided API key is incorrect' 
    });
  }
  
  next();
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    dataDir: DATA_DIR 
  });
});

// Upload model artifact
// Expects: gzipped binary data (application/octet-stream)
app.post('/api/models/:modelId', requireApiKey, express.raw({ 
  type: 'application/octet-stream',
  limit: '50mb' // Adjust based on your needs
}), async (req, res) => {
  try {
    const { modelId } = req.params;
    
    // Validate modelId (alphanumeric, hyphens, underscores only)
    if (!/^[a-zA-Z0-9_-]+$/.test(modelId)) {
      return res.status(400).json({ 
        error: 'Invalid model ID',
        message: 'Model ID must contain only alphanumeric characters, hyphens, and underscores' 
      });
    }
    
    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ 
        error: 'Empty request body',
        message: 'Request body must contain model data' 
      });
    }
    
    const filePath = path.join(DATA_DIR, `${modelId}.gz`);
    const sizeBytes = req.body.length;
    const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);
    
    console.log(`[Upload] Saving model ${modelId}, size: ${sizeMB} MB`);
    
    // Write gzipped data to disk
    await fs.writeFile(filePath, req.body);
    
    // Store metadata
    const metaPath = path.join(DATA_DIR, `${modelId}.meta.json`);
    const metadata = {
      modelId,
      sizeBytes,
      uploadedAt: new Date().toISOString(),
      contentEncoding: 'gzip'
    };
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2));
    
    console.log(`[Upload] Model ${modelId} saved successfully`);
    
    res.status(200).json({
      success: true,
      modelId,
      sizeBytes,
      message: `Model uploaded successfully (${sizeMB} MB)`
    });
    
  } catch (error) {
    console.error('[Upload] Error:', error);
    res.status(500).json({ 
      error: 'Upload failed',
      message: error.message 
    });
  }
});

// Download model artifact
app.get('/api/models/:modelId', async (req, res) => {
  try {
    const { modelId } = req.params;
    
    // Validate modelId
    if (!/^[a-zA-Z0-9_-]+$/.test(modelId)) {
      return res.status(400).json({ 
        error: 'Invalid model ID',
        message: 'Model ID must contain only alphanumeric characters, hyphens, and underscores' 
      });
    }
    
    const filePath = path.join(DATA_DIR, `${modelId}.gz`);
    
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ 
        error: 'Model not found',
        message: `Model ${modelId} does not exist` 
      });
    }
    
    // Read metadata if available
    const metaPath = path.join(DATA_DIR, `${modelId}.meta.json`);
    let metadata = null;
    try {
      const metaContent = await fs.readFile(metaPath, 'utf-8');
      metadata = JSON.parse(metaContent);
    } catch {
      // Metadata is optional
    }
    
    console.log(`[Download] Serving model ${modelId}`);
    
    // Set headers for gzipped content
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${modelId}.gz"`);
    
    if (metadata && metadata.sizeBytes) {
      res.setHeader('Content-Length', metadata.sizeBytes);
    }
    
    // Stream the file for better memory efficiency
    const fileStream = require('fs').createReadStream(filePath);
    fileStream.pipe(res);
    
    fileStream.on('error', (error) => {
      console.error('[Download] Stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: 'Download failed',
          message: error.message 
        });
      }
    });
    
  } catch (error) {
    console.error('[Download] Error:', error);
    res.status(500).json({ 
      error: 'Download failed',
      message: error.message 
    });
  }
});

// Delete model artifact
app.delete('/api/models/:modelId', requireApiKey, async (req, res) => {
  try {
    const { modelId } = req.params;
    
    // Validate modelId
    if (!/^[a-zA-Z0-9_-]+$/.test(modelId)) {
      return res.status(400).json({ 
        error: 'Invalid model ID',
        message: 'Model ID must contain only alphanumeric characters, hyphens, and underscores' 
      });
    }
    
    const filePath = path.join(DATA_DIR, `${modelId}.gz`);
    const metaPath = path.join(DATA_DIR, `${modelId}.meta.json`);
    
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ 
        error: 'Model not found',
        message: `Model ${modelId} does not exist` 
      });
    }
    
    console.log(`[Delete] Removing model ${modelId}`);
    
    // Delete model file
    await fs.unlink(filePath);
    
    // Delete metadata file if exists
    try {
      await fs.unlink(metaPath);
    } catch {
      // Metadata is optional
    }
    
    console.log(`[Delete] Model ${modelId} deleted successfully`);
    
    res.status(200).json({
      success: true,
      modelId,
      message: 'Model deleted successfully'
    });
    
  } catch (error) {
    console.error('[Delete] Error:', error);
    res.status(500).json({ 
      error: 'Delete failed',
      message: error.message 
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    message: 'The requested endpoint does not exist' 
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`[Server] Model storage API running on port ${PORT}`);
  console.log(`[Server] Allowed origins:`, ALLOWED_ORIGINS.join(', '));
  console.log(`[Server] API key configured: ${API_KEY.substring(0, 4)}...`);
  console.log(`[Server] Data directory: ${DATA_DIR}`);
});
