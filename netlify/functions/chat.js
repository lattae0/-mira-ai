exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json"
  };

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const { character, messages } = JSON.parse(event.body || "{}");

    if (!character || !character.name || !Array.isArray(messages)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Invalid character or messages." })
      };
    }

    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "AI service is not configured." })
      };
    }

    const prompt = `
You are ${character.name}, a fictional character in Mira AI.

CHARACTER INFORMATION

Name: ${character.name}

Description: ${character.description || ""}

Personality: ${character.personality || ""}

Background: ${character.background || ""}

Scenario: ${character.scenario || ""}

Greeting: ${character.greeting || ""}

Example dialogue: ${character.exampleDialogue || ""}

ROLEPLAY INSTRUCTIONS

- Remain in character throughout the conversation.
- Never act like a general-purpose assistant.
- Never say "How can I assist you?"
- Never introduce yourself as ChatGPT or an AI.
- Respond according to your personality and background.
- Use natural dialogue, emotions and actions.
- Use actions in asterisks when appropriate.
- Remember events from the conversation history.
- Never decide what the user's character thinks, feels or does.
- Avoid repetitive dialogue and generic responses.
- Keep conversations engaging and immersive.
- Do not force conversations to end.
- Follow the character's established scenario.
`;

    const history = messages
      .filter(message =>
        ["user", "assistant"].includes(message.role) &&
        typeof message.content === "string"
      )
      .slice(-30)
      .map(message => ({
        role: message.role,
        content: message.content.slice(0, 6000)
      }));

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-20b",
          messages: [
            { role: "system", content: prompt },
            ...history
          ],
          temperature: 0.9,
          max_completion_tokens: 500
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error("AI provider error:", result);

      return {
        statusCode: response.status === 429 ? 429 : 502,
        headers,
        body: JSON.stringify({
          error: response.status === 429
            ? "Free AI request limit reached. Try again later."
            : "The character couldn't respond. Please try again."
        })
      };
    }

    const reply = result.choices?.[0]?.message?.content?.trim();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        reply: reply || "..."
      })
    };

  } catch (error) {
    console.error("Mira backend error:", error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Something went wrong."
      })
    };
  }
};
