import { HttpError,type Env } from '../config';
import type { ProdioKind } from '../../../../packages/core/src/prodio';
export const prodioTenant='edd1a500-0000-4000-8000-000000000001';
export const paths={pedidos:'/pedidos',compras:'/compras/ordens',notas:'/notas'};
export class ProdioError extends HttpError {
 constructor(message:string,public retrySeconds=60,public temporary=false){super(502,message);}
}
export const configured=(env:Env)=>!!env.PRODIO_API_TOKEN?.trim();
export class ProdioClient {
 constructor(private env:Env,private fetcher:typeof fetch=(...args)=>fetch(...args)){
  if(!env.PRODIO_API_TOKEN||!/^prodio_live_[A-Za-z0-9_-]{43}$/.test(env.PRODIO_API_TOKEN))throw new HttpError(503,'Configure PRODIO_API_TOKEN com o token da empresa Eddias.');
 }
 async get(kind:ProdioKind|'eu',params:Record<string,string>={}){
  const url=new URL('https://api.prodio.com.br/v1'+(kind==='eu'?'/eu':paths[kind]));for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
  let r:Response;try{r=await this.fetcher(url,{method:'GET',headers:{Accept:'application/json',Authorization:'Bearer '+this.env.PRODIO_API_TOKEN},redirect:'manual',signal:AbortSignal.timeout(20000)});}catch{throw new ProdioError('Prodio temporariamente indisponível.',60,true);}
  if(!r.ok){
   if(r.status===429){const n=Number(r.headers.get('Retry-After'));throw new ProdioError('Limite da API Prodio atingido; nova tentativa após o intervalo.',Number.isFinite(n)&&n>0?Math.min(Math.ceil(n)+1,31536000):60,true);}
   if(r.status>=500)throw new ProdioError('API Prodio temporariamente indisponível (HTTP '+r.status+').',60,true);
   throw new ProdioError(r.status===401?'Prodio recusou o token. Confira validade e revogação.':r.status===403?'Prodio recusou o acesso. Confira escopos, empresa e vínculo administrativo do token.':r.status===404?'Rota Prodio ainda não disponível. Pedidos, compras e notas exigem a entrega E2.':'Prodio retornou HTTP '+r.status+'. Confira o contrato antes de retomar.');
  }
  const reader=r.body?.getReader();if(!reader)throw new ProdioError('Prodio retornou resposta vazia.');
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>4_000_000){await reader.cancel();throw new ProdioError('Resposta Prodio excede o limite; nenhum lote foi confirmado.');}chunks.push(chunk.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ProdioError('Prodio não retornou JSON reconhecível.');}
 }
}
