const { checkAuth } = require("./_auth");
const { kv } = require("../../lib/kv");
const { getKnowledge } = require("../../lib/claude");
const defaultTemplates = require("../../config/templates");

function renderTemplate(template, knowledge) {
  var text = template.template;

  // If template is tied to a country, fill from knowledge base
  if (template.country) {
    var dir = null;
    for (var i = 0; i < knowledge.directions.length; i++) {
      if (knowledge.directions[i].country === template.country) {
        dir = knowledge.directions[i];
        break;
      }
    }

    if (dir) {
      text = text.replace(/\{\{price\}\}/g, dir.price || "");
      text = text.replace(/\{\{processingTime\}\}/g, dir.processingTime || "");

      // Services as bullet list
      var services = (dir.services || []).map(function(s) { return "- " + s; }).join("\n");
      text = text.replace(/\{\{services\}\}/g, services);

      // Additional fees as bullet list
      var fees = (dir.additionalFees || []).map(function(f) { return "- " + f; }).join("\n");
      text = text.replace(/\{\{additionalFees\}\}/g, fees);

      // Notes
      text = text.replace(/\{\{notes\}\}/g, dir.notes || "");
    }
  }

  // Contacts placeholders
  if (knowledge.contacts) {
    text = text.replace(/\{\{contacts\.address\}\}/g, knowledge.contacts.address || "");
    text = text.replace(/\{\{contacts\.workingHours\}\}/g, knowledge.contacts.workingHours || "");
    text = text.replace(/\{\{contacts\.twoGis\}\}/g, knowledge.contacts.twoGis || "");
    text = text.replace(/\{\{contacts\.website\}\}/g, knowledge.contacts.website || "");
    text = text.replace(/\{\{contacts\.managerName\}\}/g, knowledge.contacts.managerName || "");
  }

  return text;
}

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  var knowledge = await getKnowledge();

  if (req.method === "GET") {
    // Get templates and render them with current knowledge
    var templates;
    try {
      var stored = await kv.get("templates");
      templates = stored || defaultTemplates;
    } catch {
      templates = defaultTemplates;
    }

    var rendered = templates.map(function(t) {
      return {
        id: t.id,
        name: t.name,
        country: t.country,
        rendered: renderTemplate(t, knowledge),
        template: t.template
      };
    });

    return res.status(200).json({ templates: rendered });
  }

  if (req.method === "POST") {
    try {
      var templates = req.body.templates;
      if (!templates || !Array.isArray(templates)) {
        return res.status(400).json({ error: "templates array required" });
      }
      await kv.set("templates", templates);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
