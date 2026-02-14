# 🚗 My Car Detector

Web app with **in-app training** — recognize anything directly from your phone camera! No server needed, everything runs in the browser.

## ✨ Features

- 🎓 **In-App Training** — create custom classes and train the model right from your camera
- 🎯 **Real-Time Recognition** — instant object detection with confidence percentage
- 💾 **Persistent Storage** — save/load trained models to localStorage
- 📱 **Mobile-First** — optimized for smartphone use with rear camera support
- 🌐 **100% Client-Side** — all processing happens in the browser using TensorFlow.js
- 🎨 **Modern Dark UI** — sleek interface in Russian language

## 🚀 How to Use

### Training Mode (🎓 Обучение)

1. Open the app (requires HTTPS or localhost for camera access)
2. Click **"➕ Добавить класс"** and enter a class name (e.g., "Моя тачка", "Кот", "Памятник")
3. Point your camera at the object
4. Hold down the **"Захватить"** button to capture 15-20 training examples
5. Repeat for each class you want to recognize
6. Click **"💾 Сохранить модель"** to save your training

### Recognition Mode (🎯 Распознавание)

1. Switch to the **"🎯 Распознавание"** tab
2. Point your camera at objects
3. The app will show:
   - **Green overlay** (≥80% confidence) — high confidence match
   - **Yellow overlay** (<80% confidence) — low confidence match
   - Class name and confidence percentage

### Model Management

- **💾 Сохранить модель** — save trained model to browser storage
- **📂 Загрузить модель** — load previously saved model (auto-loads on start)
- **🗑️ Очистить всё** — delete all classes and saved model
- **🔄 Переключить камеру** — switch between front/rear camera

## 💡 Tips for Best Results

- **Capture 15-20 examples** per class for reliable recognition
- **Vary angles and distances** while capturing examples
- **Use good lighting** for better accuracy
- **Rear camera works best** — front camera is flipped by default
- **Train multiple classes** for better differentiation

## 🛠️ Local Development

### Option 1: Python HTTP Server
```bash
python3 -m http.server 8080
```
Then open: `http://localhost:8080/index.html`

### Option 2: Node.js HTTP Server
```bash
npx http-server
```

### Option 3: VS Code Live Server
Install the "Live Server" extension and click "Go Live"

## 📱 Browser Compatibility

**Recommended:**
- Chrome/Edge (mobile & desktop)
- Safari (iOS/macOS)

**Also works on:**
- Firefox
- Any modern browser with WebRTC + WebGL support

## 🔒 Requirements

- **HTTPS or localhost** — camera access requires secure context
- **Internet connection** — for loading TensorFlow.js libraries from CDN
- **Disable ad blockers** — some may block CDN resources

⚠️ File protocol (`file://`) will not work due to browser security restrictions.

## ⚙️ Technical Details

### Technology Stack
- **TensorFlow.js** — machine learning in the browser
- **MobileNet** — pre-trained model for feature extraction (transfer learning)
- **KNN Classifier** — k-nearest neighbors for instant training
- **localStorage** — model persistence across sessions

### How It Works
1. MobileNet extracts 1024-dimensional feature vectors from camera frames
2. KNN Classifier learns from these features (no backpropagation needed!)
3. Predictions run in real-time at ~10 FPS
4. Model data is serialized to localStorage for persistence

### Performance
- **Model size:** ~5MB (MobileNet) + your training data (~1KB per example)
- **Inference speed:** ~100ms per frame
- **Training speed:** Instant (no model updates needed)

## 🏗️ Architecture

```
User Camera → MobileNet (feature extraction) → KNN Classifier → Prediction
                                                    ↓
                                            localStorage (save/load)
```

## 📸 Example Use Cases

- **Car recognition** — "Моя тачка" vs "Не моя тачка"
- **Pet identification** — recognize your cat/dog
- **Monument/landmark recognition** — identify famous places
- **Friend recognition** — "Петя", "Маша", "Иван"
- **Product categorization** — organize items by type
- **Custom object detection** — anything you can imagine!

## 🐛 Troubleshooting

**Camera not working:**
- Ensure you're using HTTPS or localhost
- Check browser camera permissions
- Try reloading the page

**Models not loading:**
- Check internet connection
- Disable ad blockers/privacy extensions
- Check browser console for errors

**Low accuracy:**
- Capture more training examples (20-30 per class)
- Ensure good lighting conditions
- Try different angles and distances
- Add more diverse examples

**Model not saving:**
- Check browser localStorage quota
- Try clearing old saved models
- Use private/incognito mode to test

## 📄 License

Open source — feel free to use and modify!