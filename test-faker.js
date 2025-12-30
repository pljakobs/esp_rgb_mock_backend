// test-faker.js
// Test merging defs.cfgdb into app-data.cfgdb and generating mock data with json-schema-faker

const fs = require('fs');
const path = require('path');
const jsf = require('json-schema-faker');

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
          const match = ref.match(/^([a-zA-Z0-9_-]+)\/$defs\/(.+)$/);
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
          }
        } else {
          merge(obj[key]);
        }
      }
    }
  }
  merge(schema);
}

function rewriteRefsToLocal(obj) {
  if (Array.isArray(obj)) {
    obj.forEach(rewriteRefsToLocal);
  } else if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      if (key === '$ref' && typeof obj[key] === 'string') {
        let ref = obj[key];
        const match = ref.match(/^([a-zA-Z0-9_-]+)\/$defs\/(.+)$/);
        if (match) {
          const refDef = match[2];
          obj[key] = `#/$defs/${refDef}`;
          console.log(`[schema-ref] Rewrote $ref from '${ref}' to '${obj[key]}'`);
        }
      } else {
        rewriteRefsToLocal(obj[key]);
      }
    }
  }
}

const schemasDir = path.join(__dirname, 'api-schemas');
const dataSchemaPath = path.join(schemasDir, 'app-data.cfgdb');
const defsSchemaPath = path.join(schemasDir, 'defs.cfgdb');

if (!fs.existsSync(dataSchemaPath) || !fs.existsSync(defsSchemaPath)) {
  console.error('Test requires app-data.cfgdb and defs.cfgdb in api-schemas');
  process.exit(1);
}



const dataSchema = loadSchemaFile(dataSchemaPath);
// Unconditionally merge all $defs from defs.cfgdb into the main schema
const defsSchema = loadSchemaFile(defsSchemaPath);
if (defsSchema.$defs) {
  if (!dataSchema.$defs) dataSchema.$defs = {};
  Object.assign(dataSchema.$defs, defsSchema.$defs);
  console.log('[schema-merge] Unconditionally merged all $defs from defs.cfgdb into schema');
}

// Utility to collect all $ref values in a schema
function collectRefs(obj, refs = []) {
  if (Array.isArray(obj)) {
    obj.forEach(item => collectRefs(item, refs));
  } else if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      if (key === '$ref' && typeof obj[key] === 'string') {
        refs.push(obj[key]);
      } else {
        collectRefs(obj[key], refs);
      }
    }
  }
  return refs;
}

// Print all $ref values BEFORE rewrite
console.log('All $ref values BEFORE rewrite:');
collectRefs(dataSchema).forEach(ref => console.log('  ', ref));

// After merging, rewrite all $ref values in the entire schema (including $defs)
function deepRewriteRefs(obj) {
  if (Array.isArray(obj)) {
    obj.forEach(deepRewriteRefs);
  } else if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      if (key === '$ref' && typeof obj[key] === 'string') {
        let ref = obj[key];
        // Rewrite any $ref containing '/$defs/' to local $defs
        const idx = ref.indexOf('/$defs/');
        if (idx !== -1) {
          const refDef = ref.substring(idx + 7); // after '/$defs/'
          obj[key] = `#/$defs/${refDef}`;
          console.log(`[schema-ref] Rewrote $ref from '${ref}' to '${obj[key]}'`);
        }
      } else {
        deepRewriteRefs(obj[key]);
      }
    }
  }
}
deepRewriteRefs(dataSchema);


// Print all $ref values AFTER rewrite
console.log('All $ref values AFTER rewrite:');
collectRefs(dataSchema).forEach(ref => console.log('  ', ref));

if (dataSchema.$defs) {
  console.log('Merged schema $defs keys:', Object.keys(dataSchema.$defs));
  // Uncomment the next line to print the full $defs object for deep debugging
  // console.dir(dataSchema.$defs, { depth: 5 });
} else {
  console.log('No $defs found in merged schema!');
}

jsf.resolve(dataSchema)
  .then(sample => {
    console.log('json-schema-faker output:');
    console.log(JSON.stringify(sample, null, 2));
    process.exit(0);
  })
  .catch(e => {
    console.error('FAKER ERROR:', e);
    process.exit(2);
  });
