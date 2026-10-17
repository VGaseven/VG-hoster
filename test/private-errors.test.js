import {test} from 'node:test';
import assert from 'node:assert/strict';
import {privateFailure,PrivateReplyError} from '../src/private-errors.js';
test('private diagnostics emit only fixed categories and stages, never raw secrets',()=>{
 const cases=[[{status:401},'auth_required'],[{status:403},'permission_denied'],[{status:429},'rate_limited'],[{code:'ETIMEDOUT'},'timeout'],[{code:'ENOENT'},'unavailable'],[{message:'unknown option --flag Bearer SECRET'},'unsupported_cli'],[{code:'ECONNREFUSED'},'network_error'],[{message:'unexpected SECRET'},'provider_error']];
 for(const [input,category] of cases){const safe=privateFailure({...input,message:input.message||'SECRET https://private.example'},'invoke');assert.equal(safe.category,category);assert.equal(safe.stage,'invoke');assert.ok(!JSON.stringify(safe).includes('SECRET'));assert.equal(safe.message,'Private reply failed');}
 const forged=new PrivateReplyError('SECRET','SECRET');assert.equal(forged.category,'provider_error');assert.equal(forged.stage,'provider');
});
