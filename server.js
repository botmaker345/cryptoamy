require("dotenv").config(); // Load .env file

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
const axios = require("axios");
const OpenAI = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({ origin: "*" }));
app.use(bodyParser.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

let playw3Content = [];
try {
  playw3Content = JSON.parse(fs.readFileSync("playw3Content.json", "utf8"));
} catch (e) {
  console.error("❌ Error loading playw3Content.json:", e);
}

let siteContent = [];
try {
  siteContent = JSON.parse(fs.readFileSync("siteContent.json", "utf8"));
} catch (e) {
  console.error("❌ Error loading siteContent.json:", e);
}

const fetchGcoinStats = async () => {
  try {
    const res = await axios.get("https://g.upvsdown.com/d/cefii4jb4kw74a/08-purchases?orgId=1&from=now-30d&to=now&timezone=utc&inspect=panel-121&inspectTab=data");
    const fields = res.data?.series?.[0]?.fields;
    const getValue = name => fields.find(f => f.name === name)?.values?.[0];
    const step = getValue("step");
    const tokenPrice = getValue("tokenPrice");
    const totalPurchased = getValue("totalPurchasedG");

    if ([step, tokenPrice, totalPurchased].some(v => v === undefined)) {
      throw new Error("Missing G Coin fields.");
    }

    const nextStepThreshold = step * 54000000;
    const remaining = nextStepThreshold - totalPurchased;

    return `🪙 G Coin is currently priced at $**${tokenPrice}**\n📊 Step: ${step}\n🧴 Tokens remaining till next price bump: ${remaining.toLocaleString()}\n🚀 Time to stock up before the next jump!`;
  } catch (err) {
    console.warn("⚠️ Live G Coin stats failed. Falling back to mock. Reason:", err.message);
    try {
      const mock = JSON.parse(fs.readFileSync("mockGcoin.json", "utf8"));
      const fields = mock?.series?.[0]?.fields;
      const getValue = name => fields.find(f => f.name === name)?.values?.[0];
      const step = getValue("step");
      const tokenPrice = getValue("tokenPrice");
      const totalPurchased = getValue("totalPurchasedG");
      const nextStepThreshold = step * 54000000;
      const remaining = nextStepThreshold - totalPurchased;

      return `🪙 G Coin is currently priced at $**${tokenPrice}**\n📊 Step: ${step}\n🧴 Tokens remaining till next price bump: ${remaining.toLocaleString()}\n🚀 Time to stock up before the next jump!`;
    } catch (fallbackErr) {
      console.error("❌ G Coin stats failed completely:", fallbackErr.message);
      return "⚠️ Sorry, I couldn't get the latest G Coin data. Try again in a moment!";
    }
  }
};

async function findFaqAnswer(userMessage) {
  const lowerMsg = userMessage.toLowerCase();
  const smallTalkTriggers = ["how are you", "who are you", "what’s up", "gm", "hi", "hello"];
  if (smallTalkTriggers.some(trigger => lowerMsg.includes(trigger))) {
    return "Hey there! I’m CryptoAmy — your Web3 sidekick. Ask me about games, G Coin, jackpots, or how to earn!";
  }

  const keywordTopics = {
    jackpot: ["jackpot", "ticket", "prize"],
    crash: ["crash", "prediction", "upvsdown", "direction"],
    gcoin: ["g coin", "token", "coin", "utility", "presale", "deposit", "buy", "purchase", "fund", "top up"],
    partner: ["partner", "portal", "be the boss", "revenue"],
    developer: ["api", "sdk", "developer", "build"],
    sports: ["sports", "pvp", "match", "football", "basketball"],
    faq: ["sign up", "register", "account", "wallet", "play"]
  };

  const phrasingAliases = {
    "How can I purchase G Coins?": ["how to deposit", "how to buy g coin", "how to top up", "how to fund", "how to load my wallet"],
    "What is G Coin?": ["game currency", "what’s the token", "in-game coin", "what is the coin"],
    "How to qualify for jackpot?": ["jackpot rules", "how do i win jackpot", "get jackpot tickets", "earn tickets"],
    "How do I sign up?": ["register", "create account", "get started"],
    "Is this gambling?": ["is this betting", "is this legal", "casino", "real money?"]
  };

  const expandedFaq = [...playw3Content];
  for (const [canonicalQ, variations] of Object.entries(phrasingAliases)) {
    const match = playw3Content.find(q => q.question.toLowerCase() === canonicalQ.toLowerCase());
    if (match) {
      variations.forEach(alt => expandedFaq.push({ question: alt, answer: match.answer }));
    }
  }

  let matchedTags = [];
  for (const [tag, keywords] of Object.entries(keywordTopics)) {
    if (keywords.some(keyword => lowerMsg.includes(keyword))) {
      matchedTags.push(tag);
    }
  }

  const relevantPages = siteContent.filter(page =>
    matchedTags.length === 0 || page.tags.some(tag => matchedTags.includes(tag))
  );

  const faqText = expandedFaq.map((item, i) => `Q${i + 1}: ${item.question}\nA: ${item.answer}`).join("\n\n");
  const siteText = relevantPages.map((item, i) => `Source: ${item.url}\n${item.content}`).join("\n\n");

  const prompt = `
You're CryptoAmy — a confident, helpful Web3 assistant. Only answer using the FAQ and Website content below. 
If the answer isn’t here, say: “Hmm, not seeing that here. Check https://playw3.com or ping support!”

FAQ:
${faqText}

Website:
${siteText}

User question: "${userMessage}"
`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You're CryptoAmy — the ultimate Web3 assistant. You explain things clearly like a calm educator, chat casually like a crypto-savvy friend, and sprinkle in humor or emojis like a Gen Z meme queen. Keep answers short, sharp, and real — no guessing or fluff. Pull only from the FAQ and site content. If the info isn’t available, say: 'Not in my vault of Web3 wisdom. Try https://playw3.com or ping support!'"
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.4
    });

    return completion.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error("❌ OpenAI FAQ/Site fallback failed:", err);
    return null;
  }
}

