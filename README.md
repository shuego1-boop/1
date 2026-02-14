# My Car Detector v12 🚗

A real-time object detection web app using TensorFlow.js with KNN classifier and MobileNet.

## v12 Features

### Firestore Chunked Storage (NEW in v12)
- **No Firebase Storage required**: Works on Spark (free) plan
- **Chunked storage**: Model datasets split into 500KB chunks (before encoding), stored in Firestore
- **Public read access**: Anyone can load default model and use recognition
- **Admin write access**: Only admins can save/update models

### Hard Public/Admin Split
- **Public mode (default)**: Recognition only - no login required
  - ✅ Can use recognition to identify objects
  - ✅ Auto-loads default model (`model-1`) if available
  - ❌ Cannot see model catalog or management controls
  - ❌ Cannot access training mode
  - ❌ Cannot add classes or capture frames
  - ❌ Cannot save, rename, delete, or export models
- **Admin mode (after login)**: Full functionality
  - ✅ Training mode with class management
  - ✅ Model catalog access
  - ✅ Save/rename/delete models
  - ✅ Export models as JSON
  - ✅ Autosave enabled

### Improved Admin Authentication
- **User-friendly error messages**: Clear Russian messages for common Firebase auth errors
- **Diagnostics**: Firebase project configuration displayed in login modal
- **Better logging**: Error codes logged for troubleshooting

### Smart Detection
- **"Не распознано" (Unknown)**: Shows when confidence is below 70%
- **Confidence indicators**: 
  - 🟢 Green (90%+): High confidence
  - 🔵 Blue (70-89%): Medium confidence
  - 🔴 Red (<70%): Unknown/Not recognized

## Firebase Setup

### Prerequisites
1. Firebase project created at: `raspozn-ef99a`
2. Firebase config (already in code):
   ```javascript
   apiKey: "AIzaSyDUX-p3RKcnWXMIHF0Ofk5m7LupxdU9nZU"
   authDomain: "raspozn-ef99a.firebaseapp.com"
   projectId: "raspozn-ef99a"
   storageBucket: "raspozn-ef99a.firebasestorage.app"
   messagingSenderId: "978235404466"
   appId: "1:978235404466:web:bc11571d676cdb55f719ab"
   ```

> **Security Note**: Firebase API keys are designed to be public and included in client-side code. Security is enforced through Firebase Security Rules (see below), not by hiding the API key. However, you should configure API key restrictions in Google Cloud Console to limit usage to your specific domains and prevent abuse. Consider enabling Firebase App Check for additional protection against unauthorized clients.

### Step 1: Enable Email/Password Authentication

1. Go to Firebase Console → Authentication
2. Click "Sign-in method" tab
3. Enable "Email/Password" provider
4. **Add authorized domain**: In the same tab, scroll down to "Authorized domains" and add `shuego1-boop.github.io` (if deploying to GitHub Pages)
5. Save changes

### Step 2: Create Admin User

