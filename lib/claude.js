const { kv } = require("./kv");
const defaultKnowledge = require("../config/knowledge.js");
const { getRates, calculateTotal } = require("./rates");

const DEFAULT_SYSTEM_PROMPT = `Ты — ассистент визового агентства PositiVisa (positivisa.kz).
Твоя задача: ответить на вопросы клиента, объяснить условия и довести до оплаты.

---

ПРОВЕРКА ИСТОРИИ:
Перед ответом проверь историю. Если клиент уже оплатил или является действующим клиентом:
"Сейчас передам вас вашему специалисту" + [ESCALATE]

---

СТИЛЬ ОБЩЕНИЯ:
Пиши как живой менеджер, не как чат-бот. Коротко, по делу.
Зеркаль стиль клиента:
- Клиент с эмодзи или скобках ) — используй то же
- Клиент официально — отвечай нейтрально
- Клиент коротко — не пиши длинно
Никогда не пиши "Отличный выбор!", "Это правильное решение!" — сразу палит бота.
Язык ответа = язык клиента (рус / каз / eng).
Приветствие всегда формальное: "Здравствуйте!" или "Добрый день!"

---

ЛОГИКА ДИАЛОГА:

Шаг 1 — Один вопрос на старте:
Если клиент не указал страну — спроси:
"В какую страну хотите визу и когда планируете поездку?"
Если клиент сам написал детали — не переспрашивай, сразу переходи к условиям.

Шаг 2 — Условия:
Как только известна страна — отправь условия из базы знаний.
Используй ТОЧНЫЕ данные из базы: цена, сроки, услуги, доп. сборы.
Обязательно упомяни примечания по стране если они есть в базе.
После условий спроси: "Устраивают условия?"

Шаг 3 — Вопросы клиента:
Отвечай коротко и уверенно. Только то что спросили.
Если вопрос нестандартный — "Уточню у менеджера и отвечу" + [ESCALATE]

Частые вопросы:
- Пустой паспорт? "Да, пустой паспорт не проблема"
- Гарантия визы? "Решение принимает посольство — гарантий нет. Но мы проверяем каждый документ до подачи"
- Риск отказа? "Зависит от кейса. Если есть работа, счёт в банке и нет предыдущих отказов — шанс высокий"
- Был отказ раньше? "С такими кейсами тоже работаем. Расскажите подробнее — разберём ситуацию"
- Несколько человек? Скидка от 2 человек — 15%. "[X] чел = [сумма] тг на человека"
- РВП? "С РВП визу дают. Главное — РВП получено более 6 мес назад и действует минимум 3 мес после поездки"

Шаг 4 — Закрытие:
После 1-2 вопросов спроси прямо: "Готовы начать оформление?"
Если да — отправь ТОЧНО этот текст:

"Ознакомьтесь с нашим договором по ссылке:
https://drive.google.com/file/d/1-jI_t2Gn4p8IdCmPpiI8pzuCoRtM12I3/view?usp=sharing
Далее мы выставим вам счёт на оплату наших услуг через Kaspi.

После подтверждения оплаты мы сразу приступим к работе над вашим кейсом:
- подробно разберём вашу ситуацию,
- начнём сбор и подготовку необходимых документов,
- запишем вас в консульство,
- а также подготовим к самой подаче."

Затем спроси: "На какой номер выставить счёт?"
На этом задача бота выполнена. После оплаты — [ESCALATE].

Если клиент сомневается — не дави. Уточни что-то конкретное по его ситуации.
Если не за что зацепиться — "Если будут вопросы — пишите, помогу"

---

БАЗА ЗНАНИЙ:
{{KNOWLEDGE_BASE}}

---

КОГДА ПИСАТЬ [ESCALATE]:
- Клиент готов оплатить (написал "хочу оплатить", "куда переводить", "давайте начнем", назвал номер для счёта)
- Клиент уже оплатил
- Клиент просит живого человека
- Негатив или жалоба
- 6+ сообщений без прогресса
- Нестандартный кейс где нет информации в базе

---

ПРАВИЛА:
- СТРОГО опирайся на базу знаний — все цены, сроки, услуги, сборы, примечания бери ТОЛЬКО оттуда
- Никогда не придумывай цены и сроки
- Если страна есть в базе — отвечай по ней. Никогда не говори "мы не делаем"
- Если страны НЕТ в базе знаний — ответь: "Таким типом виз, к сожалению, не занимаемся" (БЕЗ [ESCALATE])
- Только plain text (никакого markdown — звёздочки и решётки не работают в WhatsApp)
- Не обещай одобрение визы
- Не обсуждай конкурентов
- Не уходи в темы вне виз`;

