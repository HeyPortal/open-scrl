import { beforeEach,describe,expect,it } from 'vitest';
import { command } from '@/core/document/commands';
import { newDocument,useDocumentStore } from './documentStore';
import type { ShapeLayer } from '@/types';

const shape=(id:string):ShapeLayer=>({id,kind:'shape',name:id,x:0,y:0,width:100,height:100,rotation:0,opacity:1,visible:true,locked:false,shape:'rect',fill:'#000',stroke:'transparent',strokeWidth:0,cornerRadius:0});

describe('document history',()=>{
  beforeEach(()=>useDocumentStore.setState({doc:newDocument(),past:[],future:[],transaction:null,selectedSlideId:''}));
  it('undoes and redoes commands',()=>{const store=useDocumentStore.getState();store.execute(command('rename',(d)=>{d.name='Changed';}));expect(useDocumentStore.getState().doc.name).toBe('Changed');useDocumentStore.getState().undo();expect(useDocumentStore.getState().doc.name).toBe('Untitled');useDocumentStore.getState().redo();expect(useDocumentStore.getState().doc.name).toBe('Changed');});
  it('commits a gesture transaction as one entry and can cancel',()=>{let store=useDocumentStore.getState();const tx=store.beginTransaction('gesture');store=useDocumentStore.getState();store.updateTransaction(tx,command('step',(d)=>{d.name='A';}));store.updateTransaction(tx,command('step',(d)=>{d.name='B';}));store.commitTransaction(tx);expect(useDocumentStore.getState().past).toHaveLength(1);const cancel=useDocumentStore.getState().beginTransaction('cancel');useDocumentStore.getState().updateTransaction(cancel,command('step',(d)=>{d.name='C';}));useDocumentStore.getState().cancelTransaction(cancel);expect(useDocumentStore.getState().doc.name).toBe('B');});
  it('moves a selected layer backward or to either edge of the stack',()=>{const doc=newDocument();const slideId=doc.slideOrder[0];doc.layers={back:shape('back'),middle:shape('middle'),front:shape('front')};doc.slides[slideId].layerOrder=['back','middle','front'];useDocumentStore.setState({doc});useDocumentStore.getState().reorderLayer('middle','bottom');expect(useDocumentStore.getState().doc.slides[slideId].layerOrder).toEqual(['middle','back','front']);useDocumentStore.getState().reorderLayer('middle','top');expect(useDocumentStore.getState().doc.slides[slideId].layerOrder).toEqual(['back','front','middle']);useDocumentStore.getState().reorderLayer('middle','down');expect(useDocumentStore.getState().doc.slides[slideId].layerOrder).toEqual(['back','middle','front']);});
});