1. In Firebase Console → Authentication → Users
2. Click "Add user"
3. Enter email and password for your admin account
4. Note the **UID** of the created user (you'll need this)

### Step 3: Set Admin Role

1. Go to Firebase Console → Firestore Database
2. Create collection `admins`
3. Add document with ID = your user's **UID**
4. Add field:
   ```
   enabled: true (boolean)
   ```

### Step 4: Set Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Helper function to check if user is admin
    function isAdmin() {
      return request.auth != null && 
             exists(/databases/$(database)/documents/admins/$(request.auth.uid)) &&
             get(/databases/$(database)/documents/admins/$(request.auth.uid)).data.enabled == true;
    }
    
    // Models collection: public read, admin write
    match /models/{modelId} {
      allow read: if true;  // Public can read metadata
      allow create, update, delete: if isAdmin();
    }
    
    // Model datasets collection: public read, admin write
    match /modelDatasets/{modelId} {
      allow read: if true;  // Public can read dataset metadata
      allow write: if isAdmin();
      
      // Chunks subcollection: public read, admin write
      match /chunks/{chunkId} {
        allow read: if true;  // Public can read chunks to load models
        allow write: if isAdmin();
      }
    }
    
    // Admins collection: no client writes allowed
    match /admins/{uid} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow write: if false;  // Only via Firebase Console
    }
  }
}
```

> **Note**: Firebase Storage is no longer required in v12. All model data is stored in Firestore using chunked storage, which works on the free Spark plan.

### Step 5: Verify Security Rules

**IMPORTANT**: UI hiding is not security. Real protection is enforced by Firebase Security Rules.

#### How to verify rules are working:

1. **Test public read access**:
   - Open the app in Incognito mode (not logged in)
   - You should be able to view recognition mode only
   - Model catalog and training features should be hidden

2. **Test public write denied**:
   - Open browser console (F12)
   - Try to write: `db.collection('models').add({test: true})`
   - Should fail with "permission-denied" error

3. **Test admin write access**:
   - Login as admin
   - Training and model management UI should appear
   - Try saving a model - should succeed

4. **Test Firestore rules**:
   - In Incognito mode, you can still load models (public read on chunks)
   - Attempting to write would fail (admin write only)

#### Error handling in app:
- Non-admin attempts at admin actions show "Admin access required"
- Firebase permission-denied errors show clear messages
- All admin actions are blocked in public mode via UI and code checks

### Step 6: Initialize Default Models (Optional)

After logging in as admin:
1. Click "🔐 Admin" button
2. Click "Initialize Default Models" button
3. This creates 10 empty model entries (model-1 through model-10)
4. Train `model-1` first so public users can auto-load it

## Usage

### Public Mode (No Login)
1. Open the app - default model (`model-1`) auto-loads if available
2. Switch to Recognition mode to test
3. Point camera at objects to recognize them
4. **No training, export, or management features available**

### Admin Mode
1. Click "🔐 Admin" button
2. Enter your admin email and password
3. After login, you can:
   - Access Training mode
   - Save models to Firestore chunks with "💾 Save to Server"
   - Rename models with "✏️ Rename"
   - Delete models with "🗑️ Delete"
   - Export models with "💾 Export"
   - Autosave is enabled (saves 2 seconds after last change)

### Training a Model (Admin Only)
1. Click "➕ Add New Class" to create categories
2. Select a class from the radio buttons
3. Hold "📸 Take Photo" button to capture multiple examples
4. Add at least 2 classes with multiple examples each
5. Switch to "🎯 Распознавание" mode to test

### Recognition
- Point camera at objects you've trained
- 🟢 Green: High confidence (90%+)
- 🔵 Blue: Medium confidence (70-89%)
- 🔴 Red: Unknown/Not recognized (<70%)

## Technical Details

### Data Model

#### Firestore `models` Collection
```javascript
{
  name: "Model Name",              // Display name (editable)
  format: "knn-mobilenet-v1",      // Model format
  updatedAt: Timestamp,            // Last update
  sizeBytes: 1234567,              // Total size of JSON
  classesCount: 5,                 // Number of classes
  examplesCount: 150,              // Total examples
  appVersion: "v12",               // App version
  datasetVersion: 2,               // Increments on each save
  chunksCount: 3,                  // Number of chunks
  default: true                    // (Optional) Default model flag
}
```

#### Firestore `modelDatasets/{modelId}` Document
```javascript
{
  datasetVersion: 2,               // Matches model datasetVersion
  updatedAt: Timestamp             // Last update
}
```

#### Firestore `modelDatasets/{modelId}/chunks/{chunkId}` Subcollection
```javascript
{
  v: 2,                            // datasetVersion
  i: 0,                            // Chunk index (0, 1, 2, ...)
  data: "base64EncodedChunk...",   // Base64-encoded JSON chunk
  bytes: 667000                    // Size in bytes (example)
}
```

### Chunking Strategy
- Model JSON is serialized to a string
- String is split into chunks of 500KB before encoding
- Each chunk is encoded to UTF-8 using TextEncoder, then base64-encoded
- After encoding, chunks are ~667KB (4/3 size increase), staying safely under 1MB Firestore limit
- On load: chunks are fetched in order by index, decoded from base64, decoded from UTF-8, concatenated, and parsed

### Original Model Dataset Format
```javascript
{
  format: "knn-mobilenet-v1",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  appVersion: "v12",
  classes: {
    "className": {
      examples: 30
    }
  },
  dataset: {
    "className": {
      shape: [30, 1024],
      data: [/* flattened tensor data */]
    }
  }
}
```

This JSON is what gets chunked and stored in Firestore.

### Security Model
- **Public users**: Can load and use models (read-only), no authentication required
- **Admin users**: Must login with Firebase Auth, verified via `admins/{uid}` document
- **Firestore**: Public read for models and chunks, admin write (enforced by Firestore rules)
- **No Firebase Storage required**: Works on Spark (free) plan
- **No secrets in frontend**: Admin verification happens server-side via Firebase rules

## iOS Safari Compatibility

This app includes extensive fixes for iOS Safari:
- Video stream isolation (prevents disconnection on DOM changes)
- No `innerHTML` manipulation near video elements
- Proper async/await for video readiness
- Manual camera restart button
- Touch event handling with proper passive flags

## Development

### Files
- `index.html` - UI structure with modal and controls
- `app.js` - Main application logic, Firebase integration, ML model
- `style.css` - Styling including admin modal and status indicators
- `README.md` - This file

### Version History
- **v12**: Firestore chunked storage (no Storage required) + strict Public/Admin split + auto-load default model + auth diagnostics
- **v11**: Firebase public catalog + admin mode + "Не распознано"
- **v10**: Enhanced iOS Safari compatibility with video isolation
- **v9**: Visual feedback and improved mobile UX
- Earlier versions: Basic KNN classifier implementation

## Troubleshooting

### "Access denied. You are not an admin"
- Verify your user UID matches the document ID in `admins` collection
- Check that `enabled: true` is set in the admin document
- Make sure Firestore rules are deployed correctly

### Model won't load
- Check browser console for errors
- Verify model exists in Firestore (both metadata and chunks)
- Check Firestore rules allow public read access to chunks
- Try refreshing the page

### Camera not working
- Grant camera permissions when prompted
- Click "⚠️ Камера зависла? Перезапустить" if camera freezes (common on iOS)
- Check that you're using HTTPS or localhost

### Autosave not working
- Only works in admin mode
- Waits 2 seconds after last change
- Check browser console for upload errors

## License

MIT

## Credits

Built with:
- [TensorFlow.js](https://www.tensorflow.org/js)
- [MobileNet](https://github.com/tensorflow/tfjs-models/tree/master/mobilenet)
- [KNN Classifier](https://github.com/tensorflow/tfjs-models/tree/master/knn-classifier)
- [Firebase](https://firebase.google.com/)
