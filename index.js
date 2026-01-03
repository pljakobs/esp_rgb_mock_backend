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
const API_KEY = process.env.API_KEY || null;
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 100; // Increased for testing

const app = express();
app.use(helmet());
app.use(express.json());
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization'] }));
app.use(rateLimit({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX }));

// --- Authentication Middleware ---
app.use((req, res, next) => {
  // 1. Check for API Key (Mock specific)
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (API_KEY && apiKey === API_KEY) {
    return next();
  }

  // 2. Check for Basic Auth (Firmware compatible)
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Basic ')) {
    // In a real mock, we might validate the password against a config
    // For now, we just accept any Basic Auth if present, or if API_KEY is not set
    return next();
  }

  // If API_KEY is enforced and no valid auth provided
  if (API_KEY && !apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
});

// --- Schema Loading & Helper Functions ---

const schemasDir = path.join(__dirname, 'api-schemas');
const ajv = new Ajv({ strict: false });
let schemas = {};
let mockState = {}; // In-memory store for stateful endpoints
let defaultData = {};

// Load default data if available
const defaultDataPath = path.join(__dirname, 'default-data.json');
if (fs.existsSync(defaultDataPath)) {
  try {
    defaultData = JSON.parse(fs.readFileSync(defaultDataPath, 'utf-8'));
    console.log('Loaded default-data.json');
  } catch (e) {
    console.error('Failed to load default-data.json:', e.message);
  }
}

function loadSchemaFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

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
        }
      } else {
        deepRewriteRefs(obj[key]);
      }
    }
  }
}

