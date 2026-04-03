const { checkAuth } = require("./_auth");
const { getKnowledge, getSystemPrompt, formatKnowledgeBase } = require("../../lib/claude");

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { originalReply, correctedReply, history = [], userMessage } = req.body;

    if (!originalReply || !correctedReply || !userMessage) {
      return res.status(400).json({ error: "originalReply, correctedReply, and userMessage are required" });
    }

    const [knowledge, prompt] = await Promise.all([getKnowledge(), getSystemPrompt()]);
    const knowledgeText = formatKnowledgeBase(knowledge);

    const metaPrompt = `Ты — эксперт по настройке AI-ботов. Твоя задача: проанализировать ошибку бота и предложить конкретные изменения в промпт и/или базу знаний.

ТЕКУЩИЙ ПРОМПТ БОТА:
---
${prompt}
---

ТЕКУЩАЯ БАЗА ЗНАНИЙ:
---
${knowledgeText}
---

КОНТЕКСТ ДИАЛОГА:
${history.map(m => `${m.role === 'user' ? 'Клиент' : 'Бот'}: ${m.content}`).join('\n')}

ПОСЛЕДНЕЕ СООБЩЕНИЕ КЛИЕНТА: ${userMessage}

ОТВЕТ БОТА (неправильный): ${originalReply}

КАК МЕНЕДЖЕР БЫ ОТВЕТИЛ (правильно): ${correctedReply}

---

Проанализируй разницу между ответом бота и правильным ответом менеджера. Определи что именно бот сделал не так и предложи конкретные исправления.

Верни ТОЛЬКО валидный JSON (без markdown) в формате:
{
  "explanation": "краткое объяснение что бот сделал не так и почему",
  "promptSuggestion": "конкретный текст который нужно ДОБАВИТЬ в промпт (правило или инструкция), или null если промпт менять не нужно",
  "knowledgeSuggestion": "что нужно изменить или добавить в базу знаний (конкретные данные), или null если базу менять не нужно"
}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 1000,
        messages: [{ role: "user", content: metaPrompt }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`OpenAI API ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    // Parse JSON from response (handle possible markdown wrapping)
    let suggestions;
    try {
      const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      suggestions = JSON.parse(jsonStr);
    } catch {
      suggestions = {
        explanation: content,
        promptSuggestion: null,
        knowledgeSuggestion: null,
      };
    }

    return res.status(200).json(suggestions);
  } catch (err) {
    console.error("Train error:", err);
    return res.status(500).json({ error: err.message });
  }
};
