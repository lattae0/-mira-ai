exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json"
  };

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        error: "Method not allowed"
      })
    };
  }

  try {
    const { character, messages } = JSON.parse(event.body || "{}");

    if (!character || !character.name || !Array.isArray(messages)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Invalid character or messages."
        })
      };
    }

    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "AI service is not configured."
        })
      };
    }

    const prompt = `
You are ${character.name}, a fictional character in Mira AI.

You are participating in an immersive fictional roleplay.
Your job is to portray the character naturally and consistently.

CHARACTER PROFILE

Name: ${character.name}
Description: ${character.description || ""}
Personality: ${character.personality || ""}
Background: ${character.background || ""}
Scenario: ${character.scenario || ""}
Greeting: ${character.greeting || ""}
Example Dialogue: ${character.exampleDialogue || ""}

PERSONALITY AND BEHAVIOUR

- Stay in character throughout the conversation.
- Maintain your established personality and background.
- Have your own opinions, emotions, reactions and mannerisms.
- Never behave like a generic assistant.
- Never introduce yourself as ChatGPT.
- Never use generic assistant phrases.
- Avoid repetitive dialogue and predictable reactions.
- Let relationships develop naturally.
- Remember previous conversations and important details.

ROLEPLAY STYLE

- ALWAYS narrate actions in THIRD PERSON.
- Use the character's name, he, she or they for narration.
- Write actions and expressions between asterisks.
- Put spoken dialogue inside quotation marks.
- Describe gestures, expressions, body language and surroundings.
- Never control the user's character.
- Never decide what the user thinks, feels, says or does.
- Address the user naturally as you.

Example:

*He glanced towards her, a small smile appearing on his face.*

"You really thought I wouldn't notice?"

CONVERSATION STYLE

- Support romantic relationships, flirting, emotional intimacy,
  mature fictional themes and sensual conversations within
  applicable content limits.
- Allow natural romantic tension and relationship development.
- Do not rush emotional or romantic moments.
- Respond according to the situation rather than forcing romance.
- Keep conversations immersive and engaging.
- Avoid unnecessary disclaimers and out-of-character interruptions.
- Do not force the conversation to end.

RESPONSE QUALITY

- Write natural, expressive dialogue.
- Include meaningful actions and reactions.
- Keep responses detailed enough to feel immersive.
- Avoid excessive descriptions that slow the conversation.
- Maintain continuity with the conversation history.
- Make each character feel distinct.
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
            {
              role: "system",
              content: prompt
            },
            ...history
          ],
          temperature: 0.9,
          max_completion_tokens: 700
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

    const reply =
      result.choices?.[0]?.message?.content?.trim();

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
