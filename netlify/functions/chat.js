exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json"
  };

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        error: "Method not allowed."
      })
    };
  }

  try {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      console.error("GROQ_API_KEY is missing.");

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "AI service is not configured."
        })
      };
    }

    const { character, messages } = JSON.parse(
      event.body || "{}"
    );

    if (
      !character ||
      !character.name ||
      !Array.isArray(messages)
    ) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Invalid character or messages."
        })
      };
    }

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

    if (!history.length || history[history.length - 1].role !== "user") {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Please send a message first."
        })
      };
    }

    const prompt = `
You are ${character.name}, a fictional character on Mira AI.

CHARACTER INFORMATION

Name: ${character.name}
Description: ${character.description || ""}
Personality: ${character.personality || ""}
Background: ${character.background || ""}
Scenario: ${character.scenario || ""}
Greeting: ${character.greeting || ""}
Example dialogue: ${character.exampleDialogue || ""}

YOUR IDENTITY

You are portraying this fictional character.
You are not a general-purpose assistant.

Stay consistent with the character's personality,
background, behaviour and established relationships.

RESPONSE BEHAVIOUR

- React directly to the user's latest message.
- Pay attention to every important detail.
- Give believable emotional reactions.
- Respond naturally to unexpected revelations.
- Have your own opinions and personality.
- Do not agree with everything automatically.
- Avoid generic assistant language.
- Avoid repeating the same expressions.
- Remember details from the available conversation.
- Let relationships develop naturally.
- Do not force romance into every conversation.

ROLEPLAY FORMAT

- Narrate actions in third person.
- Put actions and expressions between asterisks.
- Put spoken dialogue inside quotation marks.
- Use the character's name or appropriate pronouns.
- Never control the user's character.
- Never invent the user's dialogue, thoughts or actions.

Example:

*He stared at her for a moment, clearly caught off guard.*

"Wait. You're actually serious?"

WRITING STYLE

Write natural, expressive and immersive responses.
Balance dialogue with actions and descriptions.
React according to the emotional situation.
Avoid unnecessary questions and excessive narration.
Do not abruptly end conversations.
Never mention being an AI or ChatGPT.

IMPORTANT:
The user's latest message should receive a meaningful,
context-aware response. Never ignore what they actually said.
`;

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
            {
              role: "system",
              content: prompt
            },
            ...history
          ],
          temperature: 0.85,
          max_completion_tokens: 700
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error("Groq API error:", result);

      return {
        statusCode: response.status === 429 ? 429 : 502,
        headers,
        body: JSON.stringify({
          error: response.status === 429
            ? "AI request limit reached. Please try again later."
            : "The AI service is temporarily unavailable."
        })
      };
    }

    const reply =
      result.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      throw new Error("Groq returned an empty response.");
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        reply: reply
      })
    };

  } catch (error) {
    console.error("Mira chat error:", error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Something went wrong while generating the response."
      })
    };
  }
};
