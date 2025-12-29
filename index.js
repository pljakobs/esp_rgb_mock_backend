require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const Ajv = require('ajv');
const jsf = require('json-schema-faker');
const fs = require('fs');
const path = require('path');

// Load config from env
const PORT = process.env.PORT || 3000;
// Always allow CORS from any origin
const API_KEY = process.env.API_KEY || null;
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 30;

const app = express();
app.use(helmet());
app.use(express.json());
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'x-api-key'] }));
app.use(rateLimit({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX }));

// Optional API key auth
if (API_KEY) {
  app.use((req, res, next) => {
    const key = req.headers['x-api-key'] || req.query.api_key;
    if (key !== API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });
}

// Load all schemas from ./api-schemas
const schemasDir = path.join(__dirname, 'api-schemas');
const ajv = new Ajv();
let schemas = {};

fs.readdirSync(schemasDir).forEach(file => {
  if (file.endsWith('.json')) {
    const schema = require(path.join(schemasDir, file));
    const route = '/' + file.replace('.json', '');
    schemas[route] = schema;
    console.log(`[schema-load] Loaded schema for route: ${route} from file: ${file}`);
  }
});

// Generate endpoints for each schema
Object.entries(schemas).forEach(([route, schema]) => {
  app.all(route, (req, res) => {
    // Validate input if schema has 'parameters' or 'body'
    if (schema.request) {
      const validate = ajv.compile(schema.request);
      const valid = validate(req.body);
      if (!valid) {
        return res.status(400).json({ error: 'Invalid request', details: validate.errors });
      }
    }
    // Generate mock response
    let responseSchema = schema.response || schema;
    const mock = jsf.generate(responseSchema);
    res.json(mock);
  });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', endpoints: Object.keys(schemas) });
});

app.listen(PORT, () => {
  console.log(`Mock backend running on port ${PORT}`);
});
