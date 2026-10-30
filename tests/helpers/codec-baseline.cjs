'use strict';
// Gates that compare the save text of this source with an earlier state-codec-core.js (build507, build577, build585)
// prove a change in how the text is produced, never which sealed segments become vault chunks. The save audit lowered
// TEXT_CHUNK_MIN (16 KB -> 4 KB: 348 KB of the 814 KB save text were sealed segments under 16 KB, sent again with every
// save), so the earlier source is measured with this source's threshold: exactly one TEXT_CHUNK_MIN definition is
// replaced, and nothing else in it changes.
const fs = require('node:fs');
const path = require('node:path');
const DEFINITION = /\bTEXT_CHUNK_MIN=(\d+)\b/g;
function threshold(text, label) {
  const found = [...text.matchAll(DEFINITION)];
  if (found.length !== 1) throw new Error(`${label}: expected one TEXT_CHUNK_MIN definition, found ${found.length}`);
  return found[0][1];
}
function withCurrentTextChunkMin(previous, root) {
  const current = threshold(fs.readFileSync(path.join(root, 'WebApp', 'state-codec-core.js'), 'utf8'), 'this source');
  threshold(previous, 'the earlier source');
  return previous.replace(DEFINITION, `TEXT_CHUNK_MIN=${current}`);
}
module.exports = { withCurrentTextChunkMin };
