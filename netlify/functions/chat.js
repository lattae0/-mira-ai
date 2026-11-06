const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const headers = {
  "Content-Type": "application/json"
};

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      ...options.headers
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Supabase error: ${text}`);
  }

  return text ? JSON.parse(text) : null;
}

async function verifyUser(token) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${token}`
    }
  });

  if (!response.ok) return null;

  return await response.json();
}

async function askGroq(messages, temperature = 0.9, maxTokens = 700) {
  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        messages,
        temperature,
        max_completion_tokens: maxTokens
      })
    }
  );

  const result = await response.json();

  if (!response.ok) {
    console.error("Groq error:", result);
    throw new Error("AI provider request failed.");
  }

  return result.choices?.[0]?.message?.content?.trim() || "";
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed." })
    };
  }

  try {
    if (
      !SUPABASE_URL ||
      !SUPABASE_ANON_KEY ||
      !SUPABASE_SERVICE_ROLE_KEY ||
      !GROQ_API_KEY
    ) {
      throw new Error("Required environment variables are missing.");
    }

    const token = (event.headers.authorization || "")
      .replace(/^Bearer\s+/i, "");

    if (!token) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: "Please log in first." })
      };
    }

    const user = await verifyUser(token);

    if (!user?.id) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: "Your session is invalid. Please log in again." })
      };
    }

    const { character, messages } = JSON.parse(event.body || "{}");

    if (
      !character?.id ||
      !character?.name ||
      !Array.isArray(messages) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(character.id)
    ) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "A valid character ID and conversation are required."
        })
      };
    }

    const history = messages
      .filter(m =>
        ["user", "assistant"].includes(m.role) &&
        typeof m.content === "string"
      )
      .slice(-30)
      .map(m => ({
        role: m.role,
        content: m.content.slice(0, 6000)
      }));

    // Retrieve this user's memories for this character only.
    const memoryPath =
      `character_memories?user_id=eq.${user.id}` +
      `&character_id=eq.${character.id}` +
      `&select=id,memory,category,importance` +
      `&order=importance.desc,updated_at.desc&limit=20`;

    const memories = await supabaseRequest(memoryPath);

    const memoryText = memories.length
      ? memories.map(m => `- ${m.memory}`).join("\n")
      : "No previous long-term memories.";

    const prompt = `
You are ${character.name}, a fictional character in Mira AI.

CHARACTER PROFILE
Name: ${character.name}
Description: ${character.description || ""}
Personality: ${character.personality || ""}
Background: ${character.background || ""}
Scenario: ${character.scenario || ""}
Greeting: ${character.greeting || ""}
Example dialogue: ${character.exampleDialogue || ""}

LONG-TERM MEMORIES
These are established memories from previous conversations with this user.
Treat them as important continuity information:
${memoryText}

CHARACTER RULES
- Remain in character.
- React directly to what the user actually says.
- Remember the established events and relationship history.
- Show believable emotions, opinions and reactions.
- Do not respond like a generic AI assistant.
- Do not ignore important revelations.
- Do not automatically agree with everything.
- Allow relationships to develop naturally.
- Never invent the user's thoughts, dialogue, feelings or actions.

ROLEPLAY FORMAT
- Narrate actions in third person.
- Put actions and expressions between asterisks.
- Put spoken dialogue inside quotation marks.
- Never control the user's character.

STYLE
Write natural, expressive and immersive responses.
Balance dialogue, actions and descriptions.
Avoid repetitive questions and unnecessary explanations.
Do not force romance into every interaction.
Do not mention being an AI.
`;

    const reply = await askGroq([
      { role: "system", content: prompt },
      ...history
    ]);

    if (!reply) {
      throw new Error("The character returned an empty response.");
    }

    // Extract important facts and events for future conversations.
    const extraction = await askGroq([
      {
        role: "system",
        content: `Extract important long-term memories from this fictional
character conversation.

Save only useful facts, such as:
- User preferences and personal details they explicitly shared.
- Important shared experiences and events.
- Relationship changes, promises, secrets and conflicts.
- Important ongoing story developments.

Do not save temporary dialogue, guesses or insignificant details.
Do not invent facts.

Return ONLY valid JSON in this format:
{
  "memories": [
    {
      "memory": "Short factual memory",
      "category": "relationship",
      "importance": 3
    }
  ]
}

Use categories such as general, preference, relationship, event, promise or story.
Importance must be an integer from 1 to 5.
Return an empty memories array if nothing important was shared.`
      },
      ...history,
      { role: "assistant", content: reply }
    ], 0.2, 500);

    try {
      const cleaned = extraction
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/, "");

      const parsed = JSON.parse(cleaned);
      const newMemories = Array.isArray(parsed.memories)
        ? parsed.memories.slice(0, 5)
        : [];

      for (const item of newMemories) {
        if (
          typeof item.memory !== "string" ||
          !item.memory.trim()
        ) continue;

        const memory = item.memory.trim().slice(0, 1000);

        // Avoid saving exact duplicates.
        const duplicate = memories.some(
          old => old.memory.toLowerCase() === memory.toLowerCase()
        );

        if (duplicate) continue;

        await supabaseRequest("character_memories", {
          method: "POST",
          headers: {
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({
            user_id: user.id,
            character_id: character.id,
            memory,
            category: item.category || "general",
            importance: Math.min(
              5,
              Math.max(1, Number(item.importance) || 3)
            )
          })
        });
      }
    } catch (memoryError) {
      // A memory extraction failure should not discard a successful reply.
      console.error("Memory saving error:", memoryError);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply })
    };

  } catch (error) {
    console.error("Mira backend error:", error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Mira couldn't process the message. Please try again."
      })
    };
  }
};
