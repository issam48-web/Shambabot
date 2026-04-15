require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const app = express();
app.use(express.json());

// Claude AI setup
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Store each farmer's conversation history
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

// Health check
app.get('/', (req, res) => res.send('🌿 ShambaBot is running!'));

// Webhook verification — Meta requires this
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('Webhook verified!');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Receive messages from WhatsApp
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (!message) return;

    const from = message.from; // farmer's phone number
    let userText = '';
    let imageBase64 = null;

    // Handle text message
    if (message.type === 'text') {
      userText = message.text.body;
    }

    // Handle image message
    if (message.type === 'image') {
      const imageId = message.image.id;
      const caption = message.image.caption || '';

      // Download image from Meta
      const mediaRes = await axios.get(
        `https://graph.facebook.com/v18.0/${imageId}`,
        { headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` } }
      );

      const imageRes = await axios.get(mediaRes.data.url, {
        headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
        responseType: 'arraybuffer'
      });

      imageBase64 = Buffer.from(imageRes.data).toString('base64');
      userText = caption || 'Analyse this crop photo. What disease or problem do you see? Give treatment using products available in Kenya.';
    }

    // Get or start conversation
    if (!conversations.has(from)) conversations.set(from, []);
    const history = conversations.get(from);

    // Build message for Claude
    let userMessage;
    if (imageBase64) {
      userMessage = {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 }
          },
          { type: 'text', text: userText }
        ]
      };
    } else {
      userMessage = { role: 'user', content: userText };
    }

    history.push(userMessage);
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

    // Send reply back to farmer via Meta WhatsApp API
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: from,
        text: { body: reply }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

  } catch (err) {
    console.error('Error:', err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌿 ShambaBot running on port ${PORT}`));
