import { describe, expect, it } from 'vitest';
import type { Document } from '@/types';
import { migrateDocument, UnsupportedDocumentVersionError } from './migrations';

const legacy:Document={id:'p1',name:'Legacy',format:{name:'Square',width:1080,height:1080},slides:[{id:'s1',background:{kind:'solid',color:'#fff'},layers:[{id:'l1',kind:'shape',name:'Box',x:10,y:20,width:30,height:40,rotation:0,opacity:1,visible:true,locked:false,shape:'rect',fill:'#000',stroke:'transparent',strokeWidth:0,cornerRadius:0}]}],createdAt:1,updatedAt:2};

describe('document migrations',()=>{
  it('normalizes a v1 document without changing ids or order',()=>{const result=migrateDocument(legacy);expect(result.schemaVersion).toBe(2);expect(result.slideOrder).toEqual(['s1']);expect(result.slides.s1.layerOrder).toEqual(['l1']);expect(result.layers.l1.name).toBe('Box');expect(migrateDocument(result)).toBe(result);});
  it('rejects future versions without mutating them',()=>{const value={schemaVersion:99,id:'future'};expect(()=>migrateDocument(value)).toThrow(UnsupportedDocumentVersionError);expect(value).toEqual({schemaVersion:99,id:'future'});});
});
