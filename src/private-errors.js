// Persist only allowlisted diagnostics. Raw CLI/provider text is transient and
// may contain private prompts, tokens, URLs or account identifiers.
const categories=new Set(['auth_required','permission_denied','rate_limited','timeout','unavailable','unsupported_cli','network_error','invalid_response','provider_error']);
const stages=new Set(['preflight','invoke','provider']);
export class PrivateReplyError extends Error {
 constructor(category,stage){super('Private reply failed');this.category=categories.has(category)?category:'provider_error';this.stage=stages.has(stage)?stage:'provider';}
}
export function privateFailure(error,stage='provider'){
 if(error instanceof PrivateReplyError)return error;
 const code=error?.code,status=Number(error?.status),message=String(error?.message||'');
 let category='provider_error';
 if(status===401||/not logged in|authentication required|unauthenticated|please log in|login required/i.test(message))category='auth_required';
 else if(status===403||code==='EACCES'||code==='EPERM'||/permission denied|not permitted/i.test(message))category='permission_denied';
 else if(status===429||/rate limit|usage limit|session limit|quota exceeded/i.test(message))category='rate_limited';
 else if(code==='ETIMEDOUT'||error?.name==='TimeoutError')category='timeout';
 else if(code==='ENOENT')category='unavailable';
 else if(/unknown option|unrecognized option|unsupported option/i.test(message))category='unsupported_cli';
 else if(['ECONNREFUSED','ECONNRESET','ENOTFOUND'].includes(code)||/fetch failed|network error|connection refused/i.test(message))category='network_error';
 return new PrivateReplyError(category,stage);
}
