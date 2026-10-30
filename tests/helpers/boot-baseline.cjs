'use strict';
// Gates that run an earlier app.js beside this source (build606 and others) compare what a game does after it starts,
// never whether the boot asks for a save. This source no longer saves at every boot for the two built-in sea templates
// (build640: only a saved sea route that changes asks for the save), so the earlier app.js is run with that same rule:
// exactly its three maritime-migration lines are replaced, and nothing else in it changes.
const fs = require('node:fs');
const path = require('node:path');
const EDITS = [
  ['  let maritimeMigrationChanged=false;\n', '  let maritimeMigrationChanged=false,maritimeSavedRouteChanged=false;\n'],
  ['if(index>=0)state.customRoutes[index]={...state.customRoutes[index],...clone(route)};}', 'if(index>=0){state.customRoutes[index]={...state.customRoutes[index],...clone(route)};maritimeSavedRouteChanged=true;}}'],
  ['if(maritimeMigrationChanged){state.routesRevision=(Math.max(0,Math.floor(Number(state.routesRevision)||0))+1);save();}', 'if(maritimeMigrationChanged){state.routesRevision=(Math.max(0,Math.floor(Number(state.routesRevision)||0))+1);if(maritimeSavedRouteChanged)save();}'],
];
function withBootWithoutMaritimeSave(text, label = 'the earlier app.js') {
  let out = text;
  for (const [from, to] of EDITS) {
    const count = out.split(from).length - 1;
    if (count !== 1) throw new Error(`${label}: expected one maritime migration line, found ${count}: ${from.trim().slice(0, 60)}`);
    out = out.replace(from, to);
  }
  return out;
}
// Rewrites <tree>/WebApp/app.js in place.
function applyToTree(tree) {
  const file = path.join(tree, 'WebApp', 'app.js');
  fs.writeFileSync(file, withBootWithoutMaritimeSave(fs.readFileSync(file, 'utf8'), file));
}
module.exports = { withBootWithoutMaritimeSave, applyToTree };
