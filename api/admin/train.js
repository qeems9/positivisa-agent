const { checkAuth } = require("./_auth");
const { getSystemPrompt, getKnowledge } = require("../../lib/claude");
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

    var knowledge = await getKnowledge();
    var currentPrompt = await getSystemPrompt();

    var dialogContext = "";
    if (history && history.length > 0) {
      dialogContext = history.map(function(m) {
        return (m.role === "user" ? "Клиент" : "Бот") + ": " + m.content;
      }).join("\n");
    }

    // Build compact knowledge summary for AI (just countries and key data)
    var knowledgeSummary = knowledge.directions.map(function(d) {
      return d.country + ": " + d.price + ", " + (d.processingTime || "") +
        (d.additionalFees ? ", сборы: " + d.additionalFees.join("; ") : "");
    }).join("\n");

    var metaPrompt = [
      "Проанализируй ошибку бота. Определи ТИП ошибки и верни исправление.",
      "",
      "ТЕКУЩАЯ БАЗА ЗНАНИЙ (кратко):",
      knowledgeSummary,
      "",
      "Клиент: " + userMessage,
      dialogContext ? "Контекст: " + dialogContext : "",
      "Бот ответил: " + originalReply,
      "Правильный ответ: " + correctedReply,
      "",
      "ОПРЕДЕЛИ ТИП ОШИБКИ:",
      "1. ПОВЕДЕНИЕ — бот неправильно общается (тон, порядок вопросов, формат ответа)",
      "2. ДАННЫЕ — бот дал неправильные/неточные факты (цена, срок, документы, сборы, услуги)",
      "3. ОБА — и поведение и данные неправильные",
      "",
      "Верни JSON без markdown:",
      "{",
      '  "type": "behavior" или "data" или "both",',
      '  "explanation": "что не так (1 предложение)",',
      '  "rule": "правило для промпта (императив, 1-2 предл.) или null если тип data",',
      '  "knowledgeUpdate": {',
      '    "country": "название страны из базы знаний или null",',
      '    "field": "price или processingTime или additionalFees или services или documents или notes или null",',
      '    "action": "set или add или remove",',
      '    "value": "новое значение (строка или массив строк)"',
      '  } или null если тип behavior',
      "}"
    ].filter(Boolean).join("\n");

    var response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.OPENAI_API_KEY,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        max_tokens: 500,
        messages: [{ role: "user", content: metaPrompt }],
      }),
    });

    if (!response.ok) {
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

    var changes = [];

    // Apply prompt rule (behavior)
    if (result.rule && (result.type === "behavior" || result.type === "both")) {
      var ruleText = "\n- " + result.rule;
      var rulesIdx = currentPrompt.lastIndexOf("ПРАВИЛА:");
      var newPrompt;
      if (rulesIdx !== -1) {
        var nextSep = currentPrompt.indexOf("\n---", rulesIdx);
        if (nextSep === -1) {
          newPrompt = currentPrompt + ruleText;
        } else {
          newPrompt = currentPrompt.slice(0, nextSep) + ruleText + currentPrompt.slice(nextSep);
        }
      } else {
        newPrompt = currentPrompt + "\n" + ruleText;
      }
      await kv.set("system_prompt_v2", { text: newPrompt });
      changes.push("prompt");
    }

    // Apply knowledge update (data)
    if (result.knowledgeUpdate && (result.type === "data" || result.type === "both")) {
      var upd = result.knowledgeUpdate;
      if (upd.country && upd.field && upd.value !== undefined) {
        // Find direction by country name (fuzzy match)
        var dirIdx = -1;
        var countryLower = upd.country.toLowerCase();
        for (var i = 0; i < knowledge.directions.length; i++) {
          if (knowledge.directions[i].country.toLowerCase().includes(countryLower) ||
              countryLower.includes(knowledge.directions[i].country.toLowerCase())) {
            dirIdx = i;
            break;
          }
        }

        if (dirIdx !== -1) {
          var dir = knowledge.directions[dirIdx];
          var field = upd.field;
          var action = upd.action || "set";
          var value = upd.value;

          if (field === "price" || field === "processingTime" || field === "notes") {
            // String fields — always set
            dir[field] = String(value);
          } else if (field === "additionalFees" || field === "services" || field === "documents" || field === "visaTypes") {
            // Array fields
            if (!Array.isArray(dir[field])) dir[field] = [];
            if (action === "set") {
              dir[field] = Array.isArray(value) ? value : [value];
            } else if (action === "add") {
              var items = Array.isArray(value) ? value : [value];
              for (var j = 0; j < items.length; j++) {
                if (dir[field].indexOf(items[j]) === -1) dir[field].push(items[j]);
              }
            } else if (action === "remove") {
              var toRemove = Array.isArray(value) ? value : [value];
              dir[field] = dir[field].filter(function(item) {
                return toRemove.indexOf(item) === -1;
              });
            }
          }

          knowledge.directions[dirIdx] = dir;
          await kv.set("knowledge", knowledge);
          changes.push("knowledge:" + dir.country + "." + field);
        }
      }
    }

    result.applied = changes.length > 0;
    result.changes = changes;
    return res.status(200).json(result);
  } catch (err) {
    console.error("Train error:", err);
    return res.status(500).json({ error: err.message });
  }
};
