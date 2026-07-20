import { getSupabase, json, sendTelegram } from "../../lib/store.js";

export async function onRequestPost(context) {
  try {
    const { env, request } = context;
    const body = await request.json();
    const message = String(body.message || "").trim();
    const name = String(body.name || "Store visitor").trim();
    const contact = String(body.contact || "").trim();
    const history = body.history || [];
    const visitorIp = String(body.visitorIp || "").trim();
    const userAgent = String(body.userAgent || "").trim();
    const pageUrl = String(body.pageUrl || "").trim();

    if (!message) return json({ error: "Message is required." }, 400);

    // 1. Fetch current active products from Supabase
    let productsText = "";
    try {
      const supabase = getSupabase(env);
      if (supabase) {
        const { data, error } = await supabase
          .from("products")
          .select("name, description, price_usd")
          .eq("active", true);
        if (!error && data && data.length > 0) {
          productsText = data.map(p => `- ${p.name}: ${p.description} (Price: $${p.price_usd} USD)`).join("\n");
        }
      }
    } catch (e) {
      console.warn("Could not query Supabase for AI context:", e);
    }

    // Default products fallback if Supabase query failed or is empty
    if (!productsText) {
      productsText = [
        "- Automation Bot Builder: A ready setup package for simple workflow bots, auto replies, and order notifications. (Price: $49 USD)",
        "- Customer Support Bot: A support bot package for FAQs, customer intake, and clean handoff to your team. (Price: $79 USD)",
        "- Custom Enterprise AI Bot: Full bespoke development for customized bots, database integrations, and complex business logic. (Price: $129 USD)"
      ].join("\n");
    }

    // 2. Build system instructions
    const systemPrompt = `You are the official AI Assistant for DTD Store.
DTD Store is a premium, crypto-first digital product storefront.
We accept Bitcoin (BTC) and Card/Bank payments via Paystack.
Here is our store configuration:
- Bitcoin (BTC) is accepted and processed via a QR code and manual verification.
- Card/Bank/USSD/Mobile Money is processed instantly and securely via Paystack checkout.
- Telegram username is used for delivery and order updates.
- Orders are kept pending until payment is verified by our admins.

Here are the products currently available in our store:
${productsText}

Guidelines:
- Keep your answers helpful, polite, and extremely concise (since you are chatting inside a small website widget).
- Always recommend buying directly through the website checkout at the bottom of the page.
- For support, tell them to contact @davetheedev on Telegram.
- Do not make up products, prices, or payment details. If you don't know, tell them the admin will contact them.
- If they ask about order delivery, tell them that digital products are processed immediately and they will be contacted on Telegram/Email.
- Avoid repeating yourself.`;

    let reply = "";
    const apiKey = env.GEMINI_API_KEY;

    // 3. Attempt to generate reply using Gemini API
    if (apiKey) {
      try {
        const contents = [];
        if (Array.isArray(history)) {
          for (const h of history.slice(-6)) { // Take last 6 messages
            contents.push({
              role: h.role === "user" ? "user" : "model",
              parts: [{ text: h.text }]
            });
          }
        }
        
        if (contents.length === 0 || contents[contents.length - 1].parts[0].text !== message) {
          contents.push({
            role: "user",
            parts: [{ text: message }]
          });
        }

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: systemPrompt }]
              },
              contents: contents,
              generationConfig: {
                maxOutputTokens: 250,
                temperature: 0.7
              }
            })
          }
        );

        if (response.ok) {
          const payload = await response.json();
          reply = payload.candidates?.[0]?.content?.parts?.[0]?.text || "";
        } else {
          console.error("Gemini API returned error:", await response.text());
        }
      } catch (geminiError) {
        console.error("Gemini API call failed:", geminiError);
      }
    }

    // 4. Fallback logic if Gemini is not set up or failed
    if (!reply) {
      const msg = message.toLowerCase();
      if (msg.includes("price") || msg.includes("product") || msg.includes("cost") || msg.includes("buy")) {
        reply = "We offer premium automation bots:\n- **Automation Bot Builder** ($49 USD)\n- **Customer Support Bot** ($79 USD)\n- **Custom Enterprise AI Bot** ($129 USD)\nSelect your item and purchase instantly using our checkout form below!";
      } else if (msg.includes("pay") || msg.includes("payment") || msg.includes("card") || msg.includes("btc") || msg.includes("crypto") || msg.includes("paystack")) {
        reply = "We support card & bank payments via **Paystack** and **Bitcoin (BTC)**. Simply click on the Checkout section below to select your option and complete payment.";
      } else if (msg.includes("status") || msg.includes("order") || msg.includes("deliver")) {
        reply = "To check your order status, please enter your details at checkout. Our admin reviews all orders and will message you on Telegram/email with your digital delivery.";
      } else {
        reply = `Hello! I am the DTD Assistant. I can help with product details and ordering. (Note: Set GEMINI_API_KEY in Pages Secrets to enable my full AI brain).\n\nYour query has been forwarded to the admin, who will message you shortly!`;
      }
    }

    // 5. Send a copy of the chat conversation to the admin's Telegram chat
    if (env.TELEGRAM_ADMIN_CHAT_ID) {
      await sendTelegram(
        env,
        env.TELEGRAM_ADMIN_CHAT_ID,
        [
          "<b>💬 DTD AI Widget Interaction</b>",
          `👤 From: ${name}`,
          contact ? `📞 Contact: ${contact}` : null,
          visitorIp ? `🌐 IP: <code>${visitorIp}</code>` : null,
          pageUrl ? `🔗 Page: ${pageUrl}` : null,
          userAgent ? `🖥 Device: ${userAgent.substring(0, 80)}` : null,
          "",
          `💬 User: <i>"${message}"</i>`,
          "",
          `🤖 DTD Assistant: <i>"${reply}"</i>`
        ]
          .filter(Boolean)
          .join("\n")
      );
    }

    return json({ ok: true, reply });
  } catch (error) {
    console.error("Telegram message error:", error);
    return json({ error: "Could not send message." }, 500);
  }
}
