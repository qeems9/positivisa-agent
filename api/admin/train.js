const { checkAuth } = require("./_auth");
const { getKnowledge, getSystemPrompt, formatKnowledgeBase } = require("../../lib/claude");
const { kv } = require("../../lib/kv");

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

    const [knowledge, currentPrompt] = await Promise.all([getKnowledge(), getSystemPrompt()]);
    const knowledgeText = formatKnowledgeBase(knowledge);

    const metaPrompt = `Ты — эксперт по настройке промптов для AI-ботов. Твоя задача — обновить промпт бота на основе корректировки менеджера.

ТЕКУЩИЙ ПРОМПТ БОТА:
---
${currentPrompt}
---

ТЕКУЩАЯ БАЗА ЗНАНИЙ:
---
${knowledgeText}
---

КОНТЕКСТ ДИАЛОГА:
${history.map(m => \`\${m.role === 'user' ? 'Клиент' : 'Бот'}: \${m.content}\`).join('\n')}

ПОСЛЕДНЕЕ СООБЩЕНИЕ КЛИЕНТА: ${userMessage}
ОТВЕТ БОТА (неправильный): ${originalReply}
КАК МЕНЕДЖЕР БЫ ОТВЕТИЛ (правильно): ${correctedReply}

---

ТВОЯ ЗАДАЧА:
1. Проанализируй разницу между ответом бота и правильным ответом менеджера
2. Определи какое правило или инструкцию нужно добавить или изменить в промпте
3. Верни ПОЛНЫЙ ОБНОВЛЁННЫЙ ПРОМПТ с внесёнными изменениями

ПРАВИЛА РЕДАКТИРОВАНИЯ ПРОМПТА:
- Если в промпте уже есть инструкция по этому кейсу — ЗАМЕНИ её на новую
- Если такого кейса ещё нет — ДОБАВЬ новую инструкцию в подходящий раздел
- Не удаляй существующие инструкции которые не связаны с этой корректировкой
- Сохрани структуру и форматирование промпта (разделители ---, стрелки ->, и т.д.)
- Пиши инструкции кратко и конкретно
- Плейсхолдер {{KNOWLEDGE_BASE}} должен остаться на месте

Верни ТОЛЬКО валидный JSON (без markdown, без \`\`\`) в формате:
{
  "explanation": "что бот сделал не так и что изменено в промпте (1-2 предложения)",
  "updatedPrompt": "полный обновлённый промпт со всеми изменениями",
  "knowledgeSuggestion": "что нужно изменить в базе знаний (конкретные данные), или null если база не при чём"
}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 4000,
        messages: [{ role: "user", content: metaPrompt }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`OpenAI API ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    let result;
    try {
      const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      result = JSON.parse(jsonStr);
    } catch {
      return res.status(500).json({ error: "AI вернул невалидный JSON", raw: content });
    }

    // Auto-apply prompt if updatedPrompt is present
    if (result.updatedPrompt) {
      // Wrap in object to avoid Upstash pattern-matching issues with raw strings
      await kv.set("system_prompt_v2", { text: result.updatedPrompt });
      result.applied = true;
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error("Train error:", err);
    return res.status(500).json({ error: err.message });
  }
};
