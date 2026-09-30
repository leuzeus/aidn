import http from "node:http";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";

const BODY_LIMIT=2*1024*1024, RESPONSE_LIMIT=16384, OUTSTANDING_LIMIT=8, NONCE_LIMIT=10000;
const TOKEN=/^[a-f0-9]{64}$/, NONCE=/^[a-f0-9]{32}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const mac=(token,direction,nonce,body)=>createHmac("sha256",token).update(`${direction}\n${nonce}\n${body}`).digest("hex");
const equalMac=(left,right)=>typeof left==="string" && TOKEN.test(left) && timingSafeEqual(Buffer.from(left,"hex"),Buffer.from(right,"hex"));
const failure=code=>Object.assign(new Error(code),{code});
const validDecision=(value,attemptId,requestSha256)=>value && value.protocol_version===1
  && ["allow","deny"].includes(value.outcome) && value.ok===(value.outcome==="allow") && /^[A-Z][A-Z0-9_]{0,95}$/.test(value.reason_code ?? "")
  && value.attempt_id===attemptId && value.request_sha256===requestSha256;
function boundedWait(promise,milliseconds) {
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure("ADMISSION_CLOSE_UNCONFIRMED")),milliseconds);})])
    .finally(()=>clearTimeout(timer));
}

// One listener and secret belong to one immutable attempt/request binding.
// No command, database operation, URL forwarding, or startup exception exists.
export async function startAgentAdmissionTransport({admit,attemptId,requestSha256}={}) {
  if(typeof admit!=="function" || !ID.test(attemptId ?? "") || !TOKEN.test(requestSha256 ?? "")) throw failure("ADMISSION_TRANSPORT_CONFIGURATION_REQUIRED");
  const token=randomBytes(32).toString("hex"), nonces=new Set(), abort=new AbortController();
  let closed=false, outstanding=0, serial=Promise.resolve(), host, closePromise;
  const deny=reason=>({protocol_version:1,ok:false,outcome:"deny",reason_code:reason,attempt_id:attemptId,request_sha256:requestSha256});
  function respond(response,status,value,nonce) {
    if(response.destroyed || response.writableEnded) return;
    let body=JSON.stringify(value);
    if(Buffer.byteLength(body)>RESPONSE_LIMIT) {status=503;body=JSON.stringify(deny("ADMISSION_RESPONSE_TOO_LARGE"));}
    response.writeHead(status,{"content-type":"application/json","content-length":Buffer.byteLength(body),"connection":"close","cache-control":"no-store",
      ...(NONCE.test(nonce ?? "")?{"x-aidn-auth":mac(token,"response",nonce,body)}:{})});
    response.end(body);
  }
  const server=http.createServer({connectionsCheckingInterval:250},(request,response)=>{
    const nonce=request.headers["x-aidn-nonce"];
    if(closed || request.method!=="POST" || request.url!=="/v1/admit" || request.headers.host!==host
      || request.headers.origin!==undefined || request.headers.cookie!==undefined || request.headers.expect!==undefined
      || request.headers["transfer-encoding"]!==undefined || request.headers["content-type"]!=="application/json"
      || !NONCE.test(nonce ?? "") || !TOKEN.test(request.headers["x-aidn-auth"] ?? "")) {
      respond(response,400,deny("ADMISSION_PROTOCOL_REFUSED"),nonce); request.resume(); return;
    }
    const rawLength=request.headers["content-length"];
    const length=typeof rawLength==="string" && /^(0|[1-9][0-9]*)$/.test(rawLength)?Number(rawLength):NaN;
    if(!Number.isSafeInteger(length) || length<2 || length>BODY_LIMIT || outstanding>=OUTSTANDING_LIMIT) {
      respond(response,413,deny("ADMISSION_REQUEST_LIMIT"),nonce); request.resume(); return;
    }
    outstanding+=1;
    let bytes=0, parts=[], released=false, bodyComplete=false;
    const release=()=>{if(!released){released=true;outstanding-=1;}};
    request.setTimeout(5000,()=>request.destroy());
    request.on("error",()=>{if(!bodyComplete)release();}); request.on("aborted",()=>{if(!bodyComplete)release();});
    request.on("data",part=>{
      bytes+=part.length;
      if(bytes>length || bytes>BODY_LIMIT){parts=[];request.destroy();release();return;}
      parts.push(part);
    });
    request.on("end",()=>{
      if(released)return;
      bodyComplete=true;
      // The socket's 5s idle limit protects request ingestion only. Keeping it
      // here would discard a valid admission while the supervisor is working.
      // Bound the complete response phase (including serialized queue time)
      // separately; the hook still has its stricter 6.5s client deadline and
      // the store bounds its evaluator to 4.5s without relaxing live checks.
      request.setTimeout(0);
      const responseDeadline=setTimeout(()=>response.destroy(),10000);
      response.once("close",()=>clearTimeout(responseDeadline));
      const body=Buffer.concat(parts).toString("utf8"); parts=[];
      if(bytes!==length || !equalMac(request.headers["x-aidn-auth"],mac(token,"request",nonce,body))) {
        release(); respond(response,401,deny("ADMISSION_AUTHENTICATION_REFUSED"),nonce); return;
      }
      if(nonces.has(nonce) || nonces.size>=NONCE_LIMIT) {release();respond(response,409,deny("ADMISSION_NONCE_REFUSED"),nonce);return;}
      nonces.add(nonce);
      let packet;
      try {packet=JSON.parse(body);}catch{release();respond(response,400,deny("ADMISSION_JSON_INVALID"),nonce);return;}
      if(packet?.attempt_id!==attemptId || packet?.request_sha256!==requestSha256) {
        release();respond(response,403,deny("ADMISSION_BINDING_REFUSED"),nonce);return;
      }
      serial=serial.then(async()=>{
        if(closed || response.destroyed){respond(response,503,deny("ADMISSION_TRANSPORT_CLOSED"),nonce);return;}
        try {
          const value=await admit(packet,{signal:abort.signal});
          if(closed || abort.signal.aborted){respond(response,503,deny("ADMISSION_TRANSPORT_CLOSED"),nonce);return;}
          if(!validDecision(value,attemptId,requestSha256)) throw failure("ADMISSION_DECISION_INVALID");
          respond(response,200,value,nonce);
        } catch {respond(response,503,deny("ADMISSION_SERVICE_UNAVAILABLE"),nonce);}
      }).finally(release);
    });
  });
  server.headersTimeout=5000; server.requestTimeout=10000; server.maxHeadersCount=16; server.maxConnections=OUTSTANDING_LIMIT;
  server.on("clientError",(_error,socket)=>socket.destroy());
  server.on("checkContinue",(request,response)=>{respond(response,417,deny("ADMISSION_PROTOCOL_REFUSED"));request.resume();});
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  host=`127.0.0.1:${server.address().port}`;
  return Object.freeze({endpoint:`http://${host}/v1/admit`,token,close(){
    if(closePromise)return closePromise;
    closed=true;abort.abort();
    const stopped=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    server.closeAllConnections();
    closePromise=boundedWait(Promise.all([stopped,serial]),10000).then(()=>undefined);
    return closePromise;
  }});
}