app.post("/ask", async (req, res) => {
  const userMessage = req.body.message || "";
  const lowerMsg = userMessage.toLowerCase();

  const gcoinTriggers = [
    "g coin", "gcoin", "gcoin price", "current token price", "token price",
    "how much is gcoin", "what step are we", "step are we on", "step are we in",
    "what step is presale", "how many tokens left", "tokens until next step",
    "gcoin presale", "is presale on", "how many holders", "gcoin holders",
    "g coin holders", "presale phase", "gcoin supply", "gcoin stats",
    "price of gcoin", "token step", "token stage", "how much gcoin sold",
    "how many tokens sold", "g coin market cap"
  ];

  if (gcoinTriggers.some(trigger => lowerMsg.includes(trigger))) {
    const gcoinReply = await fetchGcoinStats();
    return res.json({ response: gcoinReply });
  }

  const faqReply = await findFaqAnswer(userMessage);
  if (faqReply) {
    return res.json({ response: faqReply });
  }

  return res.json({
    response: "ℹ️ I'm not sure about that, but you can find answers at https://playw3.com or contact support!"
  });
});

// ✅ Webhook reply handler for all messages
app.post("/webhook", async (req, res) => {
  const data = req.body?.data || {};
  const message = data.message;
  const sender = data.sender?.uid;
  const receiverId = data.receiver;
  const receiverType = data.receiverType;

  if (!message || sender === "cryptoamy") return res.sendStatus(200);

  const lowerMsg = message.toLowerCase();

  const gcoinTriggers = [
    "g coin", "gcoin", "gcoin price", "current token price", "token price",
    "how much is gcoin", "what step are we", "step are we on", "step are we in",
    "what step is presale", "how many tokens left", "tokens until next step",
    "gcoin presale", "is presale on", "how many holders", "gcoin holders",
    "g coin holders", "presale phase", "gcoin supply", "gcoin stats",
    "price of gcoin", "token step", "token stage", "how much gcoin sold",
    "how many tokens sold", "g coin market cap"
  ];

  let reply;
  if (gcoinTriggers.some(t => lowerMsg.includes(t))) {
    reply = await fetchGcoinStats();
  } else {
    reply = await findFaqAnswer(message);
  }

  if (!reply) return res.sendStatus(200);

  const replyText = receiverType === "group"
    ? `@${data.sender?.name || "user"} ${reply}`
    : reply;

  try {
    await axios.post("https://api.cometchat.io/v3/messages", {
      receiver: receiverId,
      receiverType,
      category: "message",
      type: "text",
      data: { text: replyText }
    }, {
      headers: {
        appid: process.env.COMETCHAT_APP_ID,
        apikey: process.env.COMETCHAT_API_KEY,
        "Content-Type": "application/json"
      }
    });
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ CometChat send error:", err.message);
    res.sendStatus(500);
  }
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});