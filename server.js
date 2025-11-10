const express = require('express');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// --- Configuration ---
// Vercel inserts the environment variable here directly.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash-preview-09-2025';
const IMAGEN_MODEL = 'imagen-4.0-generate-001';

if (!GEMINI_API_KEY) {
    console.error("CRITICAL ERROR: GEMINI_API_KEY environment variable is NOT set.");
    // Crash the server immediately if the key is missing to prevent silent failures
    throw new Error("GEMINI_API_KEY not found. Server cannot start.");
}

// Critical System Instruction for the AI Game Master
const SYSTEM_PROMPT = `
    Ты — Мастер Игры и Сюжета для уникального психологического триллера/мистического квеста.
    Твоя главная задача — обеспечить, чтобы КАЖДАЯ ИГРА была абсолютно непредсказуемой и имела уникальную концовку.
    Сюжет должен быть напряженным, фокусироваться на тайнах, предательстве, ложных воспоминаниях, или паранормальных явлениях.

    Соблюдай СТРОГИЙ ФОРМАТ ВЫВОДА JSON.
    Обязательные поля:
    1. storySegment: (текст нового сегмента истории). Всегда пиши на русском языке.
    2. choices: (массив, содержащий ровно 3 варианта действий). Выборы должны быть морально сложными, не иметь очевидно правильного ответа, и значительно влиять на дальнейший сюжет.

    Если история достигла логического завершения (герой выжил, умер, раскрыл тайну и т.д.), storySegment должен содержать фразу "КОНЕЦ ИГРЫ:", а choices должны быть пустым массивом [].
`;

// --- Middleware Setup ---
// Universal CORS Fix: Allow requests from anywhere (including your frontend domain)
app.use(cors()); 
app.use(express.json());

// --- Helper Functions ---

/**
 * Handles API calls with exponential backoff using built-in fetch.
 */
async function fetchWithRetry(url, options, retries = 3) {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                if (response.status >= 400 && response.status < 500) {
                    // Log the error but continue retrying for API errors
                    console.error(`Client API error ${response.status} on attempt ${attempt + 1}.`);
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        } catch (error) {
            console.error(`Attempt ${attempt + 1} failed:`, error.message);
            if (attempt < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            } else {
                throw new Error(`Failed to fetch data after ${retries} attempts. Last error: ${error.message}`);
            }
        }
    }
}

/**
 * Calls the Gemini API to get the next story segment and choices.
 */
async function getNextStorySegment(chatHistory) {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    
    const payload = {
        contents: chatHistory,
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    "storySegment": { "type": "STRING" },
                    "choices": { "type": "ARRAY", "items": { "type": "STRING" } }
                },
                "propertyOrdering": ["storySegment", "choices"]
            }
        }
    };

    const result = await fetchWithRetry(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (result.candidates && result.candidates.length > 0) {
        const jsonText = result.candidates[0].content.parts[0].text;
        return JSON.parse(jsonText);
    } else {
        throw new Error("Invalid response structure from Gemini.");
    }
}

/**
 * Calls Imagen API to generate a unique illustration.
 */
async function generateIllustration(storySegment) {
    // Helper to derive a concise image prompt
    const extractImagePrompt = (segment) => {
        const firstSentenceMatch = segment.match(/^(.{20,100}[.!?])/);
        const basePrompt = firstSentenceMatch ? firstSentenceMatch[1] : "A dark and atmospheric psychological thriller scene, cinematic lighting, 8k, photorealistic.";
        // Ensure prompt is in English for better Imagen results
        return `Cinematic, dark, high contrast, highly detailed psychological thriller illustration of: "${basePrompt}". Horror, dramatic shadows, volumetric light, photorealistic, 4K, low angle.`;
    };

    const imagePrompt = extractImagePrompt(storySegment);
    const imagenUrl = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGEN_MODEL}:predict?key=${GEMINI_API_KEY}`;
    const imagenPayload = {
        instances: { prompt: imagePrompt },
        parameters: { "sampleCount": 1, "aspectRatio": "4:3" }
    };

    const result = await fetchWithRetry(imagenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(imagenPayload)
    });

    if (result.predictions && result.predictions.length > 0 && result.predictions[0].bytesBase64Encoded) {
        // Return base64 image data
        return `data:image/png;base64,${result.predictions[0].bytesBase64Encoded}`;
    } else {
        console.error("Image generation failed: No base64 data returned.");
        // Return null instead of erroring out completely
        return null;
    }
}

// --- API Endpoint ---

app.post('/api/advance-story', async (req, res) => {
    // 1. Validate Input
    const { chatHistory } = req.body;
    if (!chatHistory || !Array.isArray(chatHistory)) {
        return res.status(400).json({ error: "Invalid chat history provided." });
    }

    try {
        // 2. Generate Next Story Segment (Text/Choices)
        const storyData = await getNextStorySegment(chatHistory);

        // 3. Generate Illustration (In parallel or sequentially, here sequentially for simplicity)
        let imageUrl = null;
        if (!storyData.storySegment.toUpperCase().includes("КОНЕЦ ИГРЫ:")) {
             // Pass the story segment to Imagen
             imageUrl = await generateIllustration(storyData.storySegment);
        }

        // 4. Send combined response back to the Mini App
        res.json({
            storySegment: storyData.storySegment,
            choices: storyData.choices,
            imageUrl: imageUrl
        });

    } catch (error) {
        console.error("API Call Error:", error.message);
        res.status(500).json({ error: "Failed to generate story segment or image.", details: error.message });
    }
});


// Vercel runs serverless functions, so we don't need app.listen()
// However, the function structure remains for Vercel's use. 
// If Vercel still needs a running port for debugging, keep this:
if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`Server running securely on port ${port} (Local Development)`);
    });
}

module.exports = app;