// HMAC both ways prevents a different local process acquiring a stopped port
// from fabricating allow. The shared secret is never transmitted on the wire.
export function requestAgentAdmission({endpoint,token,request,timeoutMs=10000}={}) {
  return new Promise((resolve,reject)=>{
    const endpointMatch=typeof endpoint==="string" && /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/v1\/admit$/.exec(endpoint);
    if(!endpointMatch || Number(endpointMatch[1])>65535 || !TOKEN.test(token ?? "")
      || !Number.isSafeInteger(timeoutMs) || timeoutMs<1 || timeoutMs>10000) {reject(failure("ADMISSION_CLIENT_CONFIGURATION_REQUIRED"));return;}
    let body;
    try {body=JSON.stringify(request);}catch{reject(failure("ADMISSION_REQUEST_INVALID"));return;}
    if(typeof body!=="string" || Buffer.byteLength(body)>BODY_LIMIT) {reject(failure("ADMISSION_REQUEST_LIMIT"));return;}
    const nonce=randomBytes(16).toString("hex");
    let deadline;
    const succeed=value=>{clearTimeout(deadline);resolve(value);};
    const refuse=error=>{clearTimeout(deadline);reject(error);};
    const outgoing=http.request({hostname:"127.0.0.1",port:Number(endpointMatch[1]),path:"/v1/admit",method:"POST",agent:false,
      headers:{"content-type":"application/json","content-length":Buffer.byteLength(body),"x-aidn-nonce":nonce,"x-aidn-auth":mac(token,"request",nonce,body)}},response=>{
      let bytes=0,parts=[];
      response.on("data",part=>{bytes+=part.length;if(bytes>RESPONSE_LIMIT){parts=[];response.destroy();outgoing.destroy();refuse(failure("ADMISSION_RESPONSE_TOO_LARGE"));return;}parts.push(part);});
      response.on("error",()=>refuse(failure("ADMISSION_TRANSPORT_UNAVAILABLE")));
      response.on("end",()=>{
        const text=Buffer.concat(parts).toString("utf8");
        if(response.headers["content-type"]!=="application/json" || !equalMac(response.headers["x-aidn-auth"],mac(token,"response",nonce,text))) {
          refuse(failure("ADMISSION_RESPONSE_AUTHENTICATION_REFUSED"));return;
        }
        let result;
        try {result=JSON.parse(text);}catch{refuse(failure("ADMISSION_RESPONSE_INVALID"));return;}
        if(!validDecision(result,request?.attempt_id,request?.request_sha256)) {refuse(failure("ADMISSION_RESPONSE_INVALID"));return;}
        if(response.statusCode!==200 && result.outcome!=="deny") {refuse(failure("ADMISSION_RESPONSE_INVALID"));return;}
        succeed(result);
      });
    });
    deadline=setTimeout(()=>{outgoing.destroy();refuse(failure("ADMISSION_TRANSPORT_TIMEOUT"));},timeoutMs);
    outgoing.on("error",()=>refuse(failure("ADMISSION_TRANSPORT_UNAVAILABLE")));
    outgoing.end(body);
  });
}
