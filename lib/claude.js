const { kv } = require("./kv");
const defaultKnowledge = require("../config/knowledge.js");

const DEFAULT_SYSTEM_PROMPT = `Ты — AI-помощник визового агентства PositiVisa (positivisa.kz, Казахстан).
Общаешься с клиентами в WhatsApp. Отвечай как живой грамотный менеджер — тепло, коротко, по делу.

ЯЗЫК: определяй по первому сообщению клиента. Русский — отвечай на русском. Казахский — на казахском. Смешанный — на русском.

ТВОЯ ЦЕЛЬ — провести клиента по воронке:
1. Понять куда едет и что нужно
2. Дать конкретную информацию (цена, сроки, документы)
3. Закрыть на оплату прямо в переписке — всё онлайн без встреч

---

ЭТАПЫ КВАЛИФИКАЦИИ:
Если клиент написал что-то общее ("хочу визу", "сколько стоит") — уточняй по одному вопросу за раз:
-> Шаг 1: Куда планируете поездку?
-> Шаг 2: Примерные даты выезда?
-> Шаг 3: Один едете или с семьёй?
-> Шаг 4: Паспорт Казахстана?

Максимум 1-2 вопроса за одно сообщение.

---

БАЗА ЗНАНИЙ:
{{KNOWLEDGE_BASE}}

---

ЗАКРЫТИЕ НА ОПЛАТУ:
Как только клиент квалифицирован (страна + даты известны) — предложи конкретный следующий шаг:
"Отлично! По [страна] — [цена], срок [срок]. Чтобы начать — скиньте фото разворота загранпаспорта, я пришлю полный список документов и детали по оплате"

---

КОГДА ПИСАТЬ [ESCALATE] в конце ответа:
- Нестандартная ситуация: был отказ ранее, двойное гражданство, судимость, сложная история поездок
- Клиент явно готов оплатить прямо сейчас (написал "хочу оплатить", "куда переводить")
- Вопрос про страну которой нет в базе знаний
- Клиент просит поговорить с живым человеком
- Негатив или жалоба
- 6+ сообщений без прогресса
- Срочная поездка (менее 5 рабочих дней)
- Нет информации в базе чтобы ответить точно

---

ПРАВИЛА:
- Используй ТОЛЬКО данные из базы знаний — не придумывай цены и сроки
- Если информации нет — "уточню и напишу" + [ESCALATE]
- Только plain text — никакого markdown (звёздочки, решётки не работают в WA)
- Сообщения короткие: 2-5 предложений
- Не повторяй приветствие каждый раз
- Вместо слова "менеджер" — говори "специалист"
- При передаче: "Сейчас передам вас специалисту, ответит в течение нескольких минут"`;

function formatKnowledgeBase(knowledge) {
  let kb = "";

  // Directions
  kb += "НАПРАВЛЕНИЯ:\n\n";
  for (const dir of knowledge.directions) {
    kb += `${dir.country}\n`;
    kb += `  Типы виз: ${dir.visaTypes.join(", ")}\n`;
    kb += `  Стоимость: ${dir.price}\n`;
    if (dir.processingTime) kb += `  Сроки: ${dir.processingTime}\n`;
    if (dir.services && dir.services.length) {
      kb += `  Что входит в услугу:\n`;
      for (const s of dir.services) {
        kb += `    - ${s}\n`;
      }
    }
    if (dir.additionalFees && dir.additionalFees.length) {
      kb += `  Дополнительно оплачивается:\n`;
      for (const fee of dir.additionalFees) {
        kb += `    - ${fee}\n`;
      }
    }
    if (dir.documents && dir.documents.length) {
      kb += `  Документы:\n`;
      for (const doc of dir.documents) {
        kb += `    - ${doc}\n`;
      }
    }
    if (dir.notes) kb += `  Примечание: ${dir.notes}\n`;
    if (dir.popularCountries) kb += `  Популярные страны: ${dir.popularCountries}\n`;
    kb += "\n";
  }

  // FAQ
  kb += "ЧАСТЫЕ ВОПРОСЫ:\n\n";
  for (const item of knowledge.faq) {
    kb += `В: ${item.q}\nО: ${item.a}\n\n`;
  }

  // Contacts
  kb += `КОНТАКТЫ:\n`;
  kb += `Специалист: ${knowledge.contacts.managerName}\n`;
  kb += `Рабочие часы: ${knowledge.contacts.workingHours}\n`;
  kb += `Сайт: ${knowledge.contacts.website}\n`;
  if (knowledge.contacts.address) kb += `Адрес: ${knowledge.contacts.address}\n`;
  if (knowledge.contacts.twoGis) kb += `2ГИС: ${knowledge.contacts.twoGis}\n`;

  return kb;
}

async function getKnowledge() {
  try {
    const stored = await kv.get("knowledge");
    if (stored) return stored;
  } catch {
    // KV not available, use default
  }
  return defaultKnowledge;
}

async function getSystemPrompt() {
  try {
    const stored = await kv.get("system_prompt");
    if (stored) return stored;
  } catch {
    // KV not available, use default
  }
  return DEFAULT_SYSTEM_PROMPT;
}

/**
 * Get AI reply for a conversation
 * @param {string} contactId
 * @param {Array} history - [{role: 'user'|'assistant', content: string}]
 * @param {string} newMessage
 * @returns {{ text: string, shouldEscalate: boolean, tokensUsed: number }}
 */
async function getReply(contactId, history, newMessage) {
  const [knowledge, systemPromptTemplate] = await Promise.all([
    getKnowledge(),
    getSystemPrompt(),
  ]);

  const knowledgeText = formatKnowledgeBase(knowledge);
  const systemPrompt = systemPromptTemplate.replace("{{KNOWLEDGE_BASE}}", knowledgeText);

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: newMessage },
  ];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 500,
      messages,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${errBody}`);
  }

  const data = await response.json();
  let text = data.choices[0].message.content;
  let shouldEscalate = false;

  if (text.includes("[ESCALATE]")) {
    shouldEscalate = true;
    text = text.replace(/\[ESCALATE\]/g, "").trim();
  }

  const tokensUsed =
    (data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0);

  return { text, shouldEscalate, tokensUsed };
}

module.exports = { getReply, getKnowledge, getSystemPrompt, DEFAULT_SYSTEM_PROMPT, formatKnowledgeBase };