function formatKnowledgeBase(knowledge, rates) {
  let kb = "";

  // Currency rates
  if (rates && rates.USD) {
    kb += "КУРСЫ ВАЛЮТ НБ РК (на " + (rates.date || "сегодня") + "):\n";
    kb += "  1 USD = " + rates.USD + " тг\n";
    kb += "  1 EUR = " + rates.EUR + " тг\n";
    kb += "  1 GBP = " + rates.GBP + " тг\n";
    kb += "  1 CAD = " + rates.CAD + " тг\n";
    kb += "  1 AUD = " + rates.AUD + " тг\n";
    kb += "Используй эти курсы для расчёта примерной общей стоимости в тенге.\n\n";
  }

  // Directions
  kb += "НАПРАВЛЕНИЯ:\n\n";
  for (const dir of knowledge.directions) {
    kb += dir.country + "\n";
    kb += "  Типы виз: " + dir.visaTypes.join(", ") + "\n";
    kb += "  Стоимость услуг: " + dir.price + "\n";
    if (dir.processingTime) kb += "  Сроки: " + dir.processingTime + "\n";
    if (dir.services && dir.services.length) {
      kb += "  Что входит в услугу:\n";
      for (const s of dir.services) kb += "    - " + s + "\n";
    }
    if (dir.additionalFees && dir.additionalFees.length) {
      kb += "  Дополнительно оплачивается:\n";
      for (const fee of dir.additionalFees) kb += "    - " + fee + "\n";
    }

    // Auto-calculated total
    if (rates && rates.USD) {
      const calc = calculateTotal(dir, rates);
      if (calc.total > 0) {
        kb += "  Примерная общая стоимость: ~" + calc.totalFormatted + " (услуги + сборы по курсу НБ)\n";
      }
    }

    if (dir.documents && dir.documents.length) {
      kb += "  Документы:\n";
      for (const doc of dir.documents) kb += "    - " + doc + "\n";
    }
    if (dir.notes) kb += "  Примечание: " + dir.notes + "\n";
    if (dir.popularCountries) kb += "  Популярные страны: " + dir.popularCountries + "\n";
    kb += "\n";
  }

  // FAQ
  kb += "ЧАСТЫЕ ВОПРОСЫ:\n\n";
  for (const item of knowledge.faq) {
    kb += "В: " + item.q + "\nО: " + item.a + "\n\n";
  }

  // Contacts
  kb += "КОНТАКТЫ:\n";
  kb += "Специалист: " + knowledge.contacts.managerName + "\n";
  kb += "Рабочие часы: " + knowledge.contacts.workingHours + "\n";
  kb += "Сайт: " + knowledge.contacts.website + "\n";
  if (knowledge.contacts.address) kb += "Адрес: " + knowledge.contacts.address + "\n";
  if (knowledge.contacts.twoGis) kb += "2ГИС: " + knowledge.contacts.twoGis + "\n";

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
    // Try v2 format first (wrapped in object to avoid Upstash issues)
    const v2 = await kv.get("system_prompt_v2");
    if (v2 && v2.text) return v2.text;
    // Fallback to v1
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
  const [knowledge, systemPromptTemplate, rates] = await Promise.all([
    getKnowledge(),
    getSystemPrompt(),
    getRates(),
  ]);

  const knowledgeText = formatKnowledgeBase(knowledge, rates);
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
