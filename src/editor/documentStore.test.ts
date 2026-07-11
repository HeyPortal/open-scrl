import { beforeEach,describe,expect,it } from 'vitest';
import { command } from '@/core/document/commands';
import { newDocument,useDocumentStore } from './documentStore';

describe('document history',()=>{
  beforeEach(()=>useDocumentStore.setState({doc:newDocument(),past:[],future:[],transaction:null,selectedSlideId:''}));
  it('undoes and redoes commands',()=>{const store=useDocumentStore.getState();store.execute(command('rename',(d)=>{d.name='Changed';}));expect(useDocumentStore.getState().doc.name).toBe('Changed');useDocumentStore.getState().undo();expect(useDocumentStore.getState().doc.name).toBe('Untitled');useDocumentStore.getState().redo();expect(useDocumentStore.getState().doc.name).toBe('Changed');});
  it('commits a gesture transaction as one entry and can cancel',()=>{let store=useDocumentStore.getState();const tx=store.beginTransaction('gesture');store=useDocumentStore.getState();store.updateTransaction(tx,command('step',(d)=>{d.name='A';}));store.updateTransaction(tx,command('step',(d)=>{d.name='B';}));store.commitTransaction(tx);expect(useDocumentStore.getState().past).toHaveLength(1);const cancel=useDocumentStore.getState().beginTransaction('cancel');useDocumentStore.getState().updateTransaction(cancel,command('step',(d)=>{d.name='C';}));useDocumentStore.getState().cancelTransaction(cancel);expect(useDocumentStore.getState().doc.name).toBe('B');});
});
