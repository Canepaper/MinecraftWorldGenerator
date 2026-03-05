#!/usr/bin/env node
/**
 * Builds contributors/contributors.js from individual JSON files in contributors/people/.
 * Run: node scripts/build-contributors.js
 * Each contributor adds their own file (e.g. johndoe.json) — no merge conflicts.
 */
var fs = require('fs');
var path = require('path');

var peopleDir = path.join(__dirname, '..', 'contributors', 'people');
var outFile = path.join(__dirname, '..', 'contributors', 'contributors.js');

var files = fs.readdirSync(peopleDir)
  .filter(function (f) { return f.endsWith('.json') && !f.startsWith('_'); })
  .sort();

var data = [];
for (var i = 0; i < files.length; i++) {
  try {
    var raw = fs.readFileSync(path.join(peopleDir, files[i]), 'utf8');
    var obj = JSON.parse(raw);
    if (obj.name && obj.github) data.push(obj);
  } catch (e) {
    console.warn('Skipping ' + files[i] + ': ' + e.message);
  }
}
if (data.length === 0) {
  data = [{ name: 'Add Your Name', title: 'Contributor', description: 'Create contributors/people/yourname.json and run: node scripts/build-contributors.js', avatar: '', github: 'https://github.com/yourusername' }];
}

var js = '/**\n * Auto-generated from contributors/people/*.json\n * Run: node scripts/build-contributors.js\n */\n' +
  'var CONTRIBUTORS_DATA = ' + JSON.stringify(data, null, 2) + ';\n';

fs.writeFileSync(outFile, js);
console.log('Built contributors.js with ' + data.length + ' contributor(s)');
