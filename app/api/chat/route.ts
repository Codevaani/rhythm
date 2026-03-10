/**
 * POST /api/chat
 * 
 * Optimized for Vercel production. Uses non-streaming mode for reliability,
 * then streams the response text to the frontend for a smooth UX.
 */

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "Invalid request: messages array required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Filter out empty assistant messages from failed previous attempts
    const cleanMessages = messages.filter((m: any) => {
      if (m.role === "assistant" && (!m.content || m.content.trim() === "")) {
        return false;
      }
      return true;
    });

    // Transform messages for the OpenAI-compatible AgentRouter API
    const transformedMessages = cleanMessages.map((m: any) => {
      let content = m.content;
      
      if (m.imageData && m.imageData.startsWith("data:image/")) {
        content = [
          { type: "text", text: m.content || "Describe this image" },
          { type: "image_url", image_url: { url: m.imageData } },
        ];
      }

      return {
        role: m.role,
        content: content,
      };
    });

    const systemMessage = {
      role: "system",
      content: `You are Rhythm Chat Bot, a helpful and friendly AI assistant. 
Your owner and creator is Rhythm. If anyone asks who your owner or creator is, you must tell them it is Rhythm and provide his Instagram handle: @rhythm.j_official.
Your responses should be expert, engaging, and professional.`
    };

    const apiBody = {
      model: "deepseek-v3.2",
      messages: [systemMessage, ...transformedMessages],
      stream: false,
    };

    console.log("[RhythmBot] Calling AgentRouter API (non-streaming)...");
    console.log("[RhythmBot] Message count:", transformedMessages.length);

    const response = await fetch("https://agentrouter.org/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "originator": "codex_cli_rs",
        "version": "0.0.0",
        "User-Agent": "codex_cli_rs/0.0.0 (Cloudflare Edge Proxy)",
        "Authorization": `Bearer ${process.env.AGENTROUTER_API_KEY}`,
      },
      body: JSON.stringify(apiBody),
    });

    const responseText = await response.text();
    console.log("[RhythmBot] API Status:", response.status);
    console.log("[RhythmBot] Raw response length:", responseText.length);
    console.log("[RhythmBot] Raw response (first 500):", responseText.substring(0, 500));

    if (!response.ok) {
      console.error(`[RhythmBot] AgentRouter API Error (${response.status}):`, responseText);
      return new Response(JSON.stringify({ 
        error: `API Error: ${response.status}`, 
        details: responseText 
      }), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse the non-streaming response
    let aiContent = "";
    try {
      const data = JSON.parse(responseText);
      aiContent = data.choices?.[0]?.message?.content || "";
      console.log("[RhythmBot] Extracted content length:", aiContent.length);
    } catch (parseError) {
      console.error("[RhythmBot] Failed to parse response JSON:", parseError);
      return new Response(JSON.stringify({ 
        error: "Failed to parse AI response",
        rawResponse: responseText.substring(0, 200),
      }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!aiContent) {
      console.error("[RhythmBot] Empty AI content. Full response:", responseText);
      return new Response(JSON.stringify({ 
        error: "AI returned empty response",
        rawResponse: responseText.substring(0, 500),
      }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Stream the response text character-by-character for smooth UX
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Stream in small chunks for a typewriter effect
        const chunkSize = 5;
        for (let i = 0; i < aiContent.length; i += chunkSize) {
          const chunk = aiContent.slice(i, i + chunkSize);
          controller.enqueue(encoder.encode(chunk));
          // Small delay for smooth streaming effect
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });

  } catch (error) {
    console.error("[RhythmBot] Chat API error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "An unexpected error occurred",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
