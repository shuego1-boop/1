# Model Storage Server

External storage API for large ML model artifacts. This server allows the web app to store model files larger than Firestore's limits.

## Features

- **RESTful API**: Simple POST/GET/DELETE endpoints for model storage
- **Gzip Compression**: Models are stored compressed to save space
- **API Key Authentication**: Simple key-based auth for uploads/deletes
- **CORS Support**: Configurable allowed origins
- **Docker Ready**: Easy deployment with Docker Compose
- **Automatic HTTPS**: Caddy provides SSL certificates via Let's Encrypt

## Quick Start

### Prerequisites

- Docker and Docker Compose installed
- A domain name (for HTTPS)
- Port 80 and 443 open on your server

### Deployment Steps

1. **Clone the repository and navigate to the server directory:**
   ```bash
   cd model-storage-server
   ```

2. **Create environment file:**
   ```bash
   cp .env.example .env
   ```

3. **Edit `.env` file with your settings:**
   ```bash
   nano .env
   ```
   
   **IMPORTANT**: Change these values:
   - `API_KEY`: Generate a strong random key (e.g., use `openssl rand -base64 32`)
   - `ALLOWED_ORIGINS`: Add your GitHub Pages URL (e.g., `https://yourusername.github.io`)

   Example `.env`:
   ```env
   API_KEY=abc123xyz789secretkey
   PORT=3000
   DATA_DIR=/app/data
   ALLOWED_ORIGINS=https://shuego1-boop.github.io,http://localhost:8080
   ```

4. **Edit `Caddyfile` with your domain:**
   ```bash
   nano Caddyfile
   ```
   
   Replace `YOUR_DOMAIN.com` with your actual domain (e.g., `models.example.com`):
   ```
   models.example.com {
       reverse_proxy api:3000
       # ... rest of config
   }
   ```

5. **Point your domain to the server:**
   - Create an A record pointing your domain to your server's IP address
   - Wait for DNS propagation (can take up to 24 hours, usually much faster)

6. **Start the services:**
   ```bash
   docker-compose up -d
   ```

7. **Check logs to verify everything is running:**
   ```bash
   docker-compose logs -f
   ```

8. **Test the API:**
   ```bash
   # Health check (should work immediately)
   curl http://localhost:3000/health
   
   # After DNS propagates, test via your domain:
   curl https://YOUR_DOMAIN.com/health
   ```

### Configure the Web App

After deploying the server, update your web app configuration:

1. Open `app.js` in your web app
2. Set these constants near the top of the file:
   ```javascript
   const EXTERNAL_MODEL_STORE_BASE_URL = 'https://YOUR_DOMAIN.com';
   const EXTERNAL_MODEL_STORE_API_KEY = 'your-api-key-from-env';
   ```

3. Optionally adjust the threshold:
   ```javascript
   const EXTERNAL_STORAGE_THRESHOLD = 800 * 1024; // 800KB in bytes
   ```

## API Endpoints

### Health Check
```
GET /health
```
Returns server status. No authentication required.

### Upload Model
```
POST /api/models/:modelId
Headers:
  X-API-Key: your-api-key
  Content-Type: application/octet-stream
Body: gzipped model data (binary)
```

### Download Model
```
GET /api/models/:modelId
```
Returns gzipped model data. No authentication required (public read).

### Delete Model
```
DELETE /api/models/:modelId
Headers:
  X-API-Key: your-api-key
```

## Testing Locally (Development)

1. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

2. **Create `.env` file:**
   ```bash
   cp .env.example .env
   ```

3. **Run the server:**
   ```bash
   npm start
   ```
   
   Or with auto-reload:
   ```bash
   npm run dev
   ```

4. **Test with curl:**
   ```bash
   # Health check
   curl http://localhost:3000/health
   
   # Upload a test file
   echo "test data" | gzip | curl -X POST \
     -H "X-API-Key: your-secret-api-key-here" \
     -H "Content-Type: application/octet-stream" \
     --data-binary @- \
     http://localhost:3000/api/models/test-model-1
   
   # Download the file
   curl http://localhost:3000/api/models/test-model-1 | gunzip
   
   # Delete the file
   curl -X DELETE \
     -H "X-API-Key: your-secret-api-key-here" \
     http://localhost:3000/api/models/test-model-1
   ```

## Security Considerations

### API Key Security

⚠️ **IMPORTANT SECURITY WARNING**:

The API key will be present in your client-side JavaScript code. This means:

1. **Anyone can view the API key** by inspecting your web app's source code
2. **Anyone with the key can upload/delete models** on your server
3. This is **not production-grade security** - it's a simple authentication mechanism

### Recommended Security Measures:

1. **Use a dedicated API key**: Don't reuse passwords or keys from other services
2. **Monitor server logs**: Watch for suspicious activity
3. **Implement rate limiting**: The Caddyfile includes commented rate limiting config
4. **Keep API key rotated**: Change it periodically
5. **Restrict CORS origins**: Only allow your actual GitHub Pages domain
6. **Set up firewall rules**: Only allow necessary ports (80, 443, SSH)
7. **Keep system updated**: Regularly update Docker, system packages

### Future Improvements (Recommended):

For production use, consider implementing:
- **Firebase Authentication tokens**: Verify Firebase user tokens server-side
- **OAuth 2.0**: Use standard OAuth flow
- **IP whitelisting**: Restrict uploads to specific IP ranges
- **Request signing**: Sign requests with timestamps to prevent replay attacks
- **File scanning**: Scan uploaded files for malware
- **Storage quotas**: Limit storage per user/model

## Maintenance

### View Logs
```bash
docker-compose logs -f api
docker-compose logs -f caddy
```

### Restart Services
```bash
docker-compose restart
```

### Update Server Code
```bash
git pull
docker-compose down
docker-compose up -d --build
```

### Backup Data
```bash
tar -czf backup-$(date +%Y%m%d).tar.gz data/
```

### Check Disk Usage
```bash
du -sh data/
df -h
```

## Troubleshooting

### CORS Errors
- Verify `ALLOWED_ORIGINS` in `.env` includes your GitHub Pages URL
- Check browser console for exact error message
- Ensure URL format matches exactly (https vs http, trailing slashes)

### "Invalid API key" Error
- Verify API key matches between `.env` and web app config
- Check for extra spaces or newlines in API key
- Restart Docker containers after changing `.env`

### "Model not found" Error
- Check if model file exists: `ls -la data/`
- Verify correct modelId is being used
- Check server logs for upload errors

### Caddy Certificate Issues
- Ensure port 80 and 443 are accessible from internet
- Verify DNS A record points to correct IP
- Check Caddy logs: `docker-compose logs caddy`
- May take a few minutes for Let's Encrypt to issue certificate

### Cannot Connect to Server
- Check if services are running: `docker-compose ps`
- Verify firewall allows ports 80 and 443
- Check server IP address is correct
- Test with curl locally first

## System Requirements

- **RAM**: 512MB minimum, 1GB recommended
- **Storage**: 10GB minimum (depends on model sizes)
- **CPU**: 1 core minimum
- **OS**: Any Linux distribution with Docker support
- **Network**: Public IP address with ports 80 and 443 accessible

## License

MIT - See main repository LICENSE file