function mergeDefsIfRef(schema, schemasDir) {
  function merge(obj) {
    if (Array.isArray(obj)) {
      obj.forEach(merge);
    } else if (obj && typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        if (key === '$ref' && typeof obj[key] === 'string') {
          const ref = obj[key];
          const match = ref.match(/^([a-zA-Z0-9_-]+)\//);
          if (match) {
            const refFile = match[1];
            const defsPath = path.join(schemasDir, refFile + '.cfgdb');
            if (fs.existsSync(defsPath)) {
              const defsSchema = loadSchemaFile(defsPath);
              if (defsSchema.$defs) {
                if (!schema.$defs) schema.$defs = {};
                Object.assign(schema.$defs, defsSchema.$defs);
              }
            }
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

// --- ConfigDB Update Logic ---

function applyConfigDbUpdate(currentState, payload) {
  console.log('Applying ConfigDB update:', JSON.stringify(payload, null, 2));
  
  for (const [key, value] of Object.entries(payload)) {
    // 1. Array Append: "key[]"
    if (key.endsWith('[]')) {
      const realKey = key.slice(0, -2);
      if (!currentState[realKey]) currentState[realKey] = [];
      if (!Array.isArray(currentState[realKey])) currentState[realKey] = [currentState[realKey]];
      
      if (Array.isArray(value)) {
        currentState[realKey].push(...value);
      } else {
        currentState[realKey].push(value);
      }
      console.log(`Appended to ${realKey}`);
      continue;
    }

    // 2. Array Update/Delete via Selector: "key[prop=val]"
    // Regex captures: 1=key, 2=prop, 3=val
    const match = key.match(/^(.+)\[(.+)=(.+)\]$/);
    if (match) {
      const realKey = match[1];
      const prop = match[2];
      let val = match[3];

      // Handle quoted values in selector if present
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }

      if (!currentState[realKey] || !Array.isArray(currentState[realKey])) {
        console.warn(`Cannot update array item: ${realKey} is not an array`);
        continue;
      }

      const index = currentState[realKey].findIndex(item => String(item[prop]) === String(val));

      if (value === null) {
        // Delete
        if (index !== -1) {
          currentState[realKey].splice(index, 1);
          console.log(`Deleted item from ${realKey} where ${prop}=${val}`);
        } else {
          console.warn(`Item not found for deletion: ${key}`);
        }
      } else {
        // Update
        if (index !== -1) {
          currentState[realKey][index] = { ...currentState[realKey][index], ...value };
          console.log(`Updated item in ${realKey} where ${prop}=${val}`);
        } else {
          console.warn(`Item not found for update: ${key}`);
        }
      }
      continue;
    }

    // 3. Simple Property Update
    currentState[key] = value;
    console.log(`Updated property ${key}`);
  }
}

// --- Initialization ---

// Load schemas
fs.readdirSync(schemasDir).forEach(file => {
  if (file.endsWith('.json') || file.endsWith('.cfgdb')) {
    let schema = loadSchemaFile(path.join(schemasDir, file));
    let baseName = file.replace(/\.(json|cfgdb)$/, '').replace('.schema', '');
    if (baseName.startsWith('app-')) baseName = baseName.slice(4);
    const route = '/' + baseName;
    
    mergeDefsIfRef(schema, schemasDir);
    schemas[route] = schema;
    
    // Initialize state if it's a store or specific endpoints we want to be stateful
    if (schema.store || file.includes('app-data') || file.includes('app-config') || route === '/color' || route === '/info') {
      // Generate initial mock data
      let responseSchema = schema.response || schema;
      deepRewriteRefs(responseSchema);
      try {
        // Check if we have a default data file for this route
        const dataKey = route.slice(1); // e.g. 'info', 'config'
        if (defaultData[dataKey]) {
           mockState[route] = defaultData[dataKey];
           console.log(`Initialized state for ${route} from default-data.json key '${dataKey}'`);
        } else if (route === '/data' && Object.keys(defaultData).length > 0) {
           mockState[route] = defaultData;
           console.log(`Initialized state for ${route} from default-data.json`);
        } else {
           mockState[route] = jsf.generate(responseSchema);
           console.log(`Initialized state for ${route} from schema`);
        }
      } catch (e) {
        console.error(`Failed to generate initial state for ${route}:`, e.message);
        mockState[route] = {};
      }
    }
    
    console.log(`[schema-load] Loaded schema for route: ${route}`);
  }
});

// --- Specific Route Logic ---

// /ping
app.get('/ping', (req, res) => {
  res.json({ ping: 'pong' });
});

// /networks & /scan_networks
let isScanning = false;
app.get('/networks', (req, res) => {
  if (isScanning) {
    res.json({ scanning: true });
    // Simulate scan finishing after some time
    setTimeout(() => { isScanning = false; }, 2000);
  } else {
    // Return mock networks
    const networksSchema = schemas['/networks'];
    if (networksSchema) {
      const mockNetworks = jsf.generate(networksSchema);
      res.json({ scanning: false, available: mockNetworks.available || [] });
    } else {
      res.json({ scanning: false, available: [] });
    }
  }
});

app.post('/scan_networks', (req, res) => {
  isScanning = true;
  res.json({ success: true });
});

// /hosts
app.get('/hosts', (req, res) => {
  // Get controllers from state (loaded from default-data.json) or generate
  let controllers = [];
  if (mockState['/data'] && mockState['/data'].controllers) {
    controllers = JSON.parse(JSON.stringify(mockState['/data'].controllers)); // Deep copy
  } else {
    // Fallback if no data
    controllers = [];
  }

  // Get deviceid from /info
  let deviceId = 0;
  if (mockState['/info'] && mockState['/info'].deviceid) {
    deviceId = mockState['/info'].deviceid;
  }

  const showAll = req.query.all === 'true' || req.query.app === 'true';

  // Map to expected format and apply overrides
  let hosts = controllers.map(c => {
    return {
      id: c.id,
      hostname: c.name, // Map name to hostname
      ip_address: 'mock.lightinator.de', // Override IP
      visible: c.visible !== undefined ? c.visible : true,
      state: c.state !== undefined ? c.state : 3 // Default to 3 (Online)
    };
  });

  // Filter if not showing all
  if (!showAll) {
    hosts = hosts.filter(h => h.visible);
  }

  // Ensure the "self" device has state 4 (Connected/Self) if it matches deviceId
  const selfIndex = hosts.findIndex(h => String(h.id) === String(deviceId));
  if (selfIndex !== -1) {
    hosts[selfIndex].state = 4;
  }

  res.json({ hosts: hosts });
});

// /set_on & /set_off
app.post('/set_on', (req, res) => {
  console.log('Turning ON');
  // Update color state if exists
  if (mockState['/color'] && mockState['/color'].raw) {
    // Simple simulation: set brightness to max or restore last state
    // For now just log
  }
  res.json({ success: true, message: 'SetOn OK' });
});

app.post('/set_off', (req, res) => {
  console.log('Turning OFF');
  if (mockState['/color'] && mockState['/color'].raw) {
    mockState['/color'].raw = { r: 0, g: 0, b: 0, ww: 0, cw: 0 };
  }
  res.json({ success: true, message: 'SetOff OK' });
});

// /update
app.post('/update', (req, res) => {
  console.log('Update requested:', req.body);
  res.json({ success: true });
});

app.get('/update', (req, res) => {
  res.json({ status: 0 }); // 0 = IDLE
});

// /system
app.post('/system', (req, res) => {
  console.log('System command:', req.body);
  res.json({ success: true });
});


// --- Generic Route Handlers (Fallback) ---

Object.entries(schemas).forEach(([route, schema]) => {
  // Skip if already handled explicitly
  if (['/ping', '/networks', '/scan_networks', '/set_on', '/set_off', '/update', '/system'].includes(route)) return;

  // GET Handler
  app.get(route, (req, res) => {
    if (mockState[route]) {
      res.json(mockState[route]);
    } else {
      // Stateless endpoint, generate fresh mock
      let responseSchema = schema.response || schema;
      deepRewriteRefs(responseSchema);
      res.json(jsf.generate(responseSchema));
    }
  });

  // POST Handler
  app.post(route, (req, res) => {
    // 1. Handle State Update
    if (mockState[route]) {
      try {
        applyConfigDbUpdate(mockState[route], req.body);
        res.json({ success: true });
      } catch (e) {
        console.error(`Error updating state for ${route}:`, e);
        res.status(500).json({ error: e.message });
      }
    } else {
      // Stateless POST
      console.log(`Received POST to ${route}:`, JSON.stringify(req.body));
      
      // Special handling for /color to update state if it exists (even if not persisted in ConfigDB way)
      if (route === '/color' && mockState['/color']) {
         // Merge body into state (simplified)
         Object.assign(mockState['/color'], req.body);
      }
      
      res.json({ success: true });
    }
  });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', endpoints: Object.keys(schemas) });
});

const server = app.listen(PORT, () => {
  console.log(`Mock backend running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  server.close(() => {
    process.exit(0);
  });
});
