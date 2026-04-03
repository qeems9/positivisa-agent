const OpenAI = require("openai");

let openaiClient = null;

function getOpenAIClient() {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

/**
 * Transcribe a voice message using OpenAI Whisper
 * @param {string} mediaUrl - URL to the audio file
 * @returns {string|null} - transcribed text or null on failure
 */
async function transcribeVoice(mediaUrl) {
  try {
    // Download audio file
    const response = await fetch(mediaUrl);
    if (!response.ok) {
      console.error("Failed to download voice:", response.status);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Create a File-like object for the OpenAI SDK
    const file = new File([buffer], "voice.ogg", { type: "audio/ogg" });

    const client = getOpenAIClient();
    const transcription = await client.audio.transcriptions.create({
      model: "whisper-1",
      file,
      language: "ru",
    });

    return transcription.text || null;
  } catch (err) {
    console.error("Whisper transcription error:", err.message);
    return null;
  }
}

module.exports = { transcribeVoice };
