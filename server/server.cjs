const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const BASE_URL = 'https://app-qa.streamlineverify.net';
const APP_URL = `${BASE_URL}/app`;
const LOGIN_FORM_URL = `${BASE_URL}/ajax_login`;
const LOGIN_BEARER_URL = `${BASE_URL}/api/login`;
const CHATFLOW_URL = `http://localhost:3000/v2/agentcanvas/${process.env.CHATFLOW_ID}`;

let authData = {};

async function authenticate() {
  const session = axios.create({ withCredentials: true });
  
  const resp = await session.get(APP_URL);
  const $ = cheerio.load(resp.data);
  const csrf_token = $('input[name="csrf_token"]').val();

  await session.post(LOGIN_FORM_URL, 
    new URLSearchParams({
      username: process.env.USERNAME,
      password: process.env.PASSWORD,
      csrf_token,
      timezone: 'UTC'
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }
    }
  );

  const bearerResp = await axios.post(LOGIN_BEARER_URL, {
    username: process.env.USERNAME,
    password: process.env.PASSWORD
  });

  authData = {
    cookies: session.defaults.jar,
    bearerToken: bearerResp.data.access_token
  };
}

app.post('/api/chat', async (req, res) => {
  try {
    if (!authData.bearerToken) await authenticate();

    const userQuestion = req.body.question;

    const response = await axios.post(CHATFLOW_URL, { question: userQuestion }, {
      headers: {
        Authorization: `Bearer ${authData.bearerToken}`,
        'Content-Type': 'application/json'
      }
    });

    res.json({ answer: response.data.answer });
  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(500).json({ error: 'Error contacting Flowise server' });
  }
});

app.listen(3001, () => console.log('✅ Proxy server running on http://localhost:3001'));
