import { beforeEach,describe,expect,it } from 'vitest';
import { command } from '@/core/document/commands';
import { collectProjectAssetScopes,newDocument,useDocumentStore } from './documentStore';
import { useEditorSession } from './sessionStore';
import type { ImageLayer,ShapeLayer } from '@/types';
import type { StoredProjectSummary } from '@/storage/database';

const shape=(id:string):ShapeLayer=>({id,kind:'shape',name:id,x:0,y:0,width:100,height:100,rotation:0,opacity:1,visible:true,locked:false,shape:'rect',fill:'#000',stroke:'transparent',strokeWidth:0,cornerRadius:0});
const image=(id:string,assetId:string):ImageLayer=>({id,kind:'image',name:id,x:0,y:0,width:100,height:100,rotation:0,opacity:1,visible:true,locked:false,assetId,cornerRadius:0,cropOffsetX:0,cropOffsetY:0,cropScale:1});

describe('document history',()=>{
  beforeEach(()=>useDocumentStore.setState({doc:newDocument(),past:[],future:[],transaction:null,selectedSlideId:''}));
  it('undoes and redoes commands',()=>{const store=useDocumentStore.getState();store.execute(command('rename',(d)=>{d.name='Changed';}));expect(useDocumentStore.getState().doc.name).toBe('Changed');useDocumentStore.getState().undo();expect(useDocumentStore.getState().doc.name).toBe('Untitled');useDocumentStore.getState().redo();expect(useDocumentStore.getState().doc.name).toBe('Changed');});
  it('commits a gesture transaction as one entry and can cancel',()=>{let store=useDocumentStore.getState();const tx=store.beginTransaction('gesture');store=useDocumentStore.getState();store.updateTransaction(tx,command('step',(d)=>{d.name='A';}));store.updateTransaction(tx,command('step',(d)=>{d.name='B';}));store.commitTransaction(tx);expect(useDocumentStore.getState().past).toHaveLength(1);const cancel=useDocumentStore.getState().beginTransaction('cancel');useDocumentStore.getState().updateTransaction(cancel,command('step',(d)=>{d.name='C';}));useDocumentStore.getState().cancelTransaction(cancel);expect(useDocumentStore.getState().doc.name).toBe('B');});
  it('moves a selected layer backward or to either edge of the stack',()=>{const doc=newDocument();const slideId=doc.slideOrder[0];doc.layers={back:shape('back'),middle:shape('middle'),front:shape('front')};doc.slides[slideId].layerOrder=['back','middle','front'];useDocumentStore.setState({doc});useDocumentStore.getState().reorderLayer('middle','bottom');expect(useDocumentStore.getState().doc.slides[slideId].layerOrder).toEqual(['middle','back','front']);useDocumentStore.getState().reorderLayer('middle','top');expect(useDocumentStore.getState().doc.slides[slideId].layerOrder).toEqual(['back','front','middle']);useDocumentStore.getState().reorderLayer('middle','down');expect(useDocumentStore.getState().doc.slides[slideId].layerOrder).toEqual(['back','middle','front']);});
  it('applies one background to every slide as a single undoable step',()=>{useDocumentStore.getState().addSlide();const past=useDocumentStore.getState().past.length;const bg={kind:'gradient' as const,from:'#fff',to:'#000',angle:90};useDocumentStore.getState().setBackgroundForAllSlides(bg);const doc=useDocumentStore.getState().doc;expect(doc.slideOrder.map((id)=>doc.slides[id].background)).toEqual([bg,bg]);expect(useDocumentStore.getState().past).toHaveLength(past+1);useDocumentStore.getState().undo();const undone=useDocumentStore.getState().doc;expect(undone.slideOrder.every((id)=>undone.slides[id].background.kind==='solid')).toBe(true);});
  it('keeps the selection when deleting another slide and moves it when deleting the selected one',()=>{const store=()=>useDocumentStore.getState();store().addSlide();store().addSlide();const [first,second,third]=store().doc.slideOrder;store().selectSlide(first);store().deleteSlide(third);expect(store().doc.slideOrder).toEqual([first,second]);expect(useEditorSession.getState().selectedSlideId).toBe(first);store().deleteSlide('missing');expect(store().doc.slideOrder).toEqual([first,second]);store().deleteSlide(first);expect(store().doc.slideOrder).toEqual([second]);expect(useEditorSession.getState().selectedSlideId).toBe(second);});
});

describe('project asset scope migration',()=>{
  it('reports a partial scan so the one-time migration is not committed',async()=>{
    const doc=newDocument();doc.id='project-a';const slideId=doc.slideOrder[0];doc.layers.photo=image('photo','asset-a');doc.slides[slideId].layerOrder=['photo'];
    const project=(id:string):StoredProjectSummary=>({id,name:id,format:doc.format,slideCount:1,createdAt:0,updatedAt:0});
    const result=await collectProjectAssetScopes([project('project-a'),project('project-b')],async(id)=>{
      if(id==='project-a')return doc;
      throw new Error('temporary read failure');
    });
    expect(result.scopes).toEqual([{projectId:'project-a',assetIds:['asset-a']}]);
    expect(result.failures).toEqual([expect.objectContaining({projectId:'project-b'})]);
  });
});
