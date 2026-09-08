import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error local display module
import { pythonCallableSignature } from '../../scripts/semantic-reader-python-signature.mjs';

test('Python declarations retain keyword-only, default and variadic inputs without executing them', () => {
  const result = pythonCallableSignature('def resolve(context: dict, /, *, source: Source | None = None, **kwargs) -> tuple[dict, dict]:\n    raise RuntimeError("must not run")');
  assert.deepEqual(result.inputs, [
    {name:'context',type:'dict',optional:false},
    {name:'source',type:'Source | None',optional:true},
    {name:'**kwargs',type:null,optional:false},
  ]);
  assert.equal(result.output, 'tuple[dict, dict]');
});
test('Python unknown annotations stay unknown; decorated async functions retain their declaration', () => {
  assert.equal(pythonCallableSignature('class Example:\n    pass'), null);
  const result = pythonCallableSignature('@decorator\nasync def f(self, *args):\n    return None');
  assert.equal(result.output, null);
  assert.deepEqual(result.inputs.map((x: {name:string}) => x.name), ['self','*args']);
});
test('large Python definitions exceed the native parser default buffer', () => {
  const result = pythonCallableSignature('def large(x: str) -> str:\n' + '    # long source comment\n'.repeat(3000) + '    return x\n');
  assert.equal(result.inputs[0].name, 'x');
  assert.equal(result.output, 'str');
});
