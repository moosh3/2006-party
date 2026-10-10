import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import ts from 'typescript';

const source = readFileSync('lib/audience-cue-config.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
for (const [mode, flag, expected] of [
  ['production', undefined, false], ['production', '1', false],
  ['development', undefined, false], ['development', '1', true], ['test', '1', true],
] as const) {
  const testModule = { exports: {} as Record<string, any> };
  const context = createContext({ module: testModule, exports: testModule.exports,
    process: { env: { NODE_ENV: mode, NEXT_PUBLIC_AUDIENCE_CUE_REHEARSAL: flag } },
    require: () => { throw new Error('Config must not import runtime dependencies or credentials'); } });
  new Script(compiled).runInContext(context);
  const config = testModule.exports.SHOW_AUDIENCE_CUES;
  assert.equal(config.enabled, expected);
  assert.equal(config.cues.length > 0, expected);
  assert.equal(config.showId !== '', expected);
  console.log(`PASS ${mode} / ${flag ?? 'no rehearsal flag'}: ${expected ? 'isolated rehearsal' : 'disabled/empty'}`);
}
console.log('Production cannot activate synthetic rehearsal cues, even if the rehearsal flag is set.');
