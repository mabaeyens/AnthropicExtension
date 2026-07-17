require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;
const https = require('https');
const fs = require('fs');

const options = {
    key: fs.readFileSync('./certs/localhost3000-key.pem'), // Path to your private key
    cert: fs.readFileSync('./certs/localhost3000-cert.pem') // Path to your certificate
}

// Configure CORS - in production, restrict this to your Qlik Sense domain
app.use(cors({
  origin: process.env.QLIK_ORIGIN || 'https://your-qlik-server', // Set QLIK_ORIGIN in .env
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key', 'Origin', 'X-Requested-With', 'Accept', 'anthropic-version'],
}));

// Parse JSON request bodies
app.use(express.json({ limit: '10mb' })); // Increase limit if you send large data

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('Proxy server is running');
});

// Anthropic API proxy endpoint
app.post('/api/anthropic', async (req, res) => {
  console.log('Received proxy request');
  
  try {
    // Get API key from request header
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
      console.error('No API key provided');
      return res.status(400).json({ error: 'API key is required in x-api-key header' });
    }
    
    console.log('Forwarding request to Anthropic API');
    
    // Forward the request to Anthropic
    const response = await axios({
      method: 'post',
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      data: req.body,
      timeout: 60000 // 60 second timeout
    });
    
    console.log('Received response from Anthropic API');
    
    // Return Anthropic's response to the client
    res.json(response.data);
  } catch (error) {
    console.error('Error proxying request to Anthropic:', error.message);
    
    // Forward error details to client
    const status = error.response?.status || 500;
    const errorData = error.response?.data || { error: error.message };
    
    res.status(status).json({
      error: error.message,
      details: errorData
    });
  }
});

// Local model (Ollama) proxy endpoint.
// Forwards an OpenAI-compatible chat-completions body to a local Ollama server.
// This lets the HTTPS Qlik page reach a plain-HTTP local model (mixed content would
// otherwise block a direct browser call). No API key is required for local inference.
app.post('/api/ollama', async (req, res) => {
  console.log('Received local-model (Ollama) request');

  try {
    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434/v1/chat/completions';

    const response = await axios({
      method: 'post',
      url: ollamaUrl,
      headers: { 'Content-Type': 'application/json' },
      data: req.body,
      timeout: 300000 // 5 min — local inference is far slower than the hosted API
    });

    console.log('Received response from Ollama');
    res.json(response.data);
  } catch (error) {
    console.error('Error proxying request to Ollama:', error.message);

    const status = error.response?.status || 500;
    const errorData = error.response?.data || { error: error.message };

    res.status(status).json({
      error: error.message,
      details: errorData
    });
  }
});

// Start the server
https.createServer(options, app).listen(3000, () => {
  console.log(`Anthropic proxy server running at httpS://localhost:${port}`);
  console.log(`Health check: httpS://localhost:${port}/health`);
  console.log(`Anthropic endpoint: httpS://localhost:${port}/api/anthropic`);
  console.log(`Local model endpoint: httpS://localhost:${port}/api/ollama`);
});
