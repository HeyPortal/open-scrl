import { describe, expect, it } from 'vitest';
import type { Document, ImageLayer } from '@/types';
import { migrateDocument, UnsupportedDocumentVersionError } from './migrations';

const legacy:Document={id:'p1',name:'Legacy',format:{name:'Square',width:1080,height:1080},slides:[{id:'s1',background:{kind:'solid',color:'#fff'},layers:[{id:'l1',kind:'shape',name:'Box',x:10,y:20,width:30,height:40,rotation:0,opacity:1,visible:true,locked:false,shape:'rect',fill:'#000',stroke:'transparent',strokeWidth:0,cornerRadius:0}]}],createdAt:1,updatedAt:2};

describe('document migrations',()=>{
  it('normalizes a v1 document without changing ids or order',()=>{const result=migrateDocument(legacy);expect(result.schemaVersion).toBe(2);expect(result.slideOrder).toEqual(['s1']);expect(result.slides.s1.layerOrder).toEqual(['l1']);expect(result.layers.l1.name).toBe('Box');expect(migrateDocument(result)).toBe(result);});
  it('rejects future versions without mutating them',()=>{const value={schemaVersion:99,id:'future'};expect(()=>migrateDocument(value)).toThrow(UnsupportedDocumentVersionError);expect(value).toEqual({schemaVersion:99,id:'future'});});
});

describe('additive frame metadata migration', () => {
  const photo: ImageLayer = { id: 'photo', kind: 'image', name: 'Photo', assetId: 'original', x: 10, y: 20, width: 300, height: 400, rotation: 5, opacity: 1, visible: true, locked: false, cornerRadius: 0, cropOffsetX: .2, cropOffsetY: -.1, cropScale: 1.4, stroke: '#fff', strokeWidth: 24 };
  it('keeps older photo crops and borders unchanged and preserves supported frames', () => {
    const old = structuredClone(legacy); old.slides[0].layers = [{ ...photo }];
    const doc = migrateDocument(old);
    expect(doc.layers.photo).toEqual(photo);
    expect(migrateDocument(doc)).toBe(doc);
    Object.assign(doc.layers.photo, { frameStyle: 'polaroid' });
    expect(migrateDocument(doc)).toBe(doc);
    expect(doc.layers.photo).toMatchObject({ frameStyle: 'polaroid', cropScale: 1.4, strokeWidth: 24 });
  });
  it('falls back from unsupported styles without mutating the stored input', () => {
    const doc = migrateDocument(legacy);
    doc.layers.photo = { ...photo };
    doc.slides.s1.layerOrder = ['photo'];
    Object.assign(doc.layers.photo, { frameStyle: 'unsupported' });
    const migrated = migrateDocument(doc);
    expect(migrated.layers.photo).toEqual(photo);
    expect(doc.layers.photo).toMatchObject({ frameStyle: 'unsupported' });
  });
});
