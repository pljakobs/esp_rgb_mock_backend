// test-schema-merge.js
// Simple test to verify that merging defs.cfgdb into a schema with $ref works as expected

const fs = require('fs');
const path = require('path');

function loadSchemaFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
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
                console.log(`[schema-merge] Merged $defs from ${refFile}.cfgdb into schema`);
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

// Test: load a schema with a $ref to defs/$defs/hsvct and merge defs.cfgdb
const schemasDir = path.join(__dirname, 'api-schemas');
const dataSchemaPath = path.join(schemasDir, 'app-data.cfgdb');
const defsSchemaPath = path.join(schemasDir, 'defs.cfgdb');

if (!fs.existsSync(dataSchemaPath) || !fs.existsSync(defsSchemaPath)) {
  console.error('Test requires app-data.cfgdb and defs.cfgdb in api-schemas');
  process.exit(1);
}

const dataSchema = loadSchemaFile(dataSchemaPath);
mergeDefsIfRef(dataSchema, schemasDir);

console.log('Merged schema $defs keys:', Object.keys(dataSchema.$defs || {}));

// Check that hsvct is present in $defs
if (dataSchema.$defs && dataSchema.$defs.hsvct) {
  console.log('SUCCESS: hsvct found in merged $defs');
  process.exit(0);
} else {
  console.error('FAIL: hsvct not found in merged $defs');
  process.exit(2);
}
