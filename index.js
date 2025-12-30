// Deeply rewrite all $ref values containing '/$defs/' to local $defs refs
function deepRewriteRefs(obj) {
  if (Array.isArray(obj)) {
    obj.forEach(deepRewriteRefs);
  } else if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      if (key === '$ref' && typeof obj[key] === 'string') {
        let ref = obj[key];
        const idx = ref.indexOf('/$defs/');
        if (idx !== -1) {
          const refDef = ref.substring(idx + 7); // after '/$defs/'
          obj[key] = `#/$defs/${refDef}`;
          // Optionally log: console.log(`[schema-ref] Rewrote $ref from '${ref}' to '${obj[key]}'`);
        }
      } else {
        deepRewriteRefs(obj[key]);
      }
    }
  }
}
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

// Load all schemas from ./api-schemas, supporting .json and .cfgdb files
const schemasDir = path.join(__dirname, 'api-schemas');
const ajv = new Ajv();
let schemas = {};

function loadSchemaFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function mergeDefsIfRef(schema, schemasDir) {
  // Recursively search for $ref and merge defs if needed
  function merge(obj) {
    if (Array.isArray(obj)) {
      obj.forEach(merge);
    } else if (obj && typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        if (key === '$ref' && typeof obj[key] === 'string') {
          const ref = obj[key];
          // Only handle refs like 'defs/$defs/hsvct' (file/...) and only first occurrence
          const match = ref.match(/^([a-zA-Z0-9_-]+)\//);
          if (match) {
            const refFile = match[1];
            const defsPath = path.join(schemasDir, refFile + '.cfgdb');
            if (fs.existsSync(defsPath)) {
              const defsSchema = loadSchemaFile(defsPath);
              // Merge $defs from defsSchema into current schema if not already present
              if (defsSchema.$defs) {
                if (!schema.$defs) schema.$defs = {};
                Object.assign(schema.$defs, defsSchema.$defs);
                console.log(`[schema-merge] Merged $defs from ${refFile}.cfgdb into schema`);
              }
            }
            // Only merge the first $ref found
            return;
          }
        } else {
          merge(obj[key]);
        }
      }
    }
  }
  merge(schema);
}

fs.readdirSync(schemasDir).forEach(file => {
  if (file.endsWith('.json') || file.endsWith('.cfgdb')) {
    let schema = loadSchemaFile(path.join(schemasDir, file));
    // Remove .json, .cfgdb, and .schema from the filename
    let baseName = file.replace(/\.(json|cfgdb)$/, '').replace('.schema', '');
    // Remove leading app- for endpoint naming
    if (baseName.startsWith('app-')) baseName = baseName.slice(4);
    const route = '/' + baseName;
    // Merge defs if $ref found
    mergeDefsIfRef(schema, schemasDir);
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
    // Deeply rewrite $ref values before generating mock data
    deepRewriteRefs(responseSchema);
    const mock = jsf.generate(responseSchema);
    res.json(mock);
  });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', endpoints: Object.keys(schemas) });
});


const server = app.listen(PORT, () => {
  console.log(`Mock backend running on port ${PORT}`);
});

// Graceful shutdown on SIGTERM
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  server.close(() => {
    process.exit(0);
  });
});
