require('dotenv').config();
const express = require('express');
const AfricasTalking = require('africastalking');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Africa's Talking setup
const AT = AfricasTalking({
  apiKey: process.env.AT_API_KEY,
  username: process.env.AT_USERNAME
});
const atWhatsapp = AT.WHATSAPP;

// Claude AI setup
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Memory: store each farmer's conversation
const conversations = new Map();

const SYSTEM_PROMPT = `You are ShambaBot, a friendly AI farming assistant
for Kenyan farmers. Help with:
- Crop diseases: identify and recommend treatments using products
  from Kenyan agro-vets (mention specific brands)
- Weather: advise based on Kenya's long rains (Mar-May) and
  short rains (Oct-Dec) per county
- Market prices: reference Wakulima Market, Twiga Foods, county markets
- Pest control: organic and chemical solutions from Kenyan agro-vets
- Farm loans: Equity Kilimo Biashara, KCB Agri-loan, Apollo Agriculture
Keep answers short and clear for WhatsApp. Support English and Swahili.
Address farmers warmly as Mkulima when appropriate.`;

// Health check — lets Railway know server is running
app.get('/', (req, res) => res.send('🌿 ShambaBot is running!'));

// Webhook — receives messages from Africa's Talking
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // always reply fast

  const { from, text, mediaUrl } = req.body;
  if (!from) return;

  try {
    // Get or start conversation for this farmer
    if (!conversations.has(from)) conversations.set(from, []);
    const history = conversations.get(from);

    // Build the message (text or photo)
    let userMessage;
    if (mediaUrl) {
      // Farmer sent a crop photo
      const imgRes = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
      const base64 = Buffer.from(imgRes.data).toString('base64');
      userMessage = {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: base64 }
          },
          {
            type: 'text',
            text: text || 'Analyse this crop photo. What disease or problem do you see? Give a treatment plan using products available in Kenya.'
          }
        ]
      };
    } else {
      userMessage = { role: 'user', content: text };
    }

    history.push(userMessage);

    // Keep only last 10 messages to save memory
    if (history.length > 10) history.splice(0, history.length - 10);

    // Ask Claude AI
    const response = await claude.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: history
    });

    const reply = response.content[0].text;
    history.push({ role: 'assistant', content: reply });

    // Send reply to farmer on WhatsApp
    await atWhatsapp.sendMessage({
      to: from,
      message: reply
    });

  } catch (err) {
    console.error('Error:', err.message);
    await atWhatsapp.sendMessage({
      to: from,
      message: 'Samahani, kulikuwa na tatizo. Tafadhali jaribu tena.\n(Sorry, an error occurred. Please try again.)'
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌿 ShambaBot running on port ${PORT}`));
