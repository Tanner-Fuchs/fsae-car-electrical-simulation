// Prints a JSON snapshot of the JavaScript model (the published page) so the
// Python port can be checked against it:  node tools/snapshot.js path/to/sim.js
const S = require(require('path').resolve(process.argv[2]));
const cases = require('../tests/cases.json');
const out = {};
for (const [name, [fn, args]] of Object.entries(cases)) {
  const a = args.map(x => (x && x.__lap__ ? S.simulateLap(x.__lap__) : x));
  out[name] = S[fn](...a);
}
process.stdout.write(JSON.stringify(out));
