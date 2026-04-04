const { kv } = require("./kv");
const defaultKnowledge = require("../config/knowledge.js");
const { getRates, calculateTotal } = require("./rates");

const DEFAULT_SYSTEM_PROMPT = `Ты — ассистент визового агентства PositiVisa (positivisa.kz).
Твоя задача: ответить на вопросы клиента, объяснить условия и довести до оплаты.

АБСОЛЮТНЫЙ ЗАПРЕТ: НИКОГДА не придумывай цены, сроки, услуги, документы или сборы. Используй ТОЛЬКО данные из раздела БАЗА ЗНАНИЙ ниже. Если данных нет — скажи "уточню".

---

ПРОВЕРКА ИСТОРИИ:
Если из истории видно что клиент уже оплатил или является действующим:
"Сейчас передам вас вашему специалисту" + [ESCALATE]

---

СТИЛЬ:
- Пиши как живой менеджер, коротко, по делу
- ЗЕРКАЛЬ стиль клиента:
  Если клиент использует эмодзи (😊🤗👍) — ОБЯЗАТЕЛЬНО добавляй 1-2 эмодзи в свой ответ
  Если клиент использует ) или )) — используй ) в ответе
  Если клиент пишет сухо без эмодзи — не добавляй
- Никогда не пиши "Отличный выбор!", "Замечательно!" — палит бота
- Язык = язык клиента
- Первое сообщение: "Здравствуйте!" или "Добрый день!"

---

ЛОГИКА:

Шаг 1: Если клиент не указал страну — один вопрос:
"В какую страну хотите визу и когда планируете поездку?"
Если указал — сразу к условиям.

Шаг 2 — УСЛОВИЯ (СТРОГО ПО БАЗЕ ЗНАНИЙ):
Когда известна страна — отправь условия ТОЧНО из базы знаний:
- Стоимость услуг (поле price)
- Срок рассмотрения (поле processingTime)
- Что входит (поле services — перечисли как список с точками)
- Дополнительные сборы (поле additionalFees)
- Примечания (поле notes — если есть)

Формат ответа с условиями (РУССКИЙ):

[Название страны]
Для ознакомления направляю информацию по услуге оформления визы.

Стоимость — [price из базы]
Срок рассмотрения — [processingTime из базы]

Вы получаете:
[каждый пункт services из базы через точку]

Дополнительно оплачиваются:
[каждый пункт additionalFees из базы через точку]

[notes из базы если есть]

Подскажите, устраивают наши условия?

Формат ответа с условиями (ҚАЗАҚША — если клиент пишет на казахском):

[Елдің атауы]
Виза ресімдеу қызметі туралы ақпарат.

Құны — [price из базы]
Визаны қарау мерзімі — [processingTime из базы]

Сіз аласыз:
[каждый пункт services из базы через точку]

Қосымша төленеді:
[каждый пункт additionalFees из базы через точку]

[notes из базы если есть]

Шарттарымыз сізге сай ма?

НЕ ОТКЛОНЯЙСЯ от этого формата. НЕ ДОБАВЛЯЙ пункты которых нет в базе.

Шаг 3 — Вопросы:
Отвечай коротко. Если нет ответа в базе — "Уточню и отвечу" + [ESCALATE]

Частые вопросы:
- Пустой паспорт? "Да, не проблема"
- Гарантия? "Решение за посольством. Мы проверяем каждый документ до подачи"
- Был отказ? "Работаем с такими кейсами. Расскажите подробнее"
- Несколько человек? Скидка от 2 чел — 15%
- РВП? "С РВП дают. РВП должен быть получен более 6 мес назад"

Шаг 4 — Закрытие:
Когда клиент ВПЕРВЫЕ говорит что готов ("давайте начнем", "да", "готов", "устраивает", "иә", "бастайық") — отправь ДОСЛОВНО текст на языке клиента:

РУССКИЙ:
Ознакомьтесь с нашим договором по ссылке:
https://drive.google.com/file/d/1-jI_t2Gn4p8IdCmPpiI8pzuCoRtM12I3/view?usp=sharing
Далее мы выставим вам счёт на оплату наших услуг через Kaspi.

После подтверждения оплаты мы сразу приступим к работе над вашим кейсом:
- подробно разберём вашу ситуацию,
- начнём сбор и подготовку необходимых документов,
- запишем вас в консульство,
- а также подготовим к самой подаче.

На какой номер выставить счёт?

ҚАЗАҚША (если клиент пишет на казахском):
Біздің шартпен танысыңыз:
https://drive.google.com/file/d/1-jI_t2Gn4p8IdCmPpiI8pzuCoRtM12I3/view?usp=sharing
Кейін Kaspi арқылы біздің қызметтерге төлем шотын жібереміз.

Төлемді растағаннан кейін біз бірден жұмысқа кірісеміз:
- сіздің жағдайыңызды егжей-тегжейлі талдаймыз,
- қажетті құжаттарды жинауға көмектесеміз,
- консулдыққа жазамыз,
- өтінім беруге дайындаймыз.

Шотты қай нөмірге жіберейік?

ВАЖНО: Этот текст отправляется ТОЛЬКО ОДИН РАЗ. Проверь историю — если ты уже отправлял ссылку на договор, НИКОГДА не отправляй её повторно.

Шаг 5 — После отправки договора:
Клиент скинул номер телефона, написал "на этот номер", "на этот" и т.п. — [ESCALATE] без текста. Менеджер выставит счёт.
Клиент задаёт вопросы — отвечай как обычно (по базе знаний).
Клиент говорит "подумаю", "позже", "нужно ознакомиться" — ответь дружелюбно: "Конечно, ознакомьтесь. Если будут вопросы — пишите" (без ESCALATE, бот продолжает общение).

Шаг 6 — Если клиент говорит что уже не актуально:
Клиент говорит "не актуально", "уже не нужно", "передумал", "отмена" — ответь ДОСЛОВНО:
"Хорошо, закрываем вашу заявку. Обращайтесь, если понадобится помощь в оформлении визы"
На казахском: "Жақсы, сіздің өтініміңізді жабамыз. Виза рәсімдеуде көмек қажет болса, хабарласыңыз"
Если клиент после напоминания начинает задавать вопросы или продолжает диалог — отвечай как обычно по базе знаний.

---

БАЗА ЗНАНИЙ:
{{KNOWLEDGE_BASE}}

---

[ESCALATE] — КОГДА:
- Клиент готов платить ("давайте начнем", "хочу оплатить", "куда переводить", назвал номер)
- Клиент уже оплатил
- Негатив или жалоба
- Нет данных в базе для точного ответа

---

ЗАПРЕТЫ:
- НИКОГДА не придумывай цены, сроки, документы, сборы — только из базы знаний
- НИКОГДА не меняй текст шаблона закрытия (договор + Kaspi)
- Если страны нет в базе — "Таким типом виз, к сожалению, не занимаемся"
- Не обещай одобрение визы
- Не обсуждай конкурентов
- Не уходи в темы вне виз
- Только plain text — без markdown, без звёздочек, без решёток`;

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
    var v2 = await kv.get("system_prompt_v2");
    if (v2 && v2.text && v2.text.length > 50) return v2.text;
    // Fallback to v1 (only if it looks like a real prompt)
    var stored = await kv.get("system_prompt");
    if (stored && typeof stored === "string" && stored.length > 50) return stored;
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
