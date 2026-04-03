const { checkAuth } = require("./_auth");
const { getSystemPrompt } = require("../../lib/claude");
const { kv } = require("../../lib/kv");

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    var { originalReply, correctedReply, history, userMessage } = req.body;

    if (!originalReply || !correctedReply || !userMessage) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    var currentPrompt = await getSystemPrompt();

    var dialogContext = "";
    if (history && history.length > 0) {
      dialogContext = history.map(function(m) {
        return (m.role === "user" ? "Клиент" : "Бот") + ": " + m.content;
      }).join("\n");
    }

    // Compact meta-prompt: no knowledge base, ask for diff not full rewrite
    var metaPrompt = [
      "Проанализируй ошибку бота и верни КОРОТКУЮ инструкцию для добавления в промпт.",
      "",
      "Клиент написал: " + userMessage,
      dialogContext ? "Контекст: " + dialogContext : "",
      "Бот ответил: " + originalReply,
      "Правильный ответ: " + correctedReply,
      "",
      "Верни JSON без markdown:",
      '{"explanation":"что не так (1 предложение)","rule":"новое правило для промпта (1-2 предложения, императив)","section":"в какой раздел добавить: ПРАВИЛА или ЭТАПЫ КВАЛИФИКАЦИИ или ЗАКРЫТИЕ НА ОПЛАТУ или новый"}'
    ].filter(Boolean).join("\n");

    var response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.OPENAI_API_KEY,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 300,
        messages: [{ role: "user", content: metaPrompt }],
      }),
    });

    if (!response.ok) {
      var errBody = await response.text();
      throw new Error("OpenAI " + response.status);
    }

    var data = await response.json();
    var content = data.choices[0].message.content;

    var result;
    try {
      var jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      result = JSON.parse(jsonStr);
    } catch (e) {
      return res.status(500).json({ error: "AI вернул невалидный ответ" });
    }

    // Auto-apply: append rule to prompt
    if (result.rule) {
      var section = result.section || "ПРАВИЛА";
      var marker = "---\n\n" + section.toUpperCase() + ":";
      var ruleText = "\n- " + result.rule;

      var newPrompt;
      if (currentPrompt.includes(marker)) {
        // Find the section and append before next ---
        var sectionIdx = currentPrompt.indexOf(marker);
        var nextSeparator = currentPrompt.indexOf("\n---", sectionIdx + marker.length);
        if (nextSeparator === -1) {
          // Last section — append at end
          newPrompt = currentPrompt + ruleText;
        } else {
          newPrompt = currentPrompt.slice(0, nextSeparator) + ruleText + currentPrompt.slice(nextSeparator);
        }
      } else {
        // Section not found — append to ПРАВИЛА
        var rulesIdx = currentPrompt.lastIndexOf("ПРАВИЛА:");
        if (rulesIdx !== -1) {
          var nextSep = currentPrompt.indexOf("\n---", rulesIdx);
          if (nextSep === -1) {
            newPrompt = currentPrompt + ruleText;
          } else {
            newPrompt = currentPrompt.slice(0, nextSep) + ruleText + currentPrompt.slice(nextSep);
          }
        } else {
          // Fallback — append at end
          newPrompt = currentPrompt + "\n" + ruleText;
        }
      }

      // Save via v2 wrapper (JSON object to avoid Upstash string issues)
      await kv.set("system_prompt_v2", { text: newPrompt });
      result.applied = true;
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error("Train error:", err);
    return res.status(500).json({ error: err.message });
  }
};
