# My Car Detector v11 🚗

A real-time object detection web app using TensorFlow.js with KNN classifier and MobileNet.

## v11 Features

### Public Model Catalog
- **Public mode by default**: No login required to use existing models
- **Firebase Storage**: Models stored in the cloud, not limited by localStorage
- **Model catalog**: Browse and load pre-trained models
- **Export capability**: Download models as JSON files

### Admin Mode
- **Secure authentication**: Firebase Email/Password login
- **Role-based access**: Only verified admins can save, rename, and delete models
- **Autosave**: Automatically saves changes after 2 seconds of inactivity
- **Model management**: Create, rename, and delete models

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

### Step 1: Enable Email/Password Authentication

1. Go to Firebase Console → Authentication
2. Click "Sign-in method" tab
3. Enable "Email/Password" provider
4. Save changes

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
      allow read: if true;  // Public can read
      allow create, update, delete: if isAdmin();
    }
    
    // Admins collection: no client writes allowed
    match /admins/{uid} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow write: if false;  // Only via Firebase Console
    }
  }
}
```

### Step 5: Set Firebase Storage Security Rules

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Helper function to check if user is admin
    function isAdmin() {
      return request.auth != null && 
             firestore.exists(/databases/(default)/documents/admins/$(request.auth.uid)) &&
             firestore.get(/databases/(default)/documents/admins/$(request.auth.uid)).data.enabled == true;
    }
    
    // Models storage: public read, admin write
    match /models/{modelId}/{allPaths=**} {
      allow read: if true;  // Public can read/download
      allow write: if isAdmin();
    }
  }
}
```

### Step 6: Initialize Default Models (Optional)

After logging in as admin:
1. Click "🔐 Admin" button
2. Click "Initialize Default Models" button
3. This creates 10 empty model entries (model-1 through model-10)

## Usage

### Public Mode (No Login)
1. Open the app
2. Select a model from the dropdown
3. Click "📂 Load Model"
4. Add classes and train
5. Switch to Recognition mode to test
6. Click "💾 Export" to download your model

### Admin Mode
1. Click "🔐 Admin" button
2. Enter your admin email and password
3. After login, you can:
   - Save models to Firebase with "💾 Save to Server"
   - Rename models with "✏️ Rename"
   - Delete models with "🗑️ Delete"
   - Autosave is enabled (saves 2 seconds after last change)

### Training a Model
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
  storagePath: "models/{id}/dataset.json",
  format: "knn-mobilenet-v1",
  updatedAt: Timestamp,
  sizeBytes: 1234567,
  classesCount: 5,
  examplesCount: 150,
  appVersion: "v11"
}
```

#### Storage `models/{modelId}/dataset.json`
```javascript
{
  format: "knn-mobilenet-v1",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  appVersion: "v11",
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

### Security Model
- **Public users**: Can read models and use the app, no authentication required
- **Admin users**: Must login with Firebase Auth, verified via `admins/{uid}` document
- **Storage**: Public read, admin write (enforced by Firebase Storage rules)
- **Firestore**: Public read, admin write (enforced by Firestore rules)
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
- Verify model exists in Firestore and Storage
- Check Firebase Storage rules allow public read access
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
