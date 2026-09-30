import { z } from "zod";

const CursorSchema = z.object({ scope:z.string(), fingerprint:z.string(), sort:z.string().max(300), id:z.string().min(1).max(200) });
export interface Pagination { limit:number; scope:string; fingerprint:string; sort:string; id:string }
export async function pagination(url: URL, scope:string, filters:unknown):Promise<Pagination> {
  const rawLimit=url.searchParams.get("limit")??"50";
  const limit=Number(rawLimit);
  if(!/^\d+$/.test(rawLimit)||!Number.isInteger(limit)||limit<1||limit>100)throw new Error("INVALID_PAGE");
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(filters)));
  const fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  const page:Pagination={limit,scope,fingerprint,sort:"",id:""};
  const cursor=url.searchParams.get("cursor");
  if(cursor){
    if(cursor.length>4096)throw new Error("INVALID_CURSOR");
    const parsed=CursorSchema.parse(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(cursor),c=>c.charCodeAt(0)))));
    if(parsed.scope!==scope||parsed.fingerprint!==fingerprint)throw new Error("INVALID_CURSOR");
    page.sort=parsed.sort;page.id=parsed.id;
  }
  return page;
}
export function pageResult<T extends Record<string,unknown>>(rows:T[],page:Pagination,sortKey:keyof T){
  const data=rows.slice(0,page.limit);
  const last=data.at(-1);
  let nextCursor:string|null=null;
  if(rows.length>page.limit&&last){
    const bytes=new TextEncoder().encode(JSON.stringify({scope:page.scope,fingerprint:page.fingerprint,sort:String(last[sortKey]),id:String(last.id)}));
    nextCursor=btoa(String.fromCharCode(...bytes));
  }
  return {data,nextCursor};
}
